var e=Object.assign({"./absorption.wgsl":`// absorption.wgsl -- Beer-Lambert light absorption and in-scattering for light that travels through water.
//
// Water is not a flat tint: red is absorbed within a few metres, green within tens, blue survives
// longest, so colour shifts from the bed's own colour toward teal, then deep blue, with depth. The model
// here is the standard cheap one: per-channel exponential transmittance exp(-sigma * path) plus a single
// "fog" term that scatters light toward a scatter colour as the path gets longer. PATH LENGTH (or depth)
// is always a parameter: feed it an analytic depth today, a depth-buffer difference in a 3D scene later.
//
// UNITS. Path lengths and depths are in metres, coefficients in 1/metre, whatever scale your scene uses
// as long as you stay consistent. Colours are LINEAR rgb.
//
// Designer-friendly coefficients
//   absorb_coefficients_from_color(color: vec3f, depth: f32) -> vec3f
//       sigma such that white light has turned into \`color\` after \`depth\`: sigma = -ln(color) / depth.
//       color is clamped to [1e-4, 1]. "Clear tropical water turns (0.06, 0.5, 0.72) at 6 m".
//   absorb_turbidity_from_visibility(visibility: f32) -> f32
//       scattering coefficient from how far you can see (Secchi depth, metres): 1.7 / visibility.
//
// Transmittance and slant paths
//   absorb_transmittance(sigma: vec3f, path: f32) -> vec3f     exp(-sigma * path); 1 at path 0, non-increasing,
//                                                              always in [0, 1] (negative path counts as 0)
//   absorb_cos_refracted(cos_view: f32, ior: f32) -> f32       cosine of the ray's angle inside the water,
//                                                              given the cosine in the air (Snell's law)
//   absorb_path_length(depth, cos_view, ior) -> f32            vertical \`depth\` -> length along the refracted
//                                                              view ray: depth / cos_refracted (cos clamped >= 0.05).
//                                                              cos_view = 1 looking straight down; ior = 1.333
//   absorb_path_length_two_way(depth, cos_view, cos_light, ior) -> f32
//                                                              sun going down plus eye coming up: the light that
//                                                              lit the bed took a slant path too
//
// Compositing
//   struct AbsorbWater { sigma: vec3f, scatter: vec3f, turbidity: f32 }
//       sigma: absorption per metre; scatter: colour of the light scattered back (sky / sun tinted, roughly
//       the colour of very deep water divided by its brightness); turbidity: scattering coefficient per metre
//   absorb_composite(bed: vec3f, sigma: vec3f, turbidity: f32, scatter: vec3f, path: f32) -> vec3f
//       what the eye sees: bed * T + scatter * (turbidity / extinction) * (1 - T) per channel, with
//       extinction = sigma + turbidity and T = exp(-extinction * path). Path 0 returns the bed exactly;
//       turbidity 0 returns bed * absorb_transmittance; path -> infinity returns absorb_deep_color. Never
//       brighter than max(bed, scatter) per channel.
//   absorb_deep_color(sigma, turbidity, scatter) -> vec3f      the colour of water too deep to see the bed
//   absorb_water(kind: i32) -> AbsorbWater                     named water types, derived from "colour at depth":
//       0 clear tropical (6 m)   1 coastal (3 m)   2 murky green (1.5 m)   3 tea lake (1.5 m)
//       4 glacial milk (4 m)     5 swimming pool (3 m)   6 open ocean (20 m).   kind is clamped to 0..6
//   ABSORB_TYPE_COUNT = 7
//
// Cost: transmittance is one exp per channel (3 exp); composite is 3 exp + ~15 ALU; absorb_water is 3 log
// and a select chain, so call it once outside any loop (and hoist it if \`kind\` is uniform). This is the
// single-scatter, uniformly lit approximation: no sun-shafts, no depth-dependent light colour for the
// in-scattered part. Good for tints and fog, not for underwater volumetrics.

const ABSORB_TYPE_COUNT: i32 = 7;
const ABSORB_MIN_COS: f32 = 0.05;

struct AbsorbWater {
  sigma: vec3f,
  scatter: vec3f,
  turbidity: f32,
}

fn absorb_coefficients_from_color(color: vec3f, depth: f32) -> vec3f {
  let c = clamp(color, vec3f(1e-4), vec3f(1.0));
  return -log(c) / max(depth, 1e-4);
}

fn absorb_turbidity_from_visibility(visibility: f32) -> f32 {
  return 1.7 / max(visibility, 1e-3);
}

fn absorb_transmittance(sigma: vec3f, path: f32) -> vec3f {
  return exp(-max(sigma, vec3f(0.0)) * max(path, 0.0));
}

fn absorb_cos_refracted(cos_view: f32, ior: f32) -> f32 {
  let c = clamp(cos_view, 0.0, 1.0);
  let n = max(ior, 1.0);
  return sqrt(max(1.0 - (1.0 - c * c) / (n * n), 0.0));
}

fn absorb_path_length(depth: f32, cos_view: f32, ior: f32) -> f32 {
  return max(depth, 0.0) / max(absorb_cos_refracted(cos_view, ior), ABSORB_MIN_COS);
}

fn absorb_path_length_two_way(depth: f32, cos_view: f32, cos_light: f32, ior: f32) -> f32 {
  let down = 1.0 / max(absorb_cos_refracted(cos_light, ior), ABSORB_MIN_COS);
  let up = 1.0 / max(absorb_cos_refracted(cos_view, ior), ABSORB_MIN_COS);
  return max(depth, 0.0) * (down + up);
}

fn absorb_composite(bed: vec3f, sigma: vec3f, turbidity: f32, scatter: vec3f, path: f32) -> vec3f {
  let extinction = max(sigma, vec3f(0.0)) + vec3f(max(turbidity, 0.0));
  let t = exp(-extinction * max(path, 0.0));
  let albedo = vec3f(max(turbidity, 0.0)) / max(extinction, vec3f(1e-6));
  return bed * t + scatter * albedo * (vec3f(1.0) - t);
}

fn absorb_deep_color(sigma: vec3f, turbidity: f32, scatter: vec3f) -> vec3f {
  let extinction = max(sigma, vec3f(0.0)) + vec3f(max(turbidity, 0.0));
  return scatter * vec3f(max(turbidity, 0.0)) / max(extinction, vec3f(1e-6));
}

fn absorb_water(kind: i32) -> AbsorbWater {
  var color = vec3f(0.06, 0.5, 0.72); // colour white light turns after \`depth\` metres
  var depth = 6.0;
  var scatter = vec3f(0.3, 0.5, 0.95);
  var turbidity = 0.03;
  let k = clamp(kind, 0, ABSORB_TYPE_COUNT - 1);
  if (k == 1) { // coastal: green-turquoise, a little silt
    color = vec3f(0.12, 0.55, 0.5);
    depth = 3.0;
    scatter = vec3f(0.35, 0.65, 0.55);
    turbidity = 0.15;
  } else if (k == 2) { // murky green: algae and silt
    color = vec3f(0.1, 0.5, 0.12);
    depth = 1.5;
    scatter = vec3f(0.3, 0.55, 0.2);
    turbidity = 0.6;
  } else if (k == 3) { // tea lake: tannins eat blue first
    color = vec3f(0.35, 0.15, 0.04);
    depth = 1.5;
    scatter = vec3f(0.35, 0.18, 0.06);
    turbidity = 0.25;
  } else if (k == 4) { // glacial milk: rock flour, strong scattering
    color = vec3f(0.25, 0.65, 0.8);
    depth = 4.0;
    scatter = vec3f(0.55, 0.85, 0.9);
    turbidity = 0.8;
  } else if (k == 5) { // swimming pool
    color = vec3f(0.35, 0.85, 0.95);
    depth = 3.0;
    scatter = vec3f(0.5, 0.9, 1.0);
    turbidity = 0.02;
  } else if (k == 6) { // open ocean
    color = vec3f(0.02, 0.45, 0.75);
    depth = 20.0;
    scatter = vec3f(0.25, 0.42, 0.8);
    turbidity = 0.01;
  }
  return AbsorbWater(absorb_coefficients_from_color(color, depth), scatter, turbidity);
}
`,"./backdrop.wgsl":`// backdrop.wgsl -- procedural things to look THROUGH water at: pool tiles, a test card, sandy bed.
//
// Refraction, absorption and foam all need a backdrop whose distortion is easy to judge. These are pure
// functions of a position, return LINEAR rgb (finite, in [0, 1]) and use no textures, so they can be
// drawn straight into a render target (the production pattern: the scene behind the water is a texture)
// or evaluated analytically per pixel. None of them uses derivatives; anti-aliasing is driven by an
// explicit \`aa\` argument (the size of one pixel in the function's own units), so they run in compute
// shaders (tests) as well as fragments. Pass aa = 0 for hard edges.
//
//   backdrop_pool_tiles(p: vec2f, aa: f32) -> vec3f
//       p in TILE units (one tile = 1.0). Aqua tiles with per-tile brightness jitter, a bevel, pale grout
//       lines and a dark lane stripe every 8 columns. The classic reference for judging refraction: every
//       line is straight, so any bend is the water's doing. aa in tile units.
//   backdrop_test_card(uv: vec2f, aspect: f32, aa: f32) -> vec3f
//       uv 0..1 over the whole image (top-left origin), aspect = width / height (images narrower than
//       1.5:1 get the whole card shrunk to fit their width). Mid-grey card with a
//       10% line grid (bold every 5th), colour bars on top, a grey ramp at the bottom, a black disc with
//       concentric rings (distortion becomes visible as ovals), a Siemens star, a checker patch and
//       fine stripes (dispersion fringes show on every black/white edge). aa in uv-height units
//       (1 / image height in pixels).
//   backdrop_sand(p: vec2f, pebbles: f32) -> vec3f
//       p in world units where a pebble is about 0.25-0.5 across and ripple marks repeat every ~0.8. Sand
//       grain, mottling, ripple marks and shaded pebbles with contact shadows. \`pebbles\` in [0, 1] is the
//       share of the maximum pebble count (0 = clean rippled sand). No aa needed (soft).
//   backdrop_sample(kind: i32, uv: vec2f, aspect: f32, aa: f32, density: f32) -> vec3f
//       one entry point: kind 0 pool tiles (12 tiles tall at density 1), 1 test card, 2 pebbly sand and
//       3 quiet sand with a few pebbles (both 6 world units tall at density 1). \`density\` scales the
//       feature count (tiles, pebbles); the test card ignores it. aa in uv-height units.
//
// Constants: BACKDROP_KIND_TILES = 0, BACKDROP_KIND_CARD = 1, BACKDROP_KIND_SAND = 2, BACKDROP_KIND_DUNE = 3.
//
// Cost: tiles ~30 ALU + one hash. Test card ~60 ALU, no hashes. Sand: one voronoi (9 cells), two gnoise
// and a few dozen ALU; bake it into a texture if you evaluate it every frame.

#include "hash.wgsl"
#include "noise.wgsl"
#include "voronoi.wgsl"
#include "color.wgsl"
#include "math.wgsl"

const BACKDROP_KIND_TILES: i32 = 0;
const BACKDROP_KIND_CARD: i32 = 1;
const BACKDROP_KIND_SAND: i32 = 2;
const BACKDROP_KIND_DUNE: i32 = 3;

// Coverage of a band of half-width \`half_width\` at signed distance \`d\` from its centre line.
fn _backdrop_cover(d: f32, half_width: f32, aa: f32) -> f32 {
  let w = max(aa, 1e-5);
  return 1.0 - smoothstep(half_width - w, half_width + w, d);
}

fn backdrop_pool_tiles(p: vec2f, aa: f32) -> vec3f {
  let cell = floor(p);
  let f = p - cell;
  let edge = min(f, 1.0 - f);
  let d = min(edge.x, edge.y); // distance to the nearest tile edge, 0..0.5
  let grout_half = 0.045;

  let jitter = hash_2to1(cell);
  var tile = srgb_to_linear(vec3f(0.22, 0.66, 0.74)) * (0.88 + 0.2 * jitter);
  // Bevel: tiles darken a little toward their edge and brighten at the inner lip.
  let bevel = smoothstep(grout_half, grout_half + 0.14, d);
  tile = tile * (0.78 + 0.22 * bevel) + vec3f(0.06) * smoothstep(0.1, 0.0, abs(d - grout_half - 0.1));

  // Dark lane stripe on column 4 of every 8, a tile wide but narrower than the tile.
  let column = ((i32(cell.x) % 8) + 8) % 8;
  let stripe = select(0.0, _backdrop_cover(abs(f.x - 0.5), 0.2, aa), column == 4);
  tile = mix(tile, srgb_to_linear(vec3f(0.04, 0.12, 0.3)), stripe);

  let grout = srgb_to_linear(vec3f(0.82, 0.84, 0.82));
  let tile_cover = 1.0 - _backdrop_cover(d, grout_half, aa);
  return clamp(mix(grout, tile, tile_cover), vec3f(0.0), vec3f(1.0));
}

fn _backdrop_bars(x: f32) -> vec3f {
  // Seven bars: white, yellow, cyan, green, magenta, red, blue (75% saturation, as on broadcast cards).
  let i = clamp(i32(floor(x * 7.0)), 0, 6);
  var c = vec3f(0.75);
  if (i == 1) { c = vec3f(0.75, 0.75, 0.0); }
  if (i == 2) { c = vec3f(0.0, 0.75, 0.75); }
  if (i == 3) { c = vec3f(0.0, 0.75, 0.0); }
  if (i == 4) { c = vec3f(0.75, 0.0, 0.75); }
  if (i == 5) { c = vec3f(0.75, 0.0, 0.0); }
  if (i == 6) { c = vec3f(0.0, 0.0, 0.75); }
  return srgb_to_linear(c);
}

fn backdrop_test_card(uv: vec2f, aspect_in: f32, aa_in: f32) -> vec3f {
  // The card is laid out for a frame at least 1.5 times as wide as it is tall. A narrower image (a phone
  // in portrait) shows the whole card shrunk to fit the width, centred, with plain grid above and below.
  let fit = max(1.5 / max(aspect_in, 0.1), 1.0);
  let aspect = aspect_in * fit;
  let aa = aa_in * fit;
  let q = vec2f(uv.x * aspect, (uv.y - 0.5) * fit + 0.5); // height 1, width \`aspect\`
  var col = srgb_to_linear(vec3f(0.62, 0.64, 0.66));

  // Grid every 0.1 of the height; every fifth line is bold.
  let g = q * 10.0;
  let gd = abs(g - round(g)) / 10.0; // distance to the nearest grid line, in height units
  let major = abs(g / 5.0 - round(g / 5.0)) / 2.0;
  let minor_line = max(_backdrop_cover(gd.x, 0.0016, aa), _backdrop_cover(gd.y, 0.0016, aa));
  let major_line = max(_backdrop_cover(major.x, 0.0035, aa), _backdrop_cover(major.y, 0.0035, aa));
  col = mix(col, vec3f(0.01, 0.015, 0.03), max(minor_line * 0.8, major_line));

  // Colour bars, then a grey ramp, at the top and bottom edges.
  let on_card = q.y >= 0.0 && q.y <= 1.0;
  if (on_card && q.y < 0.1) { col = _backdrop_bars(uv.x); }
  if (on_card && q.y > 0.93) { col = vec3f(srgb_to_linear_f(uv.x)); }

  // Centre target: black disc with white concentric rings and a white outline.
  let c = vec2f(aspect * 0.5, 0.52) - q;
  let r = length(c);
  let disc = _backdrop_cover(r, 0.22, aa);
  let rings = _backdrop_cover(abs(fract(r * 28.0) - 0.5) / 28.0, 0.0105, aa);
  let target_col = mix(vec3f(0.01), vec3f(0.9), rings);
  col = mix(col, target_col, disc);

  // Siemens star, upper left: 16 spokes, converging to a point where blur and distortion show.
  let s = q - vec2f(0.2 * aspect + 0.04, 0.3);
  let star_r = length(s);
  let spoke = step(0.0, sin(atan2(s.y, s.x) * 16.0));
  col = mix(col, vec3f(spoke * 0.9 + 0.01), _backdrop_cover(star_r, 0.14, aa));

  // Checker, lower left: eight 0.025 squares per side.
  let k = q - vec2f(0.06, 0.64);
  let in_checker = _backdrop_cover(max(abs(k.x - 0.1), abs(k.y - 0.1)), 0.1, aa);
  let ck = floor(k / 0.025);
  let checker = select(0.01, 0.9, (i32(ck.x) + i32(ck.y)) % 2 == 0);
  col = mix(col, vec3f(checker), in_checker);

  // Fine vertical stripes, lower right: pitch 0.012, the sharpest edges on the card.
  let v = q - vec2f(aspect - 0.28, 0.64);
  let in_stripes = _backdrop_cover(max(abs(v.x - 0.11), abs(v.y - 0.1)), 0.11, aa);
  let stripes = select(0.01, 0.9, fract(v.x / 0.012) < 0.5);
  col = mix(col, vec3f(stripes), in_stripes);

  return clamp(col, vec3f(0.0), vec3f(1.0));
}

fn backdrop_sand(p: vec2f, pebbles: f32) -> vec3f {
  let sand = srgb_to_linear(vec3f(0.86, 0.76, 0.56));
  // Large mottling, ripple marks bending with a slow noise, and fine grain.
  let mottle = gnoise_2d(p * 0.9 + 7.0);
  let bend = gnoise_2d(p * vec2f(0.6, 0.35));
  let ripple = 0.5 + 0.5 * sin((p.y + 1.5 * bend) * 7.5 + 2.0 * mottle);
  let grain = hash_2to1(floor(p * 110.0)) - 0.5;
  var col = sand * (0.9 + 0.12 * mottle + 0.07 * (ripple - 0.5) + 0.07 * grain);

  // Pebbles: about 60% of the cells hold a pebble of random radius, hue and brightness.
  let q = p * 1.6;
  let v = voronoi_2d(q, 0.8);
  let radius = 0.2 + 0.2 * fract(v.id * 7.31);
  let has_pebble = select(0.0, 1.0, v.id < 0.6 * clamp(pebbles, 0.0, 1.0));
  let offset = (q - v.site) / radius;
  let rr = length(offset);
  let inside = has_pebble * (1.0 - smoothstep(0.9, 1.0, rr));
  let z = sqrt(max(1.0 - rr * rr, 0.0));
  let normal = normalize(vec3f(offset.x, offset.y, max(z, 0.2)));
  let light = normalize(vec3f(-0.5, -0.6, 0.65));
  let lit = 0.45 + 0.7 * max(dot(normal, light), 0.0);
  let hue = fract(v.id * 13.7);
  var stone = mix(srgb_to_linear(vec3f(0.5, 0.47, 0.44)), srgb_to_linear(vec3f(0.78, 0.64, 0.46)), hue);
  stone = stone * (0.7 + 0.5 * fract(v.id * 91.3));
  // Contact shadow on the sand just outside the pebble.
  let shadow = has_pebble * 0.3 * (1.0 - smoothstep(1.0, 1.5, rr)) * (1.0 - inside);
  col = col * (1.0 - shadow);
  col = mix(col, stone * lit * (0.9 + 0.2 * mottle), inside);
  return clamp(col, vec3f(0.0), vec3f(1.0));
}

fn backdrop_sample(kind: i32, uv: vec2f, aspect: f32, aa: f32, density: f32) -> vec3f {
  let d = max(density, 0.05);
  let q = vec2f(uv.x * aspect, uv.y);
  if (kind == BACKDROP_KIND_CARD) {
    return backdrop_test_card(uv, aspect, aa);
  }
  if (kind == BACKDROP_KIND_SAND) {
    return backdrop_sand(q * 6.0 * d, 1.0);
  }
  if (kind == BACKDROP_KIND_DUNE) {
    return backdrop_sand(q * 6.0 * d, 0.12);
  }
  return backdrop_pool_tiles(q * 12.0 * d, aa * 12.0 * d);
}
`,"./camera.wgsl":`// camera.wgsl -- perspective camera uniform and screen-space / depth-buffer helpers.
//
// Conventions (also in src/gpu/scene/camera.ts, which fills the uniform): world space is
// right-handed, +Y up. View space looks down -Z. Clip depth is 0 (near) .. 1 (far), not reversed.
// Screen \`uv\` is (0, 0) at the TOP-LEFT with v growing downwards, like fullscreen.wgsl.
// View-space "linear depth" means the positive distance along the view axis, in world units
// (clip w), range [near, far]; it is NOT the distance to the eye.
//
// struct Camera       the uniform block (view, proj, view_proj and their inverses, eye position,
//                     near, far, viewport size in pixels). Declare \`@group(g) @binding(b) var<uniform>
//                     cam: Camera;\` in the shader. Filled by \`setCameraUniform\` in
//                     src/gpu/scene/camera.ts; tests/scene.test.ts checks that the two layouts match.
//
// Depth
//   camera_linear_depth(cam, depth) -> f32        depth-buffer value -> view-space distance along -Z
//   camera_depth_from_linear(cam, z) -> f32       the inverse, z in [near, far]
//
// Screen <-> clip
//   camera_uv_to_ndc(uv) -> vec2f                 uv (top-left origin) -> ndc (y up)
//   camera_ndc_to_uv(ndc) -> vec2f
//
// Reconstruction (uv plus the depth-buffer value at that pixel)
//   camera_view_pos(cam, uv, depth) -> vec3f      view-space position
//   camera_world_pos(cam, uv, depth) -> vec3f     world-space position
//   camera_world_ray(cam, uv) -> vec3f            unit world-space direction from the eye through uv
//
// Projection
//   camera_world_to_view(cam, p) -> vec3f         world -> view
//   camera_view_to_uv(cam, p) -> vec3f            view-space point -> (uv, depth); z is -1 behind the eye
//   camera_world_to_uv(cam, p) -> vec3f           world point -> (uv, depth); z outside [0, 1] means
//                                                 clipped, -1 means behind the eye
//
// A mirrored camera (src/gpu/scene/camera.ts \`mirrorCamera\`) has an oblique near plane, so its
// depth range is skewed: \`camera_linear_depth\`, \`camera_depth_from_linear\` and the depth results of
// \`camera_view_pos\` / \`camera_world_pos\` are wrong for it. \`camera_world_ray\`, the uv of
// \`camera_world_to_uv\` and \`camera_world_to_view\` stay correct.
//
// Cost: each function is a matrix-vector product (16 multiply-adds) and a divide, or a few ALU ops.

struct Camera {
  view: mat4x4f,
  proj: mat4x4f,
  view_proj: mat4x4f,
  inv_view: mat4x4f,
  inv_proj: mat4x4f,
  inv_view_proj: mat4x4f,
  position: vec3f,
  near: f32,
  far: f32,
  viewport: vec2f,
}

fn camera_linear_depth(cam: Camera, depth: f32) -> f32 {
  return cam.near * cam.far / (cam.far - depth * (cam.far - cam.near));
}

fn camera_depth_from_linear(cam: Camera, z: f32) -> f32 {
  return cam.far * (z - cam.near) / (z * (cam.far - cam.near));
}

fn camera_uv_to_ndc(uv: vec2f) -> vec2f {
  return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

fn camera_ndc_to_uv(ndc: vec2f) -> vec2f {
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn camera_view_pos(cam: Camera, uv: vec2f, depth: f32) -> vec3f {
  let h = cam.inv_proj * vec4f(camera_uv_to_ndc(uv), depth, 1.0);
  return h.xyz / h.w;
}

fn camera_world_pos(cam: Camera, uv: vec2f, depth: f32) -> vec3f {
  let h = cam.inv_view_proj * vec4f(camera_uv_to_ndc(uv), depth, 1.0);
  return h.xyz / h.w;
}

fn camera_world_ray(cam: Camera, uv: vec2f) -> vec3f {
  // Built from the x and y scales of the projection, which an oblique near plane leaves alone, so
  // it is also right for a mirrored camera and never touches the depth range.
  let ndc = camera_uv_to_ndc(uv);
  let view_dir = vec3f(ndc.x / cam.proj[0][0], ndc.y / cam.proj[1][1], -1.0);
  return normalize((cam.inv_view * vec4f(view_dir, 0.0)).xyz);
}

fn camera_world_to_view(cam: Camera, p: vec3f) -> vec3f {
  return (cam.view * vec4f(p, 1.0)).xyz;
}

fn camera_view_to_uv(cam: Camera, p: vec3f) -> vec3f {
  let h = cam.proj * vec4f(p, 1.0);
  if (h.w <= 0.0) {
    return vec3f(0.0, 0.0, -1.0);
  }
  let ndc = h.xyz / h.w;
  return vec3f(camera_ndc_to_uv(ndc.xy), ndc.z);
}

fn camera_world_to_uv(cam: Camera, p: vec3f) -> vec3f {
  let h = cam.view_proj * vec4f(p, 1.0);
  if (h.w <= 0.0) {
    return vec3f(0.0, 0.0, -1.0);
  }
  let ndc = h.xyz / h.w;
  return vec3f(camera_ndc_to_uv(ndc.xy), ndc.z);
}
`,"./caustics.wgsl":`// caustics.wgsl -- procedural caustics: the bright, connected filaments that sunlight draws on a pool
// floor after it has been focused by a wavy surface. Two ways to build the pattern per pixel, plus the
// lookups for a baked caustic texture (the cheap one), all pure functions of position and time.
//
// CONVENTIONS (read once)
//  * TILE COORDINATES. \`uv\` is in tile units: the pattern repeats EXACTLY every 1.0 in x and in y
//    (f(uv + (1, 0)) == f(uv)), so it can be baked into a seamless texture or repeated. \`cells\` is
//    the integer number of pattern cells across one tile (a feature is about 1 / cells of a tile), so
//    it sets the feature size: for features about F in size on screen, use uv = world / (cells * F).
//    A bigger \`cells\` is also a longer period before the pattern repeats. \`cells\` < 1 counts as 1.
//  * TIME is in radians and every animated procedural function repeats after TAU (time + TAU == time),
//    so a bake of one loop is seamless. Advance it as phase += delta * speed.
//  * OUTPUT is light intensity, finite and >= 0, with a MEAN OF ABOUT 1 over the pattern for ANY
//    \`sharp\`. Caustics redistribute light rather than add it: turning \`sharp\` up concentrates the
//    same energy into thinner, brighter lines (peak value of 5 to 30) and leaves the average where it
//    was. Most pixels are therefore below 1 and the filaments far above it: expose with
//    caustics_expose(), or multiply into a lit scene and tone-map. The mean holds to about +-2% for
//    the procedural functions across sharp 0..1 and +-15% for the baked ones (tests/water-light.test.ts).
//  * \`sharp\` in [0, 1] (clamped): 0 is a broad soft net, 1 is thin hard filaments.
//
// The two per-pixel constructions (compared in src/effects/caustics/notes.md)
//   caustics_cellular(uv, cells, time, sharp) -> f32
//       Warped cellular: F2 - F1 of an animated, sine-warped tileable Voronoi, so the light collects
//       on the cell borders and the cell sites orbit. A polygonal net that reads instantly as caustics;
//       the cell structure shows at low \`cells\`. 9 cell tests (about 2.5 gnoise) + 4 sin.
//   caustics_sine(uv, cells, time, sharp) -> f32
//       Iterated sine warps, the "water turbulence" construction: four rounds of q = p + warp(q, time),
//       each adding a Lorentzian peak at the zeros of the warped phase. No hashes and no loops over
//       cells: 40 sin/cos and about 100 ALU. Long, smoothly flowing filaments, softer than cellular.
//       Uses cells / 2 phase periods per tile (cells is rounded down to an even number there).
//
//   caustics_eval(method, uv, cells, time, sharp) -> f32     dispatch on a uniform; method is one of
//       CAUSTICS_CELLULAR = 0, CAUSTICS_SINE = 1
//   caustics_stack(method, uv, cells, time, sharp) -> f32    two layers (the second turned 45 degrees,
//       1.41x finer, half a loop out of phase; still period 1) averaged: the mean stays 1 and two nets
//       crossing give the denser, more irregular look of a real pool. Twice the cost of caustics_eval.
//   caustics_rgb(method, layers, uv, cells, time, sharp, split) -> vec3f   chromatic fringing: the pattern
//       (layers = 1: caustics_eval, 2: caustics_stack) sampled at three positions \`split\` apart (tile
//       units; 0.002 to 0.01 is plenty), red shifted one way, blue the other, green in the middle.
//       Exactly 3x the cost of the grey pattern. split <= 0 returns the grey pattern in all channels
//       without the extra work.
//
// Baked variant: render a tileable caustic map once (src/gpu/bake-caustics.ts), then each frame is two
// drifting texture taps. The texture is RGBA: four time slices of one animation loop, one per channel.
//   CAUSTICS_BAKED_AVG = 0, CAUSTICS_BAKED_MIN = 1, CAUSTICS_BAKED_SINGLE = 2    how the taps are combined (\`mode\`)
//   caustics_baked_slice(slices: vec4f, phase: f32) -> f32      cyclic smooth blend of the four channels,
//       phase in radians, period TAU (this is what makes a baked texture boil instead of just slide)
//   caustics_baked(tex, samp, uv, time, lod, mode) -> f32       two taps (SINGLE: just the first, one texture
//       read, the cheapest and the cleanest look: it is the baked net itself, boiling through its slices;
//       the second 1.41x finer, turned
//       45 degrees, half a loop later, drifting the other way). AVG averages them: mean exactly 1 at
//       any lod. MIN takes the lower, the trick many shipped games use: only where both nets agree
//       does light survive, so you get sparse bright slivers and nodes; its mean is rescaled by a fit
//       to about +-15%. \`lod\` > 0 blurs by sampling a coarser mip (the cheap equivalent of lowering
//       \`sharp\`; the mean is unchanged because mips average). The sampler must repeat, ideally
//       trilinear. The drift is continuous (not periodic in \`time\`); only the slices loop.
//   caustics_baked_rgb(tex, samp, uv, time, lod, mode, split) -> vec3f   six taps with chromatic fringing
//
// Presentation
//   caustics_expose(c: f32, exposure: f32) -> f32     1 - exp(-c * exposure): maps the open-ended
//       intensity to [0, 1) without clipping the filaments. exposure 0.5 to 1 suits a mean-1 net.
//
// Cost summary (per pixel, rough): cellular ~ 130 ALU + 9 hashes; sine ~ 100 ALU + 40 sin/cos;
// baked ~ 2 texture taps + 20 ALU. stack = x2, rgb = x3, stack + rgb = x6.
// Credits: cellular distance F2 - F1 after S. Worley (1996); the iterated sine warp is the construction
// behind the classic "water turbulence" shaders, rewritten here with integer harmonics (so it tiles
// and loops), incommensurate per-round scales (so no lattice shows) and a low-frequency bend of the tile.

#include "math.wgsl"
#include "voronoi.wgsl"

const CAUSTICS_CELLULAR: u32 = 0u;
const CAUSTICS_SINE: u32 = 1u;
const CAUSTICS_BAKED_AVG: u32 = 0u;
const CAUSTICS_BAKED_MIN: u32 = 1u;
const CAUSTICS_BAKED_SINGLE: u32 = 2u;

// --- Shared profile -------------------------------------------------------------------------------

// Narrow line profile (1 - x)^2 for x in [0, 1) is the bright core of a filament.
fn _caustics_profile(x: f32) -> f32 {
  let t = saturate(1.0 - x);
  return t * t;
}

// --- Warped cellular ------------------------------------------------------------------------------

// Width of the line (in F2 - F1 units) for a given sharpness.
fn _caustics_cellular_width(sharp: f32) -> f32 {
  return mix(0.4, 0.05, saturate(sharp));
}

// Mean of the raw profile over the pattern, fitted to measurements (tests/water-light.test.ts): a line
// of width w covers a share of the plane about proportional to w, a little less for fat lines.
fn _caustics_cellular_mean(w: f32) -> f32 {
  return w * (0.86 - 0.3 * w);
}

fn caustics_cellular(uv: vec2f, cells: i32, time: f32, sharp: f32) -> f32 {
  let n = max(cells, 1);
  let a = TAU * uv;
  // Warp: low sine harmonics of the whole tile, integer frequencies in uv and in time, so the
  // displacement (in cell units) is exactly periodic and the cells bend like a wavy surface.
  let warp = 0.45 * vec2f(
    sin(a.y * 2.0 + time) + 0.5 * sin(a.x * 3.0 + a.y - 2.0 * time + 1.3),
    sin(a.x * 2.0 - time + 2.1) + 0.5 * sin(a.y * 3.0 - a.x + 2.0 * time),
  );
  let p = uv * f32(n) + warp;
  let v = voronoi_2d_tile_anim(p, 1.0, time, vec2i(n));
  let w = _caustics_cellular_width(sharp);
  // Some borders collect more light than others: modulate by the cell's id (mean 1).
  let strength = 0.6 + 0.8 * v.id;
  return strength * _caustics_profile((v.f2 - v.f1) / w) / _caustics_cellular_mean(w);
}

// --- Iterated sine warp ---------------------------------------------------------------------------

const _CAUSTICS_ITERS: i32 = 4;

fn _caustics_sine_width(sharp: f32) -> f32 {
  return mix(0.2, 0.025, saturate(sharp));
}

// Mean of the raw (squared) accumulation for line width w: a log-quadratic fit, within 1% over the
// widths used here (tests/water-light.test.ts re-measures the result).
fn _caustics_sine_mean(w: f32) -> f32 {
  let l = log(w);
  return exp(-0.0651 * l * l + 0.7645 * l - 0.4581);
}

fn caustics_sine(uv: vec2f, cells: i32, time: f32, sharp: f32) -> f32 {
  // One zero line of the phase per half cell, so a tile of \`cells\` cells has cells / 2 periods.
  let f = f32(max(cells / 2, 1));
  let a = TAU * uv;
  // A low-frequency bend of the whole tile (exactly periodic) so the lattice of the sine
  // construction, which repeats every period, does not show.
  let p = uv * (TAU * f) + (0.4 * f) * vec2f(
    sin(a.y * 2.0 + time) + 0.6 * sin(a.x * 3.0 - 2.0 * time),
    sin(a.x * 2.0 - time + 2.0) + 0.6 * sin(a.y * 3.0 + 2.0 * time),
  );
  var q = p;
  var sum = 0.0;
  let w = _caustics_sine_width(sharp);
  for (var n = 0; n < _CAUSTICS_ITERS; n++) {
    // Direction alternates so neighbouring iterations slide against each other. The per-iteration
    // scale factors (f + j) / f make the argument an integer number of periods per tile, so the
    // tile is exact, but the rounds are not commensurate: no regular lattice.
    let t = time * select(-1.0, 1.0, (n & 1) == 0);
    let sx = 1.0 + f32(n % 3 - 1) / f;
    let sy = 1.0 + f32((n + 1) % 3 - 1) / f;
    q = p + 0.55 * vec2f(cos(t - sx * q.x) + sin(t + sy * q.y), sin(t - sy * q.y) + cos(t + sx * q.x));
    // Distance to the nearest zero of the warped phase, in either axis: a warped grid of lines.
    let g = min(abs(sin(q.x + t)), abs(cos(q.y - t)));
    sum += w / (w + g);
  }
  let m = sum / f32(_CAUSTICS_ITERS);
  return m * m / _caustics_sine_mean(w);
}

// --- Dispatch and combinations --------------------------------------------------------------------

fn caustics_eval(method: u32, uv: vec2f, cells: i32, time: f32, sharp: f32) -> f32 {
  if (method == CAUSTICS_SINE) {
    return caustics_sine(uv, cells, time, sharp);
  }
  return caustics_cellular(uv, cells, time, sharp);
}

// The second layer's coordinates: (1, 1; -1, 1) * uv, an integer matrix, so it keeps period 1.
fn _caustics_second(uv: vec2f) -> vec2f {
  return vec2f(uv.x + uv.y, uv.y - uv.x);
}

fn caustics_stack(method: u32, uv: vec2f, cells: i32, time: f32, sharp: f32) -> f32 {
  let a = caustics_eval(method, uv, cells, time, sharp);
  let b = caustics_eval(method, _caustics_second(uv) + vec2f(0.37, 0.11), cells, time + PI, sharp);
  return 0.5 * (a + b);
}

fn _caustics_layers(method: u32, layers: u32, uv: vec2f, cells: i32, time: f32, sharp: f32) -> f32 {
  if (layers >= 2u) {
    return caustics_stack(method, uv, cells, time, sharp);
  }
  return caustics_eval(method, uv, cells, time, sharp);
}

fn caustics_rgb(
  method: u32,
  layers: u32,
  uv: vec2f,
  cells: i32,
  time: f32,
  sharp: f32,
  split: f32,
) -> vec3f {
  if (split <= 0.0) {
    return vec3f(_caustics_layers(method, layers, uv, cells, time, sharp));
  }
  let shift = split * vec2f(0.8, 0.6);
  return vec3f(
    _caustics_layers(method, layers, uv + shift, cells, time, sharp),
    _caustics_layers(method, layers, uv, cells, time, sharp),
    _caustics_layers(method, layers, uv - shift, cells, time, sharp),
  );
}

fn caustics_expose(c: f32, exposure: f32) -> f32 {
  return 1.0 - exp(-max(c, 0.0) * max(exposure, 0.0));
}

// --- Baked ----------------------------------------------------------------------------------------

fn caustics_baked_slice(slices: vec4f, phase: f32) -> f32 {
  let cycle = phase / TAU;
  let x = 4.0 * (cycle - floor(cycle));
  let i = u32(floor(x)) & 3u;
  let f = smoothstep(0.0, 1.0, x - floor(x));
  let a = select(select(select(slices.x, slices.y, i == 1u), slices.z, i == 2u), slices.w, i == 3u);
  let b = select(select(select(slices.y, slices.z, i == 1u), slices.w, i == 2u), slices.x, i == 3u);
  return mix(a, b, f);
}

// min of two mean-1 fields has a much lower mean (about 0.15 for sharp nets, rising toward 1 as the mips
// blur them); this restores it. A fit to measurements, 1 + 5.14 exp(-(lod / 2.39)^1.7), good to about 10%.
fn _caustics_min_gain(lod: f32) -> f32 {
  return 1.0 + 5.14 * exp(-pow(max(lod, 0.0) / 2.39, 1.7));
}

fn _caustics_baked_pair(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2f,
  time: f32,
  lod: f32,
  mode: u32,
) -> f32 {
  // Tap A drifts one way; tap B is 1.41x finer, turned 45 degrees (an integer matrix, so it still
  // tiles), drifts the other way and runs half a loop out of phase.
  let ua = uv + vec2f(0.021, 0.013) * time;
  let ub = _caustics_second(uv) + vec2f(0.37, 0.11) - vec2f(0.017, 0.009) * time;
  let a = caustics_baked_slice(textureSampleLevel(tex, samp, ua, lod), time);
  if (mode == CAUSTICS_BAKED_SINGLE) {
    return a;
  }
  let b = caustics_baked_slice(textureSampleLevel(tex, samp, ub, lod), time + PI);
  if (mode == CAUSTICS_BAKED_MIN) {
    return min(a, b) * _caustics_min_gain(lod);
  }
  return 0.5 * (a + b);
}

fn caustics_baked(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2f,
  time: f32,
  lod: f32,
  mode: u32,
) -> f32 {
  return _caustics_baked_pair(tex, samp, uv, time, lod, mode);
}

fn caustics_baked_rgb(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2f,
  time: f32,
  lod: f32,
  mode: u32,
  split: f32,
) -> vec3f {
  if (split <= 0.0) {
    return vec3f(_caustics_baked_pair(tex, samp, uv, time, lod, mode));
  }
  let shift = split * vec2f(0.8, 0.6);
  return vec3f(
    _caustics_baked_pair(tex, samp, uv + shift, time, lod, mode),
    _caustics_baked_pair(tex, samp, uv, time, lod, mode),
    _caustics_baked_pair(tex, samp, uv - shift, time, lod, mode),
  );
}
`,"./color.wgsl":`// color.wgsl -- colour-space transfer functions, luminance, tonemapping, cosine palette.
//
// Pipeline assumed by these functions: do all lighting maths in LINEAR RGB (Rec.709 / sRGB primaries),
// tonemap if the values can exceed 1, then encode to sRGB as the very last step. Decode sRGB textures
// and colour picked by eye (hex codes, CSS colours) to linear first. If the canvas / render target
// format ends in \`-srgb\` the hardware encodes for you: do NOT call linear_to_srgb yourself then. The
// preferred canvas format (bgra8unorm / rgba8unorm) is not sRGB-encoding: call it.
//
// Transfer functions: the exact IEC 61966-2-1 piecewise curve (not the pow 2.2 approximation).
// Input is clamped at 0 (negative values give 0); values above 1 pass through (HDR).
//   srgb_to_linear(c: vec3f) -> vec3f      linear_to_srgb(c: vec3f) -> vec3f
//   srgb_to_linear_f(x: f32) -> f32        linear_to_srgb_f(x: f32) -> f32     single-channel forms
//
// Luminance
//   luminance(c: vec3f) -> f32     relative luminance (Rec.709 weights 0.2126, 0.7152, 0.0722) of LINEAR rgb
//
// Tonemappers: input is linear scene-referred RGB >= 0 (1.0 = diffuse white, higher is HDR);
// output is LINEAR display-referred in [0, 1]: apply linear_to_srgb after. All map 0 -> 0 and are
// monotonic per channel. Apply exposure beforehand: tonemap_x(color * exposure).
//   tonemap_reinhard(c) -> vec3f            c / (1 + c), per channel. Never clips, washes out highlights
//   tonemap_reinhard_white(c, white) -> vec3f   extended Reinhard: input \`white\` (> 0) maps to exactly 1.0,
//                                           anything brighter clips at 1.0
//   tonemap_aces(c) -> vec3f                Narkowicz's ACES filmic fit: contrasty, 1.0 -> ~0.80,
//                                           0.18 -> ~0.27, clips to 1.0 above ~7.2 (hard shoulder);
//                                           shifts hue in bright highlights
//
// Palette
//   palette_cosine(t, a, b, c, d) -> vec3f  a + b * cos(TAU * (c * t + d)), t typically 0..1. A cheap smooth
//                                           gradient: a offset, b amplitude, c frequency, d phase (all vec3f)
//
// Cost: the transfer functions use one pow() per channel; the rest is a few ALU ops. Palette: 3 cos.
// Credits: ACES fit by K. Narkowicz (2016); cosine palettes from I. Quilez's "palettes" article.

#include "math.wgsl"

fn srgb_to_linear_f(x: f32) -> f32 {
  let c = max(x, 0.0);
  let lo = c / 12.92;
  let hi = pow((c + 0.055) / 1.055, 2.4);
  return select(hi, lo, c <= 0.04045);
}

fn linear_to_srgb_f(x: f32) -> f32 {
  let c = max(x, 0.0);
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, 1.0 / 2.4) - 0.055;
  return select(hi, lo, c <= 0.0031308);
}

fn srgb_to_linear(c: vec3f) -> vec3f {
  let v = max(c, vec3f(0.0));
  let lo = v / 12.92;
  let hi = pow((v + 0.055) / 1.055, vec3f(2.4));
  return select(hi, lo, v <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let v = max(c, vec3f(0.0));
  let lo = v * 12.92;
  let hi = 1.055 * pow(v, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, v <= vec3f(0.0031308));
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn tonemap_reinhard(c: vec3f) -> vec3f {
  let v = max(c, vec3f(0.0));
  return v / (1.0 + v);
}

fn tonemap_reinhard_white(c: vec3f, white: f32) -> vec3f {
  let v = max(c, vec3f(0.0));
  let w2 = max(white * white, 1e-12);
  return min(v * (1.0 + v / w2) / (1.0 + v), vec3f(1.0));
}

fn tonemap_aces(c: vec3f) -> vec3f {
  let v = max(c, vec3f(0.0));
  let mapped = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
  return clamp(mapped, vec3f(0.0), vec3f(1.0));
}

fn palette_cosine(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(TAU * (c * t + d));
}
`,"./curl.wgsl":`// curl.wgsl -- divergence-free flow fields from the curl of a noise potential.
//
// A velocity field v = curl(psi) neither creates nor destroys "stuff" (div v = 0), so particles
// advected through it swirl and mix without bunching up: ink, foam drift, floating debris, spray.
// The fields are computed from the ANALYTIC gradient of the potential, so they are exactly
// divergence-free up to float rounding (no finite differences, no extra samples).
//
//   curl_2d(p: vec2f, octaves, lacunarity, gain) -> vec2f
//       v = (dpsi/dy, -dpsi/dx) with psi = fbm_2d(p). Static field.
//   curl_2d_anim(p: vec2f, time: f32, octaves, lacunarity, gain) -> vec2f
//       same with psi = fbm_3d(vec3f(p, time)); the field evolves smoothly. Still divergence-free in
//       x/y at every instant.
//   curl_3d(p: vec3f) -> vec3f
//       v = curl of a vector potential made from three decorrelated gnoise_3d. Single octave.
//
// Scale: the field is the gradient of a unit-amplitude potential: |v| averages about 1.2 (curl_3d: 1.5) per
// lattice unit and rarely exceeds 4. It is NOT normalised; multiply by your speed. \`p\` is in lattice units, so
// raising the frequency of p also raises |v| per world unit: advect with
// pos += curl_2d(pos * freq, ...) * dt / freq to keep the speed independent of frequency.
// Cost: one fbm _d evaluation (about 1.5x the matching fbm; curl_3d: three gnoise_3d_d).
// Technique: R. Bridson, J. Hourihan, M. Nordenstam, "Curl-Noise for Procedural Fluid Flow" (2007).

#include "fbm.wgsl"

const _CURL_3D_OFFSET_1 = vec3f(0.0, 0.0, 0.0);
const _CURL_3D_OFFSET_2 = vec3f(31.416, 47.853, 12.793);
const _CURL_3D_OFFSET_3 = vec3f(-23.157, 19.642, 61.288);

fn curl_2d(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> vec2f {
  let d = fbm_2d_d(p, octaves, lacunarity, gain);
  return vec2f(d.z, -d.y);
}

fn curl_2d_anim(p: vec2f, time: f32, octaves: i32, lacunarity: f32, gain: f32) -> vec2f {
  let d = fbm_3d_d(vec3f(p, time), octaves, lacunarity, gain);
  return vec2f(d.z, -d.y);
}

fn curl_3d(p: vec3f) -> vec3f {
  let a = gnoise_3d_d(p + _CURL_3D_OFFSET_1);
  let b = gnoise_3d_d(p + _CURL_3D_OFFSET_2);
  let c = gnoise_3d_d(p + _CURL_3D_OFFSET_3);
  // Components of d are (value, d/dx, d/dy, d/dz); curl = (c_y - b_z, a_z - c_x, b_x - a_y).
  return vec3f(c.z - b.w, a.w - c.y, b.y - a.z);
}
`,"./droplets.wgsl":`// droplets.wgsl -- stateless water drops on a pane of glass: static beads, large drops that run
// down and pause and leave a trail of shrinking beads, and the clean streak each one wipes.
//
// No simulation and no textures. Everything is a pure function of (position, time): the glass is cut
// into a grid of cells, each cell owns one drop (or one run) per cycle, and the cycle's random numbers
// come from an integer hash of (cell, cycle). Nothing is stored, so it costs a few dozen ALU ops per
// layer per pixel, resizes for free and can be drawn at any aspect ratio.
//
// Conventions
//  * \`p\` is a position on the glass in IMAGE-HEIGHT units with y pointing DOWN the screen (the uv
//    direction): p = vec2f(uv.x * aspect, uv.y). Gravity is +y. \`time\` is a phase in seconds: pass an
//    accumulated clock (time += delta * speed), not time * speed, so a speed slider never jumps.
//  * \`cell\` is the width of one grid column in the same units. A running drop is a fifth to a quarter
//    of it wide, so cell 0.08 gives drops about 3% of the image height in diameter.
//  * \`aa\` is the size of one pixel in p units (1 / image height in pixels); 0 gives hard edges.
//  * A drop is a lens. The functions return where in the drop the pixel lies (\`local\`, the unit disc
//    of the drop, y down) and how big the drop is; droplet_lens and droplet_normal turn that into the
//    inverted, magnified-minus-one picture a real drop shows and into a shading normal.
//  * The returned \`clear\` is the "wiped" amount: 1 inside a drop and along its fresh trail, falling
//    off behind it. Use it to take the fog off the glass; it needs no state because the run's whole
//    path is a function of the cell.
//
// struct DropletSample
//     mask    f32      coverage of the drop body, [0, 1], anti-aliased over \`aa\`
//     local   vec2f    position in the drop's own frame; |local| <= 1 inside (a little over at the
//                      anti-aliased rim); (0, 0) where there is no drop
//     radius  f32      radius of the drop in p units (0 where there is no drop)
//     clear   f32      [0, 1], how much the glass is wiped here (trail of a running drop)
//
// Layers (each one grid-cell evaluation: 2 integer hashes, about 100 ALU)
//   droplet_none() -> DropletSample                  empty sample (no drop, glass untouched)
//   droplet_static(p, time, cell, density, seed, aa) -> DropletSample
//        Small beads that sit still, grow in, and slowly shrink away over 20-50 s before a new one forms
//        elsewhere in the cell. \`density\` [0, 1] is the share of cells holding a bead. A bead is up to
//        0.28 cells in radius.
//   droplet_running(p, time, cell, density, seed, aa) -> DropletSample
//        Big drops. Each column of cells is shifted vertically by its own random amount, so the cell
//        borders never line up. Each cell is 3.2 cells tall and runs one drop per cycle (6-14 s): it
//        forms at the top, runs down a gently wobbling path with pauses (it never goes backwards),
//        stretches while it moves, sheds beads that shrink with their age, and shrinks away at the
//        bottom. Drop radius 0.13-0.22 cells. \`density\` [0, 1] is the share of cycles that hold a drop.
//   droplet_merge(a, b) -> DropletSample             the nearer-to-opaque drop wins, the wipes add (max)
//   droplet_field(p, time, rain, size, layers, aa) -> DropletSample
//        The standard stack. rain [0, 1] sets all densities; size is the width of the big drops' column
//        in p units (0.05-0.2); rain 0 gives clean glass; layers 1 = beads + big runners, 2 = + a second, smaller runner layer,
//        3 = + a fine mist of tiny beads. Beads inside a wiped trail are removed.
//
// Turning a sample into pixels
//   droplet_lens(s, strength) -> vec2f     offset to ADD to p to find the point of the world this pixel of the
//        drop shows: -local * radius * strength, so the picture is inverted (strength > 1 reaches past the
//        centre) and every drop shows a differently sized slice of the world. 0 outside drops. Divide x by
//        the aspect ratio to get a uv offset.
//   droplet_normal(s, flatness) -> vec3f   unit normal of a spherical cap in the glass frame (x right, y down,
//        z toward the viewer): flatness 1 is a hemisphere, 0.5 a flat lens. (0, 0, 1) outside drops.
//   droplet_rim(s) -> f32                  [0, 1], 0 in the middle of a drop, 1 at its edge: darken or tint
//   droplet_highlight(normal, light, sharpness) -> f32   Blinn-Phong glint of a drop normal; \`light\` is a
//        unit vector from the glass toward the light in the glass frame. [0, 1]
//
// Time continuity: a drop's radius ramps in from 0 and back to 0 at both ends of its cycle, and its
// beads and wipe fade with it, so the picture changes by no more than the motion implies, also across
// a cycle boundary. Changing \`density\` or \`cell\` while running re-rolls drops (that does jump).
//
// Technique: the grid-of-cycling-drops construction that rain-on-window shaders use, written from
// scratch: per-cell hashed phase, a monotone stop-go progress curve (a line minus two sines whose
// amplitudes sum below 1, so its slope never goes negative), a path wobble that depends only on height
// so the trail can be rebuilt from the head's position, and a nearest-bead search along the path.

#include "hash.wgsl"
#include "math.wgsl"
#include "normals.wgsl"

struct DropletSample {
  mask: f32,
  local: vec2f,
  radius: f32,
  clear: f32,
}

const DROPLET_CELL_H: f32 = 3.2;   // run cell height, in column widths
const DROPLET_Y_TOP: f32 = 0.42;   // where a drop forms
const DROPLET_Y_BOTTOM: f32 = 2.78; // where it comes to rest
const _DROPLET_BEAD_SPACING: f32 = 0.46;

fn droplet_none() -> DropletSample {
  return DropletSample(0.0, vec2f(0.0), 0.0, 0.0);
}

// Anti-aliased coverage from a signed distance and a radius, both in cell units. A drop smaller than
// half a pixel fades out with its radius instead of keeping the 0.5 coverage of its centre pixel, so a
// drop that grows from nothing never pops in.
fn _droplet_cover(sd: f32, radius: f32, cell: f32, aa: f32) -> f32 {
  let a = max(aa, 1e-6);
  return clamp(0.5 - sd * cell / a, 0.0, 1.0) * smoothstep(0.0, 0.5 * a, radius * cell);
}

// Monotone stop-and-go progress: (progress, speed) for s in [0, 1]. progress(0) = 0, progress(1) = 1
// when n1 and n2 are integers; speed (the derivative) is >= 0.05, so the drop dwells but never reverses.
fn _droplet_stopgo(s: f32, n1: f32, c1: f32, n2: f32, c2: f32) -> vec2f {
  let w1 = TAU * n1;
  let w2 = TAU * n2;
  let progress = s - 0.55 * (sin(w1 * s + c1) - sin(c1)) / w1 - 0.4 * (sin(w2 * s + c2) - sin(c2)) / w2;
  let speed = 1.0 - 0.55 * cos(w1 * s + c1) - 0.4 * cos(w2 * s + c2);
  return vec2f(progress, speed);
}

// Horizontal position of a run's path at height y (cell units). Depends on y only, never on time.
fn _droplet_path_x(y: f32, x0: f32, phase: vec2f) -> f32 {
  return x0 + 0.06 * (0.65 * sin(y * 2.1 + phase.x) + 0.35 * sin(y * 4.7 + phase.y));
}

fn droplet_static(p: vec2f, time: f32, cell: f32, density: f32, seed: i32, aa: f32) -> DropletSample {
  let u = p / max(cell, 1e-5) + vec2f(f32(seed) * 5.17, f32(seed) * 3.71);
  let c = vec2i(floor(u));
  let l = fract(u);
  let h = ihash_3to3(vec3i(c, seed));
  if (h.z >= density) {
    return droplet_none();
  }
  let period = mix(20.0, 50.0, h.x);
  let t = time / period + h.y;
  let k = floor(t);
  let s = t - k;
  let g = ihash_3to3(vec3i(c.x * 3 + seed, c.y * 5 + 1, i32(k)));
  let grow = smoothstep(0.0, 0.06, s);
  let shrink = 1.0 - smoothstep(0.45, 1.0, s);
  let r = mix(0.1, 0.28, g.z * g.z) * grow * shrink;
  if (r <= 0.0) {
    return droplet_none();
  }
  let centre = vec2f(0.3 + 0.4 * g.x, 0.3 + 0.4 * g.y);
  let d = l - centre;
  let sd = length(d) - r;
  let mask = _droplet_cover(sd, r, cell, aa);
  if (mask <= 0.0) {
    return droplet_none();
  }
  return DropletSample(mask, d / r, r * cell, 0.0);
}

fn droplet_running(p: vec2f, time: f32, cell: f32, density: f32, seed: i32, aa: f32) -> DropletSample {
  let u = p / max(cell, 1e-5) + vec2f(f32(seed) * 17.31, 0.0);
  let col = i32(floor(u.x));
  let lx = u.x - floor(u.x);
  // Each column starts at its own height, so cells never line up into rows.
  let column = ihash_2to2(vec2i(col, seed));
  let v = u.y + column.x * DROPLET_CELL_H;
  let row = i32(floor(v / DROPLET_CELL_H));
  let ly = v - f32(row) * DROPLET_CELL_H;

  let h = ihash_3to3(vec3i(col, row, seed));
  let period = mix(6.0, 14.0, h.x);
  let t = time / period + h.y;
  let k = floor(t);
  let s = t - k;
  let g = ihash_3to3(vec3i(col * 3 + seed, row * 5 + 1, i32(k)));
  if (g.z >= density) {
    return droplet_none();
  }

  let grow = smoothstep(0.0, 0.08, s);
  let fade = 1.0 - smoothstep(0.84, 1.0, s);
  let env = grow * fade;
  if (env <= 0.0) {
    return droplet_none();
  }

  // Where along its path the head is: a stop-go curve over the first 78% of the cycle, then it rests.
  let n1 = 2.0 + floor(g.x * 3.0);
  let n2 = 5.0 + floor(h.z * 3.0);
  let travel = _droplet_stopgo(saturate(s / 0.78), n1, TAU * g.y, n2, TAU * h.x);
  let y_head = mix(DROPLET_Y_TOP, DROPLET_Y_BOTTOM, travel.x);
  let x0 = 0.5 + (g.x - 0.5) * 0.3;
  let phase = TAU * vec2f(h.z, fract(g.y * 7.31 + 0.13));
  let rest = mix(0.13, 0.22, g.y);
  let radius = rest * (1.0 - 0.3 * travel.x);       // loses water as it runs
  let r_head = radius * env;

  var out = droplet_none();

  // Head: an egg, stretched along the path while it moves, with a longer tail above.
  let stretch = 1.0 + 0.35 * saturate(travel.y - 0.4);
  let d = vec2f(lx - _droplet_path_x(y_head, x0, phase), ly - y_head);
  let dy = d.y / (stretch * select(1.0, 1.3, d.y < 0.0));
  let head_local = vec2f(d.x, dy);
  var best_mask = _droplet_cover(length(head_local) - r_head, r_head, cell, aa);
  var best_local = head_local / max(r_head, 1e-4);
  var best_radius = r_head;

  // Beads: one candidate per spacing along the path, thinning out and shrinking with distance
  // behind the head. Only the nearest one can touch this pixel, so that is all we test.
  let bi = floor((ly - DROPLET_Y_TOP) / _DROPLET_BEAD_SPACING + 0.5);
  let b = ihash_3to3(vec3i(col * 13 + i32(bi) + seed, row * 7 + 3, i32(k)));
  let by = DROPLET_Y_TOP + bi * _DROPLET_BEAD_SPACING + (b.y - 0.5) * 0.12;
  let behind = y_head - by;
  if (b.z < 0.72 && behind > 0.2 && by > DROPLET_Y_TOP - 0.05) {
    let age = saturate(behind / (DROPLET_Y_BOTTOM - DROPLET_Y_TOP));
    let rb = (0.045 + 0.05 * b.x) * (1.0 - 0.6 * age) * smoothstep(0.2, 0.7, behind) * env;
    let bx = _droplet_path_x(by, x0, phase) + (b.x - 0.5) * 0.1;
    let bd = vec2f(lx - bx, ly - by);
    // Whichever covers more of the pixel wins (not whichever is nearer: a speck would beat a bead).
    let bead_mask = _droplet_cover(length(bd) - rb, rb, cell, aa);
    if (bead_mask > best_mask) {
      best_mask = bead_mask;
      best_local = bd / max(rb, 1e-4);
      best_radius = rb;
    }
  }

  if (best_mask > 0.0 && best_radius > 0.0) {
    out.mask = best_mask;
    out.local = best_local;
    out.radius = best_radius * cell;
  }

  // The wipe: a streak along the path from where the drop formed to its head. It is narrower than the
  // drop and tapers away from the head (the old end re-fogs from its edges), clearest at the head.
  let path_dx = abs(lx - _droplet_path_x(ly, x0, phase));
  let recency = exp(-max(y_head - ly, 0.0) * 0.45);
  let width = 0.5 * rest * (1.0 - 0.3 * travel.x) * (0.45 + 0.55 * recency);
  let lateral = 1.0 - smoothstep(0.7 * width, 1.5 * width, path_dx);
  let along = smoothstep(DROPLET_Y_TOP - 0.15, DROPLET_Y_TOP + 0.25, ly)
    * (1.0 - smoothstep(y_head, y_head + r_head, ly));
  out.clear = max(lateral * along * (0.25 + 0.75 * recency) * env, out.mask);
  return out;
}

fn droplet_merge(a: DropletSample, b: DropletSample) -> DropletSample {
  var out = a;
  if (b.mask > a.mask) {
    out = b;
  }
  out.clear = max(a.clear, b.clear);
  return out;
}

fn droplet_field(p: vec2f, time: f32, rain: f32, size: f32, layers: i32, aa: f32) -> DropletSample {
  let r = saturate(rain);
  var s = droplet_running(p, time, size, 0.95 * r, 1, aa);
  if (layers >= 2) {
    s = droplet_merge(s, droplet_running(p, time * 1.15, size * 0.62, 0.8 * r, 2, aa));
  }
  var beads = droplet_static(p, time, size * 0.3, saturate(0.4 * sqrt(r) + 0.6 * r), 3, aa);
  if (layers >= 3) {
    let mist = droplet_static(p, time, size * 0.12, 0.7 * r, 4, aa);
    if (mist.mask > beads.mask) {
      beads = mist;
    }
  }
  // A passing drop sweeps up the beads on its path.
  beads.mask *= 1.0 - s.clear;
  return droplet_merge(s, beads);
}

fn droplet_lens(s: DropletSample, strength: f32) -> vec2f {
  return -s.local * s.radius * strength;
}

fn droplet_normal(s: DropletSample, flatness: f32) -> vec3f {
  return normal_from_xy(s.local * flatness);
}

fn droplet_rim(s: DropletSample) -> f32 {
  let r = min(length(s.local), 1.0);
  return r * r * r * r;
}

fn droplet_highlight(normal: vec3f, light: vec3f, sharpness: f32) -> f32 {
  let h = normalize(light + vec3f(0.0, 0.0, 1.0));
  return pow(max(dot(normal, h), 0.0), max(sharpness, 1.0));
}
`,"./fbm.wgsl":`// fbm.wgsl -- fractal sums of gradient noise (gnoise_* from noise.wgsl) and domain warping.
//
// Shared parameters
//   octaves     i32, clamped to [0, FBM_MAX_OCTAVES = 16]; cost is one noise evaluation per octave
//   lacunarity  frequency multiplier per octave, typically 2.0
//   gain        amplitude multiplier per octave, typically 0.5 (keep >= 0)
// Each result is divided by the sum of the octave amplitudes, so the stated range holds for any octave
// count, lacunarity and gain. In practice a 4-8 octave sum stays within about +-0.7 (std dev ~0.18):
// multiply by ~1.4 if you need the full span. Octave 0 uses \`p\` unchanged, so fbm_*(p, 1, ..) ==
// gnoise_*(p). Later octaves are rotated (36.87 degrees; about z for 3D) and shifted so the lattice
// axes and zero points of different octaves do not line up.
//
//   fbm_2d(p: vec2f, octaves, lacunarity, gain) -> f32          [-1, 1]
//   fbm_3d(p: vec3f, octaves, lacunarity, gain) -> f32          [-1, 1]; z is time or a third axis
//   fbm_2d_d(p: vec2f, octaves, lacunarity, gain) -> vec3f      (value, d/dx, d/dy), analytic
//   fbm_3d_d(p: vec3f, octaves, lacunarity, gain) -> vec4f      (value, d/dx, d/dy, d/dz), analytic
//   ridged_2d(p: vec2f, octaves, lacunarity, gain) -> f32       [0, 1]; (1 - |noise|)^2 per octave, so bright
//                                                               creases where the noise crosses zero: wave
//                                                               crests, veins, caustic-like lines
//   fbm_2d_tile(p: vec2f, period: vec2i, octaves, gain) -> f32  [-1, 1]; repeats every \`period\` cells of
//                                                               octave 0 (lacunarity fixed at 2, no rotation)
//   domain_warp_2d(p, strength, octaves, lacunarity, gain) -> vec2f
//                                  p displaced by up to \`strength\` (in p units) per axis along two fbm fields.
//                                  Feed the result to any pattern: fbm_2d(domain_warp_2d(p, ..), ..)
//   domain_warp_2d_anim(p, time, strength, octaves, lacunarity, gain) -> vec2f
//                                  same, evolving with \`time\` (3D fbm, about 2x the cost)
//
// The _d gradients are w.r.t. p (octave frequency and rotation are accounted for), so they are not
// unit-scale: expect magnitudes of 1-3. Cost is about 1.5x the plain form. Domain warping: I. Quilez, "warp".

#include "noise.wgsl"

const FBM_MAX_OCTAVES: i32 = 16;

// Per-octave transform q' = lacunarity * R q + shift. 0.8/0.6 is a 3-4-5 rotation (36.87 degrees).
const _FBM_ROT_2D = mat2x2f(0.8, 0.6, -0.6, 0.8);
const _FBM_ROT_3D = mat3x3f(0.8, 0.6, 0.0, -0.6, 0.8, 0.0, 0.0, 0.0, 1.0);
const _FBM_SHIFT_2D = vec2f(1.37, 2.71);
const _FBM_SHIFT_3D = vec3f(1.37, 2.71, 0.93);
const _WARP_OFFSET = vec2f(5.2, 1.3);

fn fbm_2d(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let n = clamp(octaves, 0, FBM_MAX_OCTAVES);
  let step_q = lacunarity * _FBM_ROT_2D;
  var q = p;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < n; i++) {
    sum += amp * gnoise_2d(q);
    norm += abs(amp);
    amp *= gain;
    q = step_q * q + _FBM_SHIFT_2D;
  }
  return sum / max(norm, 1e-6);
}

fn fbm_3d(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let n = clamp(octaves, 0, FBM_MAX_OCTAVES);
  let step_q = lacunarity * _FBM_ROT_3D;
  var q = p;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < n; i++) {
    sum += amp * gnoise_3d(q);
    norm += abs(amp);
    amp *= gain;
    q = step_q * q + _FBM_SHIFT_3D;
  }
  return sum / max(norm, 1e-6);
}

fn fbm_2d_d(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> vec3f {
  let n = clamp(octaves, 0, FBM_MAX_OCTAVES);
  let step_q = lacunarity * _FBM_ROT_2D;
  var q = p;
  var dq = mat2x2f(1.0, 0.0, 0.0, 1.0); // dq/dp, the chain-rule factor of the current octave
  var amp = 1.0;
  var sum = vec3f(0.0);
  var norm = 0.0;
  for (var i = 0; i < n; i++) {
    let d = gnoise_2d_d(q);
    sum += amp * vec3f(d.x, d.yz * dq);
    norm += abs(amp);
    amp *= gain;
    q = step_q * q + _FBM_SHIFT_2D;
    dq = step_q * dq;
  }
  return sum / max(norm, 1e-6);
}

fn fbm_3d_d(p: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> vec4f {
  let n = clamp(octaves, 0, FBM_MAX_OCTAVES);
  let step_q = lacunarity * _FBM_ROT_3D;
  var q = p;
  var dq = mat3x3f(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
  var amp = 1.0;
  var sum = vec4f(0.0);
  var norm = 0.0;
  for (var i = 0; i < n; i++) {
    let d = gnoise_3d_d(q);
    sum += amp * vec4f(d.x, d.yzw * dq);
    norm += abs(amp);
    amp *= gain;
    q = step_q * q + _FBM_SHIFT_3D;
    dq = step_q * dq;
  }
  return sum / max(norm, 1e-6);
}

fn ridged_2d(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let n = clamp(octaves, 0, FBM_MAX_OCTAVES);
  let step_q = lacunarity * _FBM_ROT_2D;
  var q = p;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < n; i++) {
    let r = 1.0 - abs(gnoise_2d(q));
    sum += amp * r * r;
    norm += abs(amp);
    amp *= gain;
    q = step_q * q + _FBM_SHIFT_2D;
  }
  return sum / max(norm, 1e-6);
}

fn fbm_2d_tile(p: vec2f, period: vec2i, octaves: i32, gain: f32) -> f32 {
  let n = clamp(octaves, 0, FBM_MAX_OCTAVES);
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  var scale = 1.0;
  var per = max(period, vec2i(1));
  for (var i = 0; i < n; i++) {
    // Any real shift keeps the pattern periodic; it only keeps octaves from all being zero at the
    // same lattice points. Octave 0 is unshifted.
    let shift = f32(min(i, 1)) * hash_1to2(f32(i));
    sum += amp * gnoise_2d_tile(p * scale + shift, per);
    norm += abs(amp);
    amp *= gain;
    scale *= 2.0;
    per *= 2;
  }
  return sum / max(norm, 1e-6);
}

fn domain_warp_2d(p: vec2f, strength: f32, octaves: i32, lacunarity: f32, gain: f32) -> vec2f {
  let q = vec2f(
    fbm_2d(p, octaves, lacunarity, gain),
    fbm_2d(p + _WARP_OFFSET, octaves, lacunarity, gain),
  );
  return p + strength * q;
}

fn domain_warp_2d_anim(
  p: vec2f,
  time: f32,
  strength: f32,
  octaves: i32,
  lacunarity: f32,
  gain: f32,
) -> vec2f {
  let q = vec2f(
    fbm_3d(vec3f(p, time), octaves, lacunarity, gain),
    fbm_3d(vec3f(p + _WARP_OFFSET, time), octaves, lacunarity, gain),
  );
  return p + strength * q;
}
`,"./flow.wgsl":`// flow.wgsl -- flow-map helpers: the two-phase advection of Vlachos, "Water Flow in Portal 2".
//
// The problem: to make a texture (normals, foam, dye) travel along a flow field you cannot just
// offset the uv by flow * time, because neighbouring pixels have different flows and the texture
// shears into streaks without bound. The fix is to advect for a LIMITED time, snap back, and hide
// the snap: two copies of the texture run on phases half a cycle apart, each fading to zero weight
// exactly when it resets, so the picture is always made of at least one copy that is young and
// undistorted, and the reset is never seen.
//
// What the caller does (texture sampling stays in the caller, so any texture or layer count works):
//   let flow = flow_decode(textureSampleLevel(flow_map, flow_samp, flow_uv, 0.0)) * speed;
//   let ph   = flow_phases(uv, flow, time, cycle, flow_phase_noise(uv * 6.0) * noise_amount);
//   let a    = textureSampleGrad(tex, samp, ph.uv_a, dpdx(uv), dpdy(uv));    // see "Mips" below
//   let b    = textureSampleGrad(tex, samp, ph.uv_b, dpdx(uv), dpdy(uv));
//   let s    = flow_blend_slope(a.xy, b.xy, ph.weight_a, ph.weight_b);        // normals, see below
//
// Flow encoding (the 8-bit "flow map" texture, e.g. from createFlowMap in src/gpu/bake.ts)
//   rg = velocity in texture axes (x right, y down, the screen's orientation), one unit = the
//   fastest current in the map. Byte 127 is EXACT zero, bytes 0 and 254 are -1 and +1 (255 clamps
//   to +1). The common 0.5 + 0.5 * v encoding cannot store zero in 8 bits (0.5 is not a multiple
//   of 1/255), so still water would drift at 1/255 of full speed and, advected for a whole cycle,
//   creep visibly: keep the byte-127 convention for any 8-bit map you author.
//   flow_encode(v: vec2f) -> vec2f      velocity (|components| <= 1, clamped) to rg in [0, 1]
//   flow_decode(texel: vec4f) -> vec2f  texel rg back to velocity. Filtering the encoded bytes
//                                       bilinearly is fine: decoding is affine, so it commutes
//
// Phases
//   struct FlowPhases { uv_a, uv_b: vec2f; weight_a, weight_b: f32 }
//       uv_a / uv_b   where to sample the texture for the two copies
//       weight_*      triangle-wave fade in [0, 1]; weight_a + weight_b == 1 always
//   flow_phases(uv, flow, time, cycle, phase_offset) -> FlowPhases
//       uv            texture coordinate of the pixel (the same units as \`flow\` times seconds)
//       flow          velocity in uv units per SECOND (already multiplied by speed and tiling), so
//                     a feature drifts by flow * cycle uv units before its copy resets
//       time          seconds, accumulated by the caller (so changing speed never jumps)
//       cycle         seconds per full phase, > 0 (clamped to >= 1e-3). 1-2 s is typical. Each copy
//                     moves for one cycle then resets; the pair is refreshed every cycle / 2
//       phase_offset  added to the phase, in cycles; use flow_phase_noise() * amount per pixel
//     phase_a = fract(time / cycle + phase_offset), phase_b = fract(phase_a + 0.5),
//     uv_x = uv - flow * cycle * phase_x, weight_x = 1 - |2 * phase_x - 1|.
//     Properties (tested): with flow == 0 both uv equal the input; an offset is exactly zero at the
//     phase's reset, which is also where its weight is zero; the weights are continuous in time.
//   flow_phase_noise(p: vec2f) -> f32
//       smooth per-pixel phase offset in [0, 1] (gradient noise, one octave, \`p\` in lattice units:
//       uv * 4 .. 12). Multiply by an amount in [0, 1] cycles. WITHOUT it every pixel resets at the
//       same instant and the whole surface pulses at 2 / cycle Hz (the texture contrast dips
//       when the two copies are mixed 50/50 and recovers as one copy takes over). With full-range
//       noise the resets are spread over the whole cycle and the pulse disappears into a
//       steady shimmer. Too-fast noise (high \`p\` frequency) shows as sparkle, too slow as bands.
//
// Blending the two copies
//   flow_blend_slope(a, b, weight_a, weight_b) -> vec2f
//       for mean-zero data (tangent-space normal xy, height deltas). A plain w_a * a + w_b * b halves
//       the variance at the 50/50 point (two independent copies average out), which shows as the
//       contrast "breathing" with the cycle. This divides by sqrt(w_a^2 + w_b^2) instead (the
//       variance-preserving blend of Heitz and Neyret's histogram-preserving work), keeping the
//       roughness constant. Do NOT use it for colours or masks that have a nonzero mean: blend those
//       with weight_a * a + weight_b * b.
//   flow_strength(flow: vec2f, calm: f32, fast: f32) -> f32
//       normal-strength multiplier from the decoded flow speed: \`calm\` where the water is still,
//       \`fast\` where |flow| >= 1 (mix in between). Fast water is rougher, backwaters glassy.
//   flow_speed(flow: vec2f) -> f32       |flow|, clamped to [0, 1] (decoded, before your speed)
//
// Mips: the two uv sets jump by flow * cycle when a phase resets, so hardware derivatives from
// textureSample see a huge uv gradient there and select a blurry mip, drawing a thin seam
// exactly where one copy has weight ~0. Pass the derivatives of the UNOFFSET uv (dpdx(uv), dpdy(uv))
// to textureSampleGrad instead; they are continuous. They must be computed in uniform control flow
// (before any non-uniform \`if\`, discard or early return).
//
// Pitfalls: a long \`cycle\` lets each copy stretch along the flow before it resets (the shear grows
// with cycle * |grad flow|); a short one makes the texture visibly refresh or "boil". Rocks and
// banks where the flow turns sharply stretch first. See the flow-map effect notes.
//
// Cost: flow_phases is about 15 ALU ops, flow_phase_noise one gradient noise. The caller pays two
// texture fetches per layer instead of one.

#include "noise.wgsl"

struct FlowPhases {
  uv_a: vec2f,
  uv_b: vec2f,
  weight_a: f32,
  weight_b: f32,
}

// Byte 127 = 0. Byte b maps to (b - 127) / 127, so 254 is +1; the one asymmetric byte (0) is -1.
const _FLOW_ZERO_BYTE: f32 = 127.0;
const _FLOW_SCALE: f32 = 127.0;

fn flow_encode(v: vec2f) -> vec2f {
  return (_FLOW_ZERO_BYTE + _FLOW_SCALE * clamp(v, vec2f(-1.0), vec2f(1.0))) / 255.0;
}

fn flow_decode(texel: vec4f) -> vec2f {
  return clamp((texel.rg * 255.0 - _FLOW_ZERO_BYTE) / _FLOW_SCALE, vec2f(-1.0), vec2f(1.0));
}

fn flow_phases(uv: vec2f, flow: vec2f, time: f32, cycle: f32, phase_offset: f32) -> FlowPhases {
  let c = max(cycle, 1e-3);
  let phase_a = fract(time / c + phase_offset);
  let phase_b = fract(phase_a + 0.5);
  var r: FlowPhases;
  r.uv_a = uv - flow * (c * phase_a);
  r.uv_b = uv - flow * (c * phase_b);
  r.weight_a = 1.0 - abs(2.0 * phase_a - 1.0);
  r.weight_b = 1.0 - abs(2.0 * phase_b - 1.0);
  return r;
}

fn flow_phase_noise(p: vec2f) -> f32 {
  // gnoise_2d reaches about +-0.93, so the stretch fills [0, 1] without clipping often.
  return clamp(0.5 + 0.5 * gnoise_2d(p) * 1.07, 0.0, 1.0);
}

fn flow_blend_slope(a: vec2f, b: vec2f, weight_a: f32, weight_b: f32) -> vec2f {
  let norm = max(sqrt(weight_a * weight_a + weight_b * weight_b), 1e-4);
  return (weight_a * a + weight_b * b) / norm;
}

fn flow_speed(flow: vec2f) -> f32 {
  return min(length(flow), 1.0);
}

fn flow_strength(flow: vec2f, calm: f32, fast: f32) -> f32 {
  return mix(calm, fast, flow_speed(flow));
}
`,"./fluid-surface.wgsl":`// fluid-surface.wgsl -- the geometry and filter helpers of screen-space fluid rendering: sphere
// impostors, depth reconstruction, the depth-smoothing kernels and the normal-from-depth rule.
// The passes themselves live in src/gpu/fluid-surface/; this chunk is what they share and what the
// tests evaluate on their own.
//
// CONVENTIONS. View space looks down -Z. "Linear depth" is the positive distance along the view
// axis (clip w), the same quantity as \`camera_linear_depth\` in camera.wgsl. A ray is a UNIT
// direction \`dir\` leaving the eye (the view-space origin). A background pixel in a depth image
// holds 0, so "valid" means depth > 0.
//
// Sphere impostors (a particle drawn as a camera-facing quad, shaded as the sphere it stands for)
//   fluid_surface_billboard_half_size(centre: vec3f, radius: f32, near: f32) -> f32
//        half width of the view-space quad, placed on the plane z = centre.z, that covers the whole
//        projected sphere (the silhouette of an off-axis sphere is an ellipse: r / cos(theta + a)).
//        -1 when the sphere reaches the near plane or is behind it: cull it
//   fluid_surface_sphere_span(dir: vec3f, centre: vec3f, radius: f32) -> vec2f
//        distances along the ray where it enters and leaves the sphere (x < y); (-1, -1) for a miss
//        or a sphere behind the eye. x may be negative when the eye is inside the sphere
//   fluid_surface_sphere_depth(dir: vec3f, centre: vec3f, radius: f32) -> f32
//        linear depth of the near surface point, -1 for a miss. This is the exact depth a real
//        sphere would have at that pixel, written to the depth buffer so impostors intersect
//
// Reconstruction
//   fluid_surface_view_pos(cam: Camera, uv: vec2f, linear_depth: f32) -> vec3f
//        view-space position of the surface seen at \`uv\` (top-left origin) with that linear depth.
//        Uses the x/y scale and offset of the projection, so it is exact for a perspective camera
//        and costs 8 ALU instead of a matrix inverse
//   fluid_surface_pixel_radius(cam: Camera, linear_depth: f32, radius: f32, height_px: f32) -> f32
//        projected radius in pixels of a world-space \`radius\` at that depth, for a target
//        \`height_px\` tall
//
// Smoothing
//   fluid_surface_filter_radius(pixel_radius: f32, scale: f32, max_radius: f32) -> f32
//        kernel radius in pixels: the projected particle radius times \`scale\`, within [1, max_radius]
//        so the filter follows the particle size as the camera moves and cannot run away when a
//        particle fills the screen
//   fluid_surface_kernel_weight(offset: f32, radius: f32) -> f32
//        Gaussian spatial weight with sigma = radius / 2 (truncated at two sigma); 1 at offset 0
//   fluid_surface_bilateral_weight(spatial: f32, dz: f32, range: f32) -> f32
//        the classic bilateral weight: spatial * exp(-dz^2 / (2 range^2)). Far depths get ~0 weight,
//        so they are dropped, which is what leaves "curtains" on slanted surfaces
//   fluid_surface_narrow_clamp(z: f32, centre: f32, window: f32) -> f32
//        the narrow-range rule: a sample is kept but clamped to centre +- window, so a foreign
//        surface can move the result by at most \`window\`
//
// Normals
//   fluid_surface_pick_difference(forward: vec3f, backward: vec3f, forward_ok: bool, backward_ok: bool) -> vec3f
//        of two one-sided differences of view-space position (the next pixel minus this one, this
//        one minus the previous), the one with the smaller depth change, or the only valid one, or
//        zero. Crossing a silhouette is what makes a central difference produce garbage normals
//   fluid_surface_normal(dx: vec3f, dy_up: vec3f) -> vec3f
//        unit normal facing the camera from a difference towards +x and one towards +y (up) in view
//        space; (0, 0, 1) when they are degenerate
//
// Thickness
//   fluid_surface_chord(dir: vec3f, centre: vec3f, radius: f32, near: f32, limit: f32) -> f32
//        length of the ray inside the sphere, clipped to [near, limit] along the ray: the thickness
//        one particle adds to a pixel. \`limit\` is the distance to a scene surface that hides the
//        rest of the sphere (use a large number for none)
//
// Cost: every function is a handful of ALU ops (the sphere ones one sqrt, view_pos two divides);
// none samples a texture. The per-pixel cost of a fluid surface is in the loops that call them.
//
// References: van der Laan, Green and Sainz, "Screen Space Fluid Rendering with Curvature Flow"
// (2009), for the impostor and the smoothing idea; Truong and Yuksel, "A Narrow-Range Filter for
// Screen-Space Fluid Rendering" (2018), for the clamped range.

#include "camera.wgsl"

fn fluid_surface_billboard_half_size(centre: vec3f, radius: f32, near: f32) -> f32 {
  let depth = -centre.z;
  let dist = length(centre);
  if (depth - radius < near || dist <= radius) {
    return -1.0;
  }
  let sin_a = radius / dist;
  let cos_a = sqrt(1.0 - sin_a * sin_a);
  let cos_t = depth / dist;
  let sin_t = sqrt(max(1.0 - cos_t * cos_t, 0.0));
  let cos_ta = cos_t * cos_a - sin_t * sin_a;
  return radius / max(cos_ta, 0.05);
}

fn fluid_surface_sphere_span(dir: vec3f, centre: vec3f, radius: f32) -> vec2f {
  // The perpendicular offset form: b * b - |c|^2 + r^2 cancels two numbers of the same size and
  // loses the rim of the sphere to rounding, this does not.
  let b = dot(dir, centre);
  let offset = centre - dir * b;
  let disc = radius * radius - dot(offset, offset);
  if (disc < 0.0 || b + sqrt(disc) < 0.0) {
    return vec2f(-1.0, -1.0);
  }
  let s = sqrt(disc);
  return vec2f(b - s, b + s);
}

fn fluid_surface_sphere_depth(dir: vec3f, centre: vec3f, radius: f32) -> f32 {
  let span = fluid_surface_sphere_span(dir, centre, radius);
  if (span.y < 0.0) {
    return -1.0;
  }
  return -dir.z * max(span.x, 0.0);
}

fn fluid_surface_view_pos(cam: Camera, uv: vec2f, linear_depth: f32) -> vec3f {
  let ndc = camera_uv_to_ndc(uv);
  return vec3f(
    linear_depth * (ndc.x + cam.proj[2][0]) / cam.proj[0][0],
    linear_depth * (ndc.y + cam.proj[2][1]) / cam.proj[1][1],
    -linear_depth,
  );
}

fn fluid_surface_pixel_radius(cam: Camera, linear_depth: f32, radius: f32, height_px: f32) -> f32 {
  return radius * cam.proj[1][1] * 0.5 * height_px / max(linear_depth, 1e-4);
}

fn fluid_surface_filter_radius(pixel_radius: f32, scale: f32, max_radius: f32) -> f32 {
  return clamp(pixel_radius * scale, 1.0, max(max_radius, 1.0));
}

fn fluid_surface_kernel_weight(offset: f32, radius: f32) -> f32 {
  let u = offset / max(radius, 1e-4);
  return exp(-2.0 * u * u);
}

fn fluid_surface_bilateral_weight(spatial: f32, dz: f32, range: f32) -> f32 {
  let u = dz / max(range, 1e-5);
  return spatial * exp(-0.5 * u * u);
}

fn fluid_surface_narrow_clamp(z: f32, centre: f32, window: f32) -> f32 {
  return clamp(z, centre - window, centre + window);
}

fn fluid_surface_pick_difference(
  forward: vec3f,
  backward: vec3f,
  forward_ok: bool,
  backward_ok: bool,
) -> vec3f {
  if (forward_ok && backward_ok) {
    return select(backward, forward, abs(forward.z) < abs(backward.z));
  }
  if (forward_ok) {
    return forward;
  }
  if (backward_ok) {
    return backward;
  }
  return vec3f(0.0);
}

fn fluid_surface_normal(dx: vec3f, dy_up: vec3f) -> vec3f {
  let n = cross(dx, dy_up);
  let len = length(n);
  if (len < 1e-20) {
    return vec3f(0.0, 0.0, 1.0);
  }
  let unit = n / len;
  return select(-unit, unit, unit.z >= 0.0);
}

fn fluid_surface_chord(dir: vec3f, centre: vec3f, radius: f32, near: f32, limit: f32) -> f32 {
  let span = fluid_surface_sphere_span(dir, centre, radius);
  if (span.y < 0.0) {
    return 0.0;
  }
  let t0 = max(span.x, near);
  let t1 = min(span.y, limit);
  return max(t1 - t0, 0.0);
}
`,"./fluid.wgsl":`// fluid.wgsl -- read the textures of the stable-fluids solver (src/gpu/sim/fluid.ts) without knowing
// how they are laid out, and a few helpers for drawing dye.
//
// CONVENTIONS. \`uv\` is the canvas uv of the fullscreen pass (0, 0 top-left, y down), and the solver's
// grid covers the canvas exactly, so the same uv addresses every texture below. Velocity is in IMAGE
// HEIGHTS PER SECOND (1.0 crosses the canvas height in a second; a horizontal 1.0 crosses a 16:9
// canvas in 1/1.78 s) with y DOWN. Vorticity is in 1 / s and is positive where the flow turns CLOCKWISE
// on screen (dv/dx > du/dy with y down). Pressure is the solver's velocity potential (see
// fluid-project.wgsl): a relative quantity, in the units of velocity. All of it is linear, unclamped.
//
// THE FIELDS TEXTURE (\`fluid.fieldsView\`, rgba16float, one texel per cell, filterable, stable between
// updates). The easiest thing to read: one filtered tap gives velocity, vorticity and pressure at
// the cell centres, bilinearly smooth in between. Solid cells are all zero.
//   fluid_velocity(s: vec4f) -> vec2f          velocity from a fields texel
//   fluid_speed(s: vec4f) -> f32               its length
//   fluid_vorticity(s: vec4f) -> f32           vorticity, 1 / s
//   fluid_pressure(s: vec4f) -> f32            pressure potential
//   fluid_sample_fields(tex, samp, uv) -> vec4f   one bilinear tap (needs a filtering sampler)
//
// THE STAGGERED VELOCITY TEXTURE (\`fluid.velocity.view\`, (W+1) x (H+1) texels, u in .x on the left face
// of each cell, v in .y on its top face), for passes that want the solver's own field rather than the
// cell-centred average:
//   fluid_velocity_at(tex, samp, uv, grid: vec2f) -> vec2f   velocity at uv by two filtered taps;
//                                              \`grid\` is [width, height] in cells (solver.grid)
//
// THE DYE TEXTURE (\`fluid.dye.view\`, rgba16float, dyeWidth x dyeHeight, filterable). What the channels
// mean is up to whoever injects the dye; the demo puts colour * amount in rgb and the amount in a.
//   fluid_dye_rgb(s: vec4f) -> vec3f           s.rgb
//   fluid_dye_density(s: vec4f) -> f32         s.a
//   fluid_dye_gradient(tex, samp, uv, texel: vec2f) -> vec2f
//                                              central-difference gradient of the density, per TEXEL
//                                              (texel = [1 / dyeWidth, 1 / dyeHeight]), x right, y down;
//                                              four taps. Feed it to a normal for a liquid sheen.
//
// COLOUR HELPERS
//   fluid_absorbance(colour: vec3f) -> vec3f   the per-channel optical density that makes light of
//                                              the given colour: -ln(colour), colour clamped to
//                                              [0.02, 1]. Inject this (times an amount) to make
//                                              inks that mix SUBTRACTIVELY, like paint
//   fluid_transmittance(absorbance: vec3f) -> vec3f   exp(-absorbance): multiply the page by it
//   fluid_flow_color(v: vec2f, scale: f32) -> vec3f   debug colour of a velocity: hue is direction
//                                              (right = red, down = green-cyan, left = cyan-blue, up = purple),
//                                              brightness 1 - exp(-|v| * scale); linear rgb
//   fluid_diverging(x: f32) -> vec3f           debug colour of a signed quantity in [-1, 1]: blue
//                                              negative, near-black at 0, orange positive; linear rgb
//
// Why subtractive? Adding light-coloured dyes gives grey mud (red + cyan = white) and averaging
// them in advection gives the same mud. Optical density adds, transmittance multiplies, so blue
// over yellow gives green and a dilute ink fades to the paper's own colour, which is how real ink
// behaves. Use additive (emissive) dye for glowing smoke on a dark ground.
//
// Cost: one tap per sample call (fluid_velocity_at two, fluid_dye_gradient four); the helpers are a
// few ALU ops.

#include "color.wgsl"
#include "math.wgsl"

fn fluid_velocity(s: vec4f) -> vec2f {
  return s.xy;
}

fn fluid_speed(s: vec4f) -> f32 {
  return length(s.xy);
}

fn fluid_vorticity(s: vec4f) -> f32 {
  return s.z;
}

fn fluid_pressure(s: vec4f) -> f32 {
  return s.w;
}

fn fluid_sample_fields(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f {
  return textureSampleLevel(tex, samp, uv, 0.0);
}

fn fluid_velocity_at(tex: texture_2d<f32>, samp: sampler, uv: vec2f, grid: vec2f) -> vec2f {
  let p = uv * grid;
  let size = grid + vec2f(1.0);
  let u = textureSampleLevel(tex, samp, vec2f(p.x + 0.5, p.y) / size, 0.0).x;
  let v = textureSampleLevel(tex, samp, vec2f(p.x, p.y + 0.5) / size, 0.0).y;
  return vec2f(u, v);
}

fn fluid_dye_rgb(s: vec4f) -> vec3f {
  return s.rgb;
}

fn fluid_dye_density(s: vec4f) -> f32 {
  return s.a;
}

fn fluid_dye_gradient(tex: texture_2d<f32>, samp: sampler, uv: vec2f, texel: vec2f) -> vec2f {
  let r = textureSampleLevel(tex, samp, uv + vec2f(texel.x, 0.0), 0.0).a;
  let l = textureSampleLevel(tex, samp, uv - vec2f(texel.x, 0.0), 0.0).a;
  let d = textureSampleLevel(tex, samp, uv + vec2f(0.0, texel.y), 0.0).a;
  let u = textureSampleLevel(tex, samp, uv - vec2f(0.0, texel.y), 0.0).a;
  return 0.5 * vec2f(r - l, d - u);
}

fn fluid_absorbance(colour: vec3f) -> vec3f {
  return -log(clamp(colour, vec3f(0.02), vec3f(1.0)));
}

fn fluid_transmittance(absorbance: vec3f) -> vec3f {
  return exp(-max(absorbance, vec3f(0.0)));
}

fn fluid_flow_color(v: vec2f, scale: f32) -> vec3f {
  if (dot(v, v) < 1e-12) {
    return vec3f(0.0);
  }
  let t = atan2(v.y, v.x) / TAU;
  let hue = palette_cosine(t, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  return hue * (1.0 - exp(-length(v) * scale));
}

fn fluid_diverging(x: f32) -> vec3f {
  let t = clamp(x, -1.0, 1.0);
  let cold = vec3f(0.02, 0.2, 0.9);
  let hot = vec3f(1.0, 0.35, 0.02);
  return abs(t) * select(cold, hot, t > 0.0);
}
`,"./foam.wgsl":`// foam.wgsl -- depth-driven foam, soft intersection fade and wet-sand helpers for shorelines.
//
// Foam appears where water is shallow or touches something: along a beach, around rocks, where a surface
// cuts through geometry. All of it keys off ONE number, \`depth\`: the vertical (or distance-to-geometry)
// thickness of water at this pixel, in whatever unit you like, as long as \`width\` / \`fade\` use the same.
// depth <= 0 means "at or inside the geometry". Feed analytic depth today, depth-buffer differences later.
//
// The foam look is built in three steps so each can be tuned or replaced on its own:
//   1. coverage  = foam_mask(depth, width, noise, breakup)   where foam is allowed, [0, 1]
//   2. thickness = foam_texture(p, time)                      what foam looks like, lace and bubbles, [0, 1]
//   3. foam      = foam_dissolve(thickness, coverage, soft)   thickness thresholded by coverage, [0, 1]
// As coverage falls the thin lace goes first and the thick clumps last, so foam dissolves into holes
// instead of fading out as a grey wash.
//
// Mask and dissolve
//   foam_mask(depth, width, noise01, breakup) -> f32
//       1 at depth <= 0, 0 at depth >= width, monotonic between, always in [0, 1] for any noise. \`noise01\` in
//       [0, 1] (e.g. 0.5 + 0.5 * gnoise) shortens the reach of the foam where it is low; \`breakup\` in [0, 1]
//       says how much (0 = a clean smooth band, 1 = ragged, fingers of foam reaching up to \`width\`).
//   foam_dissolve(thickness, coverage, softness) -> f32
//       smoothstep threshold: coverage 1 gives 1 everywhere, coverage 0 gives 0 everywhere, in between the
//       foam survives where thickness is largest. softness in (0, 1]: edge width of the holes.
//   foam_texture(p: vec2f, time: f32) -> f32
//       procedural foam thickness in [0, 1]: two scales of animated Voronoi (lace on the cell walls, bubbles
//       in the cells) modulated by a slow patchiness. p is in feature units (cells about 1.0 across; use
//       world * 12 for a fine bubbly look, world * 4 for big clumps). \`time\` is in radians: the cell seeds
//       orbit, so the lace boils instead of sliding. Cost: 2 voronoi + 1 gnoise.
//   foam_texture_lite(p, time) -> f32      one scale, no patchiness: 1 voronoi, about 40% of the cost
// Animation
//   foam_swash(phase: f32, rise: f32) -> f32
//       wave run-up cycle in [0, 1], periodic in \`phase\` (cycles). Zero at integer phase, peak 1 at
//       fract(phase) = rise (rush up fast, ease out), then drains back slowly. rise in (0, 1), typically 0.25.
//       Add a noise offset to the phase per position so wave lines lap in and out at different times.
// Soft intersection
//   foam_edge_fade(depth, fade) -> f32
//       0 at depth <= 0 (the intersection), 1 at depth >= fade, smooth (C1) between: multiply a water
//       surface's alpha by this to hide the hard line where it cuts through geometry
//   foam_rim(depth, width) -> f32          bright line hugging the contact: 1 at depth 0, 0 at width, concentrated
//                                          near 0 (squared), for the thin crisp edge on top of the foam body
// Wet ground
//   foam_wetness(height_above, reach) -> f32     1 at the waterline (height_above <= 0), 0 at \`reach\` above it
//   foam_darken_wet(color: vec3f, wetness: f32, strength: f32) -> vec3f
//       wet surfaces are darker and more saturated: pow(color, 1 + strength * wetness), a little extra
//       darkening. wetness 0 returns the colour unchanged. strength ~0.6..1.2 for sand
//
// Cost: mask / dissolve / swash / fade / rim are a handful of ALU each; the texture dominates (see above).
// Credits: Voronoi lace after the usual shoreline-foam recipes (S. Worley 1996 for the cells).

#include "noise.wgsl"
#include "voronoi.wgsl"

fn foam_mask(depth: f32, width: f32, noise01: f32, breakup: f32) -> f32 {
  let reach = max(width, 1e-5) * mix(1.0, clamp(noise01, 0.0, 1.0), clamp(breakup, 0.0, 1.0));
  return 1.0 - smoothstep(0.0, max(reach, 1e-5), depth);
}

fn foam_dissolve(thickness: f32, coverage: f32, softness: f32) -> f32 {
  let s = clamp(softness, 0.01, 1.0);
  let lo = 1.0 - clamp(coverage, 0.0, 1.0) * (1.0 + s);
  return smoothstep(lo, lo + s, clamp(thickness, 0.0, 1.0));
}

fn foam_texture_lite(p: vec2f, time: f32) -> f32 {
  let v = voronoi_2d_anim(p, 1.0, time);
  let wall = 1.0 - smoothstep(0.0, 0.3, v.f2 - v.f1);
  let bubble = 1.0 - smoothstep(0.1, 0.65, v.f1);
  return clamp(0.65 * wall + 0.45 * bubble * (0.4 + 0.6 * v.id), 0.0, 1.0);
}

fn foam_texture(p: vec2f, time: f32) -> f32 {
  let a = foam_texture_lite(p, time);
  let b = foam_texture_lite(p * 2.3 + vec2f(13.7, 5.1), time * 1.3 + 2.0);
  let clump = 0.5 + 0.5 * gnoise_2d(p * 0.35 + vec2f(0.0, time * 0.05));
  return clamp((0.6 * a + 0.5 * b) * (0.55 + 0.7 * clump), 0.0, 1.0);
}

fn foam_swash(phase: f32, rise: f32) -> f32 {
  let r = clamp(rise, 0.02, 0.98);
  let x = fract(phase);
  if (x < r) {
    return sin(x / r * 1.5707963);
  }
  let u = (x - r) / (1.0 - r);
  return 0.5 + 0.5 * cos(u * 3.1415927);
}

fn foam_edge_fade(depth: f32, fade: f32) -> f32 {
  let t = clamp(depth / max(fade, 1e-5), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn foam_rim(depth: f32, width: f32) -> f32 {
  let t = 1.0 - clamp(depth / max(width, 1e-5), 0.0, 1.0);
  return t * t;
}

fn foam_wetness(height_above: f32, reach: f32) -> f32 {
  return 1.0 - smoothstep(0.0, max(reach, 1e-5), height_above);
}

fn foam_darken_wet(color: vec3f, wetness: f32, strength: f32) -> vec3f {
  let w = clamp(wetness, 0.0, 1.0);
  let c = max(color, vec3f(0.0));
  return pow(c, vec3f(1.0 + max(strength, 0.0) * w)) * (1.0 - 0.12 * w);
}
`,"./fresnel.wgsl":`// fresnel.wgsl -- Fresnel reflectance of a clear dielectric (water, glass): how much light a surface
// reflects as a function of the angle between the view and the surface normal.
//
// Conventions
//  * \`cos_theta\` is the cosine of the angle of incidence: dot(normal, view) with both vectors unit
//    length and \`view\` pointing from the surface TO the eye. 1 = looking straight down at the
//    surface, 0 = grazing. Every function clamps it to [0, 1], so a wave normal that tilts away from
//    the eye (dot < 0) is treated as grazing and reflects fully rather than producing garbage.
//  * Results are reflectance (the reflected fraction of incoming radiance), in [0, 1]. Refraction
//    gets the remainder: transmitted = 1 - fresnel_*(..). Light is treated as unpolarised.
//  * n1 is the index of refraction (IOR) on the side the light comes from, n2 the far side. Air is
//    1.0, water 1.333 (FRESNEL_IOR_*). Light travelling from air into water is n1 = 1, n2 = 1.333.
//
// Constants
//   FRESNEL_IOR_AIR (1.0)   FRESNEL_IOR_WATER (1.333)
//   FRESNEL_F0_WATER        reflectance of air -> water at normal incidence, (n1-n2)^2/(n1+n2)^2 = 0.0204
//
// Reflectance at normal incidence
//   fresnel_f0(n1, n2) -> f32      ((n1 - n2) / (n1 + n2))^2. Air to water: 0.0204; air to glass 1.5: 0.04
//
// Schlick's approximation: F0 + (1 - F0) (1 - cos)^5. Two ALU-cheap multiplies instead of two square
// roots and two divisions; the standard choice for real-time water.
//   fresnel_schlick(cos_theta, f0) -> f32       equals f0 at cos 1 and exactly 1 at cos 0
//   fresnel_schlick_vec(cos_theta, f0: vec3f) -> vec3f   per-channel F0, for tinted or metallic reflectors
//   fresnel_water(cos_theta) -> f32             fresnel_schlick with FRESNEL_F0_WATER (air -> water)
//   fresnel_schlick_roughness(cos_theta, f0, roughness) -> f32
//                                  Lagarde's roughness-aware form for reflections taken from a blurred
//                                  environment: the grazing limit is lowered to 1 - roughness (never
//                                  below f0), so a rough surface does not turn into a perfect mirror
//                                  at the edge. roughness in [0, 1]; roughness 0 equals fresnel_schlick
//   fresnel_schlick_dielectric(cos_theta, n1, n2) -> f32
//                                  Schlick that is also right when light goes from the denser medium
//                                  to the thinner one (n1 > n2, e.g. looking up from under water):
//                                  it feeds Schlick the cosine of the TRANSMITTED angle and returns 1
//                                  beyond the critical angle (total internal reflection)
//
// Exact form: the unpolarised average of the Fresnel equations for s and p polarisation. Use it as the
// reference to check the approximations, or where a few extra ALU ops do not matter.
//   fresnel_exact(cos_theta, n1, n2) -> f32     1 beyond the critical angle when n1 > n2
//
// Accuracy (checked in tests/optics-surface.test.ts): for air -> water Schlick is within 0.01 of
// fresnel_exact up to 70 degrees from the normal and within 0.06 everywhere. It reads a little low
// around 50 to 65 degrees and high above 70, worst at 84 degrees (0.58 against 0.53). Both agree at
// 0 and 90 degrees. Not visible on a wavy surface; if you need the exact grazing shoulder, use
// fresnel_exact.
// Cost: Schlick ~8 ALU; exact ~25 ALU with one sqrt and two divisions.
//
// Reference: C. Schlick, "An Inexpensive BRDF Model for Physically-based Rendering" (1994); the
// roughness-aware form is the one S. Lagarde describes in "Image-based lighting approaches and
// parallax-corrected cubemap" (2012).

const FRESNEL_IOR_AIR: f32 = 1.0;
const FRESNEL_IOR_WATER: f32 = 1.333;
const FRESNEL_F0_WATER: f32 = 0.020373;

fn _fresnel_pow5(x: f32) -> f32 {
  let x2 = x * x;
  return x2 * x2 * x;
}

fn fresnel_f0(n1: f32, n2: f32) -> f32 {
  let r = (n1 - n2) / (n1 + n2);
  return r * r;
}

fn fresnel_schlick(cos_theta: f32, f0: f32) -> f32 {
  let m = 1.0 - clamp(cos_theta, 0.0, 1.0);
  return f0 + (1.0 - f0) * _fresnel_pow5(m);
}

fn fresnel_schlick_vec(cos_theta: f32, f0: vec3f) -> vec3f {
  let m = 1.0 - clamp(cos_theta, 0.0, 1.0);
  return f0 + (vec3f(1.0) - f0) * _fresnel_pow5(m);
}

fn fresnel_water(cos_theta: f32) -> f32 {
  return fresnel_schlick(cos_theta, FRESNEL_F0_WATER);
}

fn fresnel_schlick_roughness(cos_theta: f32, f0: f32, roughness: f32) -> f32 {
  let m = 1.0 - clamp(cos_theta, 0.0, 1.0);
  let grazing = max(1.0 - clamp(roughness, 0.0, 1.0), f0);
  return f0 + (grazing - f0) * _fresnel_pow5(m);
}

fn fresnel_exact(cos_theta: f32, n1: f32, n2: f32) -> f32 {
  let c = clamp(cos_theta, 0.0, 1.0);
  let eta = n1 / n2;
  let sin2_t = eta * eta * (1.0 - c * c);
  if (sin2_t >= 1.0) {
    return 1.0;
  }
  let cos_t = sqrt(1.0 - sin2_t);
  let rs = (n1 * c - n2 * cos_t) / (n1 * c + n2 * cos_t);
  let rp = (n1 * cos_t - n2 * c) / (n1 * cos_t + n2 * c);
  return 0.5 * (rs * rs + rp * rp);
}

fn fresnel_schlick_dielectric(cos_theta: f32, n1: f32, n2: f32) -> f32 {
  let c = clamp(cos_theta, 0.0, 1.0);
  let f0 = fresnel_f0(n1, n2);
  if (n1 <= n2) {
    return fresnel_schlick(c, f0);
  }
  let eta = n1 / n2;
  let sin2_t = eta * eta * (1.0 - c * c);
  if (sin2_t >= 1.0) {
    return 1.0;
  }
  return fresnel_schlick(sqrt(1.0 - sin2_t), f0);
}
`,"./fullscreen.wgsl":`// Fullscreen triangle, shared by every fragment-only effect and pass:
//
//   #include "fullscreen.wgsl"
//   @fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f { ... }
//
// Convention: \`uv\` is (0, 0) at the TOP-LEFT of the target and (1, 1) at the BOTTOM-RIGHT, the same
// orientation as texture coordinates. Sampling a texture with \`uv\` shows it upright, and \`uv.y\`
// grows downwards; use \`1.0 - uv.y\` for maths that expects y up. \`position.xy\` is in framebuffer
// pixels with the same top-left origin.

struct FullscreenVarying {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

// One oversized triangle covers the viewport: no vertex buffer, no diagonal seam.
@vertex fn fullscreen_vs(@builtin(vertex_index) index: u32) -> FullscreenVarying {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u)); // (0,0) (2,0) (0,2)
  var out: FullscreenVarying;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}
`,"./hash.wgsl":`// hash.wgsl -- integer hashes (PCG family) with float wrappers. No sin(), no float-precision
// dependence: the same input bits give the same output bits on every device.
//
// Credits: pcg_1d is the PCG output permutation (M. O'Neill, pcg-random.org); pcg_2d/3d/4d are the
// multi-component PCG hashes from Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020).
//
// Raw integer hashes (u32 in, u32 out; every output bit is balanced and depends on the whole input)
//   pcg_1d(v: u32) -> u32            pcg_2d(v: vec2u) -> vec2u
//   pcg_3d(v: vec3u) -> vec3u        pcg_4d(v: vec4u) -> vec4u
//
// u32 -> float in [0, 1), exactly 24 bits of precision (never returns 1.0)
//   to_unorm_1d(h: u32) -> f32       to_unorm_2d(h: vec2u) -> vec2f
//   to_unorm_3d(h: vec3u) -> vec3f   to_unorm_4d(h: vec4u) -> vec4f
//
// Float-input hashes, named hash_<in>to<out>: hash the BIT PATTERN of the inputs, output in [0, 1).
// Any change in the input bits changes the output completely (white noise), so for per-cell
// randomness hash floor(p). -0.0 and 0.0 hash differently; NaN/inf are not meaningful inputs.
//   hash_1to1(x: f32) -> f32         hash_1to2(x: f32) -> vec2f
//   hash_2to1(p: vec2f) -> f32       hash_2to2(p: vec2f) -> vec2f       hash_2to3(p: vec2f) -> vec3f
//   hash_3to1(p: vec3f) -> f32       hash_3to3(p: vec3f) -> vec3f
//
// Integer-lattice hashes, named ihash_<in>to<out>: hash an integer cell coordinate, output in [0, 1).
// Use these when the input is already a cell index (negative cells are fine).
//   ihash_2to1(c: vec2i) -> f32      ihash_2to2(c: vec2i) -> vec2f
//   ihash_3to1(c: vec3i) -> f32      ihash_3to3(c: vec3i) -> vec3f
//
// Gradient picking, for gradient/simplex noise: the low bits of any u32 hash select a direction.
// Computed with selects, not constant arrays, so nothing is indexed dynamically.
//   grad_2d(h: u32) -> vec2f         one of 8 unit vectors, 45 degrees apart
//   grad_3d(h: u32) -> vec3f         one of the 12 cube-edge directions (+-1, +-1, 0 and
//                                    permutations, length sqrt 2); 4 of them occur twice to fill 16 slots
//
// Cost: pcg_1d ~ 6 integer ops; pcg_2d/3d/4d ~ 15-25; float-input hashes add one pcg_1d per component.
// Everything is branch-free.

const _UNORM_SCALE: f32 = 1.0 / 16777216.0; // 2^-24

fn pcg_1d(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn pcg_2d(v_in: vec2u) -> vec2u {
  var v = v_in * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> vec2u(16u);
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> vec2u(16u);
  return v;
}

fn pcg_3d(v_in: vec3u) -> vec3u {
  var v = v_in * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

fn pcg_4d(v_in: vec4u) -> vec4u {
  var v = v_in * 1664525u + 1013904223u;
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
  v ^= v >> vec4u(16u);
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
  return v;
}

fn to_unorm_1d(h: u32) -> f32 {
  return f32(h >> 8u) * _UNORM_SCALE;
}

fn to_unorm_2d(h: vec2u) -> vec2f {
  return vec2f(h >> vec2u(8u)) * _UNORM_SCALE;
}

fn to_unorm_3d(h: vec3u) -> vec3f {
  return vec3f(h >> vec3u(8u)) * _UNORM_SCALE;
}

fn to_unorm_4d(h: vec4u) -> vec4f {
  return vec4f(h >> vec4u(8u)) * _UNORM_SCALE;
}

// Float bit patterns are low-entropy (consecutive integers differ only in a few top mantissa bits), which
// the cheap multi-component PCG mixers do not fully diffuse. Each component is run through pcg_1d first.
fn _float_bits_2d(p: vec2f) -> vec2u {
  let b = bitcast<vec2u>(p);
  return vec2u(pcg_1d(b.x), pcg_1d(b.y));
}

fn _float_bits_3d(p: vec3f) -> vec3u {
  let b = bitcast<vec3u>(p);
  return vec3u(pcg_1d(b.x), pcg_1d(b.y), pcg_1d(b.z));
}

fn hash_1to1(x: f32) -> f32 {
  return to_unorm_1d(pcg_1d(bitcast<u32>(x)));
}

fn hash_1to2(x: f32) -> vec2f {
  return to_unorm_2d(pcg_2d(vec2u(pcg_1d(bitcast<u32>(x)), 0u)));
}

fn hash_2to1(p: vec2f) -> f32 {
  return to_unorm_1d(pcg_2d(_float_bits_2d(p)).x);
}

fn hash_2to2(p: vec2f) -> vec2f {
  return to_unorm_2d(pcg_2d(_float_bits_2d(p)));
}

fn hash_2to3(p: vec2f) -> vec3f {
  return to_unorm_3d(pcg_3d(vec3u(_float_bits_2d(p), 0u)));
}

fn hash_3to1(p: vec3f) -> f32 {
  return to_unorm_1d(pcg_3d(_float_bits_3d(p)).x);
}

fn hash_3to3(p: vec3f) -> vec3f {
  return to_unorm_3d(pcg_3d(_float_bits_3d(p)));
}

fn ihash_2to1(c: vec2i) -> f32 {
  return to_unorm_1d(pcg_2d(bitcast<vec2u>(c)).x);
}

fn ihash_2to2(c: vec2i) -> vec2f {
  return to_unorm_2d(pcg_2d(bitcast<vec2u>(c)));
}

fn ihash_3to1(c: vec3i) -> f32 {
  return to_unorm_1d(pcg_3d(bitcast<vec3u>(c)).x);
}

fn ihash_3to3(c: vec3i) -> vec3f {
  return to_unorm_3d(pcg_3d(bitcast<vec3u>(c)));
}

const _SQRT_HALF: f32 = 0.70710678118654752; // sqrt(1/2)

// The directions are built with selects instead of a constant array, so nothing is indexed dynamically
// and the result does not depend on how a particular WGSL compiler treats that.
fn grad_2d(h: u32) -> vec2f {
  let m = h & 3u;
  let axis = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), m == 2u); // 0 and 90 degrees
  let diagonal = select(vec2f(_SQRT_HALF, _SQRT_HALF), vec2f(-_SQRT_HALF, _SQRT_HALF), m == 3u); // 45 and 135
  let g = select(axis, diagonal, (m & 1u) == 1u);
  return select(g, -g, (h & 4u) != 0u); // the other half of the circle
}

fn grad_3d(h: u32) -> vec3f {
  let k = h & 15u;
  let a = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), k >= 8u);
  let b = select(
    select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), k == 12u || k == 14u),
    vec3f(0.0, 1.0, 0.0),
    k < 4u,
  );
  return select(a, -a, (k & 1u) != 0u) + select(b, -b, (k & 2u) != 0u);
}
`,"./heightfield.wgsl":`// heightfield.wgsl -- read the output texture of the heightfield solver (src/gpu/sim/heightfield.ts)
// without knowing how it is laid out. Everything a shading pass needs: height, slope, normal.
//
// THE TEXTURE. \`solver.view\` is an rgba16float texture, filterable, one texel per grid cell, covering
// the whole canvas: uv (0, 0) is its top-left corner and (1, 1) the bottom-right, the same as the
// fullscreen pass's \`uv\`. Channels, per texel:
//     x  height     in CELLS (1.0 = one grid cell tall; multiply by solver.grid.cellSize for image heights)
//     y  velocity   in cells per simulation step (internal to the scheme; handy as a foam / activity hint)
//     z  slope dx   d height / d x, per cell, x to the right
//     w  slope dy   d height / d y, per cell, y DOWN (the uv direction)
// Height and the two slopes use the SAME unit (cells), so the slope is a dimensionless tangent: 0.1 is
// a 5.7 degree tilt. The slopes are a Sobel gradient of the height of the same instant, so they are
// consistent with the height channel, and they are smooth enough to shade with after bilinear
// filtering. Solid obstacle cells read as all zeros (the mask itself is solver.obstacles).
//
// FRAME. Normals live in the screen frame of refraction.wgsl: x right, y down, z toward the viewer, and
// a bump of positive height faces the viewer. Slopes are taken per CELL; because the height is also in
// cells, the slope is the same number whatever the grid resolution (a 128 grid and a 1024 grid that
// hold the same wave give the same slope).
//
// Decoding a texel \`s\` (a vec4f from the texture)
//   heightfield_height(s) -> f32            height in cells
//   heightfield_height_world(s, cell_size) -> f32   height in image heights; cell_size = solver.grid.cellSize
//   heightfield_velocity(s) -> f32          cells per step
//   heightfield_gradient(s) -> vec2f        (d height/dx, d height/dy), dimensionless
//   heightfield_slope(s, strength) -> vec2f gradient times a strength; the form refraction_normal_from_slope
//                                           takes. strength 1 is the physical surface, larger exaggerates
//   heightfield_normal(s, strength) -> vec3f unit normal of the surface z = height scaled by \`strength\`:
//                                           normalize(-strength * gradient, 1). Same convention as
//                                           refraction_normal_from_slope, so it feeds straight into
//                                           refraction_offset_cheap / _physical and spec_sun
//   heightfield_is_solid(mask_value) -> bool  true for an obstacle-mask texel (r8unorm .r) that is solid
//
// Fetching (the texture and sampler are parameters; this chunk declares no bindings)
//   heightfield_sample(tex, samp, uv) -> vec4f          one bilinear tap at uv; needs a filtering sampler
//   heightfield_sample_normal(tex, samp, uv, strength) -> vec3f   the normal at uv from that one tap
//   heightfield_load(tex, cell: vec2i) -> vec4f         the exact texel of a cell (clamped to the grid),
//                                                       for taps that must not be filtered
//
// Cost: one filtered tap plus a normalize (about 10 ALU). The normal needs no extra taps because the
// solver stores the slopes: that is the point of the layout.
//
// Why bilinear taps of the slope are fine: the slope field is as smooth as the height field, and a
// bilinear blend of two Sobel gradients is a gradient of a slightly smoother height. Bilinear taps of
// the HEIGHT channel are not a good normal source on their own (they flatten every crest).

const HEIGHTFIELD_SOLID_THRESHOLD: f32 = 0.5;

fn heightfield_height(s: vec4f) -> f32 {
  return s.x;
}

fn heightfield_height_world(s: vec4f, cell_size: f32) -> f32 {
  return s.x * cell_size;
}

fn heightfield_velocity(s: vec4f) -> f32 {
  return s.y;
}

fn heightfield_gradient(s: vec4f) -> vec2f {
  return s.zw;
}

fn heightfield_slope(s: vec4f, strength: f32) -> vec2f {
  return s.zw * strength;
}

fn heightfield_normal(s: vec4f, strength: f32) -> vec3f {
  return normalize(vec3f(-s.zw * strength, 1.0));
}

fn heightfield_is_solid(mask_value: f32) -> bool {
  return mask_value >= HEIGHTFIELD_SOLID_THRESHOLD;
}

fn heightfield_sample(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f {
  return textureSampleLevel(tex, samp, uv, 0.0);
}

fn heightfield_sample_normal(tex: texture_2d<f32>, samp: sampler, uv: vec2f, strength: f32) -> vec3f {
  return heightfield_normal(textureSampleLevel(tex, samp, uv, 0.0), strength);
}

fn heightfield_load(tex: texture_2d<f32>, cell: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(tex));
  return textureLoad(tex, clamp(cell, vec2i(0), size - vec2i(1)), 0);
}
`,"./math.wgsl":`// math.wgsl -- shared constants and small helpers.
//
// Constants
//   PI, TAU (= 2 PI), HALF_PI                       f32
// Functions
//   rotation_2d(angle) -> mat2x2f     counter-clockwise rotation; \`rotation_2d(a) * v\` rotates v
//   rotate_2d(p, angle) -> vec2f      p rotated counter-clockwise about the origin (radians)
//   remap(x, in_lo, in_hi, out_lo, out_hi) -> f32     linear map between ranges, NOT clamped
//   smootherstep(lo, hi, x) -> f32    quintic smoothstep: 0 below lo, 1 above hi, C2 at both ends
//   wrap_2d(c, period) -> vec2i       per-component floor-modulo, result in [0, period)
//   wrap_3d(c, period) -> vec3i       same for 3 components
//
// WGSL's \`%\` keeps the sign of the dividend (-1 % 4 == -1); wrap_* is the periodic-lattice
// version (-1 -> 3). \`period\` is clamped to >= 1 per axis. All of it is a few ALU ops.

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;
const HALF_PI: f32 = 1.5707963267949;

fn rotation_2d(angle: f32) -> mat2x2f {
  let c = cos(angle);
  let s = sin(angle);
  return mat2x2f(c, s, -s, c);
}

fn rotate_2d(p: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn remap(x: f32, in_lo: f32, in_hi: f32, out_lo: f32, out_hi: f32) -> f32 {
  return out_lo + (x - in_lo) * (out_hi - out_lo) / (in_hi - in_lo);
}

fn smootherstep(lo: f32, hi: f32, x: f32) -> f32 {
  let t = clamp((x - lo) / (hi - lo), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn wrap_2d(c: vec2i, period: vec2i) -> vec2i {
  let n = max(period, vec2i(1));
  let m = c % n;
  return m + select(vec2i(0), n, m < vec2i(0));
}

fn wrap_3d(c: vec3i, period: vec3i) -> vec3i {
  let n = max(period, vec3i(1));
  let m = c % n;
  return m + select(vec3i(0), n, m < vec3i(0));
}
`,"./media.wgsl":`// media.wgsl -- fitting an image or video into a canvas of a different shape.
//
// An image or video has its own aspect ratio and the canvas has another. These functions turn canvas uv
// (0..1, top-left origin, as in fullscreen.wgsl) into media uv (0..1 over the media, top-left origin)
// the way CSS \`object-fit\` does:
//   cover    the media fills the canvas and the overflowing part is cropped. Media uv never leaves [0, 1].
//   contain  the whole media is visible and the canvas shows bars at the sides or top and bottom. Media
//            uv leaves [0, 1] over the bars; media_inside() says where the media is.
// The fit is a pure scale about the centre, so it is described by one vec2f computed once per frame on
// the CPU (media.ts \`fitScale\` computes the same numbers) and a single mad per pixel.
//
//   media_fit_scale(canvas_aspect: f32, media_aspect: f32, contain: bool) -> vec2f
//       aspects are width / height. Returns s such that media_uv = (uv - 0.5) * s + 0.5. Cover has
//       s <= 1 on one axis and exactly 1 on the other (the media is cropped along its longer side);
//       contain has s >= 1 on one axis and exactly 1 on the other (bars along the shorter side). With
//       r = canvas_aspect / media_aspect: r > 1 gives cover (1, 1/r) and contain (r, 1); r < 1 gives cover
//       (r, 1) and contain (1, 1/r). Equal aspects give (1, 1) either way.
//   media_fit_uv(uv: vec2f, s: vec2f) -> vec2f
//       media_uv for a canvas uv. The centre maps to the centre.
//   media_offset_to_media(offset_uv: vec2f, s: vec2f) -> vec2f
//       a displacement in canvas uv expressed in media uv (offset * s). Distort in canvas space, then
//       apply the fit, so the distortion has the same size on screen for either fit.
//   media_inside(media_uv: vec2f, aa: f32) -> f32
//       1 where the media is, 0 over the bars, with an \`aa\` wide ramp (media uv units) centred on the
//       border. aa = 0 gives a hard edge. Use it to mask the bars of a \`contain\` fit.
//   media_lod(media_px: vec2f, s: vec2f, canvas_px: vec2f) -> f32
//       mip level that matches the screen footprint: log2 of how many media texels fall under one canvas
//       pixel (>= 0). Derivative-free, so it is legal anywhere, and it keeps a downscaled video from
//       aliasing. media_px is the media size in texels, canvas_px the canvas size in pixels.
//
// Colour: media is uploaded to an rgba8unorm-srgb texture (src/gpu/media.ts), so sampling returns LINEAR
// light and the shader writes it out through linear_to_srgb (color.wgsl) like everything else.
//
// Cost: a handful of ALU per call. Pitfall: distort in media space AFTER the fit and mirror/fade near the
// media border (refraction_safe_uv), or the water will pull in bar pixels and wrap at the media edges.

fn media_fit_scale(canvas_aspect: f32, media_aspect: f32, contain: bool) -> vec2f {
  let r = max(canvas_aspect, 1e-4) / max(media_aspect, 1e-4);
  // Canvas wider than the media (r > 1): cover crops the media's height, contain adds bars left and right.
  var cover = vec2f(1.0, 1.0 / r);
  if (r < 1.0) {
    cover = vec2f(r, 1.0);
  }
  return select(cover, cover / min(cover.x, cover.y), contain);
}

fn media_fit_uv(uv: vec2f, s: vec2f) -> vec2f {
  return (uv - vec2f(0.5)) * s + vec2f(0.5);
}

fn media_offset_to_media(offset_uv: vec2f, s: vec2f) -> vec2f {
  return offset_uv * s;
}

fn media_inside(media_uv: vec2f, aa: f32) -> f32 {
  let inner = min(min(media_uv.x, 1.0 - media_uv.x), min(media_uv.y, 1.0 - media_uv.y));
  return clamp(inner / max(aa, 1e-6) + 0.5, 0.0, 1.0);
}

fn media_lod(media_px: vec2f, s: vec2f, canvas_px: vec2f) -> f32 {
  let texels = media_px * s / max(canvas_px, vec2f(1.0));
  return log2(max(max(texels.x, texels.y), 1.0));
}
`,"./mist.wgsl":`// mist.wgsl -- drifting mist and steam: billowing density layers, a density profile that thins toward
// one edge, and an opacity curve with a hard cap, for overlays that must never hide what is under them.
//
// A mist layer is a low-frequency density field. Its look comes from two moving things: the base
// pattern slides along the drift direction, and a warp field bends it while sliding at a DIFFERENT
// speed, so the wisps billow and fold instead of translating rigidly. Render the layers at a fraction
// of the output size (they are soft by nature) and apply \`mist_opacity\` after upsampling.
//
//   mist_layer(p, base_shift, warp_shift, time, warp, coverage) -> f32
//       Density of one layer in [0, 1]. \`p\` in feature units (about one wisp per unit; stretch an axis
//       before calling to elongate the wisps). \`base_shift\` is added to p for the base pattern and
//       \`warp_shift\` for the warp field: pass drift * phase and drift * phase * 0.6, plus any scroll
//       offset in both, so a layer moves as a whole when the page scrolls. \`time\` evolves the shape
//       in place. \`warp\` in [0, 1.5] bends the pattern. \`coverage\` in [0, 1] is how much of the area is
//       mist: 0 is nearly clear, 1 is mostly filled. Five 3D gradient-noise evaluations.
//   mist_profile(s, height, falloff) -> f32
//       Vertical density profile in [0, 1]. \`s\` is the distance from the source edge as a fraction of
//       the canvas (0 at the edge, 1 at the far side). 1 up to height - falloff, 0 past
//       height + falloff, smooth between: \`height\` is where the mist ends, \`falloff\` how gradually.
//   mist_opacity(density, max_opacity) -> f32
//       Opacity of the overlay for a density sum: monotonic, smooth, 0 at density 0, and at most
//       \`max_opacity\` however large the density (density is clamped to [0, 1]; density 1 gives exactly the cap,
//       and the curve flattens toward it so the mist thins out smoothly). Use it as the
//       straight alpha of a premultiplied overlay: rgb = tint * alpha.
//
// MIST_ALPHA_LIMIT (0.8) is the highest cap the demo allows: a veil that opaque hides what it is over.
// Cost: mist_layer about 5 gnoise_3d; profile and opacity a few ALU and one exp.
// Technique: animated fbm with a counter-moving domain warp ("flow billowing", after I. Quilez's
// domain warping), the exponential opacity curve of Beer-Lambert extinction with a ceiling.

#include "noise.wgsl"
#include "fbm.wgsl"

const MIST_ALPHA_LIMIT: f32 = 0.8;

fn mist_layer(
  p: vec2f, base_shift: vec2f, warp_shift: vec2f, time: f32, warp: f32, coverage: f32,
) -> f32 {
  let w = vec2f(
    fbm_3d(vec3f(p * 0.6 + warp_shift, time * 0.5), 2, 2.0, 0.5),
    fbm_3d(vec3f(p * 0.6 + warp_shift + vec2f(31.4, 7.9), time * 0.5), 2, 2.0, 0.5),
  );
  let q = p + base_shift + warp * 0.9 * w;
  let n = fbm_3d(vec3f(q, time * 0.35), 3, 2.0, 0.5);
  // Wisps: a soft threshold of the noise, moved by \`coverage\`.
  let level = mix(0.55, -0.2, clamp(coverage, 0.0, 1.0));
  return smoothstep(level, level + 0.55, n * 1.5);
}

fn mist_profile(s: f32, height: f32, falloff: f32) -> f32 {
  let f = max(falloff, 1e-3);
  return 1.0 - smoothstep(height - f, height + f, s);
}

fn mist_opacity(density: f32, max_opacity: f32) -> f32 {
  let d = clamp(density, 0.0, 1.0);
  let cap = clamp(max_opacity, 0.0, MIST_ALPHA_LIMIT);
  return cap * (1.0 - exp(-3.0 * d)) / (1.0 - exp(-3.0));
}
`,"./motes.wgsl":`// motes.wgsl -- drifting particulates ("marine snow", dust in a sunbeam, plankton): soft dots that
// float, sway and twinkle, drawn procedurally with ONE hash per layer per pixel and no particle
// buffer. Stack two or three layers at different cell sizes and speeds for parallax.
//
// CONVENTIONS
//  * \`p\` is a screen position in aspect-corrected units (x in [0, aspect], y in [0, 1] growing down).
//  * \`cell\` is the grid cell size in the same units (0.04 to 0.2): at most one mote per cell, so it
//    sets the largest number of motes (aspect / cell * 1 / cell). \`density\` in [0, 1] is the share of
//    cells that hold one. \`radius\` is the mote radius as a share of \`cell\` (0.02 to 0.3, clamped);
//    the mote is kept inside its cell, which is why one cell lookup is enough (a mote never needs the
//    neighbours' hashes: cost is one pcg_4d per layer, not nine).
//  * \`drift\` is the layer's velocity in screen units per second (marine snow falls: positive y);
//    \`time\` in seconds. Use a larger cell, bigger radius and faster drift for the near layer.
//  * Output is a brightness factor in [0, 1]: 1 at the centre of a fully lit mote.
//
// Functions
//   motes_layer(p, time, cell, density, radius, drift, seed) -> f32
//       brightness of one layer at \`p\`. Each mote has its own size (0.6x to 1.2x radius), sway and
//       twinkle phase; \`seed\` (any float) gives a different layer. Pure function of its arguments, so
//       deterministic and loopable (everything periodic in \`time\` apart from the steady drift).
//
// Cost: pcg_4d (about 25 integer ops), one smoothstep and 2 sin/cos. About 60 ALU per layer.
// Pitfalls: the drift scrolls the whole lattice, so a layer never "ends"; \`p\` far from the origin
// loses precision after a few hundred seconds of drift (wrap \`time\` yourself in a long-running page).

#include "hash.wgsl"
#include "math.wgsl"

fn motes_layer(
  p: vec2f,
  time: f32,
  cell: f32,
  density: f32,
  radius: f32,
  drift: vec2f,
  seed: f32,
) -> f32 {
  let size = max(cell, 1e-3);
  let q = (p - drift * time) / size;
  let id = vec2i(floor(q));
  let f = fract(q);
  let h = to_unorm_4d(pcg_4d(vec4u(bitcast<vec2u>(id), u32(max(seed, 0.0) * 8.0) + 17u, 0u)));

  let r_cell = clamp(radius, 0.02, 0.3);
  let r = r_cell * (0.6 + 0.6 * h.w);
  // The mote's resting place, with room for its sway and its own radius inside the cell.
  let sway = 0.3 * r_cell;
  let margin = 1.5 * r_cell + sway;
  let rest = vec2f(margin) + (1.0 - 2.0 * margin) * h.yz;
  let phase = h.w * TAU;
  let centre = rest + sway * vec2f(sin(time * 0.7 + phase), cos(time * 0.55 + 2.0 * phase));

  let d = length(f - centre);
  let body = 1.0 - smoothstep(0.35 * r, r, d);
  let twinkle = 0.65 + 0.35 * sin(time * (0.8 + h.y) + phase * 3.0);
  let present = select(0.0, 1.0, h.x < saturate(density));
  return body * twinkle * present;
}
`,"./neighbors.wgsl":`// neighbors.wgsl -- cell arithmetic for the uniform-grid neighbour search (story 7.2). The grid itself is
// built by src/gpu/particles/neighbor-grid.ts (cell ids, counting sort, prefix sum, scatter, optional
// reorder); this chunk is what a SOLVER includes to walk a particle's neighbours without touching cell
// arithmetic. SPH, position-based fluids, collision and flocking all use the same loop.
//
// THE GRID. A bounded box, divided into cubic cells of side \`cell_size\` (>= the search \`radius\`), numbered
// x-fastest: index = (z * dims.y + y) * dims.x + x. Particles are sorted by cell, so the particles of one
// cell are contiguous, and so are the particles of three x-adjacent cells. A neighbour search therefore
// reads THREE contiguous ranges in 2D (the rows y-1, y, y+1) and NINE in 3D (rows (y+dy, z+dz)), not 27
// cells. \`cell_start\` has cells + 1 entries: cell c holds sorted slots cell_start[c] .. cell_start[c + 1].
// Positions outside the box are clamped into the edge cells, which keeps the search exact for them too.
//
// struct NeighborGrid       the uniform block (origin, cell_size, dims, rows, radius, inv_cell_size, cells,
//                           dimension). Filled by the grid on the CPU side; tests/neighbors.test.ts checks
//                           that the two layouts match.
//
// Cells
//   neighbor_cell_of(grid, p) -> vec3i            cell coordinates of world position p, clamped into the grid
//   neighbor_cell_index(grid, c) -> u32           linear cell index of coordinates c (x fastest)
//   neighbor_cell_id(grid, p) -> u32              neighbor_cell_index(grid, neighbor_cell_of(grid, p))
//   neighbor_cell_coords(grid, index) -> vec3i    the inverse of neighbor_cell_index
//
// Rows (the loop)
//   neighbor_row_offset(grid, row) -> vec2i       (dy, dz) of row 0 .. grid.rows - 1; rows is 3 in 2D, 9 in 3D
//   neighbor_row_cells(grid, c, row) -> vec2i     first and last linear cell index of that row's three cells
//                                                 (x - 1 .. x + 1, clamped), or (-1, -1) if the row is outside
//
// Distance
//   neighbor_dist2(grid, d) -> f32                squared length of d; in 2D the z component is ignored
//
// GENERATED BY THE GRID (not in this file, because a library chunk cannot declare bindings). Ask for the
// text with \`grid.bindingsWgsl({ group, binding })\`, pass it as the effect-local chunk
// 'neighbor_bindings.wgsl' to createShader, and \`#include "neighbor_bindings.wgsl"\`. It declares
//   var<uniform>        neighbor_grid: NeighborGrid;       at \`binding\`
//   var<storage, read>  neighbor_cell_start: array<u32>;   at \`binding + 1\`
//   var<storage, read>  neighbor_sorted: array<u32>;       at \`binding + 2\`, ONLY in sorted-index mode
// and two functions that hide them:
//   neighbor_row_span(c, row) -> vec2u            [begin, end) sorted slots of that row (empty if outside)
//   neighbor_particle(k) -> u32                   particle index for sorted slot k: neighbor_sorted[k] in
//                                                 sorted-index mode, k itself when the grid reorders the data
// \`grid.resources()\` returns the matching GPUBuffers in binding order, \`grid.storageBuffers\` is how many
// storage bindings the search takes (1 reorder, 2 sorted-index; the uniform is not a storage binding), so a
// solver has 8 minus that left per shader stage.
//
// SORTED-INDEX VERSUS REORDERED. Sorted-index leaves the particle arrays alone and gives a permutation:
// slot k holds particle neighbor_sorted[k], so every neighbour read of positions[j] is a gather.
// Reordered physically moves every per-particle array (ParticleSystem.permute does it for all of them
// at once) so that slot k IS particle k: neighbours are adjacent in memory and the indirection vanishes. It
// costs one gather of the particle data per build. After a reorder, particle indices change; keep an id in
// an extra attribute if you need to follow one.
//
// WORKED EXAMPLE: count the neighbours of every particle. This is the loop to copy; tests/neighbors.test.ts
// extracts it from this file, compiles it and checks it against brute force, so it cannot rot.
//
// ---- example begin ----
// #include "neighbor_bindings.wgsl"   // grid.bindingsWgsl({ group: 0, binding: 2 })
// @group(0) @binding(0) var<storage, read> positions: array<vec4f>;
// @group(0) @binding(1) var<storage, read_write> result: array<f32>;
//
// @compute @workgroup_size(64)
// fn main(@builtin(global_invocation_id) id: vec3u) {
//   let i = id.x;
//   if (i >= arrayLength(&result)) { return; }
//   let p = positions[i].xyz;
//   let c = neighbor_cell_of(neighbor_grid, p);
//   let r2 = neighbor_grid.radius * neighbor_grid.radius;
//   var n = 0u;
//   for (var row = 0u; row < neighbor_grid.rows; row++) {
//     let span = neighbor_row_span(c, row);
//     for (var k = span.x; k < span.y; k++) {
//       let j = neighbor_particle(k);
//       if (j != i && neighbor_dist2(neighbor_grid, positions[j].xyz - p) <= r2) {
//         n++;                            // accumulate density, pressure, a constraint... here
//       }
//     }
//   }
//   result[i] = f32(n);
// }
// ---- example end ----
//
// Cost: neighbor_cell_of is a subtract, multiply, floor and two clamps; neighbor_row_cells a handful of
// integer ops. The loop's cost is the memory it reads: about 27 / (4/3 pi) = 6.4 candidates for every true
// neighbour in 3D (9 / pi = 2.9 in 2D) with cell_size == radius.

struct NeighborGrid {
  origin: vec3f,
  cell_size: f32,
  dims: vec3i,
  rows: u32,
  radius: f32,
  inv_cell_size: f32,
  cells: u32,
  dimension: u32,
}

fn neighbor_cell_of(grid: NeighborGrid, p: vec3f) -> vec3i {
  let top = vec3f(grid.dims - vec3i(1));
  // Clamped as floats first so an infinite or enormous position cannot overflow the integer conversion,
  // then as integers so a NaN (which survives the float clamp as something arbitrary) still lands in range.
  let f = clamp(floor((p - grid.origin) * grid.inv_cell_size), vec3f(0.0), top);
  var c = clamp(vec3i(f), vec3i(0), grid.dims - vec3i(1));
  if (grid.dimension == 2u) {
    c.z = 0;
  }
  return c;
}

fn neighbor_cell_index(grid: NeighborGrid, c: vec3i) -> u32 {
  return u32((c.z * grid.dims.y + c.y) * grid.dims.x + c.x);
}

fn neighbor_cell_id(grid: NeighborGrid, p: vec3f) -> u32 {
  return neighbor_cell_index(grid, neighbor_cell_of(grid, p));
}

fn neighbor_cell_coords(grid: NeighborGrid, index: u32) -> vec3i {
  let nx = u32(grid.dims.x);
  let ny = u32(grid.dims.y);
  return vec3i(i32(index % nx), i32((index / nx) % ny), i32(index / (nx * ny)));
}

fn neighbor_row_offset(grid: NeighborGrid, row: u32) -> vec2i {
  if (grid.dimension == 2u) {
    return vec2i(i32(row) - 1, 0);
  }
  return vec2i(i32(row % 3u) - 1, i32(row / 3u) - 1);
}

fn neighbor_row_cells(grid: NeighborGrid, c: vec3i, row: u32) -> vec2i {
  let o = neighbor_row_offset(grid, row);
  let y = c.y + o.x;
  let z = c.z + o.y;
  if (y < 0 || y >= grid.dims.y || z < 0 || z >= grid.dims.z) {
    return vec2i(-1, -1);
  }
  let base = (z * grid.dims.y + y) * grid.dims.x;
  return vec2i(base + max(c.x - 1, 0), base + min(c.x + 1, grid.dims.x - 1));
}

fn neighbor_dist2(grid: NeighborGrid, d: vec3f) -> f32 {
  if (grid.dimension == 2u) {
    return dot(d.xy, d.xy);
  }
  return dot(d, d);
}
`,"./noise.wgsl":`// noise.wgsl -- lattice noise: value noise and gradient (Perlin-style) noise, 2D and 3D.
//
// Conventions
//  * Every function returns a SIGNED value in [-1, 1] (value noise: (-1, 1)). Map to [0, 1] with
//    0.5 + 0.5 * n. In practice gradient noise reaches about +-0.93 (2D) / +-0.89 (3D) and
//    value noise nearly the whole range.
//  * \`p\` is in lattice units: cells are 1.0 wide, so scale it for frequency (\`p = uv * 8.0\`).
//  * 3D noise doubles as animated 2D noise: pass vec3f(p, time).
//  * Quintic (C2) interpolation, so derivatives are continuous. Keep |p| below ~1e4; past that f32
//    can no longer resolve the fractional part. Integer lattice hashing => identical on all GPUs.
//  * \`_d\` functions return the value AND its analytic gradient w.r.t. p: .x = value, .yz (or .yzw)
//    = d/dx, d/dy (, d/dz). Use them for water normals, curl noise, slope-based shading.
//  * \`_tile\` functions repeat exactly every \`period\` cells per axis (period >= 1): f(p) ==
//    f(p + period). For a seamless texture of size N cells, pass uv * vec2f(period) as p. A z period
//    makes a seamless time loop; pass a large z period (e.g. 1 << 20) to leave z free.
//  * Inside one period a tile function equals its plain twin, except for the cells touching the seam.
//
// Value noise (smooth random lattice values; cheap, blobby, visible grid at low octaves)
//   vnoise_2d(p: vec2f) -> f32                         4 hashes
//   vnoise_3d(p: vec3f) -> f32                         8 hashes
//   vnoise_2d_d(p: vec2f) -> vec3f                     (value, d/dx, d/dy)
//   vnoise_2d_tile(p: vec2f, period: vec2i) -> f32
//
// Gradient noise (random lattice gradients; zero at lattice points, better looking than value noise)
//   gnoise_2d(p: vec2f) -> f32                         4 hashes, range [-1, 1], zero on integer points
//   gnoise_3d(p: vec3f) -> f32                         8 hashes
//   gnoise_2d_d(p: vec2f) -> vec3f                     (value, d/dx, d/dy)
//   gnoise_3d_d(p: vec3f) -> vec4f                     (value, d/dx, d/dy, d/dz)
//   gnoise_2d_tile(p: vec2f, period: vec2i) -> f32
//   gnoise_3d_tile(p: vec3f, period: vec3i) -> f32
//
// Technique: Perlin's improved noise (quintic fade, gradients from a hash); derivative formulas by
// differentiating the (tri)linear blend of corner contributions, as popularised by Inigo Quilez.

#include "hash.wgsl"
#include "math.wgsl"

// Scales that bring the raw gradient-noise sums to a worst-case magnitude of just under 1.
// 2D: unit gradients peak at sqrt(1/2). 3D: edge gradients (length sqrt 2) peak at ~1.036.
const _GNOISE_2D_SCALE: f32 = 1.4142;
const _GNOISE_3D_SCALE: f32 = 0.964;

fn _fade_2(t: vec2f) -> vec2f {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn _fade_3(t: vec3f) -> vec3f {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Derivative of the quintic fade: 30 t^2 (1 - t)^2.
fn _fade_d_2(t: vec2f) -> vec2f {
  let a = t * (1.0 - t);
  return 30.0 * a * a;
}

fn _fade_d_3(t: vec3f) -> vec3f {
  let a = t * (1.0 - t);
  return 30.0 * a * a;
}

fn _cell_2d(x: i32, y: i32) -> u32 {
  return pcg_2d(bitcast<vec2u>(vec2i(x, y))).x;
}

fn _cell_3d(x: i32, y: i32, z: i32) -> u32 {
  return pcg_3d(bitcast<vec3u>(vec3i(x, y, z))).x;
}

// Cell hashes of the corners (x0,y0) (x1,y0) (x0,y1) (x1,y1) of one square, in that order.
fn _quad_2d(x0: i32, x1: i32, y0: i32, y1: i32) -> vec4u {
  return vec4u(_cell_2d(x0, y0), _cell_2d(x1, y0), _cell_2d(x0, y1), _cell_2d(x1, y1));
}

fn _quad_3d(x0: i32, x1: i32, y0: i32, y1: i32, z: i32) -> vec4u {
  return vec4u(_cell_3d(x0, y0, z), _cell_3d(x1, y0, z), _cell_3d(x0, y1, z), _cell_3d(x1, y1, z));
}

fn _quad_2d_tile(c: vec2i, period: vec2i) -> vec4u {
  let a = wrap_2d(c, period);
  let b = wrap_2d(c + vec2i(1), period);
  return _quad_2d(a.x, b.x, a.y, b.y);
}

fn _vnoise_2d_core(u: vec2f, h: vec4u) -> f32 {
  let v = to_unorm_4d(h);
  return 2.0 * mix(mix(v.x, v.y, u.x), mix(v.z, v.w, u.x), u.y) - 1.0;
}

fn _vnoise_3d_core(u: vec3f, lo: vec4u, hi: vec4u) -> f32 {
  let a = to_unorm_4d(lo);
  let b = to_unorm_4d(hi);
  let z0 = mix(mix(a.x, a.y, u.x), mix(a.z, a.w, u.x), u.y);
  let z1 = mix(mix(b.x, b.y, u.x), mix(b.z, b.w, u.x), u.y);
  return 2.0 * mix(z0, z1, u.z) - 1.0;
}

// f: position inside the cell, u: faded f, h: corner hashes.
fn _gnoise_2d_core(f: vec2f, u: vec2f, h: vec4u) -> f32 {
  let va = dot(grad_2d(h.x), f);
  let vb = dot(grad_2d(h.y), f - vec2f(1.0, 0.0));
  let vc = dot(grad_2d(h.z), f - vec2f(0.0, 1.0));
  let vd = dot(grad_2d(h.w), f - vec2f(1.0, 1.0));
  return _GNOISE_2D_SCALE * mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}

fn _gnoise_2d_core_d(f: vec2f, u: vec2f, du: vec2f, h: vec4u) -> vec3f {
  let ga = grad_2d(h.x);
  let gb = grad_2d(h.y);
  let gc = grad_2d(h.z);
  let gd = grad_2d(h.w);
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  let k = va - vb - vc + vd;
  let value = va + (vb - va) * u.x + (vc - va) * u.y + k * u.x * u.y;
  // Gradient = blend of the corner gradients + the change of the blend weights.
  let g = mix(mix(ga, gb, u.x), mix(gc, gd, u.x), u.y);
  let d = g + du * vec2f((vb - va) + k * u.y, (vc - va) + k * u.x);
  return _GNOISE_2D_SCALE * vec3f(value, d);
}

fn _gnoise_3d_core(f: vec3f, u: vec3f, lo: vec4u, hi: vec4u) -> f32 {
  let va = dot(grad_3d(lo.x), f);
  let vb = dot(grad_3d(lo.y), f - vec3f(1.0, 0.0, 0.0));
  let vc = dot(grad_3d(lo.z), f - vec3f(0.0, 1.0, 0.0));
  let vd = dot(grad_3d(lo.w), f - vec3f(1.0, 1.0, 0.0));
  let ve = dot(grad_3d(hi.x), f - vec3f(0.0, 0.0, 1.0));
  let vf = dot(grad_3d(hi.y), f - vec3f(1.0, 0.0, 1.0));
  let vg = dot(grad_3d(hi.z), f - vec3f(0.0, 1.0, 1.0));
  let vh = dot(grad_3d(hi.w), f - vec3f(1.0, 1.0, 1.0));
  let z0 = mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
  let z1 = mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y);
  return _GNOISE_3D_SCALE * mix(z0, z1, u.z);
}

fn _gnoise_3d_core_d(f: vec3f, u: vec3f, du: vec3f, lo: vec4u, hi: vec4u) -> vec4f {
  let ga = grad_3d(lo.x);
  let gb = grad_3d(lo.y);
  let gc = grad_3d(lo.z);
  let gd = grad_3d(lo.w);
  let ge = grad_3d(hi.x);
  let gf = grad_3d(hi.y);
  let gg = grad_3d(hi.z);
  let gh = grad_3d(hi.w);
  let va = dot(ga, f);
  let vb = dot(gb, f - vec3f(1.0, 0.0, 0.0));
  let vc = dot(gc, f - vec3f(0.0, 1.0, 0.0));
  let vd = dot(gd, f - vec3f(1.0, 1.0, 0.0));
  let ve = dot(ge, f - vec3f(0.0, 0.0, 1.0));
  let vf = dot(gf, f - vec3f(1.0, 0.0, 1.0));
  let vg = dot(gg, f - vec3f(0.0, 1.0, 1.0));
  let vh = dot(gh, f - vec3f(1.0, 1.0, 1.0));
  // Trilinear blend written as a polynomial in u.
  let k1 = vb - va;
  let k2 = vc - va;
  let k3 = ve - va;
  let k4 = va - vb - vc + vd;
  let k5 = va - vc - ve + vg;
  let k6 = va - vb - ve + vf;
  let k7 = -va + vb + vc - vd + ve - vf - vg + vh;
  let value =
    va + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x +
    k7 * u.x * u.y * u.z;
  let g = mix(
    mix(mix(ga, gb, u.x), mix(gc, gd, u.x), u.y),
    mix(mix(ge, gf, u.x), mix(gg, gh, u.x), u.y),
    u.z,
  );
  let d =
    g +
    du *
      vec3f(
        k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
        k2 + k4 * u.x + k5 * u.z + k7 * u.x * u.z,
        k3 + k5 * u.y + k6 * u.x + k7 * u.x * u.y,
      );
  return _GNOISE_3D_SCALE * vec4f(value, d);
}

fn vnoise_2d(p: vec2f) -> f32 {
  let ip = floor(p);
  let c = vec2i(ip);
  return _vnoise_2d_core(_fade_2(p - ip), _quad_2d(c.x, c.x + 1, c.y, c.y + 1));
}

fn vnoise_3d(p: vec3f) -> f32 {
  let ip = floor(p);
  let c = vec3i(ip);
  return _vnoise_3d_core(
    _fade_3(p - ip),
    _quad_3d(c.x, c.x + 1, c.y, c.y + 1, c.z),
    _quad_3d(c.x, c.x + 1, c.y, c.y + 1, c.z + 1),
  );
}

fn vnoise_2d_d(p: vec2f) -> vec3f {
  let ip = floor(p);
  let f = p - ip;
  let c = vec2i(ip);
  let u = _fade_2(f);
  let du = _fade_d_2(f);
  let v = to_unorm_4d(_quad_2d(c.x, c.x + 1, c.y, c.y + 1));
  let k = v.x - v.y - v.z + v.w;
  let value = v.x + (v.y - v.x) * u.x + (v.z - v.x) * u.y + k * u.x * u.y;
  let dx = du.x * ((v.y - v.x) + k * u.y);
  let dy = du.y * ((v.z - v.x) + k * u.x);
  return vec3f(2.0 * value - 1.0, 2.0 * dx, 2.0 * dy);
}

fn vnoise_2d_tile(p: vec2f, period: vec2i) -> f32 {
  let ip = floor(p);
  return _vnoise_2d_core(_fade_2(p - ip), _quad_2d_tile(vec2i(ip), period));
}

fn gnoise_2d(p: vec2f) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let c = vec2i(ip);
  return _gnoise_2d_core(f, _fade_2(f), _quad_2d(c.x, c.x + 1, c.y, c.y + 1));
}

fn gnoise_3d(p: vec3f) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let c = vec3i(ip);
  return _gnoise_3d_core(
    f,
    _fade_3(f),
    _quad_3d(c.x, c.x + 1, c.y, c.y + 1, c.z),
    _quad_3d(c.x, c.x + 1, c.y, c.y + 1, c.z + 1),
  );
}

fn gnoise_2d_d(p: vec2f) -> vec3f {
  let ip = floor(p);
  let f = p - ip;
  let c = vec2i(ip);
  return _gnoise_2d_core_d(f, _fade_2(f), _fade_d_2(f), _quad_2d(c.x, c.x + 1, c.y, c.y + 1));
}

fn gnoise_3d_d(p: vec3f) -> vec4f {
  let ip = floor(p);
  let f = p - ip;
  let c = vec3i(ip);
  return _gnoise_3d_core_d(
    f,
    _fade_3(f),
    _fade_d_3(f),
    _quad_3d(c.x, c.x + 1, c.y, c.y + 1, c.z),
    _quad_3d(c.x, c.x + 1, c.y, c.y + 1, c.z + 1),
  );
}

fn gnoise_2d_tile(p: vec2f, period: vec2i) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  return _gnoise_2d_core(f, _fade_2(f), _quad_2d_tile(vec2i(ip), period));
}

fn gnoise_3d_tile(p: vec3f, period: vec3i) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let a = wrap_3d(vec3i(ip), period);
  let b = wrap_3d(vec3i(ip) + vec3i(1), period);
  return _gnoise_3d_core(
    f,
    _fade_3(f),
    _quad_3d(a.x, b.x, a.y, b.y, a.z),
    _quad_3d(a.x, b.x, a.y, b.y, b.z),
  );
}
`,"./normals.wgsl":`// normals.wgsl -- tangent-space normals: decoding, strength, layer blending, height gradients,
// and the step into world space for a horizontal water surface.
//
// Conventions
//  * A tangent-space normal is a unit vec3f with +z pointing OUT of the surface, so a flat surface is
//    (0, 0, 1). Its xy are the negated height slopes: n.xy = -(dh/dx, dh/dy) / sqrt(1 + |grad h|^2).
//    "x" and "y" are the texture's u and v axes (v grows downwards on screen, like uv everywhere here).
//  * Maps are stored as xy only, z rebuilt from sqrt(1 - |xy|^2). That is cheaper (2 channels), and
//    it makes mip chains behave: averaging xy averages the SLOPES, so a minified normal map flattens
//    with distance (shorter xy, z -> 1) instead of turning to noise. Water-ripple maps from
//    createWaterNormalMap (src/gpu/bake.ts) are signed xy in rg of an rg16float/rgba16float texture.
//
// Decode / encode
//   normal_from_xy(xy: vec2f) -> vec3f          z = sqrt(1 - |xy|^2); |xy| > 1 (filtering overshoot or
//                                               bad data) is scaled back to length 1 (z = 0)
//   normal_decode_signed(texel: vec4f) -> vec3f   texel.rg are the signed xy (float-format maps)
//   normal_decode_unorm(texel: vec4f) -> vec3f    texel.rg are xy * 0.5 + 0.5 (8-bit maps; blue is
//                                               ignored, so BC5/RG8 two-channel maps work)
//   normal_encode_unorm(n: vec3f) -> vec3f        n * 0.5 + 0.5, for writing maps and debug colours
//
// Strength
//   normal_scale(n, strength) -> vec3f          multiplies the SLOPE (xy / z) by \`strength\` and
//                                               renormalises: 0 gives (0, 0, 1), 1 returns n, 2 doubles
//                                               the slope. Scaling xy alone, or lerping toward
//                                               (0, 0, 1) and renormalising, are both common and
//                                               both wrong: the former overshoots |xy| > 1 at high
//                                               strength, the latter is not linear in slope.
//
// Blending two layers. \`a\` is the BASE (large waves), \`b\` the DETAIL (ripples), both unit tangent-space
// normals; the result is unit length. Apply normal_scale to each layer BEFORE blending to weight them.
//   normal_blend_linear(a, b)    normalize(a + b). The naive baseline (what averaging two normal-map
//                                RGB values does). Its z is the SUM of both z's, so every slope is halved
//                                relative to the sum: flat + detail gives half the detail, base + flat
//                                gives half the base. Detail washes out. Do not ship.
//   normal_blend_udn(a, b)       normalize(a.xy + b.xy, a.z). Unreal Developer Network blend: slopes add
//                                exactly, detail is not rotated by the base, and flat detail returns the
//                                base. Detail is slightly too steep where the base is steep. Cheapest.
//   normal_blend_whiteout(a, b)  normalize(a.xy + b.xy, a.z * b.z). Like UDN but z multiplies, which
//                                keeps the detail from turning too steep on steep bases. Flat on either
//                                side returns the other. The default choice for water.
//   normal_blend_pd(a, b)        partial-derivative blend: normalize(a.xy * b.z + b.xy * a.z, a.z * b.z).
//                                Adds the height gradients (slope = xy / z), the mathematically right sum
//                                of two heightfields. For small slopes identical to whiteout.
//   normal_blend_rnm(a, b)       reoriented normal mapping (Barre-Brisebois and Hill): rotates the
//                                detail into the base's frame, so the detail follows the base's tilt.
//                                Flat detail returns the base and flat base returns the detail, exactly.
//                                Use when the base is steep (chop, large waves) and the detail should
//                                lean with it.
//   Which to use: whiteout for almost everything; RNM for strong base waves; PD when you want the true
//   heightfield sum; UDN when the extra ALU does not matter and you want the slopes to add plainly;
//   linear only to show what goes wrong. Cost: all five are 10-20 ALU ops with one normalize (RNM the
//   most, one dot and one divide). They are cheap enough that a texture fetch costs more, so choose
//   on correctness, not speed. For small slopes the four good ones agree: within about 2% for |xy| < 0.2, 0.5% below 0.05.
//
// Height gradients
//   normal_from_gradient(grad: vec2f, strength: f32) -> vec3f
//       normal of the surface h(x, y) whose gradient is \`grad\` (dh/dx, dh/dy), scaled:
//       normalize(-grad * strength, 1). Feed it fbm_2d_d(...).yz or a height texture's finite
//       differences. The slope is NOT bounded: pick the height units so typical |grad| is below ~1.
//
// World space (horizontal water, up = +y, the usual y-up convention)
//   normal_to_world_up(n: vec3f) -> vec3f
//       tangent (x, y, z) -> world (x, z, y): u runs along world +x, v along world +z, the normal along
//       world +y. This is the exact mapping for the surface y = h(x, z), which is a mirror image of a
//       rotation, so it is NOT the cross-product frame (that would flip the tilt direction).
//   normal_to_world(n: vec3f, tangent: vec3f, bitangent: vec3f, normal: vec3f) -> vec3f
//       general frame: n.x * tangent + n.y * bitangent + n.z * normal, normalised. Use it for a
//       sloped surface or a mesh with real tangents.
//   normal_yaw(n: vec3f, angle: f32) -> vec3f
//       rotates the tangent frame about the surface normal by \`angle\` radians. Needed whenever a
//       layer's uv is rotated: the uv rotation turns the pattern, so the normals stored in it must
//       be turned too, or the lighting of the rotated layer is wrong.
//
// Technique: the blends are those compared in Colin Barre-Brisebois and Stephen Hill, "Blending in
// Detail" (2012): UDN, whiteout, partial derivatives and reoriented normal mapping. Code written
// from the published formulas.

fn normal_from_xy(xy: vec2f) -> vec3f {
  let l2 = dot(xy, xy);
  // Past the unit disc there is no real z: pull xy back onto the circle rather than return NaN.
  let k = select(1.0, inverseSqrt(l2), l2 > 1.0);
  let v = xy * k;
  return vec3f(v, sqrt(max(1.0 - dot(v, v), 0.0)));
}

fn normal_decode_signed(texel: vec4f) -> vec3f {
  return normal_from_xy(texel.rg);
}

fn normal_decode_unorm(texel: vec4f) -> vec3f {
  return normal_from_xy(texel.rg * 2.0 - 1.0);
}

fn normal_encode_unorm(n: vec3f) -> vec3f {
  return n * 0.5 + 0.5;
}

fn normal_scale(n: vec3f, strength: f32) -> vec3f {
  // Slope is xy / z, so scaling the slope by s is (s * xy, z) up to length.
  return normalize(vec3f(n.xy * max(strength, 0.0), max(n.z, 1e-4)));
}

fn normal_blend_linear(a: vec3f, b: vec3f) -> vec3f {
  return normalize(a + b);
}

fn normal_blend_udn(a: vec3f, b: vec3f) -> vec3f {
  return normalize(vec3f(a.xy + b.xy, a.z));
}

fn normal_blend_whiteout(a: vec3f, b: vec3f) -> vec3f {
  return normalize(vec3f(a.xy + b.xy, a.z * b.z));
}

fn normal_blend_pd(a: vec3f, b: vec3f) -> vec3f {
  return normalize(vec3f(a.xy * b.z + b.xy * a.z, a.z * b.z));
}

fn normal_blend_rnm(a: vec3f, b: vec3f) -> vec3f {
  let t = vec3f(a.x, a.y, a.z + 1.0);
  let u = vec3f(-b.x, -b.y, b.z);
  // t.z = a.z + 1 >= 1 for any upward-facing base; guard the divide for a degenerate one.
  return normalize(t * (dot(t, u) / max(t.z, 1e-4)) - u);
}

fn normal_from_gradient(grad: vec2f, strength: f32) -> vec3f {
  return normalize(vec3f(-grad * strength, 1.0));
}

fn normal_to_world_up(n: vec3f) -> vec3f {
  return vec3f(n.x, n.z, n.y);
}

fn normal_to_world(n: vec3f, tangent: vec3f, bitangent: vec3f, normal: vec3f) -> vec3f {
  return normalize(n.x * tangent + n.y * bitangent + n.z * normal);
}

fn normal_yaw(n: vec3f, angle: f32) -> vec3f {
  let s = sin(angle);
  let c = cos(angle);
  return vec3f(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
}
`,"./ocean-waves.wgsl":`// ocean-waves.wgsl — analytic six-wave Gerstner surface, y up, meters / seconds.
// ocean_wave(q,time,strength,chop) -> OceanWave (position, tangents, normal, Jacobian).
// ocean_world_wave(xz,...) inverts horizontal displacement for buoyancy (bounded Newton steps).
// Wave constants and phase offsets mirror src/gpu/ocean/waves.ts. No bindings or entrypoints.
struct OceanWave {
  position: vec3f, dx: vec3f, dz: vec3f, normal: vec3f, jacobian: f32
}
fn ocean_wave(q: vec2f, time: f32, strength: f32, chop: f32) -> OceanWave {
  let waves = array<vec4f, 6>(vec4f(.94,.342,.52,.24),vec4f(.77,-.638,.28,.43),vec4f(-.24,.971,.15,.78),vec4f(.61,.792,.085,1.31),vec4f(-.88,.475,.042,2.37),vec4f(.36,-.933,.024,4.17));
  var p = vec3f(q.x, 0, q.y);
  var dx = vec3f(1,0,0);
  var dz = vec3f(0,0,1);
  for(var i=0u; i<6u; i++) {
    let w=waves[i];
    let d=normalize(w.xy);
    let a=w.z*strength;
    let k=w.w;
    let phase=k*dot(d,q)-sqrt(9.81*k)*time+f32(i*4u)*.31;
    let s=sin(phase);
    let c=cos(phase);
    p+=vec3f(chop*a*d.x*c,a*s,chop*a*d.y*c);
    dx+=vec3f(-chop*a*k*d.x*d.x*s,a*k*d.x*c,-chop*a*k*d.x*d.y*s);
    dz+=vec3f(-chop*a*k*d.x*d.y*s,a*k*d.y*c,-chop*a*k*d.y*d.y*s);
  }
  return OceanWave(p,dx,dz,normalize(cross(dz,dx)),dx.x*dz.z-dx.z*dz.x);
}
fn ocean_world_wave(xz:vec2f,time:f32,strength:f32,chop:f32)->OceanWave {
  var q=xz;
  for(var i=0u;i<8u;i++) {
    let w=ocean_wave(q,time,strength,chop);
    let e=w.position.xz-xz;
    if(abs(w.jacobian)<.1) {
      break;
    }
    q-=clamp(vec2f(w.dz.z*e.x-w.dz.x*e.y,-w.dx.z*e.x+w.dx.x*e.y)/w.jacobian,vec2f(-1),vec2f(1));
  }
  return ocean_wave(q,time,strength,chop);
}
`,"./particles.wgsl":`// particles.wgsl -- helpers shared by particle renderers and particle emitters (story 7.1): billboard
// geometry, sprite edges, a palette for the per-particle scalar, and random emission. The framework in
// src/gpu/particles/ uses all of it; a custom particle shader can pick what it needs.
//
// Constants
//   PARTICLE_SHAPE_POINT, PARTICLE_SHAPE_BOX, PARTICLE_SHAPE_SPHERE, PARTICLE_SHAPE_DISC   u32 emitter shapes
//
// Billboards (camera-facing quads, drawn as a 4-vertex triangle strip)
//   particle_corner(vertex_index) -> vec2f                 strip corner in (-1, 1)^2: (-1,-1) (1,-1) (-1,1) (1,1)
//   particle_size(radius, clip_w, proj_scale, viewport_h, min_pixels) -> vec2f
//                                                          x: the radius to draw, in world units, never smaller
//                                                          than min_pixels on screen; y: an alpha factor in
//                                                          (0, 1] that conserves energy for an enlarged sprite
//                                                          (so subpixel particles do not flare). proj_scale is
//                                                          proj[1][1]; clip_w is the centre's clip w (1 for an
//                                                          orthographic camera). Works for both projections.
//   particle_disc_alpha(d, softness, aa) -> f32            coverage of a round sprite at distance d from its
//                                                          centre (d = 1 is the rim): 1 inside, 0 outside, an
//                                                          edge \`aa\` wide (one pixel in sprite units) centred
//                                                          on the rim for softness 0, a full smooth falloff for
//                                                          softness 1. Draw the quad (1 + aa) times the radius.
//   particle_sphere_z(d2) -> f32                           height of a sphere impostor above its disc, in radii,
//                                                          at squared distance d2 (0 at the rim, 1 at the centre)
//
// Colour
//   particle_palette(stops, count, t) -> vec3f             piecewise-linear colour through \`count\` (2..8) stops
//                                                          (rgb in xyz), t clamped to 0..1
//
// Random emission (a pcg hash, no state: the same index and salt give the same numbers on every device)
//   particle_random_3d(index, salt) -> vec3f               three independent uniform numbers in [0, 1)
//   particle_emit_position(shape, center, extent, r, dimension) -> vec3f
//                                                          a point in the emitter shape from r in [0, 1)^3:
//                                                          POINT the centre; BOX center + (2r - 1) * extent
//                                                          (extent is the half-size); SPHERE uniformly in the
//                                                          ball of radius extent.x; DISC uniformly in the
//                                                          horizontal (xz) disc of radius extent.x. In 2D (dimension
//                                                          2u) z is 0, SPHERE is a disc in xy and DISC a segment
//                                                          along x.
//   particle_emit_velocity(direction, speed, spread, jitter, r, dimension) -> vec3f
//                                                          direction (unit) * speed, bent by a random angle up to
//                                                          \`spread\` radians (a cone in 3D, a fan in 2D), with the
//                                                          speed varied by up to +-jitter (a fraction, 0..1)
//
// Cost: every function is a few ALU ops; particle_random_3d is one pcg_3d (about 20 integer ops).

#include "hash.wgsl"
#include "math.wgsl"

const PARTICLE_SHAPE_POINT: u32 = 0u;
const PARTICLE_SHAPE_BOX: u32 = 1u;
const PARTICLE_SHAPE_SPHERE: u32 = 2u;
const PARTICLE_SHAPE_DISC: u32 = 3u;

fn particle_corner(vertex_index: u32) -> vec2f {
  return vec2f(f32(vertex_index & 1u) * 2.0 - 1.0, f32((vertex_index >> 1u) & 1u) * 2.0 - 1.0);
}

fn particle_size(
  radius: f32,
  clip_w: f32,
  proj_scale: f32,
  viewport_h: f32,
  min_pixels: f32,
) -> vec2f {
  let pixels = radius * proj_scale / max(clip_w, 1e-6) * 0.5 * viewport_h;
  if (pixels >= min_pixels || pixels <= 0.0) {
    return vec2f(radius, 1.0);
  }
  let grow = min_pixels / pixels;
  return vec2f(radius * grow, 1.0 / (grow * grow));
}

fn particle_disc_alpha(d: f32, softness: f32, aa: f32) -> f32 {
  // The edge ramp is centred on the rim (d = 1) when hard, so a disc keeps its true area; the quad is drawn one
  // pixel larger than the rim to leave room for the outer half.
  let top = 1.0 + 0.5 * aa;
  let edge = clamp(mix(aa, top, softness), 1e-4, top);
  let t = clamp((top - d) / edge, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn particle_sphere_z(d2: f32) -> f32 {
  return sqrt(max(1.0 - d2, 0.0));
}

fn particle_palette(stops: array<vec4f, 8>, count: u32, t: f32) -> vec3f {
  let last = max(count, 2u) - 1u;
  let x = clamp(t, 0.0, 1.0) * f32(last);
  let i = min(u32(floor(x)), last - 1u);
  return mix(stops[i].xyz, stops[i + 1u].xyz, x - f32(i));
}

fn particle_random_3d(index: u32, salt: u32) -> vec3f {
  return to_unorm_3d(pcg_3d(vec3u(index, salt, 0x9e3779b9u)));
}

fn particle_emit_position(
  shape: u32,
  center: vec3f,
  extent: vec3f,
  r: vec3f,
  dimension: u32,
) -> vec3f {
  var offset = vec3f(0.0);
  if (shape == PARTICLE_SHAPE_BOX) {
    offset = (r * 2.0 - 1.0) * extent;
  } else if (shape == PARTICLE_SHAPE_SPHERE) {
    if (dimension == 2u) {
      let a = r.x * TAU;
      offset = vec3f(cos(a), sin(a), 0.0) * sqrt(r.y) * extent.x;
    } else {
      // Uniform in the ball: a direction from two numbers, a radius from the cube root of the third.
      let z = r.x * 2.0 - 1.0;
      let a = r.y * TAU;
      let s = sqrt(max(1.0 - z * z, 0.0));
      offset = vec3f(s * cos(a), z, s * sin(a)) * pow(r.z, 1.0 / 3.0) * extent.x;
    }
  } else if (shape == PARTICLE_SHAPE_DISC) {
    if (dimension == 2u) {
      offset = vec3f((r.x * 2.0 - 1.0) * extent.x, 0.0, 0.0);
    } else {
      let a = r.x * TAU;
      offset = vec3f(cos(a), 0.0, sin(a)) * sqrt(r.y) * extent.x;
    }
  }
  var p = center + offset;
  if (dimension == 2u) {
    p.z = 0.0;
  }
  return p;
}

fn particle_emit_velocity(
  direction: vec3f,
  speed: f32,
  spread: f32,
  jitter: f32,
  r: vec3f,
  dimension: u32,
) -> vec3f {
  let s = speed * (1.0 + (r.z * 2.0 - 1.0) * jitter);
  if (dimension == 2u) {
    let angle = (r.x * 2.0 - 1.0) * spread;
    return vec3f(rotate_2d(direction.xy, angle), 0.0) * s;
  }
  // Uniform in the cone around \`direction\`: cos(theta) between cos(spread) and 1.
  let cos_theta = mix(1.0, cos(spread), r.x);
  let sin_theta = sqrt(max(1.0 - cos_theta * cos_theta, 0.0));
  let phi = r.y * TAU;
  let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(direction.y) > 0.99);
  let t1 = normalize(cross(direction, up));
  let t2 = cross(direction, t1);
  return (direction * cos_theta + (t1 * cos(phi) + t2 * sin(phi)) * sin_theta) * s;
}
`,"./refraction.wgsl":`// refraction.wgsl -- screen-space refraction: turn a surface normal into a uv offset, sample a
// backdrop TEXTURE through it, with chromatic dispersion and safe edge handling.
//
// The production pattern: the scene behind the water is a texture (an image, a video frame, a captured
// page, a previous pass). The water pass finds where each pixel's ray ends up and samples the texture
// THERE instead of at the pixel itself. Nothing is ray-traced; the offset is a closed-form function of
// the normal, the index of refraction and how much water the ray crosses.
//
// FRAME (read this once). Normals, slopes and offsets live in the SCREEN frame: x to the right, y DOWN
// (the uv direction), z toward the viewer. Heights and slopes are taken with respect to a uv-aligned
// coordinate whose unit is the image HEIGHT (p = vec2f(uv.x * aspect, uv.y)). \`thickness\` is measured
// in the same unit: 0.1 means the backdrop is a tenth of the image height behind the surface. A flat
// surface has normal (0, 0, 1). Offsets named *_uv are in uv (x already divided by aspect).
//
// Normals
//   refraction_normal_from_slope(slope: vec2f) -> vec3f   unit normal of a height field with gradient
//                                    \`slope\` (dh/dx, dh/dy); use the _d noise functions for the slope
// Offsets, in world (image-height) units. Both are exactly 0 for a flat surface seen head-on.
//   refraction_offset_cheap(n, ior, thickness) -> vec2f
//                                    small-angle form: -(n.xy / n.z) * thickness * (1 - 1/ior). What most
//                                    sites ship. Within ~5% of the physical form up to ~30 degrees tilt.
//   refraction_offset_physical(n, view, ior, thickness) -> vec2f
//                                    Snell's law: bends \`view\` (unit-ish vector from the eye INTO the
//                                    scene, view.z < 0; (0, 0, -1) is looking straight down) with the
//                                    built-in refract() at eta = 1/ior, travels \`thickness\` down, and
//                                    returns the lateral shift relative to the unrefracted straight
//                                    continuation. Handles tilted views. ior is clamped to >= 1 (so no
//                                    total internal reflection); grazing rays are clamped at cos 0.05.
//   refraction_to_uv(offset: vec2f, aspect: f32) -> vec2f    world offset -> uv offset (x / aspect)
// Dispersion. Normal dispersion: blue light has the higher IOR, so red bends least.
//   refraction_dispersion_iors(ior, dispersion) -> vec3f     (ior - d, ior, ior + d) for (r, g, b), >= 1.
//                                    Real water: d ~ 0.003. Crown glass ~ 0.006. Designers use 0.01-0.05.
//   refraction_dispersion_scales(ior, dispersion) -> vec3f   (1 - 1/ior_c) / (1 - 1/ior): the factor by
//                                    which the green offset must be scaled for each channel. Exact for
//                                    the cheap form, accurate to a few percent for the physical one.
//   struct RefractionRGB { r: vec2f, g: vec2f, b: vec2f }    one uv offset per channel
//   refraction_rgb_offsets(offset_g_uv: vec2f, scales: vec3f) -> RefractionRGB
// Edge handling. Samples may land outside the texture; clamping smears the border pixel across the
// frame and wrapping shows the opposite edge. These keep every uv inside [0, 1] with neither.
//   refraction_mirror_uv(uv: vec2f) -> vec2f                 triangle-wave fold into [0, 1]: never wraps
//   refraction_fade_offset(uv, offset_uv, fade) -> vec2f     shrinks the part of the offset that points
//                                    at a border to 0 over \`fade\` (uv units, ~0.03-0.08) before reaching it
//   refraction_safe_uv(uv, offset_uv, fade) -> vec2f         mirror(uv + fade_offset(..)); always in [0, 1]
// Roughness / depth blur hook (needs a backdrop with a mip chain and a filtering sampler)
//   refraction_blur_lod(radius_px: f32, max_lod: f32) -> f32 mip level that blurs by about \`radius_px\`
//                                    texels; use radius_px = k * thickness for murky or deep water
// Sampling. \`tex\` / \`samp\` are function parameters (this chunk declares no bindings). Colours are
// whatever the texture holds; sample an \`-srgb\` format to get linear light. Uses textureSampleLevel, so
// it is legal in non-uniform control flow.
//   refraction_sample(tex, samp, uv, offset_uv, lod, fade) -> vec3f                  1 tap, no dispersion
//   refraction_sample_rgb(tex, samp, uv, offsets: RefractionRGB, lod, fade) -> vec3f 3 taps: r from the
//                                    red offset, g from green, b from blue
//   refraction_sample_spectral(tex, samp, uv, offset_g_uv, ior, dispersion, lod, fade, taps: i32) -> vec3f
//                                    \`taps\` (clamped 2..16) offsets spread over the spectrum, weighted by
//                                    overlapping red / green / blue responses and normalised, so flat colour
//                                    stays exact and edges blur into a smooth rainbow instead of three ghosts
//
// Cost (per pixel): offset_cheap ~8 ALU; offset_physical ~35 ALU (one refract); safe_uv ~15 ALU; every
// tap is one textureSampleLevel (bilinear; trilinear when lod has a fraction, so ~2x the bandwidth)
// plus safe_uv. refraction_sample_rgb = 3 taps; refraction_sample_spectral = \`taps\` taps and ~25 ALU each.
// Pitfalls: never feed uv + offset to a clamp-to-edge sampler directly (border smear); a backdrop that is
// itself the canvas needs a copy first (a texture cannot be read and written in the same pass).

const REFRACTION_MIN_COS: f32 = 0.05;

struct RefractionRGB {
  r: vec2f,
  g: vec2f,
  b: vec2f,
}

fn refraction_normal_from_slope(slope: vec2f) -> vec3f {
  return normalize(vec3f(-slope, 1.0));
}

fn refraction_offset_cheap(n: vec3f, ior: f32, thickness: f32) -> vec2f {
  let slope = n.xy / max(n.z, REFRACTION_MIN_COS);
  return -slope * thickness * (1.0 - 1.0 / max(ior, 1.0));
}

fn refraction_offset_physical(n: vec3f, view: vec3f, ior: f32, thickness: f32) -> vec2f {
  let incident = normalize(view);
  let refracted = refract(incident, n, 1.0 / max(ior, 1.0));
  let down_in = max(-incident.z, REFRACTION_MIN_COS);
  let down_out = max(-refracted.z, REFRACTION_MIN_COS);
  return thickness * (refracted.xy / down_out - incident.xy / down_in);
}

fn refraction_to_uv(offset: vec2f, aspect: f32) -> vec2f {
  return vec2f(offset.x / max(aspect, 1e-4), offset.y);
}

fn refraction_dispersion_iors(ior: f32, dispersion: f32) -> vec3f {
  return max(vec3f(ior) + vec3f(-1.0, 0.0, 1.0) * dispersion, vec3f(1.0));
}

fn refraction_dispersion_scales(ior: f32, dispersion: f32) -> vec3f {
  let iors = refraction_dispersion_iors(ior, dispersion);
  let denom = max(1.0 - 1.0 / max(ior, 1.0), 1e-4);
  return (vec3f(1.0) - vec3f(1.0) / iors) / denom;
}

fn refraction_rgb_offsets(offset_g_uv: vec2f, scales: vec3f) -> RefractionRGB {
  return RefractionRGB(offset_g_uv * scales.x, offset_g_uv, offset_g_uv * scales.z);
}

fn refraction_mirror_uv(uv: vec2f) -> vec2f {
  let t = uv - 2.0 * floor(uv * 0.5); // [0, 2)
  return vec2f(1.0) - abs(vec2f(1.0) - t);
}

fn refraction_fade_offset(uv: vec2f, offset_uv: vec2f, fade: f32) -> vec2f {
  // Distance to the border the offset points at, per axis.
  let toward = vec2f(
    select(uv.x, 1.0 - uv.x, offset_uv.x > 0.0),
    select(uv.y, 1.0 - uv.y, offset_uv.y > 0.0),
  );
  let k = smoothstep(vec2f(0.0), vec2f(max(fade, 1e-4)), toward);
  return offset_uv * k;
}

fn refraction_safe_uv(uv: vec2f, offset_uv: vec2f, fade: f32) -> vec2f {
  return refraction_mirror_uv(uv + refraction_fade_offset(uv, offset_uv, fade));
}

fn refraction_blur_lod(radius_px: f32, max_lod: f32) -> f32 {
  return clamp(log2(max(2.0 * radius_px, 1.0)), 0.0, max(max_lod, 0.0));
}

fn refraction_sample(
  tex: texture_2d<f32>, samp: sampler, uv: vec2f, offset_uv: vec2f, lod: f32, fade: f32,
) -> vec3f {
  return textureSampleLevel(tex, samp, refraction_safe_uv(uv, offset_uv, fade), lod).rgb;
}

fn refraction_sample_rgb(
  tex: texture_2d<f32>, samp: sampler, uv: vec2f, offsets: RefractionRGB, lod: f32, fade: f32,
) -> vec3f {
  let r = textureSampleLevel(tex, samp, refraction_safe_uv(uv, offsets.r, fade), lod).r;
  let g = textureSampleLevel(tex, samp, refraction_safe_uv(uv, offsets.g, fade), lod).g;
  let b = textureSampleLevel(tex, samp, refraction_safe_uv(uv, offsets.b, fade), lod).b;
  return vec3f(r, g, b);
}

fn refraction_sample_spectral(
  tex: texture_2d<f32>, samp: sampler, uv: vec2f, offset_g_uv: vec2f,
  ior: f32, dispersion: f32, lod: f32, fade: f32, taps: i32,
) -> vec3f {
  let count = clamp(taps, 2, 16);
  let denom = max(1.0 - 1.0 / max(ior, 1.0), 1e-4);
  var sum = vec3f(0.0);
  var weights = vec3f(0.0);
  for (var k = 0; k < count; k++) {
    // t runs over -1.5 .. 1.5: -1 is where the red response peaks, +1 the blue, 0 the green.
    let t = ((f32(k) + 0.5) / f32(count) * 2.0 - 1.0) * 1.5;
    let ior_t = max(ior + dispersion * t, 1.0);
    let scale = (1.0 - 1.0 / ior_t) / denom;
    let w = max(vec3f(1.0) - abs(vec3f(t) - vec3f(-1.0, 0.0, 1.0)), vec3f(0.0));
    let colour = textureSampleLevel(tex, samp, refraction_safe_uv(uv, offset_g_uv * scale, fade), lod).rgb;
    sum += w * colour;
    weights += w;
  }
  return sum / max(weights, vec3f(1e-4));
}
`,"./ripples.wgsl":`// ripples.wgsl -- rain ripple rings on a water surface: expanding, fading concentric rings from hashed
// drop positions and start times, with an analytic height and slope. No state, no textures.
//
// The surface is cut into square cells one unit wide. Each cell owns one drop per cycle: when it lands
// (a hashed time offset, so neighbouring cells are never in step), where in the cell it lands (always the
// middle half, so a ring never reaches further than half a cell past the cell border) and how big its
// ring grows come from an integer hash of (cell, cycle). A pixel therefore only needs the four cells
// nearest to it: its own and the neighbour on each axis it is closer to. Rings that cross a cell border
// stay continuous, because the ring is faded to exactly zero at distance RIPPLE_REACH from its drop.
//
// Conventions
//  * \`p\` is in CELL units: divide a position in metres or image heights by the cell size first. The
//    ring wavelength is RIPPLE_WAVELENGTH (0.1) cells, the largest ring has radius RIPPLE_MAX_RADIUS (0.4).
//    So a 0.4 m cell gives 4 cm wavelength rings that grow to 16 cm.
//  * \`time\` and \`life\` are in seconds. \`life\` is how long one ring lives. \`density\` is the share of the
//    time a cell has a ring on it (a duty cycle), [0, 1]; with 1 a cell is almost always rippling.
//    The cell's period is life / (0.9 * density), jittered by up to 35% per cell.
//  * Heights are NORMALISED: the crest of a fresh ring is 1, so one ring stays within [-1, 1] (a sum of
//    up to four overlapping rings can reach 4, in practice rarely past 1.5). Slopes are
//    d height / d p, per cell unit. To get a real surface, scale by the crest height in cell units:
//    ripple_normal does that. A crest of 0.01 cells is a gentle ripple, 0.03 a stormy one.
//  * A ring is a cosine wavelet riding on its front: a sharp leading crest followed by up to four
//    fading troughs and crests behind, in a Gaussian envelope (long behind the front, short ahead of
//    it). The front slows down as it spreads (r = R (1 - (1 - age)^2)); the height decays like
//    (1 - age)^2 and ramps in over the first 5% of the ring's life, so nothing pops.
//
//   ripple_ring(offset, age, size) -> vec3f
//        one ring. \`offset\` = pixel minus drop centre (cell units), \`age\` = fraction of the ring's life
//        gone (0 at impact, 1 when it has faded), \`size\` [0.5, 1] scales the maximum radius. Returns
//        (height, d/dx, d/dy). Exactly (0, 0, 0) for age <= 0, age >= 1 and beyond RIPPLE_REACH.
//        Radially symmetric: depends on |offset| only; the gradient points along offset.
//   ripple_rings(p, time, density, life, seed) -> vec3f
//        the sum of every ring that reaches p: (height, d/dx, d/dy). \`seed\` selects an independent
//        pattern, so two layers at different cell sizes do not coincide. 4 cell evaluations, 2 integer
//        hashes each, plus ring maths for the rings that are in range (about 60 ALU, one sqrt, one exp,
//        one sin, one cos per ring).
//   ripple_normal(rings, crest) -> vec3f
//        unit tangent-space normal (x right, y down, z up) for the sum from ripple_rings, with the
//        crest height \`crest\` in cell units
//   ripple_lod_fade(footprint) -> f32
//        [0, 1]; pass the size of one pixel on the surface in cell units. 1 where the rings are resolved
//        (footprint < 1/5 of a wavelength), 0 where they are not (> 5/8), so distant rings fade out
//        instead of shimmering
//
// Technique: the hashed-cell scheme used for rain ripples in many real-time shaders (the neighbourhood
// search is the point: rings are summed across cell borders), with the wavelet, the exact fade and the
// closed-form gradient written here. Euler-style cosine wavelets are not a wave simulation; they look
// right because the eye reads the expanding crest and the fading train behind it.

#include "hash.wgsl"
#include "math.wgsl"

const RIPPLE_WAVELENGTH: f32 = 0.1;
const RIPPLE_MAX_RADIUS: f32 = 0.4;
const RIPPLE_REACH: f32 = 0.5;

fn ripple_ring(offset: vec2f, age: f32, size: f32) -> vec3f {
  if (age <= 0.0 || age >= 1.0) {
    return vec3f(0.0);
  }
  let d = length(offset);
  if (d >= RIPPLE_REACH) {
    return vec3f(0.0);
  }
  let rest = 1.0 - age;
  let front = RIPPLE_MAX_RADIUS * clamp(size, 0.5, 1.0) * (1.0 - rest * rest);
  let x = d - front;
  let lam = RIPPLE_WAVELENGTH;
  let sigma = select(1.7 * lam, 0.3 * lam, x > 0.0);
  let g = exp(-(x * x) / (sigma * sigma));
  let phase = TAU * x / lam;
  let wave = cos(phase) * g;
  let dwave = -sin(phase) * (TAU / lam) * g - cos(phase) * g * (2.0 * x / (sigma * sigma));

  // Fade to exactly zero at the reach so rings from neighbouring cells meet without a seam.
  let edge_t = saturate((d - (RIPPLE_REACH - 0.06)) / 0.06);
  let window = 1.0 - edge_t * edge_t * (3.0 - 2.0 * edge_t);
  let dwindow = -6.0 * edge_t * (1.0 - edge_t) / 0.06;

  let ramp_t = saturate(age / 0.05);
  let amp = ramp_t * ramp_t * (3.0 - 2.0 * ramp_t) * rest * rest;

  let height = amp * window * wave;
  let slope = amp * (window * dwave + wave * dwindow);
  // The gradient of a function of |offset| is radial; the cone point at the centre has no direction.
  let radial = offset / max(d, 1e-5) * smoothstep(0.0, 0.004, d);
  return vec3f(height, slope * radial);
}

fn _ripple_cell(p: vec2f, cell: vec2i, time: f32, density: f32, life: f32, seed: i32) -> vec3f {
  let h = ihash_3to3(vec3i(cell, seed * 31 + 7));
  let period = life / (0.9 * clamp(density, 0.02, 1.0)) * mix(1.0, 1.35, h.x);
  let t = time / period + h.y;
  let k = floor(t);
  let age = (t - k) * period / max(life, 1e-4);
  if (age >= 1.0) {
    return vec3f(0.0);
  }
  let g = ihash_3to3(vec3i(cell.x * 2 + seed, cell.y * 3 + 1, i32(k)));
  let centre = vec2f(cell) + 0.25 + 0.5 * g.xy;
  return ripple_ring(p - centre, age, 0.55 + 0.45 * g.z);
}

fn ripple_rings(p: vec2f, time: f32, density: f32, life: f32, seed: i32) -> vec3f {
  let base = vec2i(floor(p));
  let f = p - floor(p);
  let step_x = select(-1, 1, f.x >= 0.5);
  let step_y = select(-1, 1, f.y >= 0.5);
  var sum = vec3f(0.0);
  sum += _ripple_cell(p, base, time, density, life, seed);
  sum += _ripple_cell(p, base + vec2i(step_x, 0), time, density, life, seed);
  sum += _ripple_cell(p, base + vec2i(0, step_y), time, density, life, seed);
  sum += _ripple_cell(p, base + vec2i(step_x, step_y), time, density, life, seed);
  return sum;
}

fn ripple_normal(rings: vec3f, crest: f32) -> vec3f {
  return normalize(vec3f(-rings.y * crest, -rings.z * crest, 1.0));
}

fn ripple_lod_fade(footprint: f32) -> f32 {
  return 1.0 - smoothstep(0.2 * RIPPLE_WAVELENGTH, 0.625 * RIPPLE_WAVELENGTH, footprint);
}
`,"./sdf.wgsl":`// sdf.wgsl -- signed distance functions, combinators and smooth min/max.
// Sign convention: negative inside, 0 on the surface, positive outside. Distances are exact (Lipschitz-1)
// except after the boolean/smooth combinators, which keep them correct near the surface only.
//
// 2D primitives (p: point relative to the shape's centre; rotate/translate p yourself)
//   sd_circle(p, radius) -> f32
//   sd_box_2d(p, half_size: vec2f) -> f32
//   sd_rounded_box_2d(p, half_size: vec2f, radius) -> f32   outer extent is half_size; radius is clamped to fit
//   sd_segment_2d(p, a, b) -> f32                           unsigned distance to the segment ab (>= 0)
//   sd_capsule_2d(p, a, b, radius) -> f32                   segment inflated by radius
//
// 3D primitives
//   sd_sphere(p, radius)                      sd_box_3d(p, half_size: vec3f)
//   sd_rounded_box_3d(p, half_size, radius)   sd_capsule_3d(p, a, b, radius)
//   sd_torus(p, major, minor) -> f32          ring in the xz plane (axis y); major = ring radius,
//                                             minor = tube radius
//
// Combinators on distances (all f32)
//   sd_union(a, b) = min          sd_intersect(a, b) = max          sd_subtract(a, b) = a minus b = max(a, -b)
//   sd_round(d, r)  grow the shape by r (rounds convex corners; negative r shrinks)
//   sd_onion(d, thickness)  hollow shell: |d| - thickness (the shell is 2 * thickness thick)
//   sd_coverage(d, aa) -> f32   anti-aliased fill: 1 inside, 0 outside, a ramp \`aa\` wide centred on the
//                               surface. Pass aa = size of one pixel in the same units as d.
//
// Smooth minimum (metaballs, gooey merging, filleted joins). \`k\` is the blend size, in distance units.
// All are symmetric, never exceed min(a, b), and approach min as k -> 0. Max deviation at a == b:
//   smin_poly(a, b, k)       quadratic, C1, local: blends only where |a-b| < k; deviation k/4. Cheapest.
//   smin_cubic(a, b, k)      cubic, C2 (smoother shading), local like poly; deviation k/6
//   smin_exp(a, b, k)        exponential, C-infinity, associative (order of merging many blobs does not
//                            matter) but never exactly min; deviation k ln 2. Costs an exp and a log.
//   smin_poly_blend / smin_cubic_blend / smin_exp_blend (a, b, k) -> vec2f   (value, w): the same value
//                            plus w in [0, 1] = weight of b, i.e. d(value)/d(b). Gradient of the result =
//                            mix(grad a, grad b, w), and w blends material colours across the join.
//                            a << b gives w = 0, a == b gives 0.5.
//   smax_poly / smax_cubic / smax_exp(a, b, k)   smooth maximum, never below max(a, b)
//   Smooth intersection is smax_*(a, b, k); smooth subtraction is smax_*(a, -b, k).
//
// Cost: primitives are 5-15 ALU ops each. Smooth-min follows Inigo Quilez's articles on smooth minimum;
// polynomial forms re-derived here with k as the full blend width.

// ---- 2D primitives ------------------------------------------------------------------------------

fn sd_circle(p: vec2f, radius: f32) -> f32 {
  return length(p) - radius;
}

fn sd_box_2d(p: vec2f, half_size: vec2f) -> f32 {
  let q = abs(p) - half_size;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn sd_rounded_box_2d(p: vec2f, half_size: vec2f, radius: f32) -> f32 {
  let r = clamp(radius, 0.0, min(half_size.x, half_size.y));
  return sd_box_2d(p, half_size - vec2f(r)) - r;
}

fn sd_segment_2d(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-20), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sd_capsule_2d(p: vec2f, a: vec2f, b: vec2f, radius: f32) -> f32 {
  return sd_segment_2d(p, a, b) - radius;
}

// ---- 3D primitives ------------------------------------------------------------------------------

fn sd_sphere(p: vec3f, radius: f32) -> f32 {
  return length(p) - radius;
}

fn sd_box_3d(p: vec3f, half_size: vec3f) -> f32 {
  let q = abs(p) - half_size;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sd_rounded_box_3d(p: vec3f, half_size: vec3f, radius: f32) -> f32 {
  let r = clamp(radius, 0.0, min(half_size.x, min(half_size.y, half_size.z)));
  return sd_box_3d(p, half_size - vec3f(r)) - r;
}

fn sd_capsule_3d(p: vec3f, a: vec3f, b: vec3f, radius: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-20), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

fn sd_torus(p: vec3f, major: f32, minor: f32) -> f32 {
  return length(vec2f(length(p.xz) - major, p.y)) - minor;
}

// ---- Combinators --------------------------------------------------------------------------------

fn sd_union(a: f32, b: f32) -> f32 {
  return min(a, b);
}

fn sd_intersect(a: f32, b: f32) -> f32 {
  return max(a, b);
}

fn sd_subtract(a: f32, b: f32) -> f32 {
  return max(a, -b);
}

fn sd_round(d: f32, r: f32) -> f32 {
  return d - r;
}

fn sd_onion(d: f32, thickness: f32) -> f32 {
  return abs(d) - thickness;
}

fn sd_coverage(d: f32, aa: f32) -> f32 {
  return clamp(0.5 - d / max(aa, 1e-12), 0.0, 1.0);
}

// ---- Smooth minimum / maximum -------------------------------------------------------------------

// value = min - k h^2 / 4 with h = max(k - |a-b|, 0) / k.
fn smin_poly(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-12);
  let h = max(kk - abs(a - b), 0.0) / kk;
  return min(a, b) - 0.25 * kk * h * h;
}

fn smin_poly_blend(a: f32, b: f32, k: f32) -> vec2f {
  let kk = max(k, 1e-12);
  let h = max(kk - abs(a - b), 0.0) / kk;
  let w = select(0.5 * h, 1.0 - 0.5 * h, b < a); // weight of b
  return vec2f(min(a, b) - 0.25 * kk * h * h, w);
}

// value = min - k h^3 / 6.
fn smin_cubic(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-12);
  let h = max(kk - abs(a - b), 0.0) / kk;
  return min(a, b) - kk * h * h * h / 6.0;
}

fn smin_cubic_blend(a: f32, b: f32, k: f32) -> vec2f {
  let kk = max(k, 1e-12);
  let h = max(kk - abs(a - b), 0.0) / kk;
  let w = select(0.5 * h * h, 1.0 - 0.5 * h * h, b < a);
  return vec2f(min(a, b) - kk * h * h * h / 6.0, w);
}

// value = -k ln(exp(-a/k) + exp(-b/k)), evaluated in an overflow-free form.
fn smin_exp(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-12);
  return min(a, b) - kk * log(1.0 + exp(-abs(a - b) / kk));
}

fn smin_exp_blend(a: f32, b: f32, k: f32) -> vec2f {
  let kk = max(k, 1e-12);
  let e = exp(-abs(a - b) / kk);
  let small = e / (1.0 + e); // weight of the larger input, in (0, 0.5]
  let w = select(small, 1.0 - small, b < a);
  return vec2f(min(a, b) - kk * log(1.0 + e), w);
}

fn smax_poly(a: f32, b: f32, k: f32) -> f32 {
  return -smin_poly(-a, -b, k);
}

fn smax_cubic(a: f32, b: f32, k: f32) -> f32 {
  return -smin_cubic(-a, -b, k);
}

fn smax_exp(a: f32, b: f32, k: f32) -> f32 {
  return -smin_exp(-a, -b, k);
}
`,"./shafts.wgsl":`// shafts.wgsl -- light shafts ("god rays") seen from below the surface: bands of sunlight that fan
// down through the water, shifting slowly as the surface above them moves. An analytic, noise-driven
// construction in screen space: no ray march, no depth buffer, one fan coordinate and two noise
// evaluations per pixel.
//
// CONVENTIONS
//  * \`p\` is a screen position in aspect-corrected units: x in [0, aspect], y in [0, 1] growing DOWN
//    (so p = vec2f(uv.x * aspect, uv.y)). Depth below the surface is roughly p.y.
//  * \`source\` is where the rays seem to come from, in the same units. Put it ABOVE the frame
//    (negative y): the farther away, the more parallel the shafts; a source just above the top edge
//    fans them out like a spotlight. The source's x sets the slant: a source to the left of the frame
//    centre leans the shafts to the right as they go down.
//  * \`time\` in seconds-like units, any rate. Shafts drift sideways slowly and breathe in strength.
//  * Results are dimensionless light factors in [0, 1] (multiply by a light colour and an intensity).
//
// Functions
//   shafts_fan(p, source) -> f32
//       the ray coordinate: tan of the angle between the ray through \`p\` and straight down, so it is
//       constant along each ray. Clamped near the source, where it would blow up.
//   shafts_beams(coord, time, frequency, contrast) -> f32
//       [0, 1] pattern across the fan: two octaves of animated gradient noise in (coord, time).
//       \`frequency\` is shafts per unit of the fan coordinate (about 3 to 12); \`contrast\` in [0, 1]
//       takes it from a soft wash (0) to separate crisp bands with dark water between them (1).
//   shafts_falloff(p, source, reach) -> f32
//       [0, 1]: 1 at the surface, decaying with distance along the ray (exp(-d / reach); \`reach\` in
//       frame heights, 0.5 to 2), with a slow ripple along each ray so shafts are not uniform rods.
//   shafts_light(p, source, time, frequency, contrast, reach) -> f32
//       beams * falloff: what the demo uses.
//
// Cost: shafts_beams = 2 gnoise_2d (8 hashes) + a smoothstep; falloff = 1 exp, 1 sin, 1 sqrt
// and a divide (the fan coordinate). About 90 ALU in all. Per pixel that is cheaper than one octave of 3D FBM.
// Why not a ray march: a march of N samples against a shadow map costs N texture reads per pixel and
// needs the surface's height; the shafts of a calm background only need to look like a fan of bands.
// Pitfalls: with the source inside the frame the fan coordinate is singular at it; keep the source
// at least 0.1 above the top edge (the fan clamps its denominator at 0.05 as a guard).
// Credits: screen-space volumetric light as in Y. Dobashi et al. (2002) and the many "fake god ray"
// shaders; the noise-in-ray-angle form is the usual cheap approximation of it.

#include "noise.wgsl"
#include "math.wgsl"

fn shafts_fan(p: vec2f, source: vec2f) -> f32 {
  return (p.x - source.x) / max(p.y - source.y, 0.05);
}

fn shafts_beams(coord: f32, time: f32, frequency: f32, contrast: f32) -> f32 {
  let x = coord * frequency;
  // Two octaves: broad swaths and finer streaks, drifting in different directions and speeds.
  let n1 = gnoise_2d(vec2f(x + time * 0.11, time * 0.17));
  let n2 = gnoise_2d(vec2f(x * 2.3 + 7.1 - time * 0.19, time * 0.29 + 3.0));
  let v = saturate(0.5 + 0.55 * (0.7 * n1 + 0.3 * n2));
  // Contrast: the band edges tighten around the middle of the range as it rises.
  let lo = mix(0.0, 0.42, saturate(contrast));
  let hi = mix(1.0, 0.72, saturate(contrast));
  return smoothstep(lo, hi, v);
}

fn shafts_falloff(p: vec2f, source: vec2f, reach: f32) -> f32 {
  let coord = shafts_fan(p, source);
  // Distance travelled below the surface (y = 0) along the ray through p.
  let travelled = max(p.y, 0.0) * sqrt(1.0 + coord * coord);
  let fade = exp(-travelled / max(reach, 0.05));
  // Each ray brightens and dims slowly along its length.
  let ripple = 0.8 + 0.2 * sin(travelled * 5.0 + coord * 3.0);
  return fade * ripple;
}

fn shafts_light(p: vec2f, source: vec2f, time: f32, frequency: f32, contrast: f32, reach: f32) -> f32 {
  let beams = shafts_beams(shafts_fan(p, source), time, frequency, contrast);
  return beams * shafts_falloff(p, source, reach);
}
`,"./shallow-water.wgsl":`// shallow-water.wgsl -- read the output textures of the shallow-water solver
// (src/gpu/sim/shallow-water.ts) without knowing how they are laid out. Everything a shading pass
// needs: water depth, flow velocity, foam, the bed, the slope of the water surface and its normal.
//
// THE TEXTURES. The solver publishes two rgba16float textures, filterable, one texel per grid cell,
// covering the whole domain: uv (0, 0) is the top-left corner and (1, 1) the bottom-right. A 3D
// consumer maps uv.x to world x and uv.y to world z (the grid's "down" is +z).
//   water  = solver.view         x depth (m)   y velocity x (m/s)   z velocity y (m/s)   w foam [0, 1]
//   ground = solver.groundView   x bed height (m)   y surface slope x   z surface slope y   w ground
//                                wetness [0, 1]
// Velocity is the depth-averaged flow, zero where there is no water. The slopes are d(level)/dx and
// d(level)/dy of the water surface (bed + depth) where there is water, of the bed where there is
// none, per metre, so a slope of 0.1 is a 5.7 degree tilt: they are the same number whatever the grid
// resolution. At a shoreline the surface is taken to be flat up to the dry ground, so the water
// does not tilt up the beach. Foam is born at bores, on thin fast sheets and at advancing fronts, is
// carried with the flow and fades over solver.params.foamLife seconds. Ground wetness is 1 under
// water and dries out over solver.params.wetLife seconds, so the sand stays dark behind a retreating
// shore.
//
// FRAME. World axes: x right, y up, z toward the viewer (uv y). The free surface normal of a flat
// pool is (0, 1, 0).
//
// Decoding a water texel \`w\` (a vec4f from the water texture)
//   swe_depth(w) -> f32                      water depth in metres, >= 0
//   swe_velocity(w) -> vec2f                 (x, z) velocity in m/s
//   swe_velocity_world(w) -> vec3f           (vx, 0, vz) in world axes
//   swe_speed(w) -> f32                      |velocity| in m/s
//   swe_foam(w) -> f32                       foam amount [0, 1]
//   swe_froude(w, gravity) -> f32            speed / sqrt(g depth): above 1 the flow is supercritical
//                                            (a torrent, or a bore front); 0 on dry ground
//
// Decoding a ground texel \`g\`
//   swe_bed(g) -> f32                        bed height in metres
//   swe_surface_slope(g) -> vec2f            (d/dx, d/dz) of the visible surface
//   swe_ground_wetness(g) -> f32             [0, 1]
//
// Combining
//   swe_surface(w, g) -> f32                 water surface height: bed + depth
//   swe_wet_mask(depth, edge) -> f32         coverage [0, 1]: 0 at depth <= 0, 1 at depth >= edge, smooth
//                                            and monotonic between. Use it as the alpha of a water mesh so
//                                            the shoreline is soft and does not stair-step. edge <= 0
//                                            gives a hard step. Roughly one cell's rise of a beach (the
//                                            beach slope times the cell size) gives a crisp edge
//   swe_surface_normal(g, strength) -> vec3f unit normal of the water surface from the stored slopes;
//                                            strength 1 is physical, larger exaggerates
//   swe_terrain_normal(bed_w, bed_e, bed_n, bed_s, spacing) -> vec3f
//                                            unit normal of the bed from four bed heights one \`spacing\`
//                                            metres west, east, north (-z) and south (+z) of the point
//
// Fetching (the texture and sampler are parameters; this chunk declares no bindings)
//   swe_sample_water(tex, samp, uv) -> vec4f            one bilinear tap; needs a filtering sampler
//   swe_sample_ground(tex, samp, uv) -> vec4f
//   swe_sample_bed_normal(tex, samp, uv, texel, cell_size) -> vec3f
//                                            bed normal from four taps of the ground texture, \`texel\`
//                                            = solver.grid.texelSize (uv), \`cell_size\` = grid.cellSize (m)
//   swe_load_water(tex, cell) -> vec4f       the exact texel of a cell (clamped to the grid)
//
// Cost: a decode is free; the normal is a normalize (about 10 ALU); swe_sample_bed_normal is four taps.
//
// Why bilinear taps are fine here: depth, velocity and slope are all smooth fields on the grid. The
// one thing a bilinear tap cannot give is a sharp shoreline, which swe_wet_mask provides.

fn swe_depth(w: vec4f) -> f32 {
  return max(w.x, 0.0);
}

fn swe_velocity(w: vec4f) -> vec2f {
  return w.yz;
}

fn swe_velocity_world(w: vec4f) -> vec3f {
  return vec3f(w.y, 0.0, w.z);
}

fn swe_speed(w: vec4f) -> f32 {
  return length(w.yz);
}

fn swe_foam(w: vec4f) -> f32 {
  return clamp(w.w, 0.0, 1.0);
}

fn swe_froude(w: vec4f, gravity: f32) -> f32 {
  let h = max(w.x, 0.0);
  if (h <= 1e-4) {
    return 0.0;
  }
  return length(w.yz) / sqrt(max(gravity, 1e-3) * h);
}

fn swe_bed(g: vec4f) -> f32 {
  return g.x;
}

fn swe_surface_slope(g: vec4f) -> vec2f {
  return g.yz;
}

fn swe_ground_wetness(g: vec4f) -> f32 {
  return clamp(g.w, 0.0, 1.0);
}

fn swe_surface(w: vec4f, g: vec4f) -> f32 {
  return g.x + max(w.x, 0.0);
}

fn swe_wet_mask(depth: f32, edge: f32) -> f32 {
  if (edge <= 0.0) {
    return select(0.0, 1.0, depth > 0.0);
  }
  let t = clamp(depth / edge, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn swe_surface_normal(g: vec4f, strength: f32) -> vec3f {
  return normalize(vec3f(-g.y * strength, 1.0, -g.z * strength));
}

fn swe_terrain_normal(bed_w: f32, bed_e: f32, bed_n: f32, bed_s: f32, spacing: f32) -> vec3f {
  let inv = 0.5 / max(spacing, 1e-6);
  return normalize(vec3f(-(bed_e - bed_w) * inv, 1.0, -(bed_s - bed_n) * inv));
}

fn swe_sample_water(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f {
  return textureSampleLevel(tex, samp, uv, 0.0);
}

fn swe_sample_ground(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f {
  return textureSampleLevel(tex, samp, uv, 0.0);
}

fn swe_sample_bed_normal(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2f,
  texel: vec2f,
  cell_size: f32,
) -> vec3f {
  let w = textureSampleLevel(tex, samp, uv - vec2f(texel.x, 0.0), 0.0).x;
  let e = textureSampleLevel(tex, samp, uv + vec2f(texel.x, 0.0), 0.0).x;
  let n = textureSampleLevel(tex, samp, uv - vec2f(0.0, texel.y), 0.0).x;
  let s = textureSampleLevel(tex, samp, uv + vec2f(0.0, texel.y), 0.0).x;
  return swe_terrain_normal(w, e, n, s, cell_size);
}

fn swe_load_water(tex: texture_2d<f32>, cell: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(tex));
  return textureLoad(tex, clamp(cell, vec2i(0), size - vec2i(1)), 0);
}
`,"./simplex.wgsl":`// simplex.wgsl -- simplex noise: gradient noise on a triangular (2D) / tetrahedral (3D) lattice.
// Fewer corners than lattice noise in 3D (4 vs 8), no axis-aligned grid look, smoother and more
// isotropic. Use it when grid artefacts from noise.wgsl are visible (low octave counts, big features).
//
//   snoise_2d(p: vec2f) -> f32       range [-1, 1]; 3 corners, 3 hashes
//   snoise_2d_d(p: vec2f) -> vec3f   (value, d/dx, d/dy), analytic gradient; same range for the value
//   snoise_3d(p: vec3f) -> f32       range [-1, 1]; 4 corners, 4 hashes. Animated 2D: vec3f(p, time)
//
// \`p\` is in lattice units (feature size ~1.0 per unit). Zero mean, signed like noise.wgsl, deterministic
// integer hashing. Keep |p| below ~1e4. No tileable form: use gnoise_*_tile from noise.wgsl for that.
//
// Technique: Perlin's simplex noise (2001); radial kernel (0.5 - r^2)^4 in 2D and (0.6 - r^2)^4 in 3D
// follow Stefan Gustavson's "Simplex noise demystified". Code written from the published algorithm.

#include "hash.wgsl"

const _SKEW_2D: f32 = 0.36602540378443865; // (sqrt(3) - 1) / 2
const _UNSKEW_2D: f32 = 0.21132486540518713; // (3 - sqrt(3)) / 6
const _SKEW_3D: f32 = 0.3333333333333333; // 1 / 3
const _UNSKEW_3D: f32 = 0.16666666666666666; // 1 / 6

// Scales that bring the worst case (every corner's gradient perfectly aligned) to just under 1.
const _SNOISE_2D_SCALE: f32 = 99.0;
const _SNOISE_3D_SCALE: f32 = 32.6;

fn _simplex_hash_2d(c: vec2i) -> u32 {
  return pcg_2d(bitcast<vec2u>(c)).x;
}

fn _simplex_hash_3d(c: vec3i) -> u32 {
  return pcg_3d(bitcast<vec3u>(c)).x;
}

// One corner's contribution t^4 (g . r), r = vector from the corner to the sample point.
fn _simplex_corner_2d(h: u32, r: vec2f) -> f32 {
  let t = max(0.5 - dot(r, r), 0.0);
  let t2 = t * t;
  return t2 * t2 * dot(grad_2d(h), r);
}

// (contribution, d/dx, d/dy) of one corner.
fn _simplex_corner_2d_d(h: u32, r: vec2f) -> vec3f {
  let t = max(0.5 - dot(r, r), 0.0);
  let t2 = t * t;
  let g = grad_2d(h);
  let gr = dot(g, r);
  return vec3f(t2 * t2 * gr, t2 * t2 * g - 8.0 * t2 * t * gr * r);
}

fn _simplex_corner_3d(h: u32, r: vec3f) -> f32 {
  let t = max(0.6 - dot(r, r), 0.0);
  let t2 = t * t;
  return t2 * t2 * dot(grad_3d(h), r);
}

fn snoise_2d(p: vec2f) -> f32 {
  let i = floor(p + (p.x + p.y) * _SKEW_2D);
  let p0 = p - (i - (i.x + i.y) * _UNSKEW_2D);
  // Which of the two triangles of the skewed cell the point is in decides the middle corner.
  let step_x = p0.x > p0.y;
  let o = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), step_x);
  let p1 = p0 - o + _UNSKEW_2D;
  let p2 = p0 - 1.0 + 2.0 * _UNSKEW_2D;
  let c = vec2i(i);
  let n =
    _simplex_corner_2d(_simplex_hash_2d(c), p0) +
    _simplex_corner_2d(_simplex_hash_2d(c + vec2i(o)), p1) +
    _simplex_corner_2d(_simplex_hash_2d(c + vec2i(1)), p2);
  return _SNOISE_2D_SCALE * n;
}

fn snoise_2d_d(p: vec2f) -> vec3f {
  let i = floor(p + (p.x + p.y) * _SKEW_2D);
  let p0 = p - (i - (i.x + i.y) * _UNSKEW_2D);
  let step_x = p0.x > p0.y;
  let o = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), step_x);
  let p1 = p0 - o + _UNSKEW_2D;
  let p2 = p0 - 1.0 + 2.0 * _UNSKEW_2D;
  let c = vec2i(i);
  let n =
    _simplex_corner_2d_d(_simplex_hash_2d(c), p0) +
    _simplex_corner_2d_d(_simplex_hash_2d(c + vec2i(o)), p1) +
    _simplex_corner_2d_d(_simplex_hash_2d(c + vec2i(1)), p2);
  return _SNOISE_2D_SCALE * n;
}

fn snoise_3d(p: vec3f) -> f32 {
  let i = floor(p + (p.x + p.y + p.z) * _SKEW_3D);
  let p0 = p - (i - (i.x + i.y + i.z) * _UNSKEW_3D);
  // Rank the three coordinates (ties broken consistently so ranks are always 0, 1, 2).
  // The tetrahedron's path from the origin corner steps along the largest, then the second largest.
  let rank = vec3f(
    f32(p0.x >= p0.y) + f32(p0.x >= p0.z),
    f32(p0.y > p0.x) + f32(p0.y >= p0.z),
    f32(p0.z > p0.x) + f32(p0.z > p0.y),
  );
  let o1 = step(vec3f(2.0), rank);
  let o2 = step(vec3f(1.0), rank);
  let p1 = p0 - o1 + _UNSKEW_3D;
  let p2 = p0 - o2 + 2.0 * _UNSKEW_3D;
  let p3 = p0 - 1.0 + 3.0 * _UNSKEW_3D;
  let c = vec3i(i);
  let n =
    _simplex_corner_3d(_simplex_hash_3d(c), p0) +
    _simplex_corner_3d(_simplex_hash_3d(c + vec3i(o1)), p1) +
    _simplex_corner_3d(_simplex_hash_3d(c + vec3i(o2)), p2) +
    _simplex_corner_3d(_simplex_hash_3d(c + vec3i(1)), p3);
  return _SNOISE_3D_SCALE * n;
}
`,"./sky.wgsl":`// sky.wgsl -- a cheap procedural sky: a function of view direction and sun direction that returns
// LINEAR HDR radiance. Not a physical atmosphere (no scattering integral): a horizon-to-zenith
// gradient, a sun disc with a halo, and a sunset tint driven by the sun's elevation. About 40 ALU ops,
// no textures, no loops. Made to be reflected by water, drawn as a backdrop, or baked into a cubemap
// (src/gpu/cubemap.ts renders any \`fn(dir) -> vec3f\` into one).
//
// Conventions
//  * World space, y up. \`dir\` and \`sun_dir\` are UNIT vectors; \`dir\` points from the viewer into the
//    sky (for a reflection: the reflected view ray). \`sun_dir\` points from the scene TOWARD the sun.
//  * Radiance is scene-referred linear RGB: ~0.3 to 1 over the blue sky, up to SKY_SUN_RADIANCE (30)
//    on the sun disc, so apply exposure and a tonemapper (color.wgsl) before display.
//  * Directions below the horizon (dir.y < 0) return a dim, horizon-coloured "ground" so a cubemap
//    has no black hole and a reflection off a steep wave never samples garbage. It matches the
//    horizon colour exactly at dir.y = 0, so the horizon is continuous. Nothing is hidden below it
//    except the sun disc and halo, which fade out across a thin band around the horizon.
//  * The sun passes through the horizon smoothly: elevation 90 degrees is noon (white, sky at its bluest),
//    ~10 to 0 degrees is golden hour to sunset (orange sun, warm horizon glow on the sun's side), below
//    about -10 degrees the sky is almost dark. No clouds.
//
// Constants
//   SKY_SUN_RADIANCE        peak radiance of the sun disc (30); the unit for sun glints, see specular.wgsl
//   SKY_SUN_ANGULAR_RADIUS  radius of the drawn disc, 0.0093 rad (about twice the real sun, for looks)
//
// Sky
//   sky_radiance(dir, sun_dir) -> vec3f         the default look (haze 0.3, full sun)
//   sky_radiance_ex(dir, sun_dir, haze, sun_gain) -> vec3f
//        haze     [0, 1]: 0 clear and deep blue, 1 milky and bright with a wide halo
//        sun_gain [0, ..): scales the sun disc and halo; 0 removes the sun, which is what you want for
//                 a reflection when the sun's reflection is added separately by specular.wgsl
//
// Pieces, for lighting a scene consistently with the sky
//   sky_sun_color(sun_dir) -> vec3f    colour of direct sunlight, max channel <= 1: white at noon, orange near
//                                      the horizon, fading to 0 as the sun sinks below -3 degrees. Multiply by
//                                      SKY_SUN_RADIANCE for the disc's radiance
//   sky_horizon_color(sun_dir, haze) -> vec3f   sky colour at dir.y = 0 away from the sun
//   sky_zenith_color(sun_dir, haze) -> vec3f    sky colour straight up
//   sky_ambient(sun_dir) -> vec3f      cheap hemisphere-average sky radiance, for ambient light and
//                                      for tinting a diffuse body colour
//
// Banding
//   sky_dither(frag_xy) -> f32         triangular-PDF noise in [-1, 1] LSB of an 8-bit channel. Add
//                                      \`sky_dither(position.xy) / 255.0\` AFTER linear_to_srgb: smooth
//                                      sky gradients otherwise show visible bands in 8-bit output
//
// Cost: sky_radiance ~40 ALU, one pow, two exp, one cross/length. Technique: a two-colour gradient
// with a sunset glow lobe and a Lorentzian sun halo (the common "cheap sky" structure); the sun's
// colour comes from a per-channel exponential extinction over an airmass that grows as 1 / elevation.

#include "hash.wgsl"

const SKY_SUN_RADIANCE: f32 = 30.0;
const SKY_SUN_ANGULAR_RADIUS: f32 = 0.0093;

// Twilight weight: 0 at noon, 1 around the horizon, 0 again when the sun is well below it.
fn _sky_twilight(sun_y: f32) -> f32 {
  return smoothstep(-0.25, 0.0, sun_y) * (1.0 - smoothstep(0.04, 0.5, sun_y));
}

// Day weight: 1 in daylight, 0 at night.
fn _sky_day(sun_y: f32) -> f32 {
  return smoothstep(-0.2, 0.25, sun_y);
}

fn sky_sun_color(sun_dir: vec3f) -> vec3f {
  let e = sun_dir.y;
  let airmass = 1.0 / (max(e, 0.0) + 0.08);
  let transmittance = exp(-airmass * vec3f(0.025, 0.07, 0.17));
  return transmittance * smoothstep(-0.05, 0.04, e);
}

fn sky_zenith_color(sun_dir: vec3f, haze: f32) -> vec3f {
  let day = _sky_day(sun_dir.y);
  let twilight = _sky_twilight(sun_dir.y);
  var c = mix(vec3f(0.002, 0.004, 0.014), vec3f(0.05, 0.16, 0.55), day);
  c = mix(c, vec3f(0.02, 0.035, 0.16), twilight * 0.8);
  return mix(c, sky_horizon_color(sun_dir, 1.0) * 0.7, saturate(haze) * 0.45);
}

fn sky_horizon_color(sun_dir: vec3f, haze: f32) -> vec3f {
  let day = _sky_day(sun_dir.y);
  let twilight = _sky_twilight(sun_dir.y);
  var c = mix(vec3f(0.006, 0.01, 0.025), vec3f(0.42, 0.6, 0.88), day);
  c = mix(c, vec3f(0.7, 0.36, 0.24), twilight * 0.75);
  return mix(c, vec3f(0.85, 0.88, 0.92) * day * day * day + c * (1.0 - day * day * day), saturate(haze) * 0.5);
}

fn sky_ambient(sun_dir: vec3f) -> vec3f {
  return 0.5 * (sky_horizon_color(sun_dir, 0.3) + sky_zenith_color(sun_dir, 0.3));
}

fn sky_radiance_ex(dir: vec3f, sun_dir: vec3f, haze: f32, sun_gain: f32) -> vec3f {
  let h = saturate(haze);
  let up = dir.y;
  let horizon = sky_horizon_color(sun_dir, h);
  let zenith = sky_zenith_color(sun_dir, h);

  // Gradient: steep near the horizon, flattening towards the zenith.
  var col = mix(horizon, zenith, pow(saturate(up), 0.45));

  // Sunset glow: a broad warm lobe on the sun's side that hugs the horizon.
  let cos_s = dot(dir, sun_dir);
  let sun_col = sky_sun_color(sun_dir);
  let twilight = _sky_twilight(sun_dir.y);
  let toward = pow(saturate(0.5 + 0.5 * cos_s), 5.0);
  col += sun_col * vec3f(0.9, 0.4, 0.2) * twilight * toward * exp(-max(up, 0.0) * 4.0) * 1.6;

  // Below the horizon: fade to a darker copy of the horizon colour. Equal to the sky at up = 0.
  col = mix(col, horizon * 0.35, saturate(-up * 4.0));

  // Sun halo (broad Mie-like glow plus a tight Lorentzian) and disc. Both vanish under the horizon.
  let sin_t = length(cross(dir, sun_dir));
  let x = 1.0 - cos_s;
  let near_sun = select(0.0, 1.0, cos_s > 0.0);
  let r = SKY_SUN_ANGULAR_RADIUS;
  let tight = 1.0 / (1.0 + (sin_t / 0.03) * (sin_t / 0.03));
  let halo = (0.9 * tight + 0.18 * exp(-x * 5.0)) * (1.0 + 2.0 * h) * near_sun;
  let disc = (1.0 - smoothstep(0.75 * r, r, sin_t)) * near_sun * SKY_SUN_RADIANCE;
  let above = smoothstep(-0.25, 0.04, up);
  let above_disc = smoothstep(-0.03, 0.03, up);
  col += sun_col * sun_gain * (halo * above + disc * above_disc);

  return max(col, vec3f(0.0));
}

fn sky_radiance(dir: vec3f, sun_dir: vec3f) -> vec3f {
  return sky_radiance_ex(dir, sun_dir, 0.3, 1.0);
}

fn sky_dither(frag_xy: vec2f) -> f32 {
  return hash_2to1(frag_xy) - hash_2to1(frag_xy + vec2f(17.0, 31.0));
}
`,"./specular.wgsl":`// specular.wgsl -- sun glint on water: a tight, energy-conserving specular lobe, and stochastic
// sparkle (glitter) for the micro-facets the wave normals do not resolve.
//
// Conventions
//  * World space, all direction arguments are UNIT vectors pointing AWAY from the surface:
//    \`n\` surface normal, \`v\` toward the eye, \`l\` toward the sun (or other light).
//  * Results are dimensionless factors. Multiply by the light's radiance to get HDR radiance, e.g.
//        sky_sun_color(sun) * SKY_SUN_RADIANCE * spec_sun(n, v, l, roughness, SKY_SUN_ANGULAR_RADIUS)
//    The product never exceeds F x (sun disc radiance): the reflection of the sun cannot be brighter
//    than the sun itself times the Fresnel reflectance, however narrow the lobe is made.
//
// Lobe: GGX (Trowbridge-Reitz) normal distribution with the Smith visibility term and Fresnel from
// fresnel.wgsl (air -> water). Why GGX and not Blinn-Phong: GGX has a long tail, which gives the sun
// reflection on water its soft glow around a hard core; a Phong lobe falls off like a Gaussian and
// looks like a plastic dot. It also normalises the same way for every roughness, so one slider
// moves from mirror-calm to choppy without re-tuning brightness. Cost: no pow, one normalize, one
// cross, a handful of multiplies and one divide (~35 ALU).
//   roughness     perceptual, [0, 1]; alpha = roughness^2. Water at noon is 0.02 to 0.1, chop 0.1 to 0.3.
//                 0 is allowed: the sun's own size keeps the lobe finite.
//   sun_radius    angular radius of the light in radians (SKY_SUN_RADIANCE's disc: 0.0093). The lobe is
//                 widened to alpha_eff^2 = alpha^2 + (sun_radius / 2)^2, the standard way to give an area
//                 light a finite highlight without a reference mirror lookup; the peak stays below 1.
//
//   spec_ggx_d(n_dot_h, alpha) -> f32       GGX normal distribution; integrates to 1 over the hemisphere of
//                                           half vectors weighted by n_dot_h. Peak 1 / (pi alpha^2)
//   spec_ggx(n, v, l, alpha) -> f32         BRDF x cos(theta_l) with Fresnel: D x V x F x n_dot_l. Units 1/sr.
//                                           Its integral over l in the upper hemisphere is the directional
//                                           albedo and stays <= 1 (energy conserving). 0 when l or v is
//                                           below the surface
//   spec_sun(n, v, l, roughness, sun_radius) -> f32
//                                           fraction of the sun disc's radiance reflected toward the eye,
//                                           in [0, 1]. Equals the Fresnel reflectance F at the exact mirror
//                                           direction of a flat surface with roughness 0 and falls off with
//                                           the GGX lobe around it
//
// Sparkle: discrete glints that twinkle as the waves move. The water plane is cut into square cells
// in WORLD space (so glints stay put under camera motion). A cell either holds a glint (with
// probability \`density\`) or not. A glint is a small round patch inside its cell with its own micro-
// facet normal, tilted away from the wave normal by a random offset (up to 0.3 in slope) that slowly
// circles with time, so the glint lights up when the half vector sweeps past the facet. Brightness is a
// Gaussian of the slope distance between the half vector and the facet normal.
// Anti-aliasing: the cell size is raised with the pixel footprint (cells are never smaller than
// ~3 pixels) by blending two power-of-two cell levels, so glints stay about pixel-sized in the
// distance, never shimmer below the sampling rate, and the mean brightness does not depend on the
// level (area fraction and facet statistics are scale-free). Cost: two cell evaluations, each two
// pcg_4d hashes and ~30 ALU: roughly 150 ALU total inside the glitter path.
//   spec_sparkle(p, n, v, l, time, footprint, cell, density, sharpness) -> f32
//        p          world xz position of the shaded point
//        time       seconds; glints twinkle with a period of roughly 3 to 20 s each
//        footprint  pixel size on the water in metres (waterplane_footprint); 0 disables the
//                   anti-aliasing blend
//        cell       finest cell size in metres, e.g. 0.05 (smaller = finer glitter, more of it)
//        density    [0, 1], the fraction of cells that hold a glint
//        sharpness  [0.25, 8], 1 = nominal. Higher makes each glint's angular window narrower
//                   (fewer, hotter, more twinkly glints); lower makes a softer, steadier sheen
//        Returns [0, 1]: multiply by the sun's radiance, the Fresnel term and an intensity. Exactly 0
//        for density 0 and wherever the half vector is more than 0.3 + 4 sigma (slope) from the wave
//        normal, i.e. outside the glitter path, which also makes those pixels nearly free.
//        Deterministic for equal inputs
//
// References: GGX: B. Walter et al., "Microfacet Models for Refraction through Rough Surfaces"
// (2007). Visibility: E. Heitz, "Understanding the Masking-Shadowing Function" (2014) with the cheap
// approximation from S. Hammon, "PBR Diffuse Lighting for GGX+Smith Microsurfaces" (GDC 2017).
// Glitter by hashed world-space cells is a common shader-demo technique; spec_sparkle is a cheap
// shortcut, not a glint BRDF (those evaluate a distribution of facet normals per footprint).

#include "fresnel.wgsl"
#include "hash.wgsl"
#include "math.wgsl"

const _SPEC_SPARKLE_SPREAD: f32 = 0.3;
const _SPEC_SPARKLE_SIGMA: f32 = 0.05;

fn spec_ggx_d(n_dot_h: f32, alpha: f32) -> f32 {
  let a2 = alpha * alpha;
  let d = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

// Hammon's approximation of the height-correlated Smith visibility G / (4 n.l n.v).
fn _spec_visibility(n_dot_l: f32, n_dot_v: f32, alpha: f32) -> f32 {
  return 0.5 / max(mix(2.0 * n_dot_l * n_dot_v, n_dot_l + n_dot_v, alpha), 1e-5);
}

// GGX distribution from the sine of the angle (cross product) rather than the cosine: stays
// accurate for very narrow lobes where 1 - cos^2 would cancel in f32.
fn _spec_ggx_d_sin(sin2_h: f32, n_dot_h: f32, alpha: f32) -> f32 {
  let a2 = alpha * alpha;
  let d = sin2_h + a2 * n_dot_h * n_dot_h;
  return a2 / (PI * d * d);
}

fn spec_ggx(n: vec3f, v: vec3f, l: vec3f, alpha: f32) -> f32 {
  let n_dot_l = dot(n, l);
  let n_dot_v = dot(n, v);
  if (n_dot_l <= 0.0 || n_dot_v <= 0.0) {
    return 0.0;
  }
  let h = normalize(v + l);
  let n_dot_h = saturate(dot(n, h));
  let c = cross(n, h);
  let a = max(alpha, 1e-3);
  let d = _spec_ggx_d_sin(dot(c, c), n_dot_h, a);
  let f = fresnel_water(saturate(dot(v, h)));
  return d * _spec_visibility(n_dot_l, n_dot_v, a) * f * n_dot_l;
}

fn spec_sun(n: vec3f, v: vec3f, l: vec3f, roughness: f32, sun_radius: f32) -> f32 {
  let n_dot_l = dot(n, l);
  let n_dot_v = dot(n, v);
  if (n_dot_l <= 0.0 || n_dot_v <= 0.0) {
    return 0.0;
  }
  let alpha = saturate(roughness) * saturate(roughness);
  let rho = 0.5 * sun_radius;
  let alpha_w = sqrt(alpha * alpha + rho * rho);
  let h = normalize(v + l);
  let v_dot_h = saturate(dot(v, h));
  // spec_ggx is per steradian of incoming light. The sun covers pi r^2 of them; a disc of radius
  // r / 2 in half-vector space maps to 4 (v.h) times that area in light-direction space, which
  // cancels the 4 in the BRDF's denominator and leaves v.h. At a perfect mirror alignment
  // (v.h == n.v) the product is exactly the Fresnel reflectance F.
  let solid_angle = PI * sun_radius * sun_radius * v_dot_h;
  return min(spec_ggx(n, v, l, alpha_w) * solid_angle, 1.0);
}

// Sparkle for one cell level. \`slope\` = half-vector slope minus the wave normal's slope.
fn _spec_sparkle_level(p: vec2f, cell: f32, level_seed: u32, slope: vec2f, time: f32, density: f32, sigma: f32) -> f32 {
  let q = p / cell;
  let id = floor(q);
  let f = q - id;
  let ids = vec2i(id);
  let key = vec4u(bitcast<u32>(ids.x), bitcast<u32>(ids.y), level_seed, 0x9e3779b9u);
  let r = to_unorm_4d(pcg_4d(key));
  if (r.x >= density) {
    return 0.0;
  }
  let r2 = to_unorm_4d(pcg_4d(key ^ vec4u(0x85ebca6bu, 0xc2b2ae35u, 0x27d4eb2fu, 1u)));
  let centre = vec2f(0.5) + (r.yz - 0.5) * 0.16;
  let mask = 1.0 - smoothstep(0.22, 0.42, length(f - centre));
  let radius = _SPEC_SPARKLE_SPREAD * sqrt(r2.x);
  let speed = (0.3 + 1.2 * r2.y) * (select(-1.0, 1.0, r2.z > 0.5));
  let angle = TAU * r.w + speed * time;
  let offset = radius * vec2f(cos(angle), sin(angle));
  let d = slope - offset;
  return mask * exp(-dot(d, d) / (sigma * sigma));
}

fn spec_sparkle(
  p: vec2f, n: vec3f, v: vec3f, l: vec3f, time: f32, footprint: f32,
  cell: f32, density: f32, sharpness: f32,
) -> f32 {
  let h = normalize(v + l);
  if (h.y <= 0.05 || n.y <= 0.05 || density <= 0.0) {
    return 0.0;
  }
  let slope = h.xz / h.y - n.xz / n.y;
  let sigma = _SPEC_SPARKLE_SIGMA / clamp(sharpness, 0.25, 8.0);
  // No facet can reach the half vector from this far (spread + 4 sigma, where the Gaussian is
  // 1e-7): skip the hashing. Most of the picture is outside the glitter path, so this is the big
  // saving.
  let reach = _SPEC_SPARKLE_SPREAD + 4.0 * sigma;
  if (dot(slope, slope) > reach * reach) {
    return 0.0;
  }
  let base = max(cell, 1e-3);
  // Cells at least ~3 pixels wide: pick the level from the footprint and blend the two nearest.
  let lod = clamp(log2(max(3.0 * footprint / base, 1.0)), 0.0, 10.0);
  let l0 = floor(lod);
  let blend = lod - l0;
  let a = _spec_sparkle_level(p, base * exp2(l0), u32(l0), slope, time, density, sigma);
  var s = a * (1.0 - blend);
  if (blend > 0.0) {
    s += blend * _spec_sparkle_level(p, base * exp2(l0 + 1.0), u32(l0) + 1u, slope, time, density, sigma);
  }
  return s;
}
`,"./sph-kernels.wgsl":`// sph-kernels.wgsl -- smoothing kernels for smoothed-particle hydrodynamics (story 7.3), in 2D and 3D, with
// their gradients. Used by src/gpu/sim/sph.ts; the position-based-fluids and MPM solvers can reuse them.
//
// CONVENTIONS. \`h\` is the SUPPORT radius: every kernel is exactly 0 for r >= h (Muller, Charypar & Gross 2003
// use the same h; Monaghan's "smoothing length" is h / 2 for a cubic spline). \`r\` is the distance between two
// particles, \`d\` the vector from the other particle to this one (d = x_i - x_j), so a gradient returned for \`d\`
// is the gradient with respect to x_i and points toward SMALLER kernel values, i.e. away from the other particle
// for a decreasing kernel. h must be positive. Every function returns 0 outside the support and is finite for
// any finite r and d.
//
// NORMALISATION. Each W integrates to 1 over its support: in 2D  integral W(|x|) dA = 1, in 3D  integral W dV = 1.
// The 3D constants found in most references are WRONG in 2D: the integral of a radial function carries 2 pi r dr
// in 2D and 4 pi r^2 dr in 3D. The constants below are derived from that and checked by numerical quadrature on
// the GPU in tests/sph.test.ts (the integrals come out within 1e-3 of 1).
//
//   poly6    W = c (h^2 - r^2)^3                       2D c = 4 / (pi h^8)       3D c = 315 / (64 pi h^9)
//            smooth at the centre (zero slope), cheap (no sqrt), used for DENSITY. Its gradient vanishes at
//            r = 0, which is why it is bad for pressure (particles that get close feel almost no push).
//   spiky    W = c (h - r)^3                           2D c = 10 / (pi h^5)      3D c = 15 / (pi h^6)
//            has a cone-shaped tip, so its gradient has full strength at r -> 0: used for the PRESSURE force,
//            where particles must repel harder the closer they get. Gradient magnitude 3 c (h - r)^2.
//   viscosity Laplacian   L(r) = c (h - r)            2D c = 40 / (pi h^5)      3D c = 45 / (pi h^6)
//            positive and falling to 0 at r = h, so a viscosity force built from it only ever smooths velocity.
//            Only the Laplacian is ever evaluated, so the kernel W it belongs to is not needed. Its constant is
//            fixed by the consistency condition of a discrete Laplacian, integral L(r) r^2 / (2 D) dV = 1 (the
//            Laplacian of the field |x|^2 / (2 D) is 1): this is what makes a viscosity of nu m^2/s diffuse
//            velocity at exactly nu, independent of the particle spacing. 3D gives Muller's 45 / (pi h^6); 2D
//            gives 40 / (pi h^5) (D = 2). tests/sph.test.ts checks the condition by quadrature.
//   cohesion  phi(q) = 16 q^2 (1 - q)^2, q = r / h    a dimensionless attractive pair profile for surface
//            tension, 0 at q = 0 and q = 1, peak 1 at q = 1/2 (a particle spacing, when h = 2 s). No
//            normalisation; the solver scales it.
//
// 2D (h support radius, r2 = r * r so no sqrt is needed where none is)
//   sph_poly6_2d(r2, h) -> f32                    W_poly6; 0 for r2 >= h^2
//   sph_poly6_grad_2d(d, h) -> vec2f              gradient w.r.t. x_i of W_poly6(|d|); 0 at |d| >= h
//   sph_spiky_2d(r, h) -> f32                     W_spiky
//   sph_spiky_grad_2d(d, h) -> vec2f              gradient of W_spiky w.r.t. x_i; 0 at d = 0 and |d| >= h
//   sph_viscosity_laplacian_2d(r, h) -> f32       Laplacian of the viscosity kernel
// 3D
//   sph_poly6_3d(r2, h) -> f32                    sph_poly6_grad_3d(d, h) -> vec3f
//   sph_spiky_3d(r, h) -> f32                     sph_spiky_grad_3d(d, h) -> vec3f
//   sph_viscosity_laplacian_3d(r, h) -> f32
// Both
//   sph_cohesion(r, h) -> f32                     phi(r / h), in [0, 1]
//   sph_coincident_direction(i, j) -> vec2f       a unit vector for two particles at the same position: the same
//                                                 for the pair (i, j) and its negation for (j, i), so pair forces
//                                                 stay equal and opposite (momentum is conserved), and different
//                                                 for different pairs, so a stack of particles spreads out.
//
// Cost: a few multiplies each; sph_spiky_grad_* and the viscosity ones are one sqrt-free evaluation if the caller
// already has r. 3D kernels use the same arithmetic.

#include "math.wgsl"
#include "hash.wgsl"

fn sph_poly6_2d(r2: f32, h: f32) -> f32 {
  let h2 = h * h;
  let t = max(h2 - r2, 0.0);
  let k = 4.0 / (PI * h2 * h2 * h2 * h2);
  return k * t * t * t;
}

fn sph_poly6_grad_2d(d: vec2f, h: f32) -> vec2f {
  let h2 = h * h;
  let t = h2 - dot(d, d);
  if (t <= 0.0) {
    return vec2f(0.0);
  }
  return d * (-24.0 / (PI * h2 * h2 * h2 * h2) * t * t);
}

fn sph_spiky_2d(r: f32, h: f32) -> f32 {
  let t = max(h - r, 0.0);
  let h2 = h * h;
  return 10.0 / (PI * h2 * h2 * h) * t * t * t;
}

fn sph_spiky_grad_2d(d: vec2f, h: f32) -> vec2f {
  let r = length(d);
  if (r <= 0.0 || r >= h) {
    return vec2f(0.0);
  }
  let t = h - r;
  let h2 = h * h;
  return d * (-30.0 / (PI * h2 * h2 * h) * t * t / r);
}

fn sph_viscosity_laplacian_2d(r: f32, h: f32) -> f32 {
  let h2 = h * h;
  return 40.0 / (PI * h2 * h2 * h) * max(h - r, 0.0);
}

fn sph_poly6_3d(r2: f32, h: f32) -> f32 {
  let h2 = h * h;
  let t = max(h2 - r2, 0.0);
  let k = 315.0 / (64.0 * PI * h2 * h2 * h2 * h2 * h);
  return k * t * t * t;
}

fn sph_poly6_grad_3d(d: vec3f, h: f32) -> vec3f {
  let h2 = h * h;
  let t = h2 - dot(d, d);
  if (t <= 0.0) {
    return vec3f(0.0);
  }
  return d * (-945.0 / (32.0 * PI * h2 * h2 * h2 * h2 * h) * t * t);
}

fn sph_spiky_3d(r: f32, h: f32) -> f32 {
  let t = max(h - r, 0.0);
  let h3 = h * h * h;
  return 15.0 / (PI * h3 * h3) * t * t * t;
}

fn sph_spiky_grad_3d(d: vec3f, h: f32) -> vec3f {
  let r = length(d);
  if (r <= 0.0 || r >= h) {
    return vec3f(0.0);
  }
  let t = h - r;
  let h3 = h * h * h;
  return d * (-45.0 / (PI * h3 * h3) * t * t / r);
}

fn sph_viscosity_laplacian_3d(r: f32, h: f32) -> f32 {
  let h3 = h * h * h;
  return 45.0 / (PI * h3 * h3) * max(h - r, 0.0);
}

fn sph_cohesion(r: f32, h: f32) -> f32 {
  let q = clamp(r / max(h, 1e-9), 0.0, 1.0);
  let t = q * (1.0 - q);
  return 16.0 * t * t;
}

fn sph_coincident_direction(i: u32, j: u32) -> vec2f {
  let a = min(i, j);
  let b = max(i, j);
  let angle = to_unorm_1d(pcg_1d((a * 73856093u) ^ (b * 19349663u))) * TAU;
  let sign = select(-1.0, 1.0, i < j);
  return vec2f(cos(angle), sin(angle)) * sign;
}
`,"./ssr.wgsl":`// ssr.wgsl -- screen-space reflection ray march against a depth buffer.
//
// struct SsrHit { uv: vec2f, confidence: f32, distance: f32 }
//   uv          where on screen the ray hit (top-left origin); meaningless when confidence is 0
//   confidence  0 = miss (ray left the screen, ran out of distance, or was never in front of the
//               scene); up to 1 = solid hit. Already faded towards the screen edges (10% border)
//               and towards \`max_distance\` (last 40%). Use it as the blend weight against a fallback.
//   distance    world-space distance from the origin to the hit surface (max_distance on a miss)
//
//   ssr_trace(depth_tex, cam, origin, dir, steps, max_distance, thickness, jitter) -> SsrHit
//     depth_tex     the depth buffer the scene was drawn with, bound as texture_depth_2d and read
//                   with textureLoad (no sampler, no filtering). Same camera as \`cam\`, standard
//                   (not reversed) 0..1 depth. Pixels at depth 1.0 are treated as empty sky.
//     cam           the camera that drew depth_tex (camera.wgsl); NOT a mirrored/oblique camera
//     origin, dir   world-space ray start and unit direction (e.g. a water point and reflect(V, N))
//     steps         linear samples along the ray's on-screen path (>= 1); resolution is path length
//                   in pixels / steps, so thin objects can slip between samples at low counts
//     max_distance  world-space length of the ray; the segment is also cut at the near plane
//     thickness     view-space depth (world units) a surface is assumed to have behind its visible
//                   face: a ray that ends up farther behind the surface than this (plus the depth
//                   it travels in one step) passed behind it and keeps going. Larger = fewer
//                   misses and more ghost hits behind thin occluders
//     jitter        0..1 per-pixel offset (e.g. interleaved gradient noise) that shifts the sample
//                   positions by up to 3/4 of a step: trades banding for fine noise. 0 disables it
//   ssr_edge_fade(uv, width) -> f32   1 in the interior, smoothly 0 at the screen edge over \`width\`
//                                     (fraction of the screen); the fade ssr_trace applies
//
// Method: project the ray's start and end into screen space once, then step linearly in screen
// space. 1 / view-z is affine along a projected line, so the ray's depth at every step is one
// reciprocal of a lerp, with no matrix multiply per step. A step whose ray depth has gone behind
// the depth buffer (within thickness) is a hit; it is refined by 5 bisections over the last step.
//
// Cost: setup is two matrix-vector products and four divides. Each step is one textureLoad of a
// 32-bit depth, one lerp, two reciprocals and a handful of compares: roughly 15 ALU + 1 fetch, so
// \`steps\` of 48 is about 750 ALU and 48 fetches per traced pixel. A hit adds 5 more steps.
// The cost is per pixel traced and independent of scene complexity (the opposite of a planar pass).
//
// Known limits: it can only reflect what is on screen and visible from the camera. There is no
// information about the back or underside of a surface, off-screen content, or what an occluder
// hides; rays that leave the screen miss. Reflections of surfaces the ray meets at grazing angles
// are stretched. Thin geometry under the step size is missed. Callers fall back to something else
// (a sky colour, a probe) with weight 1 - confidence.

#include "camera.wgsl"

struct SsrHit {
  uv: vec2f,
  confidence: f32,
  distance: f32,
}

const SSR_REFINE_STEPS: i32 = 5;
const SSR_EDGE_WIDTH: f32 = 0.1;
const SSR_FAR_FADE_START: f32 = 0.6;

fn ssr_edge_fade(uv: vec2f, width: f32) -> f32 {
  let to_edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  return smoothstep(0.0, max(width, 1e-5), to_edge);
}

// View-space depth of the surface at uv; effectively infinite for empty sky so no ray is behind it.
fn _ssr_scene_depth(depth_tex: texture_depth_2d, cam: Camera, uv: vec2f, size: vec2f) -> f32 {
  let texel = vec2i(clamp(uv * size, vec2f(0.0), size - vec2f(1.0)));
  let d = textureLoad(depth_tex, texel, 0);
  return select(camera_linear_depth(cam, d), 1e30, d >= 1.0);
}

fn ssr_trace(
  depth_tex: texture_depth_2d,
  cam: Camera,
  origin: vec3f,
  dir: vec3f,
  steps: u32,
  max_distance: f32,
  thickness: f32,
  jitter: f32,
) -> SsrHit {
  var result: SsrHit;
  result.uv = vec2f(0.0);
  result.confidence = 0.0;
  result.distance = max_distance;

  let size = vec2f(textureDimensions(depth_tex));
  let o = camera_world_to_view(cam, origin);
  let d = (cam.view * vec4f(dir, 0.0)).xyz;

  // Keep the whole segment in front of the near plane (view-space z is negative in front).
  let near_z = -cam.near * 1.001;
  if (o.z > near_z) {
    return result;
  }
  var ray_length = max_distance;
  if (d.z > 1e-5) {
    ray_length = min(ray_length, (near_z - o.z) / d.z);
  }

  let h0 = cam.proj * vec4f(o, 1.0);
  let h1 = cam.proj * vec4f(o + d * ray_length, 1.0);
  let k0 = 1.0 / h0.w;
  let k1 = 1.0 / h1.w;
  let s0 = camera_ndc_to_uv(h0.xy * k0);
  let s1 = camera_ndc_to_uv(h1.xy * k1);

  let count = max(steps, 1u);
  let inv_count = 1.0 / f32(count);
  var previous = 0.0;
  for (var i = 1u; i <= count; i++) {
    let t = (f32(i) - 0.75 * jitter) * inv_count;
    let uv = mix(s0, s1, t);
    if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) {
      break;
    }
    let ray_z = 1.0 / mix(k0, k1, t);
    let scene_z = _ssr_scene_depth(depth_tex, cam, uv, size);
    let step_z = abs(ray_z - 1.0 / mix(k0, k1, previous));
    // In front of the surface, or so far behind it that the ray passed behind: keep marching.
    if (ray_z < scene_z || ray_z - scene_z > thickness + step_z) {
      previous = t;
      continue;
    }

    // Bisect the last step for the crossing.
    var near_t = previous;
    var far_t = t;
    for (var r = 0; r < SSR_REFINE_STEPS; r++) {
      let mid = 0.5 * (near_t + far_t);
      let mid_z = 1.0 / mix(k0, k1, mid);
      if (mid_z < _ssr_scene_depth(depth_tex, cam, mix(s0, s1, mid), size)) {
        near_t = mid;
      } else {
        far_t = mid;
      }
    }
    let hit_uv = mix(s0, s1, far_t);
    let texel = vec2i(clamp(hit_uv * size, vec2f(0.0), size - vec2f(1.0)));
    let hit_world = camera_world_pos(cam, hit_uv, textureLoad(depth_tex, texel, 0));
    let hit_distance = length(hit_world - origin);

    result.uv = hit_uv;
    result.distance = hit_distance;
    result.confidence = ssr_edge_fade(hit_uv, SSR_EDGE_WIDTH)
      * (1.0 - smoothstep(SSR_FAR_FADE_START, 1.0, hit_distance / max_distance));
    return result;
  }
  return result;
}
`,"./sss.wgsl":`// sss.wgsl -- a cheap subsurface-scattering look for wave crests: the glow you see in a wave that
// is lit from behind, when the sun shines through its thin, tall top toward your eye.
//
// Approach: the "fast translucency" model of Barre-Brisebois & Bouchard (GDC 2011): take the
// direction the light travels, bend it by the surface normal, and raise how directly it points at
// the viewer to a power. The bend is outward along the normal, standing in for light leaving the
// water through the front of the wave and being refracted up toward the eye. The result is weighted
// by how crest-like the point is (thin water scatters more) and by how much the surface faces away
// from the light, the height-driven weighting common in open-source ocean shaders. No thickness
// map, no extra samples, no ray work.
//
// Conventions
//  * All vectors are UNIT, world space, pointing AWAY from the surface: \`view\` toward the eye,
//    \`light\` toward the sun, \`normal\` the (wave) normal.
//  * \`crest\` is a 0..1 factor: 0 for flat or low water, 1 for the top of a tall wave. Take it from
//    waterplane_crest(height, strength, scale) or any height/curvature measure you have.
//  * The result is a scatter intensity, not a colour: multiply by the light colour and a scatter
//    colour (a saturated turquoise or green for clean water). It is view dependent, so it replaces
//    nothing: ADD it to the reflected and body colour, and weight by (1 - Fresnel) at the call
//    site, since light scattered out of the water competes with the surface reflection.
//
//   sss_crest(view, light, normal, crest, distortion, power) -> f32
//        distortion  [0, 1] (clamped): how far the surface normal bends the transmitted light outward.
//                    0 sends the light straight on along its path, which only reaches an eye below
//                    the surface; larger values lift it into the view of an eye above the water, as
//                    refraction at the exit face does. Try 0.4 to 0.8. Above 1 a viewer on the sunny
//                    side could see it, so it is clamped
//        power       [1, 16]: concentration of the view cone. Low is a wide soft glow, high is a tight
//                    bloom around the direction of the sun. Try 3 to 6
//        Returns [0, 1]. Exactly 0 when the viewer is on the sunny side of the surface (looking
//        away from the light), when the sun is below the horizon, and never negative
//   sss_crest_color(view, light, normal, crest, scatter_color, light_color, distortion, power) -> vec3f
//        sss_crest(..) x scatter_color x light_color, ready to add to the shaded colour
//
// Cost: ~35 ALU, one normalize, one pow. No textures.

fn sss_crest(
  view: vec3f, light: vec3f, normal: vec3f, crest: f32, distortion: f32, power: f32,
) -> f32 {
  // The light ray as it leaves the wave: the incoming direction -light, bent outward by the normal.
  let leaving = normal * clamp(distortion, 0.0, 1.0) - light;
  let through = dot(view, leaving) / max(length(leaving), 1e-3);
  let forward = pow(saturate(through), max(power, 1.0));
  // Thin, tall water scatters most; keep a little everywhere so a calm surface is not dead.
  let thickness = 0.06 + 0.94 * saturate(crest);
  // Faces turned away from the sun are the thin back side of a wave as seen from the sun's far side.
  let facing_away = 0.35 + 0.65 * saturate(0.5 - 0.5 * dot(normal, light));
  let sun_up = smoothstep(-0.02, 0.1, light.y);
  return forward * thickness * facing_away * sun_up;
}

fn sss_crest_color(
  view: vec3f, light: vec3f, normal: vec3f, crest: f32,
  scatter_color: vec3f, light_color: vec3f, distortion: f32, power: f32,
) -> vec3f {
  return scatter_color * light_color * sss_crest(view, light, normal, crest, distortion, power);
}
`,"./toon.wgsl":`// toon.wgsl -- the building blocks of cel-shaded ("toon") water: hard-edged but anti-aliased steps,
// flat colour bands, outlines, and crisp cell-noise foam lines.
//
// The look comes from refusing smooth gradients: every shape has a clean edge, every colour is flat, and
// the only soft thing is the one pixel at an edge, which exists so the edge does not crawl. That makes
// anti-aliasing the whole game, and these functions all follow one convention:
//
//   \`aa\` is the width, in the units of the function's first argument, of the ramp that replaces a hard
//   edge. Pass the size of ONE PIXEL in those units (for a flat 2D scene it is a constant, \`1 / height_px\`;
//   for a shaded value use fwidth(x) in uniform control flow). aa = 0 gives a hard (aliased) edge.
//   The ramp is linear and exactly one pixel wide, which is what makes the average of the covered samples
//   equal the true covered area: lines keep a steady width as they move and never shimmer.
//
// Steps and bands (all return values in [0, 1])
//   toon_step(edge, x, aa) -> f32
//       anti-aliased step: 0 well below \`edge\`, 1 well above, linear ramp \`aa\` wide centred on the edge,
//       so toon_step(e, x, aa) is 0.5 at x == e. Its average over a pixel footprint equals the covered
//       fraction. monotonic in x.
//   toon_band(t, bands, aa) -> f32
//       quantises t in [0, 1] into \`bands\` (clamped to 1..64) flat levels and returns the level as a value in
//       [0, 1]: exactly k / (bands - 1), k = 0..bands-1, away from the band edges (t = k / bands, with \`aa\`
//       the ramp width in t units). Monotonic. bands = 1 returns 0. t outside [0, 1] clamps to the first or
//       last level. Feed the result to toon_ramp for flat colour bands.
//   toon_posterize(c, bands, aa) -> vec3f      toon_band on each channel of a colour
//   toon_ramp(level, c0, c1, c2, c3) -> vec3f
//       colour for a level in [0, 1]: linear between four stops at 0, 1/3, 2/3, 1. Fed with toon_band the
//       result is flat per band (a band count of 4 lands exactly on the stops; other counts take colours in
//       between, still flat). Stops in linear RGB.
//
// Lines and outlines (distance in any unit, \`aa\` in the same unit)
//   toon_line(d, width, aa) -> f32
//       coverage of a line \`width\` wide whose centre is d = 0, for d a distance (or |d|): 1 at the centre,
//       0 beyond width / 2 + aa / 2. Width 0 gives 0.
//   toon_ring(d, inner, outer, aa) -> f32
//       coverage of the band inner <= d <= outer of a SIGNED distance (sdf.wgsl): an outline hugging a
//       shape (inner 0, outer w), a foam ring, a shore line. 0 when outer <= inner.
//
// Cell foam (Voronoi cell borders, the "ocean network" of cartoon water)
//   toon_foam_cells(p, time, jitter) -> f32
//       F = f2 - f1 of an ANIMATED Voronoi (voronoi.wgsl): 0 on cell borders, growing to roughly 1 at cell
//       centres. p in cell units (one cell = 1.0). \`time\` in radians: the cell seeds orbit, so cells drift
//       and morph instead of sliding. jitter in [0, 1], about 0.8 looks organic.
//   toon_cell_edge(f, f_grad, width_px) -> f32
//       thresholds F into a line that is \`width_px\` pixels wide whatever the zoom: f / f_grad is the
//       distance to the nearest border in pixels, f_grad = the screen-space gradient length of F, i.e.
//       length(vec2f(dpdx(f), dpdy(f))) (call it in uniform control flow). Returns coverage in [0, 1]
//       with a one pixel ramp. width_px <= 0 gives 0.
//
// Glints (hard-edged highlights)
//   toon_sparkle(p, time, density, size, aa) -> f32
//       four-pointed white star glints at random cell positions that blink in and out with a pulse.
//       p in cell units (one cell = 1), density in [0, 1] the share of cells that hold a star, size the
//       star radius in cell units (up to 0.45, clamped), aa in cell units (one pixel). Coverage in [0, 1].
//       A star never leaves its cell, so one cell lookup is enough.
//
// Cost: toon_step / band / line / ring are 3 to 10 ALU; toon_foam_cells is one animated voronoi (about
// 9 hashes, 2 to 3 gnoise); toon_sparkle is two hashes and a few ALU. No textures, no derivatives inside.

#include "hash.wgsl"
#include "voronoi.wgsl"

fn toon_step(edge: f32, x: f32, aa: f32) -> f32 {
  return clamp((x - edge) / max(aa, 1e-6) + 0.5, 0.0, 1.0);
}

fn toon_band(t: f32, bands: f32, aa: f32) -> f32 {
  let n = clamp(floor(bands), 1.0, 64.0);
  let u = clamp(t, 0.0, 1.0) * n;
  let h = 0.5 * aa * n;                 // half width of the ramp, in band units
  let k = floor(u);
  // Level = (k - 1) + ramp across edge k + ramp across edge k + 1: a staircase whose risers are \`aa\` wide.
  let lower = toon_step(k, u, 2.0 * h);
  let upper = toon_step(k + 1.0, u, 2.0 * h);
  let level = clamp(k - 1.0 + lower + upper, 0.0, n - 1.0);
  return select(0.0, level / max(n - 1.0, 1.0), n > 1.0);
}

fn toon_posterize(c: vec3f, bands: f32, aa: f32) -> vec3f {
  return vec3f(toon_band(c.x, bands, aa), toon_band(c.y, bands, aa), toon_band(c.z, bands, aa));
}

fn toon_ramp(level: f32, c0: vec3f, c1: vec3f, c2: vec3f, c3: vec3f) -> vec3f {
  let x = clamp(level, 0.0, 1.0) * 3.0;
  let a = mix(c0, c1, clamp(x, 0.0, 1.0));
  let b = mix(c1, c2, clamp(x - 1.0, 0.0, 1.0));
  let c = mix(c2, c3, clamp(x - 2.0, 0.0, 1.0));
  return select(select(a, b, x >= 1.0), c, x >= 2.0);
}

fn toon_line(d: f32, width: f32, aa: f32) -> f32 {
  return select(0.0, 1.0 - toon_step(0.5 * width, abs(d), aa), width > 0.0);
}

fn toon_ring(d: f32, inner: f32, outer: f32, aa: f32) -> f32 {
  let ring = toon_step(inner, d, aa) - toon_step(outer, d, aa);
  return select(0.0, clamp(ring, 0.0, 1.0), outer > inner);
}

fn toon_foam_cells(p: vec2f, time: f32, jitter: f32) -> f32 {
  let v = voronoi_2d_anim(p, jitter, time);
  return v.f2 - v.f1;
}

fn toon_cell_edge(f: f32, f_grad: f32, width_px: f32) -> f32 {
  let distance_px = f / max(f_grad, 1e-4);
  return select(0.0, clamp(0.5 * width_px - distance_px + 0.5, 0.0, 1.0), width_px > 0.0);
}

fn toon_sparkle(p: vec2f, time: f32, density: f32, size: f32, aa: f32) -> f32 {
  let cell = floor(p);
  let h = hash_2to3(cell);
  let size_c = clamp(size, 0.0, 0.45);
  // Centre inside the cell, leaving room for the star; random pulse period and phase per cell.
  let centre = cell + vec2f(0.5) + (h.xy - vec2f(0.5)) * (1.0 - 2.0 * size_c);
  let period = 0.1 + 0.15 * fract(h.y * 17.17);
  let phase = fract(time * period + h.x * 7.31);
  // Blooms and fades within 70% of its cycle and is dark for the rest; zero at both ends, so no popping.
  let tri = clamp(1.0 - abs(phase * 2.0 - 0.7) / 0.7, 0.0, 1.0);
  let pulse = tri * tri * (3.0 - 2.0 * tri);
  let live = select(0.0, 1.0, h.z < density);
  let q = abs(p - centre);
  // Four-pointed star: points along the axes. |x|^0.5 + |y|^0.5 = r^0.5 is the astroid; its inside is the star.
  let r = size_c * pulse;
  let d = sqrt(q.x) + sqrt(q.y) - sqrt(max(r, 1e-6));
  // d is not a distance; convert the pixel ramp with the local slope of the astroid (about 1 / sqrt(r)).
  let aa_d = aa * 0.5 / sqrt(max(r, 1e-3));
  let inside = 1.0 - toon_step(0.0, d, aa_d);
  return select(0.0, live * clamp(inside, 0.0, 1.0), r > 1e-5);
}
`,"./volume.wgsl":`// volume.wgsl -- helpers for ray-marching a participating medium (ink, smoke, fog) inside a box: the ray-box
// intersection, per-pixel jitter, the transmittance/in-scatter accumulation of one step, a phase function.
//
// CONVENTIONS. World space, +Y up (camera.wgsl). A medium fills an axis-aligned box [box_min, box_max]; a ray is
// \`origin + t * dir\` with \`dir\` a UNIT vector (so t is a distance). Extinction \`sigma_t\` is per unit of world
// length and per channel (coloured absorption makes ink read as ink rather than smoke), radiance is LINEAR rgb.
// The march is front to back: \`VolumeAccum\` holds the radiance gathered so far and the transmittance still left.
//
// Box
//   volume_ray_box(origin, dir, box_min, box_max) -> vec2f
//       (t_near, t_far) where the ray enters and leaves the box, t_near clamped to >= 0 (a camera inside the box
//       starts at 0). The ray misses when t_far <= t_near: use volume_hit. Rays parallel to a pair of faces are
//       handled (they hit only if they are between them). Cost: 6 divides, a few min/max.
//   volume_hit(span: vec2f) -> bool                 true when volume_ray_box found a segment of positive length
//   volume_to_uvw(p, box_min, box_max) -> vec3f     world position -> 0..1 texture coordinate inside the box
//
// Stepping
//   volume_jitter(pixel: vec2f, frame: u32) -> f32  [0, 1) interleaved gradient noise of the pixel position
//       (Jimenez 2014); with \`frame\` = 0 it is a fixed pattern, with a frame counter it moves every frame. Start the
//       march at t_near + jitter * step and the banding of a fixed step count turns into fine noise.
//
// Accumulation (one step of length \`ds\`)
//   struct VolumeAccum { radiance: vec3f, transmittance: vec3f }
//   volume_start() -> VolumeAccum                   no radiance, full transmittance
//   volume_accumulate(acc, sigma_t, in_scatter, ds) -> VolumeAccum
//       \`in_scatter\` is the radiance the medium sends toward the eye per unit length (scattering coefficient times
//       the light that reaches it times the phase function; or an emission). The step adds the analytic integral over
//       the step, T * in_scatter * (1 - exp(-sigma_t ds)) / sigma_t, and multiplies T by exp(-sigma_t ds). That
//       is exact for a constant medium over the step, so a few big steps do not brighten or darken it (a plain
//       in_scatter * ds sum would). sigma_t -> 0 gives T * in_scatter * ds.
//   volume_opaque(acc, threshold) -> bool           true when the largest channel of the transmittance is below
//       \`threshold\`: stop marching (early exit)
//   volume_slab_transmittance(sigma_t, thickness) -> vec3f     exp(-sigma_t * thickness): what a uniform slab leaves
//
// Phase
//   volume_phase_hg(cos_theta, g) -> f32            Henyey-Greenstein phase function, normalised over the sphere
//       (integrates to 1); g in (-1, 1): 0 isotropic, > 0 forward scattering. cos_theta is the cosine of the
//       angle between the direction the light travels and the direction toward the eye.
//
// Cost: the accumulate is 3 exp and a few divides per step; the jitter is one fract and two multiplies.
// Credits: slab method (Kay & Kajiya 1986); interleaved gradient noise from J. Jimenez, "Next Generation Post
// Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014); Henyey & Greenstein 1941.

const _VOLUME_EPS: f32 = 1e-8;

struct VolumeAccum {
  radiance: vec3f,
  transmittance: vec3f,
}

fn volume_ray_box(origin: vec3f, dir: vec3f, box_min: vec3f, box_max: vec3f) -> vec2f {
  // A direction component of ~0 would divide by zero; give it a huge reciprocal of the right sign instead,
  // which sends that slab's distances to +-1e30 (or, outside the slab, makes the segment empty).
  let safe = select(dir, vec3f(_VOLUME_EPS), abs(dir) < vec3f(_VOLUME_EPS));
  let inv = 1.0 / safe;
  let t0 = (box_min - origin) * inv;
  let t1 = (box_max - origin) * inv;
  let near = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), max(min(t0.z, t1.z), 0.0));
  let far = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return vec2f(near, far);
}

fn volume_hit(span: vec2f) -> bool {
  return span.y > span.x;
}

fn volume_to_uvw(p: vec3f, box_min: vec3f, box_max: vec3f) -> vec3f {
  return (p - box_min) / (box_max - box_min);
}

fn volume_jitter(pixel: vec2f, frame: u32) -> f32 {
  // The frame shifts the pattern along its own diagonal (5.588238 px per frame), the usual way to animate it.
  let p = pixel + 5.588238 * f32(frame % 64u);
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn volume_start() -> VolumeAccum {
  return VolumeAccum(vec3f(0.0), vec3f(1.0));
}

fn volume_accumulate(acc: VolumeAccum, sigma_t: vec3f, in_scatter: vec3f, ds: f32) -> VolumeAccum {
  let tau = max(sigma_t, vec3f(0.0)) * max(ds, 0.0);
  let step_t = exp(-tau);
  // (1 - exp(-tau)) / sigma_t, with its limit ds as sigma_t -> 0.
  let ratio = select((vec3f(1.0) - step_t) / max(sigma_t, vec3f(1e-12)), vec3f(ds), tau < vec3f(1e-5));
  var out: VolumeAccum;
  out.radiance = acc.radiance + acc.transmittance * in_scatter * ratio;
  out.transmittance = acc.transmittance * step_t;
  return out;
}

fn volume_opaque(acc: VolumeAccum, threshold: f32) -> bool {
  return max(acc.transmittance.x, max(acc.transmittance.y, acc.transmittance.z)) < threshold;
}

fn volume_slab_transmittance(sigma_t: vec3f, thickness: f32) -> vec3f {
  return exp(-max(sigma_t, vec3f(0.0)) * max(thickness, 0.0));
}

fn volume_phase_hg(cos_theta: f32, g: f32) -> f32 {
  let gg = clamp(g, -0.999, 0.999);
  let denom = 1.0 + gg * gg - 2.0 * gg * cos_theta;
  return (1.0 - gg * gg) / (12.566370614 * pow(max(denom, 1e-6), 1.5));
}
`,"./voronoi.wgsl":`// voronoi.wgsl -- 2D cellular (Worley) noise: distances to the nearest feature points.
//
//   struct Voronoi2D {
//     f1: f32,      distance to the nearest feature point (exact), in cell units
//     f2: f32,      distance to the second nearest. f2 - f1 >= 0 is 0 on cell borders: use it as a
//                   cheap edge mask for foam lines / cracks (smoothstep(0.0, w, f2 - f1)). Its
//                   width varies a little with cell shape; it is not a true border distance.
//     id: f32,      random value in [0, 1) that is constant per cell (colour / height / phase per cell)
//     cell: vec2i,  lattice cell that owns the nearest point (wrapped into [0, period) by _tile forms)
//     site: vec2f,  position of the nearest feature point in p's own coordinates; p - site points
//                   from the cell's seed to the sample (radial shading, per-cell uv)
//   }
//
//   voronoi_2d(p, jitter) -> Voronoi2D                       static points
//   voronoi_2d_anim(p, jitter, time) -> Voronoi2D            points orbit inside their cells: no popping,
//                                                            flows like water. \`time\` in radians (one orbit
//                                                            per 2 pi); the orbit is +-0.4 * jitter wide
//   voronoi_2d_tile(p, jitter, period: vec2i) -> Voronoi2D   repeats every \`period\` cells per axis (>= 1)
//   voronoi_2d_tile_anim(p, jitter, time, period: vec2i) -> Voronoi2D   both
//
// \`p\` is in lattice units (one feature point per unit cell). \`jitter\` in [0, 1] (clamped): 0 is a regular
// grid of seeds at cell centres, 1 is fully random inside each cell.
//
// Accuracy: the search covers the 3x3 cells around p. For jitter <= 0.65 f1 and f2 are exact everywhere
// (provable); in practice f1 stays exact up to jitter 1 and f2 up to ~0.8. At jitter 1 f2 can be too large
// in a vanishing fraction of points (~1e-4 of the area), always deep inside a cell and far from any border,
// so f2 - f1 masks along borders are unaffected. The animated forms orbit +-0.4 (not +-0.5) per unit jitter
// for the same reason.
// Cost: 9 hashes + 9 distance tests; about 2-3x a gnoise_2d. Cells are random per cell, deterministic.
//
// Technique: S. Worley, "A Cellular Texture Basis Function" (1996), 3x3 neighbour search as in
// Gustavson's and Quilez's implementations.

#include "hash.wgsl"
#include "math.wgsl"

struct Voronoi2D {
  f1: f32,
  f2: f32,
  id: f32,
  cell: vec2i,
  site: vec2f,
}

// x, y: jitter of the feature point inside its cell, z: the cell's id.
fn _voronoi_hash(c: vec2i) -> vec3f {
  return to_unorm_3d(pcg_3d(vec3u(bitcast<vec2u>(c), 0u)));
}

fn _voronoi_2d(
  p: vec2f,
  jitter: f32,
  time: f32,
  animate: bool,
  period: vec2i,
  tiled: bool,
) -> Voronoi2D {
  let j = clamp(jitter, 0.0, 1.0);
  let n = max(period, vec2i(1));
  let base = vec2i(floor(p));
  let hash_base = select(base, wrap_2d(base, n), tiled);
  var d1 = 1e9;
  var d2 = 1e9;
  var best = Voronoi2D(0.0, 0.0, 0.0, vec2i(0), vec2f(0.0));
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2i(x, y);
      // The cell whose hash we use. Wrapping once up front means a compare per cell, not a modulo.
      var w = hash_base + offset;
      if (tiled) {
        w += select(vec2i(0), n, w < vec2i(0)) - select(vec2i(0), n, w >= n);
      }
      let h = _voronoi_hash(w);
      var shift = j * (h.xy - 0.5);
      if (animate) {
        shift = 0.4 * j * sin(time + TAU * h.xy);
      }
      // The feature point is placed around the UNWRAPPED cell so distances stay local.
      let site = vec2f(base + offset) + 0.5 + shift;
      let d = site - p;
      let dd = dot(d, d);
      if (dd < d1) {
        d2 = d1;
        d1 = dd;
        best.id = h.z;
        best.cell = w;
        best.site = site;
      } else if (dd < d2) {
        d2 = dd;
      }
    }
  }
  best.f1 = sqrt(d1);
  best.f2 = sqrt(d2);
  return best;
}

fn voronoi_2d(p: vec2f, jitter: f32) -> Voronoi2D {
  return _voronoi_2d(p, jitter, 0.0, false, vec2i(1), false);
}

fn voronoi_2d_anim(p: vec2f, jitter: f32, time: f32) -> Voronoi2D {
  return _voronoi_2d(p, jitter, time, true, vec2i(1), false);
}

fn voronoi_2d_tile(p: vec2f, jitter: f32, period: vec2i) -> Voronoi2D {
  return _voronoi_2d(p, jitter, 0.0, false, period, true);
}

fn voronoi_2d_tile_anim(p: vec2f, jitter: f32, time: f32, period: vec2i) -> Voronoi2D {
  return _voronoi_2d(p, jitter, time, true, period, true);
}
`,"./wash.wgsl":`// wash.wgsl -- watercolour and ink-wash building blocks: a cheap low-frequency pigment field, bicubic
// upsampling of it, soft blooms with pooled (darker) edges, granulation, and a tileable paper texture.
//
// The idea: pigment in water has soft, wandering blooms whose EDGES are crisp and darker (pigment is
// carried to the edge as the bloom dries), over a paper whose grain shows through. All of that is a
// threshold of a smooth field plus a texture, so the expensive part (the field) is low-frequency and
// can be rendered at a fraction of the output resolution, then reconstructed smoothly:
//
//   field pass (small target)   wash_field(p, time, warp)            -> vec3f  (bloom, tone, detail)
//   compose pass (full size)    wash_sample_bspline(tex, samp, uv)   -> the field, C2-smooth
//                               wash_body / wash_pool                -> bloom coverage, pooled edge
//                               wash_granulate(density, grain, k)    -> grain shows where pigment is
//   once, at creation           wash_paper_tile(uv)                  -> vec2f (grain, fibre) to bake
//
// Functions
//   wash_field(p: vec2f, time: f32, warp: f32) -> vec3f
//       Three smooth fields at one point, each in about [-0.9, 0.9]: x = bloom shape (domain-warped
//       3D fbm, 3 octaves; its level sets are the bloom outlines), y = tone (one slow noise at a coarser
//       scale: pick between two pigments), z = detail (finer noise at 2.2x the frequency: roughens an
//       outline). \`p\` is in feature units (about one blob per unit); \`time\` in seconds-ish (the field
//       evolves by one feature in about 8 units of time); \`warp\` in [0, 1.5] is how far the domain is
//       bent (0 = plain fbm blobs, 1 = swirled tendrils). Nine 3D gradient-noise evaluations in total.
//   wash_sample_bspline(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f
//       The texture reconstructed with a cubic B-spline (C2: no kinks at texel borders even when the
//       texture is 4x smaller than the output), using four hardware-bilinear taps instead of sixteen.
//       \`samp\` must be a linear, clamp-to-edge sampler. The result is slightly smoother than the
//       texels (B-spline smoothing), which is what you want for a low-frequency field.
//   wash_body(inside_px: f32, softness_px: f32) -> f32
//       Bloom coverage in [0, 1] from the signed distance in pixels to the bloom outline, positive
//       inside: a ramp \`softness_px\` wide on each side. Get inside_px = (field - level) / fwidth(field),
//       which is the distance in pixels to the field's level set to first order.
//   wash_pool(inside_px: f32, width_px: f32, softness_px: f32) -> f32
//       The darker rim where pigment gathers, in [0, 1]: 1 just inside the outline, falling to 0 by
//       \`width_px\` inside it, and 0 outside. Add to the pigment density, scaled by an edge strength.
//   wash_granulate(density: f32, grain: f32, strength: f32) -> f32
//       Pigment settles into the paper's valleys: density modulated by the grain (\`grain\` in [0, 1],
//       0.5 neutral), more where there is more pigment. strength 0 returns \`density\` unchanged.
//   wash_paper_tile(uv: vec2f) -> vec2f
//       Paper at one point of a tile, for baking once into a texture that is repeated: x = grain height
//       in [0, 1] (mean 0.5), y = fibre in [0, 1] (mostly 0; thin curved streaks). Seamless: the value
//       at uv and uv + 1 are equal, on both axes. Sample the baked texture with a repeating sampler.
//
// Cost: wash_field about 9 gnoise_3d (run it at 1/16 of the pixels); wash_sample_bspline 4 filtered
// fetches; body, pool and granulate a few ALU each; wash_paper_tile 5 tiled gnoise_2d (bake it once).
// Credits: cubic B-spline with bilinear taps from C. Sigg and M. Hadwiger, "Fast Third-Order Texture
// Filtering" (GPU Gems 2, ch. 20); domain warping from I. Quilez; the pooled-edge model follows the
// "edge darkening" of Curtis et al., "Computer-Generated Watercolor" (SIGGRAPH 1997), simplified to a
// rim at the level set of a smooth field.

#include "noise.wgsl"
#include "fbm.wgsl"

fn wash_field(p: vec2f, time: f32, warp: f32) -> vec3f {
  let q = domain_warp_2d_anim(p * 0.8, time * 0.35, warp * 0.9, 2, 2.0, 0.5);
  let bloom = fbm_3d(vec3f(q * 1.1, time * 0.22), 3, 2.0, 0.5) * 1.5;
  let tone = gnoise_3d(vec3f(q * 0.45 + vec2f(11.0, 3.0), time * 0.15)) * 1.4;
  let detail = gnoise_3d(vec3f(q * 2.4 + vec2f(5.0, 17.0), time * 0.3));
  return vec3f(bloom, tone, detail);
}

fn wash_sample_bspline(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f {
  let size = vec2f(textureDimensions(tex, 0));
  let coord = uv * size - 0.5;
  let base = floor(coord);
  let f = coord - base;
  let f2 = f * f;
  let f3 = f2 * f;
  let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1;
  let g1 = w2 + w3;
  // Each pair of neighbouring texels becomes one bilinear tap placed so the hardware weights match.
  let p0 = (base - 1.0 + w1 / g0 + 0.5) / size;
  let p1 = (base + 1.0 + w3 / g1 + 0.5) / size;
  let t00 = textureSampleLevel(tex, samp, vec2f(p0.x, p0.y), 0.0);
  let t10 = textureSampleLevel(tex, samp, vec2f(p1.x, p0.y), 0.0);
  let t01 = textureSampleLevel(tex, samp, vec2f(p0.x, p1.y), 0.0);
  let t11 = textureSampleLevel(tex, samp, vec2f(p1.x, p1.y), 0.0);
  return g0.y * (g0.x * t00 + g1.x * t10) + g1.y * (g0.x * t01 + g1.x * t11);
}

fn wash_body(inside_px: f32, softness_px: f32) -> f32 {
  return smoothstep(-softness_px, softness_px, inside_px);
}

fn wash_pool(inside_px: f32, width_px: f32, softness_px: f32) -> f32 {
  let rise = smoothstep(-softness_px, softness_px, inside_px);
  let fall = 1.0 - smoothstep(0.0, max(width_px, 1e-3), inside_px - softness_px);
  return rise * fall;
}

fn wash_granulate(density: f32, grain: f32, strength: f32) -> f32 {
  let valley = 0.5 - grain;
  return max(density * (1.0 + strength * 1.6 * valley * (0.35 + density)), 0.0);
}

fn wash_paper_tile(uv: vec2f) -> vec2f {
  // Grain: two scales of tiled gradient noise, a texel or two across.
  let g1 = gnoise_2d_tile(uv * 128.0 + vec2f(17.0, 3.0), vec2i(128, 128));
  let g2 = gnoise_2d_tile(uv * 48.0 + vec2f(5.0, 29.0), vec2i(48, 48));
  let grain = clamp(0.5 + 0.55 * (0.62 * g1 + 0.38 * g2), 0.0, 1.0);

  // Fibres: noise stretched 8x along one axis, thinned to the lines where it crosses zero; one set
  // runs along each axis, and a slow patchiness makes them clump the way real paper does.
  let along_y = gnoise_2d_tile(vec2f(uv.x * 40.0, uv.y * 5.0) + vec2f(2.0, 1.0), vec2i(40, 5));
  let along_x = gnoise_2d_tile(vec2f(uv.x * 5.0, uv.y * 40.0) + vec2f(3.0, 7.0), vec2i(5, 40));
  let thin_y = pow(1.0 - min(abs(along_y) * 2.2, 1.0), 12.0);
  let thin_x = pow(1.0 - min(abs(along_x) * 2.2, 1.0), 12.0);
  let clump = clamp(0.5 + 0.9 * gnoise_2d_tile(uv * 6.0 + vec2f(1.0, 4.0), vec2i(6, 6)), 0.0, 1.0);
  let fibre = clamp(max(thin_y, thin_x * 0.8) * clump, 0.0, 1.0);
  return vec2f(grain, fibre);
}
`,"./waterplane.wgsl":`// waterplane.wgsl -- a small open-water test scene: camera rays, a cheap animated wave surface with
// analytic normals, and a distance fade so the surface does not alias into sparkle near the horizon.
// Built for the optics demos (fresnel-sky, sun-glint, crest-sss); a later ocean effect may reuse it.
// Pure functions, no bindings: the caller owns the uniforms.
//
// World: y is up, the water is the plane y = 0 displaced by the waves, the camera sits at
// (x, height, z) and looks along +z when pitch and yaw are zero. Units are metres and seconds.
//
// Camera
//   waterplane_ray_dir(uv, aspect, pitch, fov_y) -> vec3f
//        unit view ray for a pixel. \`uv\` has its origin at the TOP-LEFT (fullscreen.wgsl), aspect is
//        width / height, \`pitch\` is radians (positive looks up, negative looks down at the water),
//        \`fov_y\` is the vertical field of view in radians
//   waterplane_sun_dir(elevation, azimuth) -> vec3f
//        unit direction toward the sun from angles in radians. Azimuth 0 is straight ahead of the
//        camera (+z), positive turns toward +x (right). Elevation 0 is the horizon
//
// Intersection
//   waterplane_hit(origin, dir) -> f32
//        distance along the ray to the flat plane y = 0, or -1.0 when the ray points at or above the
//        horizon (dir.y >= 0) or starts below the plane. Use \`t < 0.0\` as the sky test
//   waterplane_footprint(t, dir_y, pixel_angle) -> f32
//        approximate size in metres of one pixel on the water at distance t: t * pixel_angle / |dir_y|.
//        pixel_angle = 2 * tan(fov_y / 2) / height_in_pixels. Grows without bound towards the horizon
//   waterplane_hit_waves(origin, dir, t_plane, time, strength, scale, footprint) -> f32
//        refines the flat-plane distance against the large waves (one fixed-point step with the
//        swell only); returns t_plane when the plane is missed. Cheap and good enough for
//        placing texture/noise lookups on the displaced surface, not an exact ray-surface hit
//
// Waves. Five directional swells shaped like exp(sin(x) - 1) (sharp crests, broad troughs; the sum
// is zero-mean) plus two octaves of gradient-noise ripples that drift across the surface. All
// animated, all with analytic derivatives, no loops and no textures.
//   strength   steepness multiplier, 0 (dead flat) to about 3; 1 is a lively sea (slopes up to ~0.3)
//   scale      wavelength multiplier: 1 gives 25 m down to 1.5 m swells, 2 doubles every wavelength
//   footprint  pixel size on the water in metres (waterplane_footprint). Each wave fades out
//              smoothly as its wavelength drops from 8 pixels to 2.5 pixels, so distant water loses
//              its small waves instead of aliasing. Pass 0.0 for the full unfiltered surface
//   waterplane_wave(p, time, strength, scale, footprint) -> vec3f
//        p is the world xz position. Returns (height, d height / dx, d height / dz), the
//        gradient is analytic and exact
//   waterplane_height(p, time, strength, scale, footprint) -> f32       the height alone
//   waterplane_normal(gradient: vec2f) -> vec3f
//        unit normal (-gx, 1, -gz) / length from the .yz of waterplane_wave
//   waterplane_amplitude(strength, scale) -> f32
//        an upper bound on the swell height in metres (reached only when all five waves line up)
//   waterplane_crest(height, strength, scale) -> f32
//        height as a 0..1 "how crest-like" factor: 0 at and below 8% of waterplane_amplitude (just
//        above the mean level), 1 from 40% of it up. The swell's standard deviation is about a third
//        of the amplitude, so roughly one point in five reads as crest. The input for sss.wgsl
//
// Reflection
//   waterplane_reflect(dir, normal) -> vec3f
//        mirror of the view ray \`dir\` about the normal, with any downward result folded upward
//        (y -> |y|). A steep wave normal can reflect the ray into the water; the fold makes it sample
//        the sky just above the horizon instead
//
// Cost: waterplane_wave ~ 5 x (sin, cos, exp) + two gnoise_2d_d (8 hashes), about 100 ALU. A wave or
// ripple that has faded out at distance is skipped, so far water is cheaper. waterplane_height costs
// the same (the derivative maths is cheap). Camera ray: 1 normalize, 2 sincos.
//
// Wave shape: exp(sin(x) - 1) is a widely used cheap peaked-crest profile; each wave travels at the
// deep-water gravity speed omega = sqrt(g k). Not a physical spectrum: five hand-picked directions
// and wavelengths, which repeat visibly over a very long view, and a plausible look is the goal.

#include "math.wgsl"
#include "noise.wgsl"

const WATERPLANE_GRAVITY: f32 = 9.81;
// Mean of exp(sin(x) - 1) over a period: I0(1) / e. Subtracted so each wave has zero mean.
const _WATERPLANE_PROFILE_MEAN: f32 = 0.4658;

fn waterplane_ray_dir(uv: vec2f, aspect: f32, pitch: f32, fov_y: f32) -> vec3f {
  let tan_half = tan(0.5 * fov_y);
  let ndc = vec2f((2.0 * uv.x - 1.0) * aspect, 1.0 - 2.0 * uv.y);
  let local = normalize(vec3f(ndc * tan_half, 1.0));
  let c = cos(pitch);
  let s = sin(pitch);
  return vec3f(local.x, local.y * c + local.z * s, local.z * c - local.y * s);
}

fn waterplane_sun_dir(elevation: f32, azimuth: f32) -> vec3f {
  let c = cos(elevation);
  return vec3f(sin(azimuth) * c, sin(elevation), cos(azimuth) * c);
}

fn waterplane_hit(origin: vec3f, dir: vec3f) -> f32 {
  if (dir.y >= 0.0 || origin.y <= 0.0) {
    return -1.0;
  }
  return -origin.y / dir.y;
}

fn waterplane_footprint(t: f32, dir_y: f32, pixel_angle: f32) -> f32 {
  return t * pixel_angle / max(abs(dir_y), 1e-4);
}

// One swell. Returns (height, d/dx, d/dz). \`angle\` is the travel direction (0 = toward -z, so the
// waves roll toward a camera that looks along +z), \`steep\` the relative steepness, \`phase0\` a fixed
// offset that decorrelates the five waves at the origin, \`rscale\` = inverseSqrt(scale). The speed
// sqrt(g k) has a constant part that the compiler folds, because \`wavelength\` is a literal.
fn _waterplane_swell_wave(
  p: vec2f, time: f32, angle: f32, wavelength: f32, steep: f32, phase0: f32,
  strength: f32, scale: f32, rscale: f32, footprint: f32,
) -> vec3f {
  let lambda = wavelength * scale;
  let fade = smoothstep(2.5, 8.0, lambda / max(footprint, 1e-6));
  if (fade <= 0.0) {
    return vec3f(0.0);
  }
  let k = TAU / lambda;
  let dir = vec2f(sin(angle), -cos(angle));
  let omega = sqrt(WATERPLANE_GRAVITY * TAU / wavelength) * rscale;
  let phase = k * dot(dir, p) - omega * time + phase0;
  let amp = 0.03 * lambda * steep * strength * fade;
  let e = exp(sin(phase) - 1.0);
  let slope = amp * k * e * cos(phase);
  return vec3f(amp * (e - _WATERPLANE_PROFILE_MEAN), slope * dir.x, slope * dir.y);
}

fn _waterplane_swell(p: vec2f, time: f32, strength: f32, scale: f32, footprint: f32) -> vec3f {
  let r = inverseSqrt(scale);
  return _waterplane_swell_wave(p, time, 0.00, 25.0, 1.00, 0.0, strength, scale, r, footprint) +
    _waterplane_swell_wave(p, time, 0.50, 14.0, 0.90, 1.7, strength, scale, r, footprint) +
    _waterplane_swell_wave(p, time, -0.65, 8.3, 0.80, 3.1, strength, scale, r, footprint) +
    _waterplane_swell_wave(p, time, 1.05, 4.6, 0.70, 4.4, strength, scale, r, footprint) +
    _waterplane_swell_wave(p, time, -1.30, 2.5, 0.55, 0.9, strength, scale, r, footprint);
}

// One ripple octave: 2D gradient noise scrolled across the surface by \`drift\` (metres per second),
// the cheap way to animate small ripples. \`frequency\` is in cells per metre.
fn _waterplane_ripple(
  p: vec2f, time: f32, frequency: f32, amp: f32, drift: vec2f, strength: f32, footprint: f32,
) -> vec3f {
  let fade = smoothstep(2.5, 8.0, (1.0 / frequency) / max(footprint, 1e-6));
  let a = amp * min(strength, 1.5) * fade;
  if (a <= 0.0) {
    return vec3f(0.0);
  }
  let n = gnoise_2d_d((p - drift * time) * frequency);
  return vec3f(a * n.x, a * frequency * n.y, a * frequency * n.z);
}

fn waterplane_wave(p: vec2f, time: f32, strength: f32, scale: f32, footprint: f32) -> vec3f {
  let f = 1.0 / scale;
  return _waterplane_swell(p, time, strength, scale, footprint) +
    _waterplane_ripple(p, time, 2.6 * f, 0.014 * scale, vec2f(0.35, -0.5) * scale, strength, footprint) +
    _waterplane_ripple(p + vec2f(31.7, -12.3), time, 6.1 * f, 0.005 * scale, vec2f(-0.6, -0.3) * scale, strength, footprint);
}

fn waterplane_height(p: vec2f, time: f32, strength: f32, scale: f32, footprint: f32) -> f32 {
  return waterplane_wave(p, time, strength, scale, footprint).x;
}

fn waterplane_normal(gradient: vec2f) -> vec3f {
  return normalize(vec3f(-gradient.x, 1.0, -gradient.y));
}

fn waterplane_hit_waves(
  origin: vec3f, dir: vec3f, t_plane: f32, time: f32, strength: f32, scale: f32, footprint: f32,
) -> f32 {
  if (t_plane < 0.0) {
    return t_plane;
  }
  let p = origin + dir * t_plane;
  let h = _waterplane_swell(p.xz, time, strength, scale, footprint).x;
  // The surface is at y = h; the ray reaches that height at t = (h - origin.y) / dir.y.
  return clamp((h - origin.y) / dir.y, 0.5 * t_plane, 2.0 * t_plane);
}

fn waterplane_amplitude(strength: f32, scale: f32) -> f32 {
  // Sum of 0.03 * wavelength * steepness over the five waves, times the largest deviation from the mean.
  return 0.03 * (25.0 + 12.6 + 6.64 + 3.22 + 1.375) * 0.5342 * strength * scale;
}

fn waterplane_crest(height: f32, strength: f32, scale: f32) -> f32 {
  let amplitude = max(waterplane_amplitude(strength, scale), 1e-4);
  return smoothstep(0.08, 0.4, height / amplitude);
}

fn waterplane_reflect(dir: vec3f, normal: vec3f) -> vec3f {
  var r = reflect(dir, normal);
  r.y = abs(r.y);
  return r;
}
`,"./waveline.wgsl":`// waveline.wgsl -- a wavy line as a signed-distance field: section dividers, footers, wave layers.
//
// A "wave line" is the graph y = line_y(x) of a few summed sines plus a little noise, so it never
// repeats exactly or reads as a pure sine. Everything is measured in ONE length unit chosen by the
// caller (CSS pixels is the natural one), and y grows DOWNWARD like uv.y. The filled side is below the
// line (larger y). The distance is signed like sdf.wgsl: negative inside the fill, positive above it.
//
//   waveline_curve(x, phase, wavelength, amplitude, roughness, seed) -> vec2f
//       (y, dy/dx) of the curve relative to its own mean line (add the baseline yourself). Three sines
//       at 1x, 1.93x and 0.57x the base frequency (weights 0.58, 0.27, 0.15) plus gradient noise with
//       weight \`roughness\` in [0, 1]. \`phase\` in radians moves the whole pattern toward -x as it grows
//       (the pattern is f(x + phase * wavelength / TAU), each harmonic at its own speed, so the line
//       evolves instead of sliding rigidly). \`seed\` decorrelates layers: use a different value per
//       layer (any float; a few units apart). |y| <= 1.6 * amplitude in the worst case, usually < amplitude.
//   waveline_distance(y, line_y, slope) -> f32
//       signed distance from the point (x, y) to the curve, from the vertical gap and the slope:
//       (line_y - y) / sqrt(1 + slope^2). Negative below the line. It is a first-order distance (the
//       true distance is a little larger away from the line), exact to first order at the line, with
//       unit gradient there: moving one pixel across the line changes it by one pixel. Pass
//       line_y = baseline + curve.x and slope = curve.y.
//   waveline_coverage(d, px) -> f32
//       anti-aliased fill from a distance: 1 below the line, 0 above, a ramp \`px\` wide centred on the
//       line. Because the distance has unit gradient, \`px\` is simply the size of one pixel in the
//       distance's units (1 / dpr for CSS pixels): no derivative instructions are needed, so the caller
//       may branch freely, and edges are exactly one pixel wide at any DPR without MSAA.
//   waveline_band(d, centre, half_width, px) -> f32
//       anti-aliased coverage of the strip |d - centre| <= half_width: a thin highlight or outline
//       that follows the curve. centre = -half_width puts the strip just inside the fill.
//   waveline_foam(depth, p, time, width, amount, edge) -> f32
//       foam along a line, in [0, 1]: round bubbles that merge into a solid band right at depth 0 and
//       thin out to nothing by \`depth\` = \`width\`. \`depth\` = distance from the foam's start edge (same
//       units as \`width\`; use -d plus a margin to let it reach past the line), \`p\` the texture
//       coordinate in feature units (one bubble cell is 1.0: pixels / 9 reads as fine foam), \`time\` in
//       radians (the bubbles boil), \`amount\` in [0, 1] the coverage, \`edge\` the softness of a bubble's
//       rim in feature units (one pixel = 1 / cell size in pixels). Costs one Voronoi and one gradient
//       noise; call it only for pixels with depth < width.
//
// Cost: curve = 3 sin + 3 cos + 1 gnoise_2d_d (about 40 ALU); distance and coverage a few ops.
// Technique: a sum of sines (the simplest Gerstner-less wave), a height-field distance estimate
// d = f / |grad f| (I. Quilez, "distance to implicit functions"), analytic-gradient anti-aliasing.

#include "math.wgsl"
#include "noise.wgsl"
#include "sdf.wgsl"
#include "foam.wgsl"
#include "voronoi.wgsl"

fn waveline_curve(
  x: f32, phase: f32, wavelength: f32, amplitude: f32, roughness: f32, seed: f32,
) -> vec2f {
  let k = TAU / max(wavelength, 1e-3);
  let a1 = k * x + phase;
  let a2 = k * 1.93 * x + phase * 1.31 + 1.7 + seed * 2.3;
  let a3 = k * 0.57 * x - phase * 0.73 + 4.1 + seed * 5.1;
  let sines = 0.58 * sin(a1) + 0.27 * sin(a2) + 0.15 * sin(a3);
  let dsines = k * (0.58 * cos(a1) + 0.27 * 1.93 * cos(a2) + 0.15 * 0.57 * cos(a3));

  // Noise along x, drifting slowly in its second axis so the shape keeps changing.
  let nk = k * 0.9;
  let n = gnoise_2d_d(vec2f(x * nk + seed * 13.0, phase * 0.12 + seed * 3.0));
  let rough = clamp(roughness, 0.0, 1.0) * 0.6;
  return amplitude * vec2f(sines + rough * n.x, dsines + rough * n.y * nk);
}

fn waveline_distance(y: f32, line_y: f32, slope: f32) -> f32 {
  return (line_y - y) * inverseSqrt(1.0 + slope * slope);
}

fn waveline_coverage(d: f32, px: f32) -> f32 {
  return sd_coverage(d, px);
}

fn waveline_band(d: f32, centre: f32, half_width: f32, px: f32) -> f32 {
  return sd_coverage(abs(d - centre) - half_width, px);
}

fn waveline_foam(depth: f32, p: vec2f, time: f32, width: f32, amount: f32, edge: f32) -> f32 {
  // Patchiness along the crest, so the foam comes in clumps and fingers.
  let patch_noise = 0.5 + 0.5 * gnoise_2d(vec2f(p.x * 0.3, time * 0.15));
  let reach = foam_mask(depth, width, patch_noise, 0.45) * clamp(amount, 0.0, 1.0);
  let v = voronoi_2d_anim(p, 0.9, time);
  // Bubbles shrink with distance from the crest and the small ones go first.
  let radius = 0.8 * reach * (0.35 + 0.65 * v.id);
  let soft = max(edge, 1e-3);
  // A bubble of zero radius is nothing, not the half-covered dot a bare ramp would leave.
  return (1.0 - smoothstep(radius - soft, radius + soft, v.f1)) * smoothstep(0.0, 2.0 * soft, radius);
}
`,"./wetness.wgsl":`// wetness.wgsl -- the usual wet-surface model: where the water is, how wet the ground around it is,
// and what wetness does to a material (darker and more saturated, smoother, mirror-like).
//
// A dry porous surface scatters light inside a rough, bright skin. Water fills the pores and coats the
// grains: the skin becomes translucent (darker, more saturated colour), the micro-roughness is smoothed
// by a film (the surface gets glossier and reflects the sky), and a real puddle on top is a flat mirror
// with Fresnel reflection. These functions split the job so a shader can combine them: a flood mask
// from a height field and a water level, a wetness field with a damp band around the water, and the
// material changes driven by wetness.
//
// Conventions
//  * \`height\` and \`level\` (the water level) are in the same unit, metres in practice; so are \`reach\`,
//    \`depth\` and \`edge\`. The ground is flooded where height < level.
//  * Wetness is [0, 1]: 0 bone dry, 1 soaked. Albedo and colours are LINEAR rgb.
//
// Where the water is
//   wet_depth(height, level) -> f32           water depth over the ground, max(level - height, 0)
//   wet_water_mask(depth, edge) -> f32        coverage [0, 1]: 0 at depth <= 0, 1 at depth >= edge, smooth and
//                                             monotonic between. edge is the width of the shoreline in depth
//                                             units; set it to about one pixel of the shore's slope (slope times
//                                             pixel footprint) for a crisp anti-aliased edge, larger for a soft
//                                             one. edge <= 0 gives a hard step
//   wet_damp(height, level, reach, base) -> f32
//                                             wetness of the ground: 1 at and below the waterline, falling to
//                                             \`base\` (the general dampness, 0 dry .. 1 soaked) over \`reach\`
//                                             above it. Never below base; monotonic in base and in level
// What wetness does to the material
//   wet_albedo(albedo, wetness) -> vec3f      darker and more saturated: per-channel pow(albedo, 1 + 0.9 w), then
//                                             saturation x (1 + 0.3 w) about the luminance
//                                             (limited so that no channel goes below 0). Output in [0, 1];
//                                             luminance never increases with wetness; w = 0 returns albedo
//   wet_roughness(roughness, wetness) -> f32  roughness * (1 - 0.75 w): a film of water smooths the surface
//   wet_reflectance(cos_theta, wetness, water, roughness) -> f32
//                                             how much of the environment the surface mirrors, [0, 1]. Over a
//                                             real puddle (\`water\` 1) it is the Fresnel reflectance of water;
//                                             on damp ground a dull sheen: the same Fresnel curve times
//                                             wetness squared times smoothness, capped at 0.8 of the puddle.
//                                             cos_theta = dot(normal, view), view pointing to the eye
//   wet_through_water(bed, depth, sigma) -> vec3f
//                                             the bed seen through \`depth\` of water with absorption \`sigma\`
//                                             per metre (absorb_transmittance): bed * exp(-sigma depth)
//
// Cost: a few ALU ops each; wet_albedo has 3 pow, wet_through_water 3 exp.
//
// References: the darker-albedo, lower-roughness wet-surface model is the one S. Lagarde describes in
// "Water drop 3b - Physically based wet surfaces" (2013); the puddle as a flat Fresnel mirror follows
// the same article.

#include "color.wgsl"
#include "fresnel.wgsl"
#include "absorption.wgsl"

fn wet_depth(height: f32, level: f32) -> f32 {
  return max(level - height, 0.0);
}

fn wet_water_mask(depth: f32, edge: f32) -> f32 {
  if (edge <= 0.0) {
    return select(0.0, 1.0, depth > 0.0);
  }
  return smoothstep(0.0, edge, depth);
}

fn wet_damp(height: f32, level: f32, reach: f32, base: f32) -> f32 {
  let above = max(height - level, 0.0);
  let band = select(0.0, 1.0 - smoothstep(0.0, reach, above), reach > 0.0);
  let at_water = select(0.0, 1.0, height <= level);
  return max(max(saturate(base), band), at_water);
}

fn wet_albedo(albedo: vec3f, wetness: f32) -> vec3f {
  let w = saturate(wetness);
  let dark = pow(clamp(albedo, vec3f(0.0), vec3f(1.0)), vec3f(1.0 + 0.9 * w));
  let l = luminance(dark);
  // More saturation about the luminance, but never so much that a channel goes negative: clamping
  // would add light and make a wetter surface brighter.
  let lowest = min(dark.x, min(dark.y, dark.z));
  let boost = min(1.0 + 0.3 * w, l / max(l - lowest, 1e-4));
  let rich = vec3f(l) + (dark - vec3f(l)) * max(boost, 1.0);
  return clamp(rich, vec3f(0.0), vec3f(1.0));
}

fn wet_roughness(roughness: f32, wetness: f32) -> f32 {
  return clamp(roughness, 0.0, 1.0) * (1.0 - 0.75 * saturate(wetness));
}

fn wet_reflectance(cos_theta: f32, wetness: f32, water: f32, roughness: f32) -> f32 {
  let f = fresnel_water(cos_theta);
  let w = saturate(wetness);
  let sheen = f * w * w * (1.0 - clamp(roughness, 0.0, 1.0)) * 0.8;
  return mix(sheen, f, saturate(water));
}

fn wet_through_water(bed: vec3f, depth: f32, sigma: vec3f) -> vec3f {
  return bed * absorb_transmittance(sigma, depth);
}
`}),t={chunks:new Map,listeners:new Set};t.chunks.clear();for(let[n,r]of Object.entries(e))t.chunks.set(n.replace(/^\.\//,``),r);function n(e){return t.chunks.get(e)}function r(e){return t.listeners.add(e),()=>t.listeners.delete(e)}export{r as n,n as t};