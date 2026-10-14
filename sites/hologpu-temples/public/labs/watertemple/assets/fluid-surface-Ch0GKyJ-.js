import{n as e}from"./profiler-Bi27xYp-.js";import{n as t}from"./targets-Dcl181Ey.js";import{t as n}from"./depth-DtG5nS6F.js";import{s as r,t as i}from"./camera-BT6VSIZb.js";import{n as a,t as o}from"./uniforms-BE1XSnDx.js";import{t as s}from"./shader-Cd_FDUy8.js";import{t as c}from"./fullscreen-Dq3Mq0Js.js";import{n as l,r as u}from"./common-DyRXdhCv.js";var d=`// Composite pass of the fluid surface, at the size of the output. It reads the scene the caller drew
// (colour and depth), the chain's depth and normals (raw and smoothed), and the blurred thickness,
// and writes scene-plus-liquid:
//   * the surface is rebuilt by interpolating the chain with weights that skip background texels, so
//     a half resolution chain still gives a clean, anti-aliased silhouette
//   * the scene behind the liquid is looked up through an offset taken from the normal and scaled by
//     the thickness (the offset is dropped when it would pull in something in FRONT of the liquid)
//   * Beer-Lambert absorption by the thickness, Fresnel-weighted sky reflection and a GGX sun
//     highlight sit on top; the scalar \`w\` of the particles can tint towards foam
//   * the liquid is hidden by scene geometry in front of it (depth compare against the scene depth)
// With debug views it shows one intermediate instead.

#include "fluid-frame.wgsl"
#include "fullscreen.wgsl"
#include "camera.wgsl"
#include "fluid-surface.wgsl"
#include "fresnel.wgsl"
#include "sky.wgsl"
#include "specular.wgsl"
#include "absorption.wgsl"
#include "refraction.wgsl"
#include "color.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> frame: FluidFrame;
@group(0) @binding(2) var scene_color: texture_2d<f32>;
@group(0) @binding(3) var scene_depth: texture_depth_2d;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var raw_depth: texture_2d<f32>;
@group(0) @binding(6) var raw_normals: texture_2d<f32>;
@group(0) @binding(7) var smooth_depth: texture_2d<f32>;
@group(0) @binding(8) var smooth_normals: texture_2d<f32>;
@group(0) @binding(9) var thickness_image: texture_2d<f32>;

struct Surface {
  depth: f32,
  normal: vec3f,
  // Fraction of the four chain texels around the pixel that hold fluid (bilinear-weighted).
  coverage: f32,
}

fn fetch_surface(depth_image: texture_2d<f32>, normal_image: texture_2d<f32>, uv: vec2f) -> Surface {
  let size = vec2i(textureDimensions(depth_image));
  let position = uv * vec2f(size) - 0.5;
  let base = vec2i(floor(position));
  let f = position - floor(position);
  var depth_sum = 0.0;
  var normal_sum = vec3f(0.0);
  var weight_sum = 0.0;
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      let q = clamp(base + vec2i(i, j), vec2i(0), size - 1);
      let w = select(1.0 - f.x, f.x, i == 1) * select(1.0 - f.y, f.y, j == 1);
      let z = textureLoad(depth_image, q, 0).r;
      if (z > 0.0) {
        depth_sum += w * z;
        normal_sum += w * textureLoad(normal_image, q, 0).xyz;
        weight_sum += w;
      }
    }
  }
  var s: Surface;
  s.coverage = weight_sum;
  if (weight_sum <= 0.0) {
    s.depth = 0.0;
    s.normal = vec3f(0.0, 0.0, 1.0);
    return s;
  }
  s.depth = depth_sum / weight_sum;
  let n = normal_sum / weight_sum;
  s.normal = select(vec3f(0.0, 0.0, 1.0), normalize(n), dot(n, n) > 1e-8);
  return s;
}

fn finish(c: vec3f) -> vec4f {
  if (frame.output_srgb != 0u) {
    return vec4f(linear_to_srgb(tonemap_aces(max(c, vec3f(0.0)))), 1.0);
  }
  return vec4f(c, 1.0);
}

fn depth_colour(z: f32) -> vec3f {
  // Brightness falls with distance; thin dark lines mark equal depth every half radius, which makes
  // the lumps of a raw sphere cloud and the flatness of a smoothed surface obvious.
  let g = 0.95 * exp(-0.12 * z);
  let contour = abs(fract(z / (0.5 * frame.radius)) - 0.5) * 2.0;
  return vec3f(g * (1.0 - 0.55 * smoothstep(0.8, 1.0, contour)));
}

fn heat(v: f32) -> vec3f {
  let t = clamp(v, 0.0, 1.0);
  return mix(mix(vec3f(0.02, 0.04, 0.2), vec3f(0.1, 0.6, 0.7), smoothstep(0.0, 0.5, t)), vec3f(1.0, 0.92, 0.45), smoothstep(0.5, 1.0, t));
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = vec2i(in.position.xy);
  let uv = in.uv;
  let last = vec2i(frame.full_size) - 1;
  let scene = textureLoad(scene_color, pixel, 0).rgb;
  if (frame.live == 0u) {
    return finish(scene);
  }

  var use_raw = frame.surface == 1u;
  if (frame.surface == 2u) {
    use_raw = uv.x < frame.split;
  }
  var s: Surface;
  if (use_raw) {
    s = fetch_surface(raw_depth, raw_normals, uv);
  } else {
    s = fetch_surface(smooth_depth, smooth_normals, uv);
  }
  let thick_sample = textureSampleLevel(thickness_image, samp, uv, 0.0).xy;
  let thick = max(thick_sample.x, 0.0);
  let foam_mean = select(0.0, thick_sample.y / thick, thick > 1e-4);

  var divider = 0.0;
  if (frame.surface == 2u) {
    divider = 1.0 - smoothstep(0.5, 1.5, abs(in.position.x - frame.split * frame.full_size.x));
  }

  // Debug views replace the liquid with one intermediate on a dark ground.
  if (frame.debug != 0u) {
    var debug_colour = vec3f(0.035);
    let covered = clamp(s.coverage, 0.0, 1.0);
    if (frame.debug == 1u || frame.debug == 2u) {
      // The depth that was asked for, whichever half of a split it is.
      var d: Surface;
      if (frame.debug == 1u) {
        d = fetch_surface(raw_depth, raw_normals, uv);
      } else {
        d = fetch_surface(smooth_depth, smooth_normals, uv);
      }
      debug_colour = mix(debug_colour, depth_colour(d.depth), clamp(d.coverage, 0.0, 1.0));
    } else if (frame.debug == 3u) {
      debug_colour = mix(debug_colour, s.normal * 0.5 + 0.5, covered);
    } else if (frame.debug == 4u) {
      debug_colour = heat(1.0 - exp(-0.5 * thick));
    } else {
      debug_colour = vec3f(clamp(foam_mean * max(frame.foam_amount, 1.0), 0.0, 1.0));
    }
    return finish(mix(debug_colour, vec3f(1.0), divider));
  }

  if (s.coverage <= 0.0) {
    return finish(mix(scene, vec3f(1.0), divider));
  }

  // Hidden by the scene? Fade over a fraction of a particle so the cut with a floor is not a stair.
  let scene_z = camera_linear_depth(cam, textureLoad(scene_depth, pixel, 0));
  let slack = 0.35 * frame.radius;
  let hidden = smoothstep(scene_z - slack, scene_z + slack, s.depth);
  let alpha = clamp(s.coverage, 0.0, 1.0) * (1.0 - hidden);
  if (alpha <= 0.0) {
    return finish(mix(scene, vec3f(1.0), divider));
  }

  let n_view = s.normal;
  let p_view = fluid_surface_view_pos(cam, uv, s.depth);
  let v_view = normalize(-p_view);
  let n_world = normalize((cam.inv_view * vec4f(n_view, 0.0)).xyz);
  let v_world = normalize((cam.inv_view * vec4f(v_view, 0.0)).xyz);
  let sun = normalize(frame.sun_dir);

  // Refraction: the offset is in image-height units, so convert the thickness from world units.
  let aspect = frame.full_size.x / frame.full_size.y;
  let height_world = 2.0 * s.depth / cam.proj[1][1];
  let bend_thickness = min(thick, frame.max_refract) * frame.refraction / height_world;
  let n_screen = vec3f(n_view.x, -n_view.y, max(n_view.z, 0.1));
  let offset = refraction_to_uv(refraction_offset_cheap(n_screen, frame.ior, bend_thickness), aspect);
  var bed_uv = refraction_safe_uv(uv, offset, 0.03);
  let refracted_z = camera_linear_depth(cam, textureLoad(scene_depth, clamp(vec2i(bed_uv * frame.full_size), vec2i(0), last), 0));
  if (refracted_z < s.depth) {
    // Something stands in front of the liquid there: do not drag it into the liquid.
    bed_uv = uv;
  }
  let bed = textureSampleLevel(scene_color, samp, bed_uv, 0.0).rgb;

  var water = AbsorbWater(frame.sigma, frame.scatter, frame.turbidity);
  if (frame.water_type >= 0) {
    water = absorb_water(frame.water_type);
  }
  let body = absorb_composite(bed, water.sigma, water.turbidity, water.scatter, thick * frame.density);

  let f0 = fresnel_f0(1.0, frame.ior);
  let fresnel = fresnel_schlick(dot(n_world, v_world), f0) * frame.reflection;
  let sky = sky_radiance_ex(reflect(-v_world, n_world), sun, frame.haze, 0.0);
  let glint = frame.specular * sky_sun_color(sun) * SKY_SUN_RADIANCE
    * spec_sun(n_world, v_world, sun, frame.roughness, SKY_SUN_ANGULAR_RADIUS);
  var colour = body * (1.0 - fresnel) + sky * fresnel + glint;

  let foam = clamp(foam_mean * frame.foam_amount, 0.0, 1.0);
  let lit = sky_ambient(sun) + sky_sun_color(sun) * max(dot(n_world, sun), 0.0);
  colour = mix(colour, frame.foam_color * lit, foam);

  return finish(mix(mix(scene, colour, alpha), vec3f(1.0), divider));
}
`,f=a(`FluidFrame`,{chain_size:`vec2f`,thick_size:`vec2f`,full_size:`vec2f`,radius:`f32`,thick_radius:`f32`,thick_gain:`f32`,live:`u32`,filter_kind:`u32`,filter_scale:`f32`,max_radius:`f32`,range:`f32`,blur_radius:`i32`,surface:`u32`,split:`f32`,debug:`u32`,output_srgb:`u32`,sigma:`vec3f`,density:`f32`,scatter:`vec3f`,turbidity:`f32`,sun_dir:`vec3f`,ior:`f32`,foam_color:`vec3f`,foam_amount:`f32`,refraction:`f32`,reflection:`f32`,roughness:`f32`,specular:`f32`,haze:`f32`,water_type:`i32`,max_refract:`f32`}),p=a(`FluidPass`,{direction:`vec2i`}),m={"fluid-frame.wgsl":f.wgsl+p.wgsl},h=[`bilateral`,`narrow-range`],ee=[`smooth`,`raw`,`split`],te=[`none`,`raw-depth`,`smooth-depth`,`normals`,`thickness`,`foam`],ne=[`depth`,`smooth`,`normals`,`thickness`,`composite`],g={scale:.5,thicknessScale:.25,thicknessStride:1,thicknessBlur:3,filter:`narrow-range`,filterRadius:1.5,maxFilterRadius:16,iterations:2,rangeScale:.75},_={surface:`smooth`,split:.5,debug:`none`,waterType:-1,absorption:[.35,.09,.05],scatter:[.05,.25,.35],turbidity:.05,density:1,ior:1.333,refraction:1,maxRefractionThickness:1,reflection:1,roughness:.05,specular:1,haze:.3,sunDirection:[.5,.7,.35],thicknessGain:1,thicknessRadius:1,foamAmount:0,foamColor:[.95,.97,1],srgb:!1};function re(e={}){let t=Object.fromEntries(Object.entries(e).filter(([,e])=>e!==void 0));return{..._,...t}}var v=(e,t,n)=>Math.min(n,Math.max(t,e));function y(e){return{scale:v(e.scale,.25,1),thicknessScale:v(e.thicknessScale,.125,1),thicknessStride:Math.round(v(e.thicknessStride,1,16)),thicknessBlur:Math.round(v(e.thicknessBlur,0,16)),filter:e.filter===`bilateral`?`bilateral`:`narrow-range`,filterRadius:v(e.filterRadius,.1,16),maxFilterRadius:v(e.maxFilterRadius,1,64),iterations:Math.round(v(e.iterations,1,8)),rangeScale:v(e.rangeScale,.05,16)}}var b=`// Normals from a depth image. The view-space position of each pixel is rebuilt from its linear
// depth; the normal is the cross product of the position differences to the neighbours, and in each
// direction the one-sided difference with the smaller depth change is used (or the only valid one),
// so a pixel on a silhouette takes its normal from the surface side and never from across the gap.
// Output: xyz is the unit view-space normal facing the camera, w is 1 on the fluid and 0 off it.

#include "fluid-frame.wgsl"
#include "fullscreen.wgsl"
#include "camera.wgsl"
#include "fluid-surface.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> frame: FluidFrame;
@group(0) @binding(2) var depth: texture_2d<f32>;

fn position_at(pixel: vec2i) -> vec4f {
  let size = vec2i(frame.chain_size);
  if (any(pixel < vec2i(0)) || any(pixel >= size)) {
    return vec4f(0.0);
  }
  let z = textureLoad(depth, pixel, 0).r;
  if (z <= 0.0) {
    return vec4f(0.0);
  }
  let uv = (vec2f(pixel) + 0.5) / frame.chain_size;
  return vec4f(fluid_surface_view_pos(cam, uv, z), 1.0);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = vec2i(in.position.xy);
  let here = position_at(pixel);
  if (here.w == 0.0) {
    return vec4f(0.0);
  }
  let right = position_at(pixel + vec2i(1, 0));
  let left = position_at(pixel + vec2i(-1, 0));
  let up = position_at(pixel + vec2i(0, -1));
  let down = position_at(pixel + vec2i(0, 1));
  let dx = fluid_surface_pick_difference(right.xyz - here.xyz, here.xyz - left.xyz, right.w > 0.0, left.w > 0.0);
  // Screen y grows downwards, so the pixel above is towards +y in view space.
  let dy = fluid_surface_pick_difference(up.xyz - here.xyz, here.xyz - down.xyz, up.w > 0.0, down.w > 0.0);
  return vec4f(fluid_surface_normal(dx, dy), 1.0);
}
`,x=`// One separable pass of the depth filter. \`direction\` is (1, 0) or (0, 1); a full round is two draws.
// Both filters take a Gaussian average along the line, with a kernel whose radius follows the
// projected size of a particle at the pixel's depth, so the smoothing is the same in world terms
// near and far. They differ in what they do with a neighbour whose depth is far from the centre's:
//   bilateral     weights it by exp(-dz^2 / 2 range^2): far depths are dropped, so a slanted surface
//                 only averages a thin sliver of its neighbours and the blobs show through
//   narrow-range  keeps it but clamps its depth to centre +- range: a foreign surface can move the
//                 result by at most \`range\`, and a slanted surface still averages everything
// Background pixels (depth 0) are skipped by both, so an isolated droplet keeps its own shape and a
// silhouette is never pulled outwards.

#include "fluid-frame.wgsl"
#include "fullscreen.wgsl"
#include "camera.wgsl"
#include "fluid-surface.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> frame: FluidFrame;
@group(0) @binding(2) var<uniform> pass_info: FluidPass;
@group(0) @binding(3) var source: texture_2d<f32>;

// At most 33 taps per direction. A wider kernel takes every n-th texel, which is only safe on a
// surface that is already smooth: on raw depth it makes each parity class of pixels average a
// different set of texels and leaves a checkered texture, so the default cap stays below it.
const TAPS_PER_SIDE = 16.0;

@fragment fn fs(in: FullscreenVarying) -> @location(0) f32 {
  let pixel = vec2i(in.position.xy);
  let size = vec2i(frame.chain_size);
  let centre = textureLoad(source, pixel, 0).r;
  if (centre <= 0.0) {
    return 0.0;
  }
  let pixel_radius = fluid_surface_pixel_radius(cam, centre, frame.radius, frame.chain_size.y);
  let radius = fluid_surface_filter_radius(pixel_radius, frame.filter_scale, frame.max_radius);
  let stride = max(1, i32(ceil(radius / TAPS_PER_SIDE)));
  let taps = i32(floor(radius / f32(stride)));
  var total = 0.0;
  var weight_sum = 0.0;
  for (var i = -taps; i <= taps; i++) {
    let offset = i * stride;
    let q = pixel + pass_info.direction * offset;
    if (any(q < vec2i(0)) || any(q >= size)) {
      continue;
    }
    let z = textureLoad(source, q, 0).r;
    if (z <= 0.0) {
      continue;
    }
    var weight = fluid_surface_kernel_weight(f32(offset), radius);
    var value = z;
    if (frame.filter_kind == 0u) {
      weight = fluid_surface_bilateral_weight(weight, z - centre, frame.range);
    } else {
      value = fluid_surface_narrow_clamp(z, centre, frame.range);
    }
    total += weight * value;
    weight_sum += weight;
  }
  return total / max(weight_sum, 1e-6);
}
`,S=`// Depth pass of the fluid surface: every particle is a camera-facing quad shaded as the sphere it
// stands for. The fragment intersects the pixel's ray with the sphere, writes the exact depth to the
// depth buffer (so overlapping spheres intersect and the nearest surface wins) and the linear
// view-space depth to a float target. Fragments behind the scene are discarded, so a particle
// hidden by a wall or the floor never reaches the smoothing.

#include "fluid-frame.wgsl"
#include "camera.wgsl"
#include "fluid-surface.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> frame: FluidFrame;
@group(0) @binding(2) var scene_depth: texture_depth_2d;

struct SphereVarying {
  @builtin(position) position: vec4f,
  // The point on the quad's plane in view space: its direction is the pixel's ray.
  @location(0) view: vec3f,
  @location(1) @interpolate(flat) centre: vec3f,
}

// A triangle strip: four vertices per particle instead of six.
const QUAD = array<vec2f, 4>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0),
);

@vertex fn vs(@builtin(vertex_index) vertex: u32, @location(0) particle: vec4f) -> SphereVarying {
  var out: SphereVarying;
  let centre = (cam.view * vec4f(particle.xyz, 1.0)).xyz;
  let half_size = fluid_surface_billboard_half_size(centre, frame.radius, cam.near);
  out.centre = centre;
  if (half_size < 0.0) {
    // Culled: a point outside the clip volume produces no fragments.
    out.position = vec4f(2.0, 2.0, 2.0, 1.0);
    out.view = vec3f(0.0, 0.0, -1.0);
    return out;
  }
  out.view = vec3f(centre.xy + QUAD[vertex] * half_size, centre.z);
  out.position = cam.proj * vec4f(out.view, 1.0);
  return out;
}

struct SphereOut {
  @location(0) depth: f32,
  @builtin(frag_depth) frag_depth: f32,
}

// The deepest scene surface among the full-resolution pixels this chain pixel covers, as linear depth.
fn scene_limit(position: vec2f) -> f32 {
  let ratio = frame.full_size / frame.chain_size;
  let top = vec2i(floor((position - 0.5) * ratio + 0.5));
  let last = vec2i(frame.full_size) - 1;
  var deepest = textureLoad(scene_depth, clamp(top, vec2i(0), last), 0);
  if (ratio.x > 1.5) {
    deepest = max(deepest, textureLoad(scene_depth, clamp(top + vec2i(1, 0), vec2i(0), last), 0));
    deepest = max(deepest, textureLoad(scene_depth, clamp(top + vec2i(0, 1), vec2i(0), last), 0));
    deepest = max(deepest, textureLoad(scene_depth, clamp(top + vec2i(1, 1), vec2i(0), last), 0));
  }
  return camera_linear_depth(cam, deepest);
}

@fragment fn fs(in: SphereVarying) -> SphereOut {
  let dir = normalize(in.view);
  let depth = fluid_surface_sphere_depth(dir, in.centre, frame.radius);
  if (depth < 0.0 || depth > scene_limit(in.position.xy)) {
    discard;
  }
  var out: SphereOut;
  out.depth = depth;
  out.frag_depth = camera_depth_from_linear(cam, depth);
  return out;
}
`,C=`// One separable Gaussian pass over the thickness image (rg16float: thickness and thickness times
// the particle scalar). Radius and sigma follow \`blur_radius\`; zero copies.

#include "fluid-frame.wgsl"
#include "fullscreen.wgsl"

@group(0) @binding(0) var<uniform> frame: FluidFrame;
@group(0) @binding(1) var<uniform> pass_info: FluidPass;
@group(0) @binding(2) var source: texture_2d<f32>;

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = vec2i(in.position.xy);
  let size = vec2i(frame.thick_size);
  let radius = frame.blur_radius;
  if (radius <= 0) {
    return textureLoad(source, pixel, 0);
  }
  let sigma = (f32(radius) + 1.0) / 3.0;
  var total = vec4f(0.0);
  var weight_sum = 0.0;
  for (var i = -radius; i <= radius; i++) {
    // Clamp to the edge: thickness continues past the border of the image.
    let q = clamp(pixel + pass_info.direction * i, vec2i(0), size - 1);
    let w = exp(-0.5 * f32(i * i) / (sigma * sigma));
    total += w * textureLoad(source, q, 0);
    weight_sum += w;
  }
  return total / weight_sum;
}
`,w=`// Thickness pass: each particle adds the length its sphere cuts out of the pixel's ray, summed with
// additive blending and no depth test. Red is the thickness in world units (times a gain); green is
// the same times the particle's scalar \`w\`, so blurring both and dividing recovers a smooth mean of
// \`w\` along the ray (the foam hook). The chord is clipped at the scene surface behind which the rest
// of the sphere is hidden.

#include "fluid-frame.wgsl"
#include "camera.wgsl"
#include "fluid-surface.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> frame: FluidFrame;
@group(0) @binding(2) var scene_depth: texture_depth_2d;

struct ThicknessVarying {
  @builtin(position) position: vec4f,
  @location(0) view: vec3f,
  @location(1) @interpolate(flat) centre: vec3f,
  @location(2) @interpolate(flat) scalar: f32,
}

// A triangle strip: four vertices per particle instead of six.
const QUAD = array<vec2f, 4>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0),
);

@vertex fn vs(@builtin(vertex_index) vertex: u32, @location(0) particle: vec4f) -> ThicknessVarying {
  var out: ThicknessVarying;
  let centre = (cam.view * vec4f(particle.xyz, 1.0)).xyz;
  let half_size = fluid_surface_billboard_half_size(centre, frame.thick_radius, cam.near);
  out.centre = centre;
  out.scalar = particle.w;
  if (half_size < 0.0) {
    out.position = vec4f(2.0, 2.0, 2.0, 1.0);
    out.view = vec3f(0.0, 0.0, -1.0);
    return out;
  }
  out.view = vec3f(centre.xy + QUAD[vertex] * half_size, centre.z);
  out.position = cam.proj * vec4f(out.view, 1.0);
  return out;
}

@fragment fn fs(in: ThicknessVarying) -> @location(0) vec4f {
  let dir = normalize(in.view);
  let ratio = frame.full_size / frame.thick_size;
  let pixel = clamp(vec2i(in.position.xy * ratio), vec2i(0), vec2i(frame.full_size) - 1);
  let scene = camera_linear_depth(cam, textureLoad(scene_depth, pixel, 0));
  // Distance along the ray to the scene surface: linear depth is the z component of the hit.
  let limit = scene / max(-dir.z, 1e-3);
  let chord = fluid_surface_chord(dir, in.centre, frame.thick_radius, cam.near / max(-dir.z, 1e-3), limit);
  if (chord <= 0.0) {
    discard;
  }
  let thickness = chord * frame.thick_gain;
  return vec4f(thickness, thickness * in.scalar, 0.0, 0.0);
}
`,T={depth:`r32float`,depthBuffer:`depth32float`,normals:`rgba16float`,thickness:`rg16float`},E=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST,D={arrayStride:16,stepMode:`instance`,attributes:[{shaderLocation:0,offset:0,format:`float32x4`}]},O={operation:`add`,srcFactor:`one`,dstFactor:`one`},k=u(e=>{let t=m,n=s(e,{label:`fluid-surface/sphere-depth.wgsl`,code:S,chunks:t}),r=s(e,{label:`fluid-surface/thickness.wgsl`,code:w,chunks:t}),i=e.createBindGroupLayout({label:`fluid particle passes`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`depth`}}]}),a=e.createPipelineLayout({label:`fluid particle passes layout`,bindGroupLayouts:[i]}),o=new Map,l=(n,r,i)=>c(e,{label:`fluid ${n}`,fragment:{label:`fluid-surface/${n}.wgsl`,code:r,chunks:t},format:i});return{particleLayout:i,sphereDepth:e.createRenderPipeline({label:`fluid sphere depth`,layout:a,vertex:{module:n,entryPoint:`vs`,buffers:[D]},fragment:{module:n,entryPoint:`fs`,targets:[{format:T.depth}]},primitive:{topology:`triangle-strip`,cullMode:`none`},depthStencil:{format:T.depthBuffer,depthWriteEnabled:!0,depthCompare:`less`}}),thickness(t){let n=o.get(t);return n||(n=e.createRenderPipeline({label:`fluid thickness (every ${t})`,layout:a,vertex:{module:r,entryPoint:`vs`,buffers:[{...D,arrayStride:D.arrayStride*t}]},fragment:{module:r,entryPoint:`fs`,targets:[{format:T.thickness,blend:{color:O,alpha:O}}]},primitive:{topology:`triangle-strip`,cullMode:`none`}}),o.set(t,n)),n},smooth:l(`smooth`,x,T.depth),thicknessBlur:l(`thickness-blur`,C,T.thickness),normals:l(`normals`,b,T.normals),composite:new Map}});function ie(e,t){let n=k(e),r=n.composite.get(t);return r||(r=c(e,{label:`fluid composite ${t}`,fragment:{label:`fluid-surface/composite.wgsl`,code:d,chunks:m},format:t}),n.composite.set(t,r)),r}var A=(e,t)=>Math.max(1,Math.round(e*t));function j(a){let{device:s,format:c}=a,u=a.label??`fluid`,d=k(s),m=ie(s,c),_=y({...g,...Object.fromEntries(Object.entries(a).filter(([e])=>e in g))}),v=A(a.width,1),b=A(a.height,1),x=0,S=!1,C=()=>[A(v,_.scale),A(b,_.scale)],w=()=>[A(v,_.thicknessScale),A(b,_.thicknessScale)],[D,O]=C(),[j,M]=w(),N=(e,n,r,i)=>t(s,{label:`${u} ${e}`,format:n,width:r,height:i,usage:E}),P=N(`raw depth`,T.depth,D,O),F=N(`smooth A`,T.depth,D,O),I=N(`smooth B`,T.depth,D,O),L=N(`raw normals`,T.normals,D,O),R=N(`smooth normals`,T.normals,D,O),z=N(`thickness`,T.thickness,j,M),B=N(`thickness scratch`,T.thickness,j,M),V=n(s,{label:`${u} depth buffer`,width:D,height:O,format:T.depthBuffer,sampled:!1}),H=o(s,i,`${u} camera`),U=o(s,f,`${u} frame`),W=o(s,p,`${u} horizontal`),G=o(s,p,`${u} vertical`);W.set({direction:[1,0]}),G.set({direction:[0,1]}),W.upload(),G.upload();let K={bindGroupsCreated:0,particlesDrawn:0,lastPasses:[]},q,J,Y=(e,t)=>e!==void 0&&e.every((e,n)=>e===t[n]);function X(e,t,n){return K.bindGroupsCreated++,s.createBindGroup({label:`${u} ${t}`,layout:`getBindGroupLayout`in e?e.getBindGroupLayout(0):e,entries:n.map((e,t)=>({binding:t,resource:e}))})}let Z=e=>({buffer:e.buffer});function ae(){let e=[P.view,F.view,I.view,z.view,B.view];if(q&&Y(q.key,e))return q;let t=Z(H),n=Z(U);return q={key:e,smoothFromRaw:X(d.smooth,`smooth H (raw)`,[t,n,Z(W),P.view]),smoothFromB:X(d.smooth,`smooth H (B)`,[t,n,Z(W),I.view]),smoothVertical:X(d.smooth,`smooth V`,[t,n,Z(G),F.view]),normalsRaw:X(d.normals,`normals (raw)`,[t,n,P.view]),normalsSmooth:X(d.normals,`normals (smooth)`,[t,n,I.view]),blurHorizontal:X(d.thicknessBlur,`blur H`,[n,Z(W),z.view]),blurVertical:X(d.thicknessBlur,`blur V`,[n,Z(G),B.view])},q}function oe(e,t){let n=[e,t,P.view,I.view,L.view,R.view,z.view];if(J&&Y(J.key,n))return J;let r=Z(H),i=Z(U);return J={key:n,depth:X(d.particleLayout,`depth`,[r,i,t]),thickness:X(d.particleLayout,`thickness`,[r,i,t]),composite:X(m,`composite`,[r,i,e,t,l(s),P.view,L.view,I.view,R.view,z.view])},J}function se(){let[e,t]=C(),[n,r]=w(),i=!1;for(let n of[P,F,I,L,R,V])i=n.resize(e,t)||i;for(let e of[z,B])i=e.resize(n,r)||i;i&&x++}function Q(e,t,n,r,i={r:0,g:0,b:0,a:0},a){return K.lastPasses.push(t),e.beginRenderPass({label:t,colorAttachments:[{view:n,loadOp:`clear`,clearValue:i,storeOp:`store`}],depthStencilAttachment:a?{view:a,depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`discard`}:void 0,timestampWrites:r.pass(t)})}function $(e,t,n,r,i,a){let o=Q(e,t,r,a);o.setPipeline(n),o.setBindGroup(0,i),o.draw(3),o.end()}return{get quality(){return _},setQuality(e){let t=Object.fromEntries(Object.entries(e).filter(([,e])=>e!==void 0));_=y({..._,...t})},resize(e,t){v=A(e,1),b=A(t,1),se()},get generation(){return x},get sizes(){return{chain:C(),thickness:w()}},textures:{get rawDepth(){return P},get smoothDepth(){return I},get rawNormals(){return L},get smoothNormals(){return R},get thickness(){return z}},stats:K,render(t,n){if(S)throw Error(`FluidSurface: render after destroy`);let i=n.profiler??e,a=new Set(n.stages??ne),o=re(n.params),s=n.particles,c=Math.max(0,Math.min(Math.floor(s.count),s.capacity));K.lastPasses=[],K.particlesDrawn=0,se();let[l,u]=C(),[f,p]=w(),g=_;r(H,n.camera,v,b),H.upload();let y=ee.indexOf(o.surface),x=te.indexOf(o.debug),[T,E,D]=o.sunDirection,O=Math.hypot(T,E,D)||1;U.set({chain_size:[l,u],thick_size:[f,p],full_size:[v,b],radius:s.radius,thick_radius:s.radius*o.thicknessRadius,thick_gain:o.thicknessGain*g.thicknessStride,live:+(c>0),filter_kind:h.indexOf(g.filter),filter_scale:g.filterRadius,max_radius:g.maxFilterRadius,range:g.rangeScale*s.radius,blur_radius:g.thicknessBlur,surface:Math.max(0,y),split:o.split,debug:Math.max(0,x),output_srgb:+!!o.srgb,sigma:o.absorption,density:o.density,scatter:o.scatter,turbidity:o.turbidity,sun_dir:[T/O,E/O,D/O],ior:o.ior,foam_color:o.foamColor,foam_amount:o.foamAmount,refraction:o.refraction,reflection:o.reflection,roughness:o.roughness,specular:o.specular,haze:o.haze,water_type:Math.round(o.waterType),max_refract:o.maxRefractionThickness}),U.upload();let k={...ae(),...oe(n.sceneColor,n.sceneDepth)};if(c>0){K.particlesDrawn=c;let e=o.surface!==`raw`||o.debug===`smooth-depth`,n=o.surface!==`raw`,r=o.surface!==`smooth`;if(a.has(`depth`)){let e=Q(t,`fluid depth`,P.view,i,{r:0,g:0,b:0,a:0},V.view);e.setPipeline(d.sphereDepth),e.setBindGroup(0,k.depth),e.setVertexBuffer(0,s.positions),e.draw(4,c),e.end()}if(e&&a.has(`smooth`))for(let e=0;e<g.iterations;e++)$(t,`fluid smooth`,d.smooth,F.view,e===0?k.smoothFromRaw:k.smoothFromB,i),$(t,`fluid smooth`,d.smooth,I.view,k.smoothVertical,i);if(a.has(`normals`)&&(n&&$(t,`fluid normals`,d.normals,R.view,k.normalsSmooth,i),r&&$(t,`fluid normals`,d.normals,L.view,k.normalsRaw,i)),a.has(`thickness`)){let e=Q(t,`fluid thickness`,z.view,i);e.setPipeline(d.thickness(g.thicknessStride)),e.setBindGroup(0,k.thickness),e.setVertexBuffer(0,s.positions),e.draw(4,Math.ceil(c/g.thicknessStride)),e.end(),g.thicknessBlur>0&&($(t,`fluid blur`,d.thicknessBlur,B.view,k.blurHorizontal,i),$(t,`fluid blur`,d.thicknessBlur,z.view,k.blurVertical,i))}}a.has(`composite`)&&$(t,`fluid composite`,m,n.target,k.composite,i)},destroy(){if(!S){S=!0;for(let e of[P,F,I,L,R,z,B])e.destroy();V.destroy();for(let e of[H,U,W,G])e.destroy();q=void 0,J=void 0}}}}export{h as n,j as t};