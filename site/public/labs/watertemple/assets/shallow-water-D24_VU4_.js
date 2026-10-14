import{t as e}from"./meta-BRxl9WCC.js";import{n as t}from"./types-ci2WwWg0.js";import{t as n}from"./loop-_CGOOht2.js";import{n as r}from"./profiler-Bi27xYp-.js";import{c as i,i as a,n as o,r as s,s as c,t as l}from"./camera-BT6VSIZb.js";import{n as u,r as d,t as f}from"./uniforms-BE1XSnDx.js";import{t as p}from"./shader-Cd_FDUy8.js";import{n as m}from"./pointer-BbHa9JHH.js";import{r as h}from"./fullscreen-Dq3Mq0Js.js";import{a as g,i as _,r as ee,t as v}from"./orbit-Dpc2wFkv.js";import{n as y}from"./caustics-iIiC1wP8.js";import{t as b}from"./shallow-B9ZyvJrI.js";var x=`// The compute-pass variant of the shallow-water solver: the same kernels as the render variant, one
// thread per cell, reading the previous state as a texture and writing write-only storage textures
// (no read-write storage textures, so it runs everywhere compute does). The resolve kernel writes
// three storage textures, which is the most a default-limits device allows in a stage but one.
#include "sw_core.wgsl"

@group(0) @binding(3) var out_a: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var out_water: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var out_ground: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var out_history: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(16, 16)
fn cs_upload(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.size)) {
    return;
  }
  textureStore(out_a, vec2i(id.xy), sw_upload(vec2i(id.xy)));
}

@compute @workgroup_size(16, 16)
fn cs_step(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.size)) {
    return;
  }
  textureStore(out_a, vec2i(id.xy), sw_step(vec2i(id.xy)));
}

@compute @workgroup_size(16, 16)
fn cs_resolve(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.size)) {
    return;
  }
  let r = sw_resolve(vec2i(id.xy));
  textureStore(out_water, vec2i(id.xy), r.water);
  textureStore(out_ground, vec2i(id.xy), r.ground);
  textureStore(out_history, vec2i(id.xy), r.history);
}
`,S=`// shallow-water-core.wgsl -- the maths of the shallow-water solver, shared by the render-pass and the
// compute-pass variant so that both run the SAME code and differ only in how they are launched.
//
// Included (as an effect-local chunk) by shallow-water-render.wgsl and shallow-water-compute.wgsl,
// after the generated \`sw_params.wgsl\` (struct SimParams). Bindings, group 0:
//   0  P         uniform SimParams
//   1  state_in  rgba32float  the previous state, one texel per cell:
//                             x h   water depth (m, >= 0)
//                             y hu  momentum along +x  (m^2 / s)
//                             z hv  momentum along +y  (m^2 / s); +y is DOWN the texture, like uv
//                             w b   bed height (m)
//   2  aux_in    the upload texture (rgba32float: x bed, y depth) in the upload pass, the history
//                texture (rgba16float: x foam, y wetness memory) in the resolve pass
//
// SCHEME. The 2D shallow-water equations in conservative form,
//     h_t + (hu)_x + (hv)_y = 0
//     (hu)_t + (hu^2 + g h^2 / 2)_x + (huv)_y = -g h b_x - friction
//     (hv)_t + (huv)_x + (hv^2 + g h^2 / 2)_y = -g h b_y - friction
// solved by a first-order finite-volume scheme with the HLL approximate Riemann solver (Einfeldt wave
// speeds, Toro's dry-bed speeds) and Audusse's hydrostatic reconstruction of the interface states:
//   * well balanced: a lake at rest over any terrain stays at rest to rounding error, because the
//     pressure of the reconstructed states cancels the bed slope term exactly;
//   * positivity preserving: h never goes negative while the timestep obeys the CFL rule below, and a
//     cell next to a dry one sees a wall or a dam break, whichever physics says;
//   * conservative: the mass flux through a face is computed from the same two states for the cell on
//     either side, so water only moves, it is never created or lost (apart from sources, the depth
//     cap and open edges);
//   * one pass per step, no flux textures: each cell recomputes the four fluxes around it.
// A solid obstacle is just a bed higher than the water next to it.
//
// STABILITY. The timestep is fixed per solver: dt = cfl dx / (2 lambda_cap), lambda_cap =
// 2 sqrt(g h_max). Every step clamps h <= h_max and then |velocity| <= lambda_cap - sqrt(g h), so no
// cell can have |u| + sqrt(g h) above lambda_cap, whatever happened. (Ritter's dry dam-break solution
// has |u| + c <= 2 sqrt(g h0), which is exactly what lambda_cap allows.) With cfl <= 0.5 this is the
// positivity condition of the HLL flux in two dimensions.

#include "sw_params.wgsl"

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var state_in: texture_2d<f32>;
@group(0) @binding(2) var aux_in: texture_2d<f32>;

// Below this depth a cell is dry: no momentum, no wave speed.
const DRY: f32 = 1e-5;
// Velocity desingularisation length: u = m h / (h^2 + EPS^2), which is m / h for h >> EPS and goes
// smoothly to zero as the film vanishes, so a sliver of water cannot carry a huge velocity.
const EPS_U: f32 = 1e-3;
// Visible water: the depth from which a cell counts as wet for shading, foam and the wetness memory.
const WET: f32 = 1e-4;
// The depth from which the ground counts as soaked: a film thinner than a millimetre is not a wet stain.
const WET_GROUND: f32 = 1.5e-3;

fn sw_velocity(h: f32, m: f32) -> f32 {
  return m * h / (h * h + EPS_U * EPS_U);
}

fn sw_in_grid(c: vec2i) -> bool {
  return all(c >= vec2i(0)) && all(c < vec2i(P.size));
}

fn sw_load(c: vec2i) -> vec4f {
  return textureLoad(state_in, clamp(c, vec2i(0), vec2i(P.size) - vec2i(1)), 0);
}

// The state of the neighbour of cell \`c\` (state \`s\`) in the axis direction \`d\`; beyond the grid a
// ghost cell. Wall: the same water with the momentum along the normal reversed (a mirror).
// Open: dry ground at the same height, so water can run off the edge like a free outfall.
fn sw_neighbour(c: vec2i, d: vec2i, s: vec4f) -> vec4f {
  let n = c + d;
  if (sw_in_grid(n)) {
    return textureLoad(state_in, n, 0);
  }
  if (P.edge_open != 0u) {
    return vec4f(0.0, 0.0, 0.0, s.w);
  }
  var g = s;
  if (d.x != 0) {
    g.y = -s.y;
  } else {
    g.z = -s.z;
  }
  return g;
}

// One interface between a cell A (the lower-index side) and a cell B, along the face normal.
// Components are (mass, normal momentum, tangential momentum); \`pa\` and \`pb\` are the hydrostatic
// pressure corrections to add to the normal-momentum flux seen by A and by B.
struct Face {
  f: vec3f,
  pa: f32,
  pb: f32,
}

fn sw_face(
  ha: f32, mna: f32, mta: f32, ba: f32,
  hb: f32, mnb: f32, mtb: f32, bb: f32,
) -> Face {
  let g = P.g;
  // Hydrostatic reconstruction: the water on each side above the higher of the two beds.
  let z = max(ba, bb);
  var hl = max(ha + ba - z, 0.0);
  var hr = max(hb + bb - z, 0.0);
  if (hl < DRY) {
    hl = 0.0;
  }
  if (hr < DRY) {
    hr = 0.0;
  }
  var out: Face;
  out.pa = 0.5 * g * (ha * ha - hl * hl);
  out.pb = 0.5 * g * (hb * hb - hr * hr);
  out.f = vec3f(0.0);
  if (hl <= 0.0 && hr <= 0.0) {
    return out;
  }

  // The velocities do not change in the reconstruction.
  let ul = sw_velocity(ha, mna);
  let vl = sw_velocity(ha, mta);
  let ur = sw_velocity(hb, mnb);
  let vr = sw_velocity(hb, mtb);
  let cl = sqrt(g * hl);
  let cr = sqrt(g * hr);

  var sl: f32;
  var sr: f32;
  if (hr <= 0.0) {
    sl = ul - cl;
    sr = ul + 2.0 * cl;
  } else if (hl <= 0.0) {
    sl = ur - 2.0 * cr;
    sr = ur + cr;
  } else {
    let u_star = 0.5 * (ul + ur) + cl - cr;
    let c_star = 0.5 * (cl + cr) + 0.25 * (ul - ur);
    sl = min(ul - cl, u_star - c_star);
    sr = max(ur + cr, u_star + c_star);
  }

  let fl = vec3f(hl * ul, hl * ul * ul + 0.5 * g * hl * hl, hl * ul * vl);
  let fr = vec3f(hr * ur, hr * ur * ur + 0.5 * g * hr * hr, hr * ur * vr);
  if (sl >= 0.0) {
    out.f = fl;
  } else if (sr <= 0.0) {
    out.f = fr;
  } else {
    let ql = vec3f(hl, hl * ul, hl * vl);
    let qr = vec3f(hr, hr * ur, hr * vr);
    out.f = (sr * fl - sl * fr + sl * sr * (qr - ql)) / (sr - sl);
  }
  return out;
}

fn sw_bump(q: f32) -> f32 {
  let t = max(1.0 - q * q, 0.0);
  return t * t;
}

// Sources, pushes, sculpting and level zones, applied once per step. Entry i is two vec4s:
//   kind 0 (a disc):   a = (x, y, radius, depth rate), b = (accel x, accel y, bed rate, 0)
//                      x, y, radius in cells; depth rate = peak m / s of water (negative removes);
//                      accel in m / s^2; bed rate in m / s (positive raises).
//   kind 1 (a level zone): a = (x0, y0, x1, y1) in cells, b = (level, rate, 0, 1)
//                      nudges the surface b + h in the rectangle toward \`level\` at \`rate\` per second.
fn sw_apply_sources(c: vec2i, s: vec4f) -> vec4f {
  var h = s.x;
  var hu = s.y;
  var hv = s.z;
  var bed = s.w;
  let p = vec2f(c) + vec2f(0.5);
  for (var i = 0u; i < P.source_count; i++) {
    let a = P.sources[2u * i];
    let e = P.sources[2u * i + 1u];
    if (e.w > 0.5) {
      if (p.x >= a.x && p.x < a.z && p.y >= a.y && p.y < a.w) {
        let k = clamp(e.y * P.dt, 0.0, 1.0);
        h = max(h + k * (e.x - (bed + h)), 0.0);
      }
    } else {
      let w = sw_bump(length(p - a.xy) / max(a.z, 1e-3));
      if (w > 0.0) {
        h = max(h + a.w * P.dt * w, 0.0);
        hu += h * e.x * P.dt * w;
        hv += h * e.y * P.dt * w;
        bed = clamp(bed + e.z * P.dt * w, P.bed_min, P.bed_max);
      }
    }
  }
  return vec4f(h, hu, hv, bed);
}

fn sw_step(c: vec2i) -> vec4f {
  let s = textureLoad(state_in, c, 0);
  let sw = sw_neighbour(c, vec2i(-1, 0), s);
  let se = sw_neighbour(c, vec2i(1, 0), s);
  let sn = sw_neighbour(c, vec2i(0, -1), s);
  let ss = sw_neighbour(c, vec2i(0, 1), s);

  // x faces: normal = x, tangential = y. The cell is B of its west face and A of its east face.
  let fw = sw_face(sw.x, sw.y, sw.z, sw.w, s.x, s.y, s.z, s.w);
  let fe = sw_face(s.x, s.y, s.z, s.w, se.x, se.y, se.z, se.w);
  // y faces: normal = y, tangential = x.
  let fn_ = sw_face(sn.x, sn.z, sn.y, sn.w, s.x, s.z, s.y, s.w);
  let fs = sw_face(s.x, s.z, s.y, s.w, ss.x, ss.z, ss.y, ss.w);

  let r = P.dt / P.dx;
  var h = s.x - r * ((fe.f.x - fw.f.x) + (fs.f.x - fn_.f.x));
  var hu = s.y - r * ((fe.f.y + fe.pa) - (fw.f.y + fw.pb) + (fs.f.z - fn_.f.z));
  var hv = s.z - r * ((fe.f.z - fw.f.z) + (fs.f.y + fs.pa) - (fn_.f.y + fn_.pb));

  h = max(h, 0.0);
  var next = vec4f(h, hu, hv, s.w);
  next.x += P.rain * P.dt;
  if (P.source_count > 0u) {
    next = sw_apply_sources(c, next);
  }
  h = min(next.x, P.h_max);
  hu = next.y;
  hv = next.z;

  if (h < DRY) {
    return vec4f(h, 0.0, 0.0, next.w);
  }

  // Bed friction, treated implicitly so a thin film comes to rest instead of flipping sign:
  // Manning's law, tau = g n^2 |u| u / h^(1/3), plus a linear drag.
  let speed = length(vec2f(hu, hv)) * h / (h * h + EPS_U * EPS_U);
  let manning = P.g * P.manning * P.manning * speed / pow(max(h, EPS_U), 4.0 / 3.0);
  let damp = 1.0 / (1.0 + P.dt * (manning + P.drag));
  hu *= damp;
  hv *= damp;

  // The stability clamp: |u| + sqrt(g h) <= lambda_cap.
  let cap = max(P.lambda_cap - sqrt(P.g * h), 0.0);
  let spd = length(vec2f(sw_velocity(h, hu), sw_velocity(h, hv)));
  if (spd > cap) {
    let k = cap / spd;
    hu *= k;
    hv *= k;
  }
  return vec4f(h, hu, hv, next.w);
}

// Copies the uploaded bed and/or depth (mode 0 both, 1 bed only, 2 depth only) into the state.
fn sw_upload(c: vec2i) -> vec4f {
  let s = textureLoad(state_in, c, 0);
  let u = textureLoad(aux_in, c, 0);
  if (P.upload_mode == 0u) {
    return vec4f(clamp(u.y, 0.0, P.h_max), 0.0, 0.0, clamp(u.x, P.bed_min, P.bed_max));
  }
  if (P.upload_mode == 1u) {
    return vec4f(s.xyz, clamp(u.x, P.bed_min, P.bed_max));
  }
  return vec4f(clamp(u.y, 0.0, P.h_max), 0.0, 0.0, s.w);
}

// --- Resolve: the consumer-facing textures ------------------------------------------------------

struct Resolved {
  water: vec4f,
  ground: vec4f,
  history: vec4f,
}

fn sw_eta_eff(n: vec4f, centre_wet: bool, eta_c: f32) -> f32 {
  if (!centre_wet) {
    return n.w;
  }
  if (n.x >= WET) {
    return n.w + n.x;
  }
  // A dry neighbour presents the centre's own level: the surface is flat up to the shore.
  return eta_c;
}

fn sw_history(p: vec2f) -> vec2f {
  // Bilinear fetch of the history texture at cell coordinates p (cell centres at +0.5).
  let q = p - vec2f(0.5);
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let hi = vec2i(P.size) - vec2i(1);
  let a = textureLoad(aux_in, clamp(i, vec2i(0), hi), 0).xy;
  let b = textureLoad(aux_in, clamp(i + vec2i(1, 0), vec2i(0), hi), 0).xy;
  let cc = textureLoad(aux_in, clamp(i + vec2i(0, 1), vec2i(0), hi), 0).xy;
  let d = textureLoad(aux_in, clamp(i + vec2i(1, 1), vec2i(0), hi), 0).xy;
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

fn sw_resolve(c: vec2i) -> Resolved {
  // The 3x3 neighbourhood, edge cells replicated.
  let s = sw_load(c);
  let nw = sw_load(c + vec2i(-1, -1));
  let nn = sw_load(c + vec2i(0, -1));
  let ne = sw_load(c + vec2i(1, -1));
  let ww = sw_load(c + vec2i(-1, 0));
  let ee = sw_load(c + vec2i(1, 0));
  let sw_ = sw_load(c + vec2i(-1, 1));
  let ss = sw_load(c + vec2i(0, 1));
  let se = sw_load(c + vec2i(1, 1));

  let h = s.x;
  let wet = h >= WET;
  let eta_c = s.w + h;
  let u = sw_velocity(h, s.y);
  let v = sw_velocity(h, s.z);

  // Surface slope: Sobel gradient of the water level where there is water, of the bed where not.
  let e_nw = sw_eta_eff(nw, wet, eta_c);
  let e_nn = sw_eta_eff(nn, wet, eta_c);
  let e_ne = sw_eta_eff(ne, wet, eta_c);
  let e_ww = sw_eta_eff(ww, wet, eta_c);
  let e_ee = sw_eta_eff(ee, wet, eta_c);
  let e_sw = sw_eta_eff(sw_, wet, eta_c);
  let e_ss = sw_eta_eff(ss, wet, eta_c);
  let e_se = sw_eta_eff(se, wet, eta_c);
  let k = 1.0 / (8.0 * P.dx);
  let slope = vec2f(
    ((e_ne + 2.0 * e_ee + e_se) - (e_nw + 2.0 * e_ww + e_sw)) * k,
    ((e_sw + 2.0 * e_ss + e_se) - (e_nw + 2.0 * e_nn + e_ne)) * k,
  );

  // Foam. Where it is born: a bore (the flow converging, depth jumping), thin fast supercritical
  // sheets, and an advancing front (fast water next to dry ground).
  let spd = length(vec2f(u, v));
  let cw = sqrt(P.g * max(h, WET));
  let froude = spd / cw;
  let uw = sw_velocity(ww.x, ww.y);
  let ue = sw_velocity(ee.x, ee.y);
  let vn = sw_velocity(nn.x, nn.z);
  let vs = sw_velocity(ss.x, ss.z);
  // How much the velocity drops across one cell, in units of the wave speed.
  let converge = max(-((ue - uw) + (vs - vn)) * 0.5 / max(cw, 0.05), 0.0);
  let bore = smoothstep(0.08, 0.35, converge) * smoothstep(0.015, 0.08, h);
  // Thin sheets that are fast enough to be supercritical, but not the film that merely creeps.
  let fast = smoothstep(1.0, 2.4, froude) * (1.0 - smoothstep(0.04, 0.3, h)) * smoothstep(0.01, 0.03, h);
  let dry_next = min(min(ww.x, ee.x), min(nn.x, ss.x)) < WET;
  let front = select(0.0, smoothstep(0.6, 2.2, spd) * (1.0 - smoothstep(0.04, 0.3, h)) * smoothstep(0.006, 0.02, h), dry_next);
  let born = clamp(0.9 * bore + 0.5 * fast + 0.55 * front, 0.0, 1.0);

  // Foam drifts with the flow and fades; the wet ground dries out slowly.
  let back = vec2f(c) + vec2f(0.5) - vec2f(u, v) * (P.resolve_dt / P.dx);
  let before = sw_history(back);
  let foam = select(0.0, max(before.x * exp(-P.resolve_dt / max(P.foam_life, 1e-3)), born), wet);
  let damp = max(before.y * exp(-P.resolve_dt / max(P.wet_life, 1e-3)), select(0.0, 1.0, h >= WET_GROUND));

  var r: Resolved;
  r.water = vec4f(h, u, v, foam);
  r.ground = vec4f(s.w, slope.x, slope.y, damp);
  r.history = vec4f(foam, damp, 0.0, 0.0);
  return r;
}
`,C=`// The render-pass variant of the shallow-water solver: fullscreen fragment passes over grid-sized
// ping-pong render targets. The state is rgba32float (renderable everywhere, not blendable, which the
// solver never needs); the resolve pass writes three rgba16float targets at once.
#include "fullscreen.wgsl"
#include "sw_core.wgsl"

@fragment fn fs_upload(in: FullscreenVarying) -> @location(0) vec4f {
  return sw_upload(vec2i(in.position.xy));
}

@fragment fn fs_step(in: FullscreenVarying) -> @location(0) vec4f {
  return sw_step(vec2i(in.position.xy));
}

struct ResolveOutput {
  @location(0) water: vec4f,
  @location(1) ground: vec4f,
  @location(2) history: vec4f,
}

@fragment fn fs_resolve(in: FullscreenVarying) -> ResolveOutput {
  let r = sw_resolve(vec2i(in.position.xy));
  return ResolveOutput(r.water, r.ground, r.history);
}
`,w=`rgba32float`,T=`rgba16float`,E=.5,D=1.5,O=64,k=16,A={gravity:9.81,maxDepth:1.5,friction:.03,drag:0,rain:0,edges:`wall`,cfl:.45,timeScale:1,foamLife:1.2,wetLife:12,bedMin:-8,bedMax:8},te=u(`SimParams`,{size:`vec2u`,dt:`f32`,dx:`f32`,g:`f32`,h_max:`f32`,lambda_cap:`f32`,manning:`f32`,drag:`f32`,rain:`f32`,bed_min:`f32`,bed_max:`f32`,resolve_dt:`f32`,foam_life:`f32`,wet_life:`f32`,edge_open:`u32`,source_count:`u32`,upload_mode:`u32`,sources:d(`vec4f`,64)}),j=new WeakMap;function M(e,t){let n=p(e,{label:`sim/shallow-water-${t}.wgsl`,code:t===`render`?C:x,chunks:{"sw_params.wgsl":te.wgsl,"sw_core.wgsl":S}}),r=r=>t===`render`?e.createRenderPipeline({label:`shallow water render ${r}`,layout:`auto`,vertex:{module:n,entryPoint:`fullscreen_vs`},fragment:{module:n,entryPoint:`fs_${r}`,targets:r===`resolve`?[{format:T},{format:T},{format:T}]:[{format:w}]}}):e.createComputePipeline({label:`shallow water compute ${r}`,layout:`auto`,compute:{module:n,entryPoint:`cs_${r}`}});return{upload:r(`upload`),step:r(`step`),resolve:r(`resolve`)}}function ne(e,t){let n=j.get(e);return n||j.set(e,n={}),n[t]??=M(e,t)}var re=(e,t,n)=>Math.min(n,Math.max(t,e)),N=(e,t)=>Number.isFinite(e)?e:t;function ie(e,t,n=4096){let r=Math.round(re(N(e,256),16,n)),i=Number.isFinite(t)&&t>0?t:1,a=i>=1?r:Math.max(16,Math.round(r*i)),o=i>=1?Math.max(16,Math.round(r/i)):r;return{width:Math.min(a,n),height:Math.min(o,n)}}function ae(e,t){let n=Math.max(N(e.gravity,9.81),.001),r=Math.max(N(e.maxDepth,1.5),.001);return re(N(e.cfl,.45),.1,E)*t/(4*Math.sqrt(n*r))}function oe(e,t,n,r,i){let a=Math.max(0,Math.floor(e-n)),o=Math.min(r-1,Math.ceil(e+n)),s=Math.max(0,Math.floor(t-n)),c=Math.min(i-1,Math.ceil(t+n)),l=0;for(let r=s;r<=c;r++)for(let i=a;i<=o;i++){let a=Math.hypot(i+.5-e,r+.5-t)/n;a<1&&(l+=(1-a*a)**2)}return l}function P(e){let{device:t,kind:i=`compute`,maxStepsPerFrame:a=48,profiler:o=r,label:s=`shallow water`}=e,c=e.size??12,l=e.resolution??256,u=e.aspect??1.5,d=Math.min(t.limits.maxTextureDimension2D,4096),p={...A,...e.params},m=ne(t,i),g=f(t,te,`${s} params`),_=i===`compute`,ee=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|(_?GPUTextureUsage.STORAGE_BINDING:0),v=!1,y=0,b=0,x=0,S=0,C=0,E,j=0,M,P=!0,se=0,F=new Float32Array,I=!1,L=!1,R=new Float32Array(256),z=0;function B(e,n){let r=e>=n?[c,c/(e/n)]:[e/n*c,c],i=Object.freeze({width:e,height:n,aspect:e/n,cellSize:r[0]/e,extent:Object.freeze(r),texelSize:Object.freeze([1/e,1/n])}),a=(r,i)=>t.createTexture({label:`${s} ${r}`,size:[e,n],format:i,usage:ee}),o=[a(`state A`,w),a(`state B`,w)],l=a(`upload`,w),u=a(`water`,T),d=a(`ground`,T),f=[a(`history A`,T),a(`history B`,T)],p=e=>e.createView(),h=[p(o[0]),p(o[1])],v=[p(f[0]),p(f[1])],y=p(l),b=u.createView({label:`${s} water view`}),x=d.createView({label:`${s} ground view`}),S={binding:0,resource:{buffer:g.buffer}},C=(e,n,r)=>t.createBindGroup({label:`${s} ${n}`,layout:e.getBindGroupLayout(0),entries:[S,...r]}),E=e=>({binding:1,resource:h[e]}),D=e=>_?[{binding:3,resource:h[1-e]}]:[],O=(e,t)=>C(m.resolve,`resolve ${e}${t}`,[E(e),{binding:2,resource:v[t]},..._?[{binding:4,resource:b},{binding:5,resource:x},{binding:6,resource:v[1-t]}]:[]]);return F=new Float32Array(e*n*4),I=!1,L=!1,{grid:i,state:o,stateViews:h,upload:l,uploadView:y,water:u,waterView:b,ground:d,groundView:x,history:f,historyViews:v,uploadGroups:[C(m.upload,`upload 0`,[E(0),{binding:2,resource:y},...D(0)]),C(m.upload,`upload 1`,[E(1),{binding:2,resource:y},...D(1)])],stepGroups:[C(m.step,`step 0`,[E(0),...D(0)]),C(m.step,`step 1`,[E(1),...D(1)])],resolveGroups:[O(0,0),O(0,1),O(1,0),O(1,1)]}}function V(e){for(let t of[...e.state,e.upload,e.water,e.ground,...e.history])t.destroy()}function H(){let e=ie(l,u,d);return M&&e.width===M.grid.width&&e.height===M.grid.height?!1:(M&&V(M),M=B(e.width,e.height),b=0,x=0,y++,E=void 0,z=0,P=!0,C=0,!0)}H();let U=()=>ae(p,M.grid.cellSize);function W(e){let{grid:t}=M,n=U(),r=Math.max(N(p.gravity,9.81),.001),i=Math.max(N(p.maxDepth,1.5),.001),a=new Float32Array(256);a.set(R.subarray(0,z*8)),g.set({size:[t.width,t.height],dt:n,dx:t.cellSize,g:r,h_max:i,lambda_cap:2*Math.sqrt(r*i),manning:Math.max(0,N(p.friction,0)),drag:Math.max(0,N(p.drag,0)),rain:Math.max(0,N(p.rain,0)),bed_min:N(p.bedMin,-8),bed_max:N(p.bedMax,8),resolve_dt:se,foam_life:Math.max(.01,N(p.foamLife,1.2)),wet_life:Math.max(.01,N(p.wetLife,12)),edge_open:+(p.edges===`open`),source_count:z,upload_mode:e,sources:a}),g.upload()}let G=()=>[Math.ceil(M.grid.width/k),Math.ceil(M.grid.height/k)];function K(e){let n=M;t.queue.writeTexture({texture:n.upload},F,{bytesPerRow:n.grid.width*16},{width:n.grid.width,height:n.grid.height});let r=o.pass(`sim upload`),i=n.uploadGroups[b];if(_){let t=e.beginComputePass({label:`sim upload`,timestampWrites:r});t.setPipeline(m.upload),t.setBindGroup(0,i),t.dispatchWorkgroups(...G()),t.end()}else h(e,n.stateViews[1-b],m.upload,[i],{label:`sim upload`,timestampWrites:r});b=1-b,P=!0}function q(e,t){if(v)return;let n=Math.max(0,Math.floor(t));S=n;let r=I||L;if(n===0&&!r&&!P){z=0;return}let i=M;if(se=n*U(),W(I&&L?0:I?1:2),r&&(K(e),I=!1,L=!1),n>0){if(_){let t=e.beginComputePass({label:`sim steps`,timestampWrites:o.pass(`sim steps`)});t.setPipeline(m.step);for(let e=0;e<n;e++)t.setBindGroup(0,i.stepGroups[b]),t.dispatchWorkgroups(...G()),b=1-b;t.end()}else for(let t=0;t<n;t++){let r=t===0||t===n-1?o.pass(`sim step`):void 0;h(e,i.stateViews[1-b],m.step,[i.stepGroups[b]],{label:`sim step`,timestampWrites:r}),b=1-b}C+=se}z=0;let a=o.pass(`sim resolve`),s=i.resolveGroups[b*2+x];if(_){let t=e.beginComputePass({label:`sim resolve`,timestampWrites:a});t.setPipeline(m.resolve),t.setBindGroup(0,s),t.dispatchWorkgroups(...G()),t.end()}else h(e,[i.waterView,i.groundView,i.historyViews[1-x]],m.resolve,[s],{label:`sim resolve`,timestampWrites:a});x=1-x,P=!1}function J(e,t){let{width:n,height:r}=M.grid;if(typeof t==`function`)for(let i=0;i<r;i++)for(let a=0;a<n;a++){let o=t((a+.5)/n,(i+.5)/r);F[(i*n+a)*4+e]=Number.isFinite(o)?o:0}else{if(t.length!==n*r)throw RangeError(`${s}: a grid field needs ${n*r} values (${n} x ${r}), got ${t.length}`);for(let i=0;i<n*r;i++){let n=t[i];F[i*4+e]=Number.isFinite(n)?n:0}}}function Y(e,t){return z>=32||![...e,...t].every(Number.isFinite)?!1:(R.set(e,z*8),R.set(t,z*8+4),z++,!0)}return{kind:i,params:p,get grid(){return M.grid},get generation(){return y},get texture(){return M.water},get view(){return M.waterView},get groundTexture(){return M.ground},get groundView(){return M.groundView},get stateTexture(){return M.state[b]},get stepSeconds(){return U()},get lastSteps(){return S},get simTime(){return C},get pendingSources(){return z},setResolution(e){return Number.isFinite(e)?(l=e,H()):!1},setAspect(e){return!(e>0)||!Number.isFinite(e)?!1:(u=e,H())},setTerrain(e){J(0,e),I=!0},setWater(e){J(1,e),L=!0},addSource(e){let{grid:t}=M,n=re(N(e.radius,0)/t.cellSize,D,O),r=e.x*t.width,i=e.y*t.height,a=oe(r,i,n,t.width,t.height);return a>0&&Y([r,i,n,(e.volume??0)/(a*t.cellSize*t.cellSize)],[e.pushX??0,e.pushY??0,e.bedRate??0,0])},addLevelZone(e){let{grid:t}=M,n=Math.min(e.x0,e.x1)*t.width,r=Math.max(e.x0,e.x1)*t.width;return Y([n,Math.min(e.y0,e.y1)*t.height,r,Math.max(e.y0,e.y1)*t.height],[e.level,Math.max(0,e.rate),0,1])},update(e,t){if(v)return 0;let r=U();(!E||Math.abs(r-j)>r*.001)&&(E=n(r,{maxSteps:a}),j=r);let i=Math.max(0,N(p.timeScale,1)),{steps:o}=E.advance(N(t,0)*i);return q(e,o),o},advance(e,t){q(e,t)},reset(e){z=0,I=!1,L=!1,F.fill(0);let t=M;for(let n of[...t.state,t.water,t.ground,...t.history])e.beginRenderPass({label:`${s} clear`,colorAttachments:[{view:n.createView(),loadOp:`clear`,storeOp:`store`}]}).end();b=0,x=0,C=0,P=!1},destroy(){v||(v=!0,V(M),g.destroy())}}}var se=12/8,F=[`dam break`,`hillside spring`,`tide pool`],I=(e,t,n)=>Math.min(n,Math.max(t,e)),L=(e,t,n)=>{let r=I((n-e)/(t-e),0,1);return r*r*(3-2*r)};function R(e,t){let n=Math.imul(e,374761393)+Math.imul(t,668265263);return n=Math.imul(n^n>>>13,1274126177),((n^n>>>16)>>>0)/4294967296}function z(e,t){let n=Math.floor(e),r=Math.floor(t),i=e-n,a=t-r,o=i*i*(3-2*i),s=a*a*(3-2*a),c=R(n,r),l=R(n+1,r),u=R(n,r+1),d=R(n+1,r+1);return c+(l-c)*o+(u-c)*s+(c-l-u+d)*o*s}function B(e,t,n=4){let r=0,i=.5,a=0;for(let o=0;o<n;o++)r+=i*z(e,t),a+=i,e=e*2.03+11.3,t=t*2.03+7.1,i*=.5;return r/a}function V(e,t,n,r,i,a,o){let s=Math.abs(e-n)-(i-o),c=Math.abs(t-r)-(a-o);return Math.hypot(Math.max(s,0),Math.max(c,0))+Math.min(Math.max(s,c),0)-o}var H=(e,t=.1)=>1-L(-t,t,e);function U(e,t,n){let r=new Float32Array(e*t);for(let i=0;i<t;i++)for(let a=0;a<e;a++){let o=(a+.5)/e,s=(i+.5)/t;r[i*e+a]=n(o,s,o*12,s*8)}return r}var W=3.25;function G(e,t,n){let r=.03*B(e*.9,t*.9);return r+=.55*L(9.6,11.9,e),r+=1.5*H(Math.hypot(e-6.1,t-2.4)-.55),r+=1.5*H(Math.hypot(e-7,t-5.6)-.62),r+=1.3*H(V(e,t,8.9,3.9,.6,.45,.08)),r+=.7*H(V(e,t,5,4,.12,.9,.05)),n&&(r+=1.7*(L(3.17,3.33,e)-L(3.4699999999999998,3.63,e))),r}var K={id:`dam break`,maxDepth:1.3,edges:`wall`,releaseAfter:1.4,palette:[0,0],camera:{yaw:.55,pitch:.62,distance:12.8},build(e,t){let n=U(e,t,(e,t,n,r)=>G(n,r,!0)),r=U(e,t,(e,t,n,r)=>G(n,r,!1));return{terrain:n,water:U(e,t,(e,t,n,r)=>n<W?Math.max(1-G(n,r,!1),0):0),released:r}},forces(){}};function q(e){return .3+.13*Math.sin(e*7+.4)+.2*e}function J(e,t,n,r){let i=3*(1-e)**1.3*(.7+.3*(1-t));i+=2.2*(B(n*.38,r*.38)-.5)*(.3+.7*(1-e));let a=(t-q(e))*8/.5;i-=.95*Math.exp(-a*a)*L(.03,.22,e)*(1-.45*e);let o=(e-.8)*12/2.7,s=(t-.58)*8/2.1;return i-=.95*Math.exp(-(o*o+s*s)),i}var Y={x:.085,y:.27},ce={id:`hillside spring`,maxDepth:.8,edges:`open`,palette:[.75,0],camera:{yaw:1.05,pitch:.58,distance:13.4},build(e,t){let n=U(e,t,J),r=1/0;for(let i=0;i<t;i++)for(let t=Math.floor(e*.6);t<e;t++)r=Math.min(r,n[i*e+t]);let i=r+.28,a=new Float32Array(e*t);for(let r=0;r<t;r++)for(let t=Math.floor(e*.6);t<e;t++)a[r*e+t]=Math.max(i-n[r*e+t],0);return{terrain:n,water:a}},forces(e,t,n){let r=L(0,1.5,t);e.addSource({x:Y.x,y:Y.y,radius:.32,volume:.5*n*r})}},X=40,le=.045;function ue(e,t,n,r){let i=-1+1.6*L(0,.32,e)**.85,a=L(.26,.4,e);i+=a*(.34*(B(n*.75,r*.75)-.45)+.1*(B(n*2.4,r*2.4)-.5));let o=(n,r,i,a,o)=>{let s=(e-n)/i,c=(t-r)/a;return o*Math.exp(-(s*s+c*c)*1.8)};i-=o(.55,.3,.12,.2,.7)*a,i-=o(.73,.68,.14,.21,.74)*a,i-=o(.9,.3,.08,.15,.66)*a,i-=o(.5,.86,.09,.11,.6)*a;let s=(n,r,i,a,o,s)=>{let c=I((e-i)/(a-i),0,1),l=(t-(n+(r-n)*c))*8/o;return s*Math.exp(-l*l)*L(i-.02,i+.02,e)*(1-L(a-.02,a+.02,e))};return i-=s(.3,.3,.3,.55,.26,.4)*a,i-=s(.68,.68,.3,.73,.24,.36)*a,i}var de={"dam break":K,"hillside spring":ce,"tide pool":{id:`tide pool`,maxDepth:1.2,edges:`wall`,palette:[0,.9],camera:{yaw:-.7,pitch:.62,distance:12.4},build(e,t){let n=U(e,t,ue),r=new Float32Array(e*t);for(let e=0;e<r.length;e++)r[e]=Math.max(.12-n[e],0);return{terrain:n,water:r}},forces(e,t){let n=.1+.62*Math.sin(2*Math.PI*t/X)+.025*Math.sin(2*Math.PI*t/2.6)+.012*Math.sin(2*Math.PI*t/1.3);e.addLevelZone({x0:0,y0:0,x1:le,y1:1,level:n,rate:4})}}};function fe(e,t,n,r,i){let a=I(r*t-.5,0,t-1),o=I(i*n-.5,0,n-1),s=Math.floor(a),c=Math.floor(o),l=Math.min(s+1,t-1),u=Math.min(c+1,n-1),d=a-s,f=o-c,p=e[c*t+s],m=e[c*t+l],h=e[u*t+s],g=e[u*t+l];return p+(m-p)*d+(h-p)*f+(p-m-h+g)*d*f}var pe=u(`SceneParams`,{sun:`vec3f`,sun_power:`f32`,brush:`vec4f`,palette:`vec2f`,domain:`vec2f`,texel:`vec2f`,mesh:`vec2u`,cell:`f32`,time:`f32`,exposure:`f32`,ripple:`f32`,edge:`f32`,gravity:`f32`,shine:`f32`,view:`u32`,skirt:`f32`,density:`f32`,foam_amount:`f32`,water_kind:`u32`}),Z=[`compute`,`render`],me=[`128`,`192`,`256`,`384`],Q=[`add water`,`remove water`,`push water`,`raise ground`,`lower ground`,`orbit camera`],he=[`scrolls the page`,`plays with the water`],ge=[`clear tropical`,`coastal`,`murky green`,`tea lake`,`glacial milk`,`swimming pool`,`open ocean`],_e=[`beauty`,`depth`,`speed`,`surface height`,`foam`],ve=`depth24plus`,ye=Math.PI/180,be=45*ye,xe=66*ye,Se=1.1,Ce=.9,we=.28,Te=(e,t,n)=>Math.min(n,Math.max(t,e)),$=t({meta:e,params:{scenario:{type:`select`,default:`dam break`,options:F,label:`Scenario (restarts)`},restart:{type:`boolean`,default:!1,label:`Restart (flip to run the scenario again)`},autoRestart:{type:`number`,default:0,min:0,max:120,step:1,label:`Restart by itself after the dam goes (s, 0 = never)`},speed:{type:`number`,default:.9,min:.1,max:2.5,step:.01,label:`Time scale (1 = real time)`},gravity:{type:`number`,default:9.81,min:2,max:25,step:.01,label:`Gravity (m / s²)`},friction:{type:`number`,default:.025,min:0,max:.15,step:.001,label:`Ground friction (Manning n)`},rain:{type:`number`,default:0,min:0,max:30,step:.1,label:`Rain (mm / s)`},inflow:{type:`number`,default:1,min:0,max:3,step:.01,label:`Spring flow / tide strength`},gridResolution:{type:`select`,default:`256`,options:me,label:`Grid cells on the long side (restarts)`},solver:{type:`select`,default:`compute`,options:Z,label:`Solver passes (restarts)`},tool:{type:`select`,default:`add water`,options:Q,label:`Pointer tool`},brushSize:{type:`number`,default:.5,min:.15,max:1.6,step:.01,label:`Brush radius (m)`},brushStrength:{type:`number`,default:1.2,min:.1,max:5,step:.01,label:`Pour rate (m³ / s)`},touch:{type:`select`,default:`scrolls the page`,options:he,label:`Touch drags`},waterType:{type:`select`,default:`coastal`,options:ge,label:`Water`},waterDensity:{type:`number`,default:5,min:1,max:14,step:.1,label:`Water density (visual depth multiplier)`},foamAmount:{type:`number`,default:.85,min:0,max:1.6,step:.01,label:`Foam`},ripples:{type:`number`,default:1,min:0,max:3,step:.01,label:`Surface ripples`},shine:{type:`number`,default:1,min:0,max:2,step:.01,label:`Sun glint`},sunElevation:{type:`number`,default:34,min:12,max:85,step:.5,label:`Sun elevation (degrees)`},sunAzimuth:{type:`number`,default:112,min:0,max:360,step:1,label:`Sun direction (degrees)`},exposure:{type:`number`,default:.9,min:.4,max:1.8,step:.01},autoRotate:{type:`boolean`,default:!0,label:`Camera sways gently`},view:{type:`select`,default:`beauty`,options:_e,label:`View`},stepsPerFrame:{type:`number`,default:0,min:0,max:200,step:1,label:`Solver steps per frame (0 = by clock; for benchmarks)`},sceneRepeats:{type:`number`,default:1,min:1,max:16,step:1,label:`Scene draws per frame (for benchmarks)`}},presets:{"dam break":{scenario:`dam break`,speed:.9,friction:.025,gravity:9.81,rain:0,waterType:`coastal`,autoRestart:0,view:`beauty`},"dam break, slow motion":{scenario:`dam break`,speed:.28,friction:.015,gravity:9.81,rain:0,waterType:`swimming pool`,view:`beauty`},"dam break, on a loop":{scenario:`dam break`,speed:1,friction:.025,gravity:9.81,rain:0,waterType:`coastal`,autoRestart:16,view:`beauty`},"muddy flood":{scenario:`dam break`,speed:1,friction:.06,gravity:9.81,rain:0,waterType:`tea lake`,waterDensity:8,foamAmount:.7,view:`beauty`},"hillside spring":{scenario:`hillside spring`,speed:1.5,friction:.03,gravity:9.81,rain:0,inflow:1,waterType:`clear tropical`,view:`beauty`},"rain on the hills":{scenario:`hillside spring`,speed:1.6,friction:.035,gravity:9.81,rain:4,inflow:.4,waterType:`murky green`,view:`beauty`},"tide pool":{scenario:`tide pool`,speed:1.6,friction:.03,gravity:9.81,rain:0,inflow:1,waterType:`coastal`,view:`beauty`},"flow speed (debug)":{scenario:`dam break`,view:`speed`}},async create({device:e,format:t,canvas:n,params:r,profiler:u}){let d=m(n,{capture:r.touch===he[1]}),h=new AbortController,x=new Map;n.addEventListener(`pointerdown`,e=>{let t=e;x.set(t.pointerId,!!t.shiftKey||t.button===2)},{signal:h.signal});let S=()=>P({device:e,kind:r.solver,resolution:Number(r.gridResolution),aspect:se,size:12,profiler:u,label:`shallow water`}),C=S(),w=r.scenario,T=de[w],E=new Float32Array,D,O=!1,k=0,A=!0,te=r.restart,j=!0,M=e.createBindGroupLayout({label:`shallow water layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:4,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),ne=p(e,{label:`shallow-water/shallow.wgsl`,code:b,chunks:{"scene_params.wgsl":pe.wgsl}}),re=e.createPipelineLayout({label:`shallow water pipeline layout`,bindGroupLayouts:[M]}),N=(n,r,i,a={})=>e.createRenderPipeline({label:`shallow water ${n}`,layout:re,vertex:{module:ne,entryPoint:r},fragment:{module:ne,entryPoint:i,targets:[{format:t,blend:a.blend?{color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}:void 0}]},primitive:{topology:a.topology??`triangle-list`,cullMode:`none`},depthStencil:{format:ve,depthWriteEnabled:a.depthWrite??!0,depthCompare:a.depthCompare??`less`,depthBias:a.bias?-2:0,depthBiasSlopeScale:a.bias?-1:0}}),ie=N(`sky`,`fullscreen_vs`,`sky_fs`,{depthCompare:`always`,depthWrite:!1}),ae=N(`terrain`,`terrain_vs`,`terrain_fs`),oe=N(`skirt`,`skirt_vs`,`skirt_fs`,{topology:`triangle-strip`}),F=N(`section`,`section_vs`,`section_fs`,{topology:`triangle-strip`,blend:!0,depthCompare:`less-equal`,depthWrite:!1}),I=N(`water`,`water_vs`,`water_fs`,{blend:!0,depthCompare:`less-equal`,bias:!0}),L=f(e,l,`shallow water camera`),R=f(e,pe,`shallow water params`),z=e.createSampler({label:`shallow water sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),B,V=-1,H,U,W=0,G=``,K,q,J=Math.max(1,n.width||1),Y=Math.max(1,n.height||1);function ce(){let{width:t,height:n}=C.grid,r=`${t}x${n}`;if(r===G&&U)return;G=r,U?.destroy();let i=y(t,n);W=i.length,U=e.createBuffer({label:`shallow water mesh indices`,size:i.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}),e.queue.writeBuffer(U,0,i)}let X=ee({yaw:.5,pitch:.6,distance:15,target:[0,.3,0]}),le={...v,minPitch:.22,maxPitch:1.42,autoSpeed:0},ue=s(),Z=0;function me(e,t){let n=i(ue.invViewProj,e,t,0),r=i(ue.invViewProj,e,t,1),a=r[0]-n[0],o=r[1]-n[1],s=r[2]-n[2],c=Math.hypot(a,o,s)||1,l=[a/c,o/c,s/c],{width:u,height:d}=C.grid,f=e=>{let t=n[0]+l[0]*e,r=n[1]+l[1]*e,i=n[2]+l[2]*e,a=t/12+.5,o=i/8+.5;return a<0||a>1||o<0||o>1?1/0:r-fe(E,u,d,a,o)},p=0;for(let e=0;e<90;e+=.08){if(f(e)<=0&&Number.isFinite(f(p))){let t=p,r=e;for(let e=0;e<12;e++){let e=(t+r)/2;f(e)<=0?r=e:t=e}let i=n[0]+l[0]*r,a=n[1]+l[1]*r,o=n[2]+l[2]*r;return{x:i,y:a,z:o,u:i/12+.5,v:o/8+.5}}p=e}}let Q=new Map,$,Ee=0;function De(e,t,n){let{width:i,height:a,cellSize:o}=C.grid,s=Math.max(r.brushSize/o,1.5),c=e.u*i,l=e.v*a,u=C.params.bedMin,d=C.params.bedMax;for(let e=Math.max(0,Math.floor(l-s));e<=Math.min(a-1,Math.ceil(l+s));e++)for(let r=Math.max(0,Math.floor(c-s));r<=Math.min(i-1,Math.ceil(c+s));r++){let a=Math.hypot(r+.5-c,e+.5-l)/s;if(a<1){let o=e*i+r;E[o]=Te(E[o]+t*n*(1-a*a)**2,u,d)}}}function Oe(e){let t=r.tool,n=d.poll(),i=0,a=0,o=!1,s;for(let r of n){r.justPressed&&Q.set(r.id,{until:Z+we,down:!0,invert:x.get(r.id)??!1,vx:0,vz:0});let n=Q.get(r.id);if(n&&(n.down=r.down,(r.justReleased||!r.down)&&(n.down=!1)),t===`orbit camera`)r.down&&(i+=r.dx,a+=r.dy,o=!0);else if(r.inside||r.down){let t=me(r.x,r.y);if(t&&(s=t,n)){if(n.lastHit&&e>0){let r=1-Math.exp(-e*18);n.vx+=((t.x-n.lastHit.x)/e-n.vx)*r,n.vz+=((t.z-n.lastHit.z)/e-n.vz)*r}n.lastHit=t}}}g(X,{yaw:o?-i*3:0,pitch:o?a*2:0,dragging:o},e,le),$=s??$;let c=t!==`orbit camera`&&(s!==void 0||Q.size>0);Ee+=(+!!c-Ee)*(1-Math.exp(-e*10));let l=e*Math.max(0,r.speed);for(let[e,n]of Q){if(!(n.down||Z<n.until)){Q.delete(e),x.delete(e);continue}let i=n.lastHit;if(!i||t===`orbit camera`)continue;let a=n.invert?-1:1,o=r.brushSize;switch(t){case`add water`:case`remove water`:{let e=(t===`add water`?1:-1)*a;C.addSource({x:i.u,y:i.v,radius:o,volume:e*r.brushStrength});break}case`push water`:{let e=Math.hypot(n.vx,n.vz),t=Math.min(1,e/1.5)*14,r=e>.001?n.vx/e*t:0,a=e>.001?n.vz/e*t:0;C.addSource({x:i.u,y:i.v,radius:o*1.3,pushX:r,pushY:a});break}case`raise ground`:case`lower ground`:{let e=(t===`raise ground`?1:-1)*a*Ce;C.addSource({x:i.u,y:i.v,radius:o,bedRate:e}),De(i,e,l);break}}}}function ke(e){let t=r.scenario,n=t!==w;w=t,T=de[w],C.reset(e),C.params.maxDepth=T.maxDepth,C.params.edges=T.edges;let i=T.build(C.grid.width,C.grid.height);C.setTerrain(i.terrain),C.setWater(i.water),E=i.terrain.slice(),D=i.released,O=!1,k=0,Q.clear(),(n||j)&&(X.yaw=T.camera.yaw,X.pitch=T.camera.pitch,X.distance=T.camera.distance,X.yawVelocity=0,X.pitchVelocity=0,j=!1),A=!1}function Ae(){let e=C.params;e.gravity=r.gravity,e.friction=r.friction,e.rain=r.rain/1e3,e.timeScale=r.speed}return{resize(t,n){J=Math.max(1,Math.round(t)),Y=Math.max(1,Math.round(n)),K?.destroy(),K=e.createTexture({label:`shallow water depth`,size:[J,Y],format:ve,usage:GPUTextureUsage.RENDER_ATTACHMENT}),q=K.createView()},frame({delta:t},n,i){if(!q)return;Z+=t;let s=J/Y;d.setCapture(r.touch===he[1]),C.kind!==r.solver&&(C.destroy(),C=S(),A=!0),C.setResolution(Number(r.gridResolution))&&(A=!0),r.scenario!==w&&(A=!0),r.restart!==te&&(te=r.restart,A=!0),r.autoRestart>0&&O&&C.simTime-k>r.autoRestart&&(A=!0),A&&ke(n),Ae(),ce();let l=r.autoRotate?.34*Math.sin(Z*.11):0;o({position:_({...X,yaw:X.yaw+l}),target:X.target,fovY:a(be,s,xe),aspect:s,near:.1,far:160},ue),c(L,ue,J,Y),L.upload(),Oe(t),T.releaseAfter!==void 0&&!O&&C.simTime>=T.releaseAfter&&(D&&(C.setTerrain(D),E=D.slice()),O=!0,k=C.simTime),T.forces(C,C.simTime,r.inflow),r.stepsPerFrame>0?C.advance(n,r.stepsPerFrame):C.update(n,t),(!B||H!==C||V!==C.generation)&&(H=C,V=C.generation,B=e.createBindGroup({label:`shallow water bind group`,layout:M,entries:[{binding:0,resource:{buffer:L.buffer}},{binding:1,resource:{buffer:R.buffer}},{binding:2,resource:C.view},{binding:3,resource:C.groundView},{binding:4,resource:z}]}));let f=r.sunElevation*ye,p=r.sunAzimuth*ye,{grid:m}=C;R.set({sun:[Math.cos(f)*Math.sin(p),Math.sin(f),Math.cos(f)*Math.cos(p)],sun_power:2.1,brush:$?[$.x,$.z,r.brushSize,Ee*.85]:[0,0,r.brushSize,0],palette:[T.palette[0],T.palette[1]],domain:[12,8],texel:[m.texelSize[0],m.texelSize[1]],mesh:[m.width,m.height],cell:m.cellSize,time:Z,exposure:r.exposure,ripple:r.ripples,edge:.02,gravity:r.gravity,shine:r.shine,view:Math.max(0,_e.indexOf(r.view)),skirt:Se,density:r.waterDensity,foam_amount:r.foamAmount,water_kind:Math.max(0,ge.indexOf(r.waterType))}),R.upload();let h=n.beginRenderPass({label:`shallow water scene`,colorAttachments:[{view:i,loadOp:`clear`,storeOp:`store`,clearValue:[0,0,0,1]}],depthStencilAttachment:{view:q,depthLoadOp:`clear`,depthStoreOp:`discard`,depthClearValue:1},timestampWrites:u.pass(`scene`)});h.setBindGroup(0,B),h.setPipeline(ie),h.draw(3);let g=Math.max(1,Math.round(r.sceneRepeats));for(let e=0;e<g;e++)h.setPipeline(ae),h.setIndexBuffer(U,`uint32`),h.drawIndexed(W),h.setPipeline(oe),h.draw(2*(Math.max(m.width,m.height)+1),4),h.setPipeline(I),h.setIndexBuffer(U,`uint32`),h.drawIndexed(W),h.setPipeline(F),h.draw(2*(Math.max(m.width,m.height)+1),4);h.end()},destroy(){h.abort(),d.destroy(),C.destroy(),U?.destroy(),K?.destroy(),L.destroy(),R.destroy()}}}});export{$ as effect};