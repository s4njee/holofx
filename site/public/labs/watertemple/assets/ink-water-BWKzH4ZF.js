import{t as e}from"./meta-CuTGwClb.js";import{n as t}from"./types-ci2WwWg0.js";import{n}from"./profiler-Bi27xYp-.js";import{n as r}from"./targets-Dcl181Ey.js";import{n as i,t as a}from"./uniforms-BE1XSnDx.js";import{t as o}from"./shader-Cd_FDUy8.js";import{n as s}from"./pointer-BbHa9JHH.js";import{r as c,t as l}from"./fullscreen-Dq3Mq0Js.js";import{t as u}from"./fluid-Bv7YHznw.js";import{t as d}from"./fluid-stir-BpRr4raR.js";import{t as f}from"./composite-pnrshC2W.js";import{t as ee}from"./display-BPDW9Ss9.js";import{t as p}from"./paper-3zxp3Ela.js";var m=`// pigment-flow.wgsl -- the paper holds the water back: damps the solver's velocity where the paper is
// dry (a custom pass for \`fluid.hooks.forces\`, see src/gpu/sim/pigment.ts). Water in the fibres of dry
// paper does not flow, so a face loses speed at the rate \`drag\` (1 / s) times how dry the paper under
// it is: v *= exp(-drag * (1 - ws) * dt). The pressure projection that follows removes the
// divergence this makes.
//
// Bindings: 0 U (PigmentUniforms: grid = velocity cells, size = dye texels, dt, drag, wet_lo/hi),
// 1 vel_in (the staggered velocity, (W+1) x (H+1) rgba16float: u in .x on the left face of a cell,
// v in .y on its top face; the last row of u and column of v repeat the previous one), 2 wet_in
// (r32float, dye sized), 3 vel_out (rgba16float storage, same size as vel_in). Entry point cs_flow.

#include "pigment_uniforms.wgsl"

@group(0) @binding(0) var<uniform> U: PigmentUniforms;
@group(0) @binding(1) var vel_in: texture_2d<f32>;
@group(0) @binding(2) var wet_in: texture_2d<f32>;
@group(0) @binding(3) var vel_out: texture_storage_2d<rgba16float, write>;

// Shaped wetness under a point given in cells of the velocity grid.
fn wetness_at(p_cells: vec2f) -> f32 {
  let uv = p_cells / vec2f(U.grid);
  let t = clamp(vec2i(floor(uv * vec2f(U.size))), vec2i(0), vec2i(U.size) - vec2i(1));
  return smoothstep(U.wet_lo, U.wet_hi, textureLoad(wet_in, t, 0).x);
}

@compute @workgroup_size(16, 16)
fn cs_flow(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= U.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  let g = vec2i(U.grid);
  let v = textureLoad(vel_in, c, 0).xy;
  // The face each component belongs to (the padding row / column repeats the last real face).
  let u_at = vec2f(f32(c.x), f32(min(c.y, g.y - 1)) + 0.5);
  let v_at = vec2f(f32(min(c.x, g.x - 1)) + 0.5, f32(c.y));
  let du = exp(-U.drag * (1.0 - wetness_at(u_at)) * U.dt);
  let dv = exp(-U.drag * (1.0 - wetness_at(v_at)) * U.dt);
  textureStore(vel_out, c, vec4f(v.x * du, v.y * dv, 0.0, 0.0));
}
`,h=`// pigment-step.wgsl -- one step of the pigment layer (src/gpu/sim/pigment.ts) on the dye grid: the
// transport of the suspended pigment (diffusion and edge drift), its exchange with the paper
// (deposition and lifting), and the water that makes it all move (wetness). No advection: the flow
// carried the pigment already, this is what happens to it in the water and on the paper.
//
// Bindings (the layout is spelled out in pigment.ts; an entry point uses only some of them):
//   0 U         PigmentUniforms (the generated pigment_uniforms.wgsl)
//   1 dye_in    suspended pigment, rgba16float: rgb = optical density (absorbance) per channel
//   2 stain_in  deposited pigment, rgba16float: rgb = optical density, a = shaped wetness for shading
//   3 wet_in    wetness, r32float, read with textureLoad
//   4 paper     the paper tile, rgba8unorm: r = grain height, g = fibre (wash.wgsl wash_paper_tile),
//               one tile texel per dye texel, repeating
//   5 dye_out   rgba16float storage, the new suspended pigment (a = mean density, for buoyancy)
//   6 stain_out rgba16float storage (cs_step only)
//   7 wet_out   r32float storage (cs_step only)
//
// Entry points
//   cs_transport   diffusion and drift only: dye_in -> dye_out. Run n - 1 times when a step needs n
//                  sub-steps (see pigmentSubsteps in pigment.ts).
//   cs_step        the same transport, then the settle (deposit, lift, fade) and the wetness update:
//                  writes all three outputs. The last (or only) sub-step.
//
// THE MODEL, all of it local to a texel and its four neighbours, in texels and per-step fractions.
//
// 1. Wetness w in [0, 1] is the film of water on the paper. Every rule below looks at the SHAPED
//    wetness ws = smoothstep(wet_lo, wet_hi, w), which is 0 on dry paper, 1 once there is a film, and
//    changes over the thin fringe where a film runs out: the wet edge.
//
// 2. Diffusion. Between a texel and a neighbour the pigment exchanges k * (c_neighbour - c) with
//    k = min(w_diff * wetter * paper, w_cap):
//      w_diff   D dt / dx^2, the diffusivity D (image heights^2 / s) as a per-step fraction
//      wetter   mix(dry_diff, 1, the mean ws of the two texels): pigment barely spreads on dry paper
//      paper    1 + feather * (3 fibre + 1.6 (grain - 0.5)) of the mean of the two texels: streaks of
//               fibre carry pigment further, which is the feathering of a wet edge
//      w_cap    the stability cap: the sum of the four k and of the drift below stays <= 1, so no
//               texel can lose more than it has and nothing goes negative
//    k is symmetric (the same for a -> b and b -> a), so what one texel loses its neighbour gains:
//    diffusion conserves the total pigment exactly, up to the rounding of the 16-bit store. The
//    variance of a spreading point grows by 2 k per step and axis, linearly in time.
//
// 3. Edge drift. Where the film thins the water is drawn out towards the drier paper and carries
//    pigment with it: the bloom of a drop on wet paper, and, where a flat-topped film ends, the
//    "coffee ring" of edge darkening. Across a face from a to b the pigment moves
//    s = edge_v * smoothstep(0.3 edge_g0, edge_g0, |grad w|) * (w_a - w_b) / |grad w| texels per
//    step, from the wetter texel to the drier one, as an UPWIND flux (the donor texel's value
//    leaves): conservative, positive, and it stops at once where the film is uniform. |grad w| is the
//    gradient of the raw wetness at the face (normal difference and mean tangential central
//    difference), so the drift is isotropic: with a per-axis sign it drew diamonds and crosses round
//    every drop. The smoothstep is a dead zone: a film that is only nearly flat
//    (the ripple of a stroke laid in capsules is a percent or two) must not pull pigment into bars,
//    which it does for any gradient however small if the drift is saturating (seen: stripes across
//    every stroke, one per frame of the drag).
//
// 4. Settling. Suspended pigment c moves into the paper (the stain S) at the rate
//      kd = absorb * mix(1, wet_stick, ws) * gran      deposited: 1 - exp(-kd dt) of c per step
//    fast on dry paper, slow under water, and faster in the valleys of the paper than on its
//    peaks (gran = 1 + granulation * 1.4 * (0.5 - grain)): granulation. Re-wetted stain dissolves
//    again at the rate lift * ws^2 (back-runs). What leaves c enters S and the other way round, so
//    c + S is conserved by this pass too. A residue below dep_floor deposits in one go (half
//    floats cannot add a tiny amount to a big stain, and it would otherwise hang about for ever).
//    Both then fade by exp(-fade dt): washing out, 0 keeps everything.
//
// 5. Wetness. It spreads by capillary action (wet_spread, a plain diffusion), then dries: w * dry_decay
//    (exponential: the edge of a wash stays where it is for a long time and thins) minus dry_lin
//    (so it does reach zero), and never falls under wet_floor (1 = the whole sheet is under water).

#include "pigment_uniforms.wgsl"

@group(0) @binding(0) var<uniform> U: PigmentUniforms;
@group(0) @binding(1) var dye_in: texture_2d<f32>;
@group(0) @binding(2) var stain_in: texture_2d<f32>;
@group(0) @binding(3) var wet_in: texture_2d<f32>;
@group(0) @binding(4) var paper: texture_2d<f32>;
@group(0) @binding(5) var dye_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var stain_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var wet_out: texture_storage_2d<r32float, write>;

// The texel itself for a neighbour outside the grid: no flux through the edge (a closed box).
fn texel(p: vec2i) -> vec2i {
  return clamp(p, vec2i(0), vec2i(U.size) - vec2i(1));
}

fn shaped(w: f32) -> f32 {
  return smoothstep(U.wet_lo, U.wet_hi, w);
}

fn paper_at(p: vec2i) -> vec2f {
  return textureLoad(paper, p % vec2i(textureDimensions(paper)), 0).xy;
}

// 0 for NaN and +-Inf, x otherwise (tests the exponent bits: \`x != x\` may be folded away).
fn finite_or_zero(x: f32) -> f32 {
  return select(x, 0.0, (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u);
}

fn finite3(v: vec3f) -> vec3f {
  return vec3f(finite_or_zero(v.x), finite_or_zero(v.y), finite_or_zero(v.z));
}

// Raw wetness at an offset from t.
fn wet_at(t: vec2i, d: vec2i) -> f32 {
  return textureLoad(wet_in, texel(t + d), 0).x;
}

// What this texel gains across the face to its neighbour at offset \`d\` (a unit step along x or y):
// diffusion plus upwind drift. The neighbour computes the negative of the same number for the same face.
fn exchange(t: vec2i, d: vec2i, c: vec3f, w: f32, p: vec2f) -> vec3f {
  let n = texel(t + d);
  let cn = textureLoad(dye_in, n, 0).rgb;
  let wr = wet_at(t, d);
  let ws = shaped(w);
  let wn = shaped(wr);
  let pn = paper_at(n);
  let wetter = mix(U.dry_diff, 1.0, 0.5 * (ws + wn));
  let fibre = 0.5 * (p.y + pn.y);
  let grain = 0.5 * (p.x + pn.x);
  let rough = max(1.0 + U.feather * (3.0 * fibre + 1.6 * (grain - 0.5)), 0.2);
  let k = min(U.w_diff * wetter * rough, U.w_cap);

  // Drift: along the face normal, with the speed set by the size of the whole gradient of the RAW
  // wetness at the face (the normal difference, and the mean of the two texels' central differences
  // along the face), so a film that thins on a slant drives pigment the same fast as one that thins
  // along an axis, instead of moving it along x and y separately (which draws diamonds). s > 0 moves
  // pigment from this texel to the neighbour (this one is the wetter).
  let side = vec2i(d.y, d.x);
  let along = 0.25 * (wet_at(t, side) - wet_at(t, -side) + wet_at(t + d, side) - wet_at(t + d, -side));
  let normal = w - wr;
  let slope = sqrt(normal * normal + along * along);
  var s = 0.0;
  if (slope > 1e-9) {
    s = U.edge_v * smoothstep(0.3 * U.edge_g0, U.edge_g0, slope) * normal / slope;
  }
  return k * (cn - c) + max(-s, 0.0) * cn - max(s, 0.0) * c;
}

fn transport(t: vec2i) -> vec3f {
  let c = finite3(textureLoad(dye_in, t, 0).rgb);
  let w = textureLoad(wet_in, t, 0).x;
  let p = paper_at(t);
  var out = c;
  out += exchange(t, vec2i(1, 0), c, w, p);
  out += exchange(t, vec2i(-1, 0), c, w, p);
  out += exchange(t, vec2i(0, 1), c, w, p);
  out += exchange(t, vec2i(0, -1), c, w, p);
  return max(out, vec3f(0.0));
}

fn mean3(v: vec3f) -> f32 {
  return (v.x + v.y + v.z) / 3.0;
}

@compute @workgroup_size(16, 16)
fn cs_transport(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= U.size)) {
    return;
  }
  let t = vec2i(id.xy);
  let c = transport(t);
  textureStore(dye_out, t, vec4f(c, mean3(c)));
}

@compute @workgroup_size(16, 16)
fn cs_step(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= U.size)) {
    return;
  }
  let t = vec2i(id.xy);
  let c1 = transport(t);

  // Settling.
  let w = textureLoad(wet_in, t, 0).x;
  let ws = shaped(w);
  let p = paper_at(t);
  let s = finite3(textureLoad(stain_in, t, 0).rgb);
  let gran = clamp(1.0 + U.gran * 1.4 * (0.5 - p.x), 0.1, 3.5);
  let kd = U.absorb * mix(1.0, U.wet_stick, ws) * gran;
  var dep = c1 * (1.0 - exp(-kd * U.dt));
  if (kd > 0.0) {
    dep = select(dep, c1, c1 < vec3f(U.dep_floor));
  }
  let lifted = s * (1.0 - exp(-U.lift * ws * ws * U.dt));
  let c2 = min(max(c1 - dep + lifted, vec3f(0.0)) * U.keep, vec3f(U.dye_max));
  let s2 = min(max(s + dep - lifted, vec3f(0.0)) * U.keep, vec3f(U.dye_max));

  // Wetness.
  var lap = textureLoad(wet_in, texel(t + vec2i(1, 0)), 0).x - w;
  lap += textureLoad(wet_in, texel(t + vec2i(-1, 0)), 0).x - w;
  lap += textureLoad(wet_in, texel(t + vec2i(0, 1)), 0).x - w;
  lap += textureLoad(wet_in, texel(t + vec2i(0, -1)), 0).x - w;
  var w2 = (w + U.wet_spread * lap) * U.dry_decay - U.dry_lin;
  w2 = clamp(max(finite_or_zero(w2), U.wet_floor), 0.0, 1.0);

  textureStore(dye_out, t, vec4f(c2, mean3(c2)));
  textureStore(stain_out, t, vec4f(s2, shaped(w2)));
  textureStore(wet_out, t, vec4f(w2, 0.0, 0.0, 0.0));
}
`,g=`// pigment-water.wgsl -- adds water: capsule splats of wetness, the brush of the pigment layer
// (src/gpu/sim/pigment.ts). The same capsule footprint as the solver's splats (fluid-core.wgsl): a
// segment a -> b in uv inflated by a Gaussian of radius \`shape.x\` image heights, with a smooth start
// and end ramp \`shape.y\`, so segments laid end to end add up to a uniform stroke.
//
// Bindings: 0 W (WaterUniforms), 1 wet_in (r32float), 2 splats (read-only storage), 3 wet_out
// (r32float storage). Entry point cs_water: wet_out = min(1, wet_in + the splats' water). An amount
// above 1 makes a flat-topped film with a steeper edge.
//
// RAGGED EDGES. Paper does not wet evenly, so a film's outline is never a circle. The water a splat
// adds at a point is scaled by 1 + W.ragged * n, with n two octaves of gradient noise of the canvas (fixed
// to the sheet, the same for every splat, about 12 and 30 features per image height): where the paper takes
// water more readily the film reaches further. 0 gives the plain Gaussian capsules.

#include "noise.wgsl"
#include "water_uniforms.wgsl"

struct Splat {
  seg: vec4f,
  shape: vec4f,
  value: vec4f,
}

@group(0) @binding(0) var<uniform> W: WaterUniforms;
@group(0) @binding(1) var wet_in: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> splats: array<Splat>;
@group(0) @binding(3) var wet_out: texture_storage_2d<r32float, write>;

fn splat_weight(uv: vec2f, s: Splat) -> f32 {
  let k = vec2f(W.aspect, 1.0);
  let a = s.seg.xy * k;
  let ab = s.seg.zw * k - a;
  let p = uv * k;
  let len = length(ab);
  let ramp = s.shape.y;
  var along = 1.0;
  var d = length(p - a);
  if (len > 1e-6) {
    let dir = ab / len;
    let rel = p - a;
    let t = dot(rel, dir);
    if (ramp > 0.0) {
      along = smoothstep(-ramp, ramp, t) * (1.0 - smoothstep(len - ramp, len + ramp, t));
      d = length(rel - dir * t);
    } else {
      d = length(rel - dir * clamp(t, 0.0, len));
    }
  }
  let x = d / max(s.shape.x, 1e-5);
  if (x > 3.0) {
    return 0.0;
  }
  return along * exp(-x * x);
}

@compute @workgroup_size(16, 16)
fn cs_water(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= W.size)) {
    return;
  }
  let t = vec2i(id.xy);
  let uv = (vec2f(t) + 0.5) / vec2f(W.size);
  var w = textureLoad(wet_in, t, 0).x;
  var rough = 1.0;
  if (W.ragged != 0.0) {
    let p = uv * vec2f(W.aspect, 1.0);
    rough = max(1.0 + W.ragged * (0.7 * gnoise_2d(p * 12.0 + vec2f(3.1, 7.7)) + 0.4 * gnoise_2d(p * 30.0 + vec2f(9.3, 1.9))), 0.0);
  }
  for (var k = 0u; k < W.count; k++) {
    let s = splat_weight(uv, splats[k]);
    w += s * splats[k].value.x * rough;
  }
  textureStore(wet_out, t, vec4f(clamp(w, 0.0, 1.0), 0.0, 0.0, 0.0));
}
`,te=.12,ne=.12,re=.0015,_=.03,ie=.3,ae=.02,oe=16,v=12,y=`rgba16float`,b=`r32float`,x={diffusion:6e-5,dryDiffusion:.03,feather:.5,edgeSpeed:.006,absorption:.6,wetAbsorption:.2,granulation:.4,lift:.2,drying:.08,wetSpread:2e-5,wetFloor:0,dryDrag:14,fade:0,ragged:0,maxSubsteps:3,dyeMax:64},S=i(`PigmentUniforms`,{size:`vec2u`,grid:`vec2u`,dt:`f32`,w_diff:`f32`,w_cap:`f32`,feather:`f32`,dry_diff:`f32`,edge_v:`f32`,edge_g0:`f32`,absorb:`f32`,wet_stick:`f32`,gran:`f32`,lift:`f32`,keep:`f32`,dep_floor:`f32`,wet_lo:`f32`,wet_hi:`f32`,wet_spread:`f32`,dry_decay:`f32`,dry_lin:`f32`,wet_floor:`f32`,drag:`f32`,dye_max:`f32`}),C=i(`WaterUniforms`,{size:`vec2u`,count:`u32`,aspect:`f32`,ragged:`f32`}),w=(e,t,n)=>Math.min(n,Math.max(t,e)),T=(e,t)=>Number.isFinite(e)?e:t,E=e=>Math.max(0,T(e,0));function D(e,t,n){let r=E(e.diffusion)*E(t)*n*n,i=Math.round(w(T(e.maxSubsteps,3),1,8));return w(Math.ceil(r/te),1,i)}var O=GPUShaderStage.COMPUTE,k=(e,t)=>({binding:e,visibility:O,texture:{sampleType:t}}),A=(e,t)=>({binding:e,visibility:O,storageTexture:{access:`write-only`,format:t}}),j=e=>({binding:e,visibility:O,buffer:{type:`uniform`}});function M(e,t){let n=t===`rgba16float`?`float`:`unfilterable-float`;switch(e){case`step`:return[j(0),k(1,n),k(2,n),k(3,`unfilterable-float`),k(4,`float`),A(5,t),A(6,t),A(7,b)];case`water`:return[j(0),k(1,`unfilterable-float`),{binding:2,visibility:O,buffer:{type:`read-only-storage`}},A(3,b)];case`flow`:return[j(0),k(1,`float`),k(2,`unfilterable-float`),A(3,y)]}}var N={transport:{source:`step`,entry:`cs_transport`,layout:`step`},step:{source:`step`,entry:`cs_step`,layout:`step`},water:{source:`water`,entry:`cs_water`,layout:`water`},flow:{source:`flow`,entry:`cs_flow`,layout:`flow`}},P=new WeakMap,F=new WeakMap,I=new WeakMap;function L(e,t,n){let r=I.get(e);r||I.set(e,r=new Map);let i=`${t}:${n}`,a=r.get(i);return a||(a=e.createBindGroupLayout({label:`pigment ${i} layout`,entries:M(t,n)}),r.set(i,a)),a}function R(e,t,n){let r=F.get(e);r||F.set(e,r=new Map);let i=`${t}:${n}`,a=r.get(i);if(!a){let s={step:h,water:g,flow:m}[t];a=o(e,{label:`sim/pigment-${t}.wgsl${n===`rgba16float`?``:` (${n})`}`,code:t===`step`?s.replaceAll(`rgba16float`,n):s,chunks:{"pigment_uniforms.wgsl":S.wgsl,"water_uniforms.wgsl":C.wgsl}}),r.set(i,a)}return a}function z(e,t,n){let r=P.get(e);r||P.set(e,r=new Map);let i=N[t],a=i.source===`step`?n:`rgba16float`,o=`${t}:${a}`,s=r.get(o);if(!s){let t=L(e,i.layout,a);s={layout:t,pipeline:e.createComputePipeline({label:`pigment ${i.entry} ${a}`,layout:e.createPipelineLayout({bindGroupLayouts:[t]}),compute:{module:R(e,i.source,a),entryPoint:i.entry}})},r.set(o,s)}return s}var B=1,V=new WeakMap;function H(e){let t=V.get(e);return t===void 0&&V.set(e,t=B++),t}function se(e){let{device:t,profiler:r=n,label:i=`pigment`,format:o=y}=e,s={...x,...e.params},c=Math.max(1,Math.round(e.width)),l=Math.max(1,Math.round(e.height)),u=!1,d=0,f=!1,ee=1,p=[c,l],m=a(t,S,`${i} params`),h=a(t,C,`${i} water params`),g=t.createBuffer({label:`${i} water splats`,size:3072,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),O=new Float32Array(768),k=0,A=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST;function j(e,n){let r=t.createTexture({label:`${i} ${e}`,size:[c,l],format:n,usage:A});return{texture:r,view:r.createView({label:`${i} ${e} view`})}}let M=t.createTexture({label:`${i} flat paper`,size:[1,1],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});t.queue.writeTexture({texture:M},new Uint8Array([128,0,0,255]),{},[1,1]);let N=M.createView(),P=N,F,I,L=[],R=0,B=0,V=new Map;function se(){F=[j(`stain 0`,o),j(`stain 1`,o)],I=[j(`wetness 0`,b),j(`wetness 1`,b)],L=[],R=0,B=0,V.clear(),d++}function U(){for(let e of[...F,...I,...L])e.texture.destroy()}se();let W=e=>e.view;function G(e){for(;L.length<e;)L.push(j(`scratch ${L.length}`,o))}function K(e,t){let n=w(E(s.diffusion),0,.05),r=l*l,i=e/t,a=E(s.drying);m.set({size:[c,l],grid:[Math.max(1,Math.round(p[0])),Math.max(1,Math.round(p[1]))],dt:e,w_diff:n*i*r,w_cap:te,feather:w(T(s.feather,0),0,2),dry_diff:w(T(s.dryDiffusion,0),0,1),edge_v:Math.min(E(s.edgeSpeed)*i*l,ne),edge_g0:ae,absorb:E(s.absorption),wet_stick:w(T(s.wetAbsorption,0),0,1),gran:w(T(s.granulation,0),0,1),lift:E(s.lift),keep:Math.exp(-E(s.fade)*e),dep_floor:re,wet_lo:_,wet_hi:ie,wet_spread:Math.min(E(s.wetSpread)*e*r,.2),dry_decay:Math.exp(-a*e),dry_lin:.04*a*e,wet_floor:w(T(s.wetFloor,0),0,1),drag:E(s.dryDrag),dye_max:w(T(s.dyeMax,64),1,256)}),m.upload()}function q(e,n,r){let i=F[R],a=F[1-R],s=I[B],c=I[1-B],l=[e,H(n),H(r),R,B,H(P)].join(`|`),u=V.get(l);return u||(u=t.createBindGroup({label:`pigment ${e}`,layout:z(t,e,o).layout,entries:[{binding:0,resource:{buffer:m.buffer}},{binding:1,resource:n},{binding:2,resource:W(i)},{binding:3,resource:W(s)},{binding:4,resource:P},{binding:5,resource:r},{binding:6,resource:W(a)},{binding:7,resource:W(c)}]}),V.set(l,u)),u}function J(e,n,r,i,a){e.setPipeline(z(t,n,o).pipeline),e.setBindGroup(0,r),e.dispatchWorkgroups(Math.ceil(i/oe),Math.ceil(a/oe))}let Y={params:s,get width(){return c},get height(){return l},get generation(){return d},format:o,get stain(){return{texture:F[R].texture,view:F[R].view,slot:R}},get wet(){return{texture:I[B].texture,view:I[B].view,slot:B}},get lastSubsteps(){return ee},setPaper(e){P=e??N,V.clear()},addWater(e,t,n,r,i=0){if(k>=64||![e[0],e[1],t[0],t[1],n,i,r].every(Number.isFinite))return!1;let a=k*v;return O.set([e[0],e[1],t[0],t[1]],a),O.set([Math.max(n,1e-4),Math.max(i,0),0,0],a+4),O.set([r,0,0,0],a+8),k++,!0},beginFrame(e){if(f=!0,u||k===0)return;t.queue.writeBuffer(g,0,O,0,k*v),h.set({size:[c,l],count:k,aspect:c/l,ragged:w(T(s.ragged,0),0,1)}),h.upload();let n=t.createBindGroup({label:`pigment water`,layout:z(t,`water`,o).layout,entries:[{binding:0,resource:{buffer:h.buffer}},{binding:1,resource:W(I[B])},{binding:2,resource:{buffer:g}},{binding:3,resource:W(I[1-B])}]}),r=e.beginComputePass({label:`pigment water`});J(r,`water`,n,c,l),r.end(),B=1-B,k=0},step(e,t){if(u)return;let n=w(T(t.dt,1/60),1e-4,.1);t.grid&&(p=[t.grid.width,t.grid.height]);let i=D(s,n,l);ee=i,K(n,i),G(i>1?Math.min(2,i-1):0);let a=e.beginComputePass({label:`pigment step`,timestampWrites:f?r.pass(`pigment`):void 0});f=!1;let o=t.read;for(let e=0;e<i-1;e++){let t=W(L[e%2]);J(a,`transport`,q(`transport`,o,t),c,l),o=t}J(a,`step`,q(`step`,o,t.write),c,l),a.end(),R=1-R,B=1-B},dampFlow(e){if(u||!(s.dryDrag>0)||s.wetFloor>=1)return!1;p=[e.grid.width,e.grid.height];let n=w(T(e.dt,1/60),1e-4,.1);K(n,D(s,n,l));let r=[`flow`,H(e.read),H(e.write),B].join(`|`),i=V.get(r);i||(i=t.createBindGroup({label:`pigment flow`,layout:z(t,`flow`,o).layout,entries:[{binding:0,resource:{buffer:m.buffer}},{binding:1,resource:e.read},{binding:2,resource:W(I[B])},{binding:3,resource:e.write}]}),V.set(r,i));let a=e.encoder.beginComputePass({label:`pigment flow`});return J(a,`flow`,i,e.grid.width+1,e.grid.height+1),a.end(),!0},attach(e){e.hooks.dye=e=>e.grid.dyeWidth!==c||e.grid.dyeHeight!==l?!1:(Y.step(e.encoder,{dt:e.dt,read:e.read,write:e.write,grid:{width:e.grid.width,height:e.grid.height}}),!0),e.hooks.forces=e=>e.grid.dyeWidth===c&&e.grid.dyeHeight===l&&Y.dampFlow(e)},detach(e){e.hooks.dye=void 0,e.hooks.forces=void 0},resize(e,t){let n=Math.max(1,Math.round(e)),r=Math.max(1,Math.round(t));return u||n===c&&r===l?!1:(U(),c=n,l=r,k=0,se(),!0)},reset(e){k=0;let t=w(T(s.wetFloor,0),0,1);for(let t of[...F,...L])e.beginRenderPass({label:`${i} clear`,colorAttachments:[{view:t.view,loadOp:`clear`,storeOp:`store`}]}).end();for(let n of I)e.beginRenderPass({label:`${i} clear wetness`,colorAttachments:[{view:n.view,loadOp:`clear`,storeOp:`store`,clearValue:[t,0,0,0]}]}).end();R=0,B=0},destroy(){u||(u=!0,U(),M.destroy(),m.destroy(),h.destroy(),g.destroy())}};return Y}var U=i(`DisplayParams`,{paper:`vec3f`,aspect:`f32`,dye_size:`vec2f`,tile:`f32`,strength:`f32`,gran:`f32`,grain:`f32`,wet_look:`f32`,debug_gain:`f32`,vignette:`f32`,mode:`u32`,view:`u32`}),W=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4;function G(e){let t=parseInt(e.replace(`#`,``),16);return[t>>16&255,t>>8&255,t&255].map(e=>W(e/255))}function K(e){return[0,1,2].map(t=>-Math.log(Math.min(1,Math.max(.02,e[t]))))}var q={indigo:`#31469b`,sumi:`#262a33`,crimson:`#c0304a`,ochre:`#d9a02e`,viridian:`#2a9478`,sienna:`#9a5530`,violet:`#7442a0`,cobalt:`#2f7ac2`},J=Object.keys(q),Y=[`indigo`,`ochre`,`crimson`,`viridian`,`cobalt`,`sienna`,`violet`],X=[...J,`mixed`],ce=.75,le={cream:`#f3ebdc`,white:`#f7f6f2`,rice:`#ebe5d3`,kraft:`#cdb28a`,night:`#10141b`},Z=Object.keys(le),ue=[`48`,`64`,`96`,`128`],de=[`256`,`384`,`512`,`768`],fe=[`maccormack`,`semi-lagrangian`],pe=[`ink`,`clean water`],me=[`press only`,`hover stirs`,`off`],he=[`scrolls the page`,`paints`],ge=[`paint`,`wetness`,`deposited`,`suspended`,`velocity`],Q=256,$=1.5;function _e(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}var ve=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)},ye=t({meta:e,params:{resolution:{type:`select`,default:`64`,options:ue,label:`Velocity cells (short side; re-creates the fluid)`},dyeResolution:{type:`select`,default:`384`,options:de,label:`Pigment texels (short side; re-creates the fluid)`},ink:{type:`select`,default:`mixed`,options:X,label:`Ink`},brush:{type:`select`,default:`ink`,options:pe,label:`Brush`},size:{type:`number`,default:.035,min:.012,max:.1,step:.001,label:`Brush size (canvas heights)`},load:{type:`number`,default:1.5,min:0,max:2,step:.01,label:`Ink on the brush`},water:{type:`number`,default:1,min:0,max:2,step:.01,label:`Water on the brush`},push:{type:`number`,default:.1,min:0,max:2,step:.01,label:`Push (fraction of pointer velocity)`},submerged:{type:`number`,default:0,min:0,max:1,step:.01,label:`Submerged (0 dry paper, 1 ink in a pool)`},advection:{type:`select`,default:`maccormack`,options:fe,label:`Pigment advection (MacCormack is crisp, semi-Lagrangian soft and cheaper)`},diffusion:{type:`number`,default:6e-5,min:0,max:3e-4,step:1e-6,label:`Diffusion (heights² / s)`},feather:{type:`number`,default:.6,min:0,max:1.5,step:.01,label:`Feathering along paper fibres`},viscosity:{type:`number`,default:.004,min:0,max:.03,step:5e-4,label:`Viscosity (heights² / s)`},flowDecay:{type:`number`,default:1.2,min:.1,max:4,step:.01,label:`Flow decay (1 / s)`},swirl:{type:`number`,default:0,min:0,max:20,step:.5,label:`Swirl (vorticity confinement)`},settling:{type:`number`,default:0,min:0,max:1,step:.01,label:`Settling (pigment sinks)`},absorption:{type:`number`,default:.7,min:0,max:4,step:.01,label:`Absorption into dry paper (1 / s)`},wetAbsorption:{type:`number`,default:.2,min:0,max:1,step:.01,label:`Absorption while wet (fraction)`},drying:{type:`number`,default:.15,min:0,max:.5,step:.005,label:`Drying speed (1 / s)`},dryDrag:{type:`number`,default:14,min:0,max:40,step:.5,label:`Dry paper holds the flow (1 / s)`},maxSubsteps:{type:`number`,default:2,min:1,max:6,step:1,label:`Diffusion sub-steps at most (cost)`},ragged:{type:`number`,default:.5,min:0,max:1,step:.01,label:`Ragged wet edges (uneven paper)`},wicking:{type:`number`,default:.03,min:0,max:1,step:.01,label:`Wicking: diffusion on dry paper (fraction of wet)`},wetSpread:{type:`number`,default:1e-5,min:0,max:1e-4,step:1e-6,label:`Water creep on paper (heights² / s)`},edgeDarkening:{type:`number`,default:.4,min:0,max:1,step:.01,label:`Edge darkening`},granulation:{type:`number`,default:.5,min:0,max:1,step:.01,label:`Granulation`},lift:{type:`number`,default:.25,min:0,max:1,step:.01,label:`Back-runs (re-wetting lifts stain, 1 / s)`},fade:{type:`number`,default:.012,min:0,max:.2,step:.001,label:`Washing out (1 / s)`},paper:{type:`select`,default:`cream`,options:Z,label:`Paper`},paperGrain:{type:`number`,default:.6,min:0,max:1,step:.01,label:`Paper grain and fibres`},wetLook:{type:`number`,default:.6,min:0,max:1,step:.01,label:`Wet sheen`},strength:{type:`number`,default:1,min:.3,max:2.5,step:.01,label:`Pigment strength`},ambient:{type:`number`,default:.5,min:0,max:1,step:.01,label:`Idle drops and strokes`},pointer:{type:`select`,default:`press only`,options:me,label:`Pointer`},touch:{type:`select`,default:`scrolls the page`,options:he,label:`Touch drags`},view:{type:`select`,default:`paint`,options:ge,label:`View`},debugGain:{type:`number`,default:1,min:.1,max:10,step:.1,label:`Debug view gain`},stepsPerFrame:{type:`number`,default:0,min:0,max:64,step:1,label:`Steps per frame (0 = by clock; for benchmarks)`}},presets:{"wet-on-wet watercolour":{},"ink drop in water":{submerged:1,ink:`indigo`,paper:`white`,size:.03,load:2,water:0,push:.7,diffusion:15e-6,feather:0,viscosity:.001,flowDecay:.6,swirl:10,settling:.7,absorption:.05,wetAbsorption:.3,drying:0,edgeDarkening:0,granulation:0,lift:0,fade:.05,paperGrain:.1,wetLook:.2,ambient:.5},"sumi-e":{ink:`sumi`,paper:`rice`,size:.026,load:1.3,water:.25,push:.05,diffusion:25e-5,feather:1.5,wicking:.6,maxSubsteps:3,viscosity:.002,flowDecay:3,absorption:1.1,wetAbsorption:.6,drying:.4,dryDrag:30,wetSpread:2e-5,edgeDarkening:.1,granulation:.2,lift:.1,paperGrain:.9,wetLook:.2,fade:.01,ambient:.4},"granulating wash":{ink:`mixed`,paper:`white`,size:.05,load:1.2,water:1.6,push:.1,diffusion:1e-4,feather:.3,absorption:.5,drying:.06,edgeDarkening:.8,granulation:1,lift:.35,paperGrain:1,fade:.008,ambient:.5},"night ink":{paper:`night`,ink:`mixed`,size:.035,load:.8,water:.7,push:.3,submerged:.4,diffusion:6e-5,feather:.4,viscosity:.003,swirl:6,absorption:.3,drying:.04,edgeDarkening:.15,granulation:.2,fade:.05,paperGrain:.3,wetLook:.1,strength:1,ambient:.6}},async create({device:e,format:t,canvas:n,params:i,profiler:o}){let m=a(e,U,`ink-water display params`),h=s(n),g=_e(6782),te=typeof matchMedia==`function`&&matchMedia(`(prefers-reduced-motion: reduce)`).matches,ne=e.createSampler({label:`ink-water sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),re=e.createSampler({label:`ink-water paper sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`repeat`,addressModeV:`repeat`}),_=e=>({binding:e,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}}),ie=e.createBindGroupLayout({label:`ink-water display layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},_(1),_(2),_(3),_(4),{binding:5,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:6,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),ae=l(e,{fragment:{label:`ink-water/display.wgsl`,code:ee,chunks:{"display_params.wgsl":U.wgsl,"composite.wgsl":f}},format:t,layout:[ie]}),oe=l(e,{fragment:{label:`ink-water/paper.wgsl`,code:p},format:`rgba8unorm`}),v=r(e,{label:`ink-water paper`,format:`rgba8unorm`,width:Q,height:Q}),y=!1,b=Math.max(1,n.width||1),x=Math.max(1,n.height||1),S=b/x,C=(e,t)=>Math.round(e*Math.max(t,1/t)),w=u({device:e,resolution:C(Number(i.resolution),S),dyeResolution:C(Number(i.dyeResolution),S),width:b,height:x,profiler:o,label:`ink-water`,params:{dyeDissipation:0,pressureIterations:24,viscosityIterations:8}}),T=se({device:e,width:w.grid.dyeWidth,height:w.grid.dyeHeight,profiler:o,label:`ink-water`});T.setPaper(v.view),T.attach(w);let E=w.generation,D=!0,O=new Map,k=`${w.generation}/${T.generation}`;function A(){let t=`${w.generation}/${T.generation}`;t!==k&&(O.clear(),k=t);let n=`${w.dye.slot}|${T.stain.slot}`,r=O.get(n);return r||(r=e.createBindGroup({label:`ink-water display`,layout:ie,entries:[{binding:0,resource:{buffer:m.buffer}},{binding:1,resource:w.dye.view},{binding:2,resource:T.stain.view},{binding:3,resource:v.view},{binding:4,resource:w.fieldsView},{binding:5,resource:ne},{binding:6,resource:re}]}),O.set(n,r)),r}function j(e){return K(G(q[i.ink===`mixed`?Y[Math.floor(e*.381966%1*Y.length)%Y.length]:i.ink]??q.indigo))}function M(e,t){let n=j(e),r=ce*t;return[n[0]*r,n[1]*r,n[2]*r,(n[0]+n[1]+n[2])/3*r]}let N=1,P=1.8,F={addForce:(e,t,n,r,i)=>w.addForce(e,t,n,r,i),addDye:(e,t,n,r,i)=>(r[0]+r[1]+r[2]>1e-6&&w.addDye(e,t,n,r,i),(e[0]!==t[0]||e[1]!==t[1])&&T.addWater(e,t,n*$,N*P,i),!0)},I=new Map,L=new Map,R=Math.floor(g()*50),z=0;function B(e,t,n,r,a){let o=[e,t],s=i.size*r;if(i.brush===`ink`||r>1.05){let e=M(n,i.load*1.6*r);w.addDye(o,o,s*1.2,e)}if((i.water>0||i.submerged<1)&&T.addWater(o,o,s*2.2,Math.max(i.water,.5)*1.5),i.push>0){let n=(.35+.35*g())*Math.min(1.5,.5+i.push);for(let r=0;r<5;r++){let r=g()*Math.PI*2,i=[e+Math.cos(r)*s/a,t+Math.sin(r)*s];w.addForce(i,i,s,[Math.cos(r)*n,Math.sin(r)*n])}}}function V(e,t){h.setCapture(i.touch===`paints`);let n=h.poll(),r=!1,a=new Set;for(let o of n){a.add(o.id);let n=I.get(o.id);n||(n=d(),I.set(o.id,n)),o.justPressed&&L.set(o.id,R++);let s=L.get(o.id)??0,c=I.get(o.id).stir(F,[o],t,e,H(o,s));r||=c.active,o.down&&c.speed<.05&&i.pointer!==`off`&&T.addWater([o.x,o.y],[o.x,o.y],i.size*$,N*2*Math.min(e,.05)),o.justPressed&&i.pointer!==`off`&&(i.brush===`ink`?B(o.x,o.y,s,.6+.3*Math.min(1,o.pressure*2),t):T.addWater([o.x,o.y],[o.x,o.y],i.size*$*1.2,i.water*1.6+.4))}for(let e of[...I.keys()])a.has(e)||(I.delete(e),L.delete(e));return r}function H(e,t){let n=.55+.9*Math.min(1,Math.max(0,e.pressure)),r=ve(.3,2.5,e.speed),a=i.size*n*(1-.3*r);N=i.water*(1-.35*r);let o=i.brush!==`ink`;return{mode:i.pointer===`hover stirs`?`hover and press`:i.pointer===`off`?`off`:`press only`,radius:a,force:i.push,dyeRadius:a,dyeAmount:o?1:Math.max(i.load,.001)*(1-.25*r),colour:()=>o?[0,0,0,0]:M(t,1),hoverForce:.3,hoverDye:0,puff:.35*Math.min(1,i.push*2),maxSpeed:3}}let W,J=.4,X=6+g()*4,Z=!1;function ue(e){Z=!0;for(let t=0;t<4;t++)B(.14+.72*g(),.2+.6*g(),R++,.9+.5*g(),e)}function de(){let e=g()<.65,t=e?[.12+.25*g(),.25+.5*g()]:[.2+.6*g(),.15+.2*g()],n=e?[t[0]+.3+.25*g(),t[1]+(g()-.5)*.3]:[t[0]+(g()-.5)*.25,t[1]+.3+.2*g()];W={p0:t,p1:[(t[0]+n[0])/2+(g()-.5)*.18,(t[1]+n[1])/2+(g()-.5)*.18],p2:[Math.min(.95,n[0]),Math.min(.9,Math.max(.1,n[1]))],t:0,duration:1.1+g()*.8,seed:R++,last:void 0}}function fe(e,t){let n=1-.85*z,r=i.ambient*n*(te?.3:1),a=Math.min(Math.max(e,1/240),.1);if(!(r<.02)){if(J-=a*r,J<=0&&(J=2.2+g()*3.5,B(.1+.8*g(),.12+.76*g(),R++,.75+.7*g(),t)),X-=a*r,!W&&X<=0&&(X=7+g()*8,de()),W){let e=W;e.t=Math.min(1,e.t+a/e.duration);let n=1-e.t,r=[n*n*e.p0[0]+2*n*e.t*e.p1[0]+e.t*e.t*e.p2[0],n*n*e.p0[1]+2*n*e.t*e.p1[1]+e.t*e.t*e.p2[1]],o=e.last;e.last=r;let s=Math.sqrt(Math.sin(Math.PI*Math.min(1,Math.max(.02,e.t))));if(o){let n=(r[0]-o[0])*t,c=r[1]-o[1],l=Math.hypot(n,c);if(l>1e-6){let t=i.size*(.6+.6*s),u=t*.5,d=Math.min(l/a,1.5),f=[n/l*d*i.push,c/l*d*i.push];if(w.addForce(o,r,t*1.4,f,u),i.brush===`ink`){let n=M(e.seed,i.load*.9*s);w.addDye(o,r,t,n,u)}T.addWater(o,r,t*$,i.water*P*.8,u)}}e.t>=1&&(W=void 0)}if(i.submerged>.5&&i.push>0){let e=performance.now()*.001,t=[.5+.35*Math.sin(e*.11),.5+.3*Math.sin(e*.17+1)],n=[.5+.35*Math.sin(e*.11+.15),.5+.3*Math.sin(e*.17+1.2)];w.addForce(t,n,i.size*2.5,[.04*r,.03*r],i.size)}}}function pe(){let e=w.params;e.viscosity=i.viscosity,e.velocityDissipation=i.flowDecay,e.vorticity=i.swirl,e.buoyancy=-.3*i.settling,e.dyeDissipation=0,e.dyeScheme=i.advection===`semi-lagrangian`?`semi-lagrangian`:`maccormack`;let t=T.params;t.diffusion=i.diffusion,t.feather=i.feather,t.dryDiffusion=i.wicking,t.maxSubsteps=i.maxSubsteps,t.ragged=i.ragged,t.edgeSpeed=i.edgeDarkening*.03,t.absorption=i.absorption,t.wetAbsorption=i.wetAbsorption,t.granulation=i.granulation,t.lift=i.lift,t.drying=i.drying,t.wetSpread=i.wetSpread,t.wetFloor=i.submerged,t.dryDrag=i.dryDrag,t.fade=i.fade}return{resize(e,t){b=Math.max(1,Math.round(e)),x=Math.max(1,Math.round(t));let n=b/x;Math.abs(Math.log(n/S))>.06&&(S=n,w.resize(b,x))},frame({delta:e},t,n){pe();let r=b/x;if(w.setResolution(C(Number(i.resolution),S),C(Number(i.dyeResolution),S)),w.generation!==E){E=w.generation,T.resize(w.grid.dyeWidth,w.grid.dyeHeight);for(let e of I.values())e.reset();D=!0,Z=!1}D&&(D=!1,T.reset(t)),y||(y=!0,c(t,v.view,oe,[],{timestampWrites:o.pass(`bake paper (once)`)}));let a=V(e,r),s=1-Math.exp(-e*(a?5:.5));z+=(+!!a-z)*s,Z||ue(r),fe(e,r),T.beginFrame(t),i.stepsPerFrame>0?w.advance(t,i.stepsPerFrame):w.update(t,e);let l=i.paper===`night`;m.set({paper:G(le[i.paper]??le.cream),aspect:r,dye_size:[w.grid.dyeWidth,w.grid.dyeHeight],tile:Q,strength:i.strength,gran:i.granulation,grain:i.paperGrain,wet_look:i.wetLook,debug_gain:i.debugGain,vignette:l?.3:.1,mode:+!!l,view:Math.max(0,ge.indexOf(i.view))}),m.upload(),c(t,n,ae,[A()],{timestampWrites:o.pass(`shade`)})},destroy(){h.destroy(),T.detach(w),T.destroy(),w.destroy(),v.destroy(),m.destroy()}}}});export{ye as effect};