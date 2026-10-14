import{g as H,S as N,c as W,w as O}from"./surface-CPzQGKfE.js";import{m as V}from"./wgpu-matrix.module-hZiCFRr9.js";import{b as Y}from"./brdf-DfmsPKoP.js";import{P as j,U as Z,f as $,c as K,H as X}from"./post-YOyvqv1Z.js";import{n as Q}from"./noise-C55vzw-d.js";import{o as J}from"./optics-ClQZWXWq.js";import{s as ee}from"./jump-flood-DPZk2Fyk.js";import{m as ne,g as te}from"./mipmaps-D2ImRwxg.js";import{I as ae,i as re}from"./ibl-pm7vx_C6.js";import{O as ie}from"./orbit-camera-COMcKYBF.js";import{T as le}from"./text-sdf-HQH47OTV.js";const se=`// ---------------------------------------------------------------------------
// Ace of Spades — a holographic playing card in the void.
//
// One fullscreen pass. Each pixel ray-marches a thin rounded card (an extruded
// rounded-rectangle SDF) centred at the origin; the camera orbits it.
//
//   front: matte white stock with a classic ornate ace: the spade and the
//          corner pips are polished black marble (warped-noise veins) under a
//          holographic laminate (diffraction rainbow + glitter, thin-film sheen).
//          White printed detail inside the spade: keylines, a ring of dots,
//          mirrored scrollwork, an eye-in-triangle emblem in holographic foil on a
//          white plate, and "mk7s" in tiny dark-indigo script outlined in white at the centre.
//   back:  black marble with a holographic lattice, frame and spade emblem.
//   edge:  white paper core.
// Lights: three point lights (two in front, one behind) + studio IBL.
// Requires (prepended): common.wgsl, noise.wgsl, sdf.wgsl, brdf.wgsl, optics.wgsl,
// fullscreen.wgsl, \`Ace\`, \`IblParams\`, ibl.wgsl.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> u: Ace;
@group(0) @binding(1) var index_sdf: texture_2d<f32>;
@group(0) @binding(2) var mark_sdf: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;
@group(0) @binding(4) var emblem_tex: texture_2d<f32>;

// Coverage of the "mk7s" mark at this pixel. It is written to alpha so the post
// chain composites its background colour (exact dark indigo,
// #2E1065) there after tonemapping, keeping the colour exact instead of lit and tonemapped.
var<private> mark_ink: f32 = 0.0;

const SPADE_CENTRE = vec2f(0.0, 0.0);
const SPADE_SIZE = 0.44;

// --- Shapes (card units: x right, y up, card half-size ≈ 0.63 × 0.88) ----------------

fn dot2(v: vec2f) -> f32 { return dot(v, v); }

/// Inigo Quilez's exact heart: point at the origin, lobes up to y ≈ 1.1.
fn sd_heart(p_in: vec2f) -> f32 {
  let p = vec2f(abs(p_in.x), p_in.y);
  if (p.y + p.x > 1.0) { return sqrt(dot2(p - vec2f(0.25, 0.75))) - sqrt(2.0) / 4.0; }
  return sqrt(min(dot2(p - vec2f(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

/// A classic spade in unit space (y from ≈ -0.75 to 0.85): an upside-down heart
/// for the body, plus a flared stem carved by two large circles.
fn sd_spade_unit(p: vec2f) -> f32 {
  let body = sd_heart(vec2f(p.x, 0.85 - p.y));
  // Reaches up into the body so it also fills the notch between the lobes.
  let stem_box = sd_box(p - vec2f(0.0, -0.37), vec2f(0.24, 0.38));
  let carve = min(length(p - vec2f(0.97, -0.19)), length(p - vec2f(-0.97, -0.19))) - 0.92;
  let stem = max(stem_box, -carve);
  return op_smooth_union(body, stem, 0.04);
}

fn sd_spade(p: vec2f, centre: vec2f, size: f32) -> f32 {
  return sd_spade_unit((p - centre) / size) * size;
}

/// Text from a runtime SDF texture placed at rect = (centre, half-size), card units.
fn sd_text_tex(tex: texture_2d<f32>, rect: vec4f, scale_pad: vec2f, p: vec2f) -> f32 {
  let rel = p - rect.xy;
  let half = rect.zw;
  let box = sd_box(rel, half);
  let uv = clamp(vec2f(rel.x / half.x, -rel.y / half.y) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let d = textureSampleLevel(tex, lin, uv, 0.0).r * scale_pad.x;
  let glyph_box = sd_box(rel, max(half - vec2f(scale_pad.y), vec2f(1e-4)));
  return select(d, max(glyph_box, d - box), box > 0.0);
}

/// Corner index (a condensed serif "A" over a solid spade) at the top-left; call with -p for the bottom-right.
fn sd_index(p: vec2f) -> f32 {
  let a = sd_text_tex(index_sdf, u.indexRect, u.indexScalePad, p);
  let s = sd_spade(p, u.indexPip, 0.052);
  return min(a, s);
}

fn sd_frame(p: vec2f) -> f32 {
  return abs(sd_round_box(p, u.cardHalf - vec2f(0.045), 0.035)) - 0.0022;
}

// --- Ornate centre spade (spade units: y ≈ -0.75 .. 0.85) ------------------------------

/// Archimedean scroll: a curling white line around \`c\`, out to radius \`rmax\`.
fn sd_scroll(q: vec2f, c: vec2f, pitch: f32, rmax: f32, turn: f32) -> f32 {
  let d = q - c;
  let r = length(d);
  let a = atan2(d.y, d.x) * turn;
  let s = (r / pitch - a / TAU);
  let line = abs(fract(s + 0.5) - 0.5) * pitch;
  return max(line - 0.011, r - rmax);
}

/// White printed detail inside the black spade: a keyline, a ring of dots, a second
/// keyline, then mirrored scrollwork (the eye emblem is drawn separately). Returns
/// (white ink distance, inner-field distance), in spade units.
fn spade_ornament(s: vec2f) -> vec2f {
  let d0 = sd_spade_unit(s);
  // Fine keylines just inside the edge.
  var white = abs(d0 + 0.05) - 0.0045;
  white = min(white, abs(d0 + 0.155) - 0.0045);
  // Ring of dots between the keylines, spaced by angle around the body. Where the
  // contour runs toward the centre (the notch above the stem) angle spacing would
  // smear the dots into a rope, so they are left out there, as on real cards.
  let c = vec2f(0.0, 0.12);
  let rel = s - c;
  let e = vec2f(0.004, 0.0);
  let g = normalize(vec2f(sd_spade_unit(s + e.xy) - sd_spade_unit(s - e.xy), sd_spade_unit(s + e.yx) - sd_spade_unit(s - e.yx)) + 1e-6);
  let facing = abs(dot(g, normalize(rel + 1e-6)));
  let ang = atan2(rel.x, rel.y);
  let count = 52.0;
  let cell = (fract(ang / TAU * count + 0.5) - 0.5) * TAU / count * length(rel);
  let dots_ok = step(0.72, facing) * step(-0.36, s.y);
  white = min(white, mix(1e3, length(vec2f(d0 + 0.1025, cell)) - 0.019, dots_ok));

  // Scrollwork, mirrored left/right, kept inside the inner keyline.
  let m = vec2f(abs(s.x), s.y);
  let inner = d0 + 0.19;
  var orn = sd_scroll(m, vec2f(0.33, -0.02), 0.05, 0.12, 1.0) + 0.0035;
  orn = min(orn, sd_scroll(m, vec2f(0.19, 0.42), 0.04, 0.085, -1.0) + 0.0035);
  orn = max(orn, inner);
  // Clear black space for the tiny "mk7s" mark under the emblem.
  orn = max(orn, -sd_round_box(s - vec2f(0.0, 0.045), vec2f(0.15, 0.04), 0.02));
  white = min(white, orn);
  return vec2f(white, inner);
}

// --- Eye-in-triangle emblem (replaces the club) ---------------------------------------
// An inverted engraving (eye-emblem.png): R = stroke coverage (drawn in holographic
// foil), G = the triangular white plate it sits on. Placed at rect = (centre, half-size).

/// Returns (plate coverage, foil coverage) at card point p; \`aa\` = pixel size.
fn emblem(p: vec2f, aa: f32) -> vec2f {
  let rel = (p - u.emblemRect.xy) / u.emblemRect.zw;
  if (any(abs(rel) > vec2f(1.0))) { return vec2f(0.0); }
  let uv = vec2f(rel.x, -rel.y) * 0.5 + 0.5;
  // Explicit LOD from the pixel footprint (shading runs after a non-uniform loop).
  let lod = log2(max(aa / u.emblemTexel, 1.0));
  let t = textureSampleLevel(emblem_tex, lin, uv, lod);
  let plate = smoothstep(0.3, 0.7, t.g);
  return vec2f(plate, saturate(t.r * 1.15) * plate);
}

/// Polished black marble: near-black stone with warped grey-white veins.
fn marble(p: vec2f) -> vec3f {
  let q = p * 2.2 + vec2f(3.1, 1.7);
  let warp = fbm(q * 1.3, 4);
  let v = fbm(q * 1.8 + vec2f(warp * 1.6, warp * 0.9), 5);
  let vein = smoothstep(0.03, 0.0, abs(v + 0.05));
  let fine = smoothstep(0.012, 0.0, abs(fbm(q * 5.0 + warp * 2.5, 4))) * 0.45;
  let cloud = 0.5 + 0.5 * fbm(q * 0.9 + 7.0, 3);
  let base = mix(vec3f(0.006, 0.006, 0.008), vec3f(0.02, 0.019, 0.022), cloud);
  return mix(base, vec3f(0.16, 0.157, 0.167), saturate(vein * 0.7 + fine * 0.35));
}

// --- Card body ---------------------------------------------------------------------------

fn sd_card(q: vec3f) -> f32 {
  return op_extrude(sd_round_box(q.xy, u.cardHalf, u.cardRadius), q.z, u.halfThickness);
}

fn card_normal(q: vec3f) -> vec3f {
  let e = vec2f(1.0, -1.0) * 0.0004;
  return normalize(e.xyy * sd_card(q + e.xyy) + e.yyx * sd_card(q + e.yyx) + e.yxy * sd_card(q + e.yxy) + e.xxx * sd_card(q + e.xxx));
}

// --- Lighting ------------------------------------------------------------------------------

struct Light { pos: vec3f, color: vec3f };

fn light(i: i32) -> Light {
  switch i {
    case 0: { return Light(u.light0.xyz, u.light0Color.rgb); }
    case 1: { return Light(u.light1.xyz, u.light1Color.rgb); }
    default: { return Light(u.light2.xyz, u.light2Color.rgb); }
  }
}

/// Glitter: small round flecks with random groove directions. (direction.xy, coverage)
fn glitter(p: vec2f) -> vec3f {
  let q = p * u.glitterScale;
  let cell = floor(q);
  let rnd = hash22(cell);
  let rnd2 = hash22(cell + 17.0);
  let present = step(1.0 - u.glitter, rnd.x);
  let fleck = smoothstep(0.32, 0.18, length(fract(q) - (0.3 + 0.4 * rnd2)));
  let a = rnd.y * TAU;
  return vec3f(cos(a), sin(a), present * fleck);
}

/// Holographic laminate: diffraction rainbow (grooves concentric around \`centre\`)
/// plus glitter flecks, from every light. Added on top of whatever is underneath.
fn holo(p: vec2f, centre: vec2f, pos: vec3f, n: vec3f, v: vec3f, ax: vec3f, ay: vec3f) -> vec3f {
  let r = p - centre + vec2f(1e-4, 0.0);
  let tangent2 = normalize(vec2f(-r.y, r.x));
  let t = normalize(ax * tangent2.x + ay * tangent2.y);
  let gl = glitter(p);
  let tg = normalize(ax * gl.x + ay * gl.y);
  var c = vec3f(0.0);
  for (var i = 0; i < 3; i++) {
    let lt = light(i);
    let lv = lt.pos - pos;
    let l = normalize(lv);
    let li = lt.color / dot(lv, lv);
    let rainbow = diffraction_grating(l, v, n, t, u.grooveSpacing, 0.08);
    let sparkle = diffraction_grating(l, v, n, tg, u.grooveSpacing, 0.35) * gl.z * 3.0;
    c += (rainbow + sparkle) * li;
  }
  return c * u.holoIntensity;
}

/// Silver holographic foil: metallic, thin-film tinted, rainbow laminate on top.
fn shade_holofoil(p: vec2f, centre: vec2f, pos: vec3f, n: vec3f, v: vec3f, ax: vec3f, ay: vec3f) -> vec3f {
  let film_t = u.filmThickness * (0.75 + 0.5 * fbm(p * 6.0 + 1.0, 3));
  let film = mix(vec3f(1.0), thin_film(saturate(dot(n, v)), film_t, 1.45), u.filmStrength);
  let m = Material(vec3f(0.9) * film, 0.18, 1.0);
  var c = ibl_specular_radiance(reflect(-v, n), 0.18) * film * u.envIntensity;
  for (var i = 0; i < 3; i++) {
    let lt = light(i);
    let lv = lt.pos - pos;
    c += lt.color / dot(lv, lv) * brdf_direct(m, n, v, normalize(lv));
  }
  return c + holo(p, centre, pos, n, v, ax, ay) * 1.5;
}

/// Holographic black marble: polished stone with an iridescent film and rainbow laminate.
fn shade_marble(p: vec2f, centre: vec2f, pos: vec3f, n: vec3f, v: vec3f, ax: vec3f, ay: vec3f) -> vec3f {
  let film_t = u.filmThickness * (0.75 + 0.5 * fbm(p * 3.0 + 4.0, 3));
  let film = mix(vec3f(1.0), thin_film(saturate(dot(n, v)), film_t, 1.45), u.filmStrength);
  let albedo = marble(p);
  let stone = Material(albedo, 0.35, 0.0);
  let gloss = Material(vec3f(0.0), u.foilRoughness, 0.0);
  let coat_f = f_schlick(vec3f(0.05), saturate(dot(n, v))).x;
  var c = ibl_irradiance(n) / PI * albedo * u.envIntensity;
  c += ibl_specular_radiance(reflect(-v, n), u.foilRoughness) * coat_f * film * u.envIntensity * 1.6;
  for (var i = 0; i < 3; i++) {
    let lt = light(i);
    let lv = lt.pos - pos;
    let l = normalize(lv);
    let li = lt.color / dot(lv, lv);
    c += li * (brdf_direct(stone, n, v, l) + brdf_direct(gloss, n, v, l) * film * 1.4);
  }
  return c + holo(p, centre, pos, n, v, ax, ay);
}

/// Matte uncoated stock / ink: diffuse with a very rough, faint specular, so the
/// white card reads as paper and only the holographic layers catch highlights.
fn shade_matte(albedo: vec3f, pos: vec3f, n: vec3f, v: vec3f) -> vec3f {
  let base = Material(albedo, 0.95, 0.0);
  var c = ibl_irradiance(n) / PI * albedo * u.envIntensity;
  for (var i = 0; i < 3; i++) {
    let lt = light(i);
    let lv = lt.pos - pos;
    c += lt.color / dot(lv, lv) * brdf_direct(base, n, v, normalize(lv));
  }
  return c;
}

fn shade_front(p: vec2f, pos: vec3f, n: vec3f, v: vec3f, aa: f32) -> vec3f {
  let ax = vec3f(1.0, 0.0, 0.0);
  let ay = vec3f(0.0, 1.0, 0.0);
  let s = (p - SPADE_CENTRE) / SPADE_SIZE;
  let spade = sd_spade_unit(s) * SPADE_SIZE;
  let marble_d = min(spade, min(sd_index(p), sd_index(-p)));
  let stone = smoothstep(aa, -aa, marble_d);

  var c = shade_matte(vec3f(0.97), pos, n, v);
  if (stone > 0.0) {
    var black = shade_marble(p, SPADE_CENTRE + vec2f(0.0, 0.05), pos, n, v, ax, ay);
    // White printed ornament and the tiny "mk7s" mark on the centre spade.
    if (spade < aa) {
      let orn = spade_ornament(s);
      let white_ink = smoothstep(aa, -aa, orn.x * SPADE_SIZE);
      if (white_ink > 0.0) { black = mix(black, shade_matte(vec3f(0.95), pos, n, v), white_ink); }
      // Eye-in-triangle emblem: white plate with holographic-foil engraving.
      let em = emblem(p, aa);
      if (em.x > 0.0) {
        black = mix(black, shade_matte(vec3f(0.95), pos, n, v), em.x);
        if (em.y > 0.0) { black = mix(black, shade_holofoil(p, u.emblemRect.xy, pos, n, v, ax, ay), em.y); }
      }
      // "mk7s": flat dark indigo, composited in post (see \`mark_ink\`), with a thin
      // white outline printed around it so it stands off the dark marble.
      let mark_d = sd_text_tex(mark_sdf, u.markRect, u.markScalePad, p);
      let outline = smoothstep(aa, -aa, mark_d - 0.0011);
      if (outline > 0.0) { black = mix(black, shade_matte(vec3f(0.95), pos, n, v), outline); }
      mark_ink = stone * smoothstep(aa, -aa, mark_d);
    }
    c = mix(c, black, stone);
  }
  return c;
}

fn shade_back(p: vec2f, pos: vec3f, n: vec3f, v: vec3f, aa: f32) -> vec3f {
  // Seen from behind, the card's local x axis points along -world x.
  let ax = vec3f(-1.0, 0.0, 0.0);
  let ay = vec3f(0.0, 1.0, 0.0);
  let inner = sd_round_box(p, u.cardHalf - vec2f(0.075), 0.03);
  let q = rot2(0.7853982) * p * 22.0;
  let lattice = min(abs(fract(q.x) - 0.5), abs(fract(q.y) - 0.5)) / 22.0 - 0.0013;
  let badge = sd_spade(p, vec2f(0.0, 0.0), 0.16);
  let ring = abs(length(p) - 0.2) - 0.004;
  var line_d = min(sd_frame(p), max(lattice, inner));
  line_d = max(line_d, -(length(p) - 0.24));
  line_d = min(line_d, min(badge, ring));
  let lines = smoothstep(aa, -aa, line_d);
  var c = shade_marble(p, vec2f(0.0), pos, n, v, ax, ay);
  if (lines > 0.0) {
    c = mix(c, shade_matte(vec3f(0.75, 0.74, 0.72), pos, n, v) + holo(p, vec2f(0.0), pos, n, v, ax, ay), lines);
  }
  return c;
}

fn shade_card(pos: vec3f, v: vec3f, footprint: f32) -> vec3f {
  let n = card_normal(pos);
  // Pixel footprint on the surface grows at grazing angles.
  let aa = footprint / max(abs(n.z) * 0.5 + 0.5 * abs(dot(n, v)), 0.15);
  if (n.z > 0.7) { return shade_front(pos.xy, pos, n, v, aa); }
  if (n.z < -0.7) { return shade_back(vec2f(-pos.x, pos.y), pos, n, v, aa); }
  // Edge: white paper core.
  return shade_matte(vec3f(0.8, 0.79, 0.77), pos, n, v);
}

@fragment
fn fs_main(fv: FullscreenOut) -> @location(0) vec4f {
  let ndc = vec2f(fv.uv.x * 2.0 - 1.0, 1.0 - fv.uv.y * 2.0);
  let far = u.invViewProj * vec4f(ndc, 1.0, 1.0);
  let ro = u.cameraPos;
  let rd = normalize(far.xyz / far.w - ro);

  // Bounding sphere around the card.
  let b = dot(ro, rd);
  let disc = b * b - (dot(ro, ro) - 1.2);
  if (disc < 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  var t = max(-b - sqrt(disc), 0.0);
  let t_end = -b + sqrt(disc);

  var hit = false;
  var closest = 1e9;
  var closest_t = t;
  for (var i = 0; i < 96; i++) {
    let d = sd_card(ro + rd * t);
    if (d < closest) {
      closest = d;
      closest_t = t;
    }
    if (d < 1e-4 * (1.0 + t)) {
      hit = true;
      break;
    }
    t += d;
    if (t > t_end) { break; }
  }

  // Anti-aliased silhouette: near misses become partial coverage.
  let footprint = closest_t * u.pixelAngle;
  var coverage = select(saturate(1.0 - closest / footprint), 1.0, hit);
  if (coverage <= 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let pos = ro + rd * select(closest_t, t, hit);
  let col = shade_card(pos, -rd, footprint);
  // Premultiplied: alpha < 1 lets the post background (the mark colour) show through the mark.
  let a = 1.0 - mark_ink * coverage;
  return vec4f(col * coverage * a, a);
}
`,oe="/labs/lighttemple/assets/eye-emblem-DthEN2il.png",ce="/labs/lighttemple/assets/yesteryear-latin-BIYptinc.woff2",w=[.63,.88],q=32*Math.PI/180,de='"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", Georgia, serif',fe='Yesteryear, "Brush Script MT", cursive',me=3018853,pe=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4,he=[16,8,0].map(e=>pe((me>>e&255)/255));function G(e){window.__ace={frames:0,error:e};const i=document.getElementById("fallback");i.textContent=e,i.hidden=!1}function C(e,i,n,c,d=1){const r=c/Math.max(e.baseline-e.padding,1),l=r*d,s=e.width/2,f=(e.padding+e.baseline)/2,m=i+(e.width/2-s)*l,p=n-(e.height/2-f)*r;return{rect:[m,p,e.width*l/2,e.height*r/2],scalePad:[Math.min(l,r),e.padding*Math.min(l,r)]}}async function ve(){const e=document.getElementById("stage"),i=await H(t=>t.reason!=="destroyed"&&G(`The GPU device was lost (${t.message}). Reload to try again.`)),{device:n}=i,c=i.presentationFormat,d=new N(e,n,c,{maxPixelRatio:2}),r=matchMedia("(prefers-reduced-motion: reduce)").matches,l=await j.create({device:n,format:c},{bloom:.05,bloomRadius:1.2,vignette:0,grain:0,exposure:1.6}),s=await ae.create(n);await s.setProcedural({kind:"studio"});const f=new le(n);try{const t=await(await fetch(ce)).arrayBuffer();document.fonts.add(await new FontFace("Yesteryear",t).load())}catch(t){console.warn("Yesteryear failed to load; using a fallback script.",t)}const[m,p,a]=await Promise.all([f.generate({text:"A",family:de,weight:400,size:220}),f.generate({text:"mk7s",family:fe,weight:400,size:160}),fetch(oe).then(t=>t.blob()).then(t=>createImageBitmap(t,{colorSpaceConversion:"none"}))]),b=n.createTexture({label:"eye-emblem",size:[a.width,a.height],format:"rgba8unorm",mipLevelCount:ne(a.width,a.height),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});n.queue.copyExternalImageToTexture({source:a},{texture:b},[a.width,a.height]),te(n,b);const h=[-w[0]+.115,w[1]-.17],k=C(m,h[0],h[1],.15,.72),M=[h[0],h[1]-.17],x=.21*.44,L=x*a.height/a.width,U=[0,.27*.44,x,L],S=C(p,0,.045*.44,.024),v=new Z(n,"Ace",{invViewProj:"mat4x4f",light0:"vec4f",light0Color:"vec4f",light1:"vec4f",light1Color:"vec4f",light2:"vec4f",light2Color:"vec4f",indexRect:"vec4f",markRect:"vec4f",emblemRect:"vec4f",cameraPos:"vec3f",pixelAngle:"f32",cardHalf:"vec2f",cardRadius:"f32",halfThickness:"f32",indexScalePad:"vec2f",indexPip:"vec2f",markScalePad:"vec2f",envIntensity:"f32",glitter:"f32",glitterScale:"f32",filmThickness:"f32",filmStrength:"f32",foilRoughness:"f32",anisotropy:"f32",grooveSpacing:"f32",holoIntensity:"f32",emblemTexel:"f32"}),P=await W(n,"ace-of-spades",O(K,Q,ee,Y,J,$,v.wgslStruct,s.wgslStruct,re,se)),R=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{}}]}),F=await n.createRenderPipelineAsync({label:"ace-of-spades",layout:n.createPipelineLayout({bindGroupLayouts:[R,s.bindGroupLayout]}),vertex:{module:P,entryPoint:"vs_fullscreen"},fragment:{module:P,entryPoint:"fs_main",targets:[{format:X}]}}),D=n.createBindGroup({layout:R,entries:[{binding:0,resource:{buffer:v.buffer}},{binding:1,resource:m.texture.createView()},{binding:2,resource:p.texture.createView()},{binding:3,resource:n.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"linear"})},{binding:4,resource:b.createView()}]}),u=new ie(e,{target:[0,0,0],distance:3.6,yaw:-.35,pitch:.12,minDistance:1.1,maxDistance:8,minPitch:-1.35,maxPitch:1.35,fovY:q,smoothing:.025,rotateSpeed:1.35,zoomSpeed:1.6});u.autoRotate=r?0:.12;const B=document.getElementById("hint"),T=()=>B.classList.add("gone");e.addEventListener("pointerdown",T,{once:!0}),e.addEventListener("wheel",T,{once:!0,passive:!0}),v.set("indexRect",k.rect).set("indexScalePad",k.scalePad).set("indexPip",M).set("markRect",S.rect).set("markScalePad",S.scalePad).set("emblemRect",U).set("emblemTexel",2*x/a.width).set("cardHalf",w).set("cardRadius",.055).set("halfThickness",.006).set("envIntensity",.8).set("glitter",.16).set("glitterScale",380).set("filmThickness",430).set("filmStrength",.6).set("foilRoughness",.2).set("anisotropy",.75).set("grooveSpacing",1500).set("holoIntensity",1.6),window.__ace={frames:0};let E=performance.now(),_=0;const A=t=>{requestAnimationFrame(A);const z=Math.min(.05,(t-E)/1e3);E=t,_+=z;const{size:g}=d;u.update(z,g.width/g.height),s.update();const I=r?0:_*.25;v.set("invViewProj",V.inverse(u.viewProjection)).set("cameraPos",u.position).set("pixelAngle",2*Math.tan(q/2)/g.height).set("light0",[1.6*Math.cos(I),2,2.6,0]).set("light0Color",[14,13.2,12.2,0]).set("light1",[-2.4,-.6+.8*Math.sin(I*.7),1.8,0]).set("light1Color",[5,6,8,0]).set("light2",[.6,1.6,-2.6,0]).set("light2Color",[10,9.5,9,0]).upload();const y=n.createCommandEncoder({label:"ace"}),o=y.beginRenderPass({colorAttachments:[{view:l.scene(g).view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});o.setPipeline(F),o.setBindGroup(0,D),o.setBindGroup(1,s.bindGroup),o.draw(3),o.end(),l.render(y,d.currentTexture().createView(),{time:_,background:he}),n.queue.submit([y.finish()]),window.__ace.frames++};requestAnimationFrame(A)}ve().catch(e=>{console.error(e),G(e instanceof Error&&e.name==="WebGpuUnavailableError"?`${e.message}`:`Something went wrong: ${e instanceof Error?e.message:String(e)}`)});
