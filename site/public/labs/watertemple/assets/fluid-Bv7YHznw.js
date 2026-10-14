import{t as e}from"./loop-_CGOOht2.js";import{n as t}from"./profiler-Bi27xYp-.js";import{n,t as r}from"./uniforms-BE1XSnDx.js";import{t as i}from"./shader-Cd_FDUy8.js";import{n as a}from"./obstacles-CsV74c88.js";var o=`// fluid-advect.wgsl -- advection of the velocity field (by itself) and of the dye (by the velocity), in
// three schemes. Every kernel writes one rgba16float storage texture and reads others as textures.
//
// Bindings (besides the shared 0 \`P\` and 1 \`solid_mask\`):
//   2 src   the field being advected: velocity (W+1 x H+1) or dye
//   3 aux   scheme scratch: the forward-advected prediction, or the error-compensated field
//   4 dst   the output
//   5 flow  dye entry points only: the velocity that carries the dye
//   6 flow_samp  dye entry points only: a linear sampler, used when \`P.dye_filter\` asks for a cubic
//                reconstruction of \`flow\` (fluid-core.wgsl, \`vel_at_cubic\`)
//
// SCHEMES (Selle, Fedkiw, Kim, Liu, Rossignac 2008, "An Unconditionally Stable MacCormack Method").
// Write A for one semi-Lagrangian step (sample the field at where the parcel came from) and A^R for
// the reverse step (sample at where the parcel is going):
//   semi-Lagrangian  1 pass    cs_*_sl             f' = A f
//   MacCormack       2 passes  cs_*_pred, cs_*_mc  f^ = A f;  f' = f^ + (f - A^R f^) / 2, clamped
//   BFECC            3 passes  cs_*_pred, cs_*_bfecc_error, cs_*_bfecc_final
//                              f^ = A f;  g = f + (f - A^R f^) / 2;  f' = A g, clamped
// "Clamped" means limited to the smallest and largest value among the source samples the forward
// trace interpolates. The limiter is what keeps the error correction from creating new extrema (and
// makes both schemes unconditionally stable); without it they overshoot and ring.
//
// The \`*_sl\` and \`*_mc\`/\`*_bfecc_final\` entry points of the dye apply the dye dissipation; \`*_pred\`
// and \`*_bfecc_error\` never do (they are intermediates).

#include "fluid-core.wgsl"

@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var aux: texture_2d<f32>;
@group(0) @binding(4) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var flow: texture_2d<f32>;
@group(0) @binding(6) var flow_samp: sampler;

// The limiter: the corrected value clamped to the range of the source samples it came from. It is only
// ever off (P.limit == 0) to show what it prevents.
fn limited(x: f32, lo: f32, hi: f32) -> f32 {
  return select(x, clamp(x, lo, hi), P.limit != 0u);
}

fn limited4(x: vec4f, lo: vec4f, hi: vec4f) -> vec4f {
  return select(x, clamp(x, lo, hi), P.limit != 0u);
}

// ---- Velocity ------------------------------------------------------------------------------------

fn vel_pred(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  return face_sample(src, axis, trace(src, face_position(axis, f), -1.0));
}

fn vel_mc(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  let p = face_position(axis, f);
  let forward = face_sample_bounds(src, axis, trace(src, p, -1.0));
  let original = face_tap(src, axis, f.x, f.y).x;
  let back = face_sample(aux, axis, trace(src, p, 1.0));
  return limited(forward.x + 0.5 * (original - back), forward.y, forward.z);
}

fn vel_bfecc_error(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  let original = face_tap(src, axis, f.x, f.y).x;
  let back = face_sample(aux, axis, trace(src, face_position(axis, f), 1.0));
  return original + 0.5 * (original - back);
}

fn vel_bfecc_final(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  let x = trace(src, face_position(axis, f), -1.0);
  let bounds = face_sample_bounds(src, axis, x);
  return limited(face_sample(aux, axis, x), bounds.y, bounds.z);
}

fn finish_vel(v: vec2f) -> vec4f {
  return vec4f(finite2(v), 0.0, 0.0);
}

@compute @workgroup_size(16, 16)
fn cs_vel_sl(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(dst, c, finish_vel(vec2f(vel_pred(0u, c), vel_pred(1u, c))));
}

// The forward pass of both corrected schemes is the plain semi-Lagrangian step.
@compute @workgroup_size(16, 16)
fn cs_vel_pred(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(dst, c, finish_vel(vec2f(vel_pred(0u, c), vel_pred(1u, c))));
}

@compute @workgroup_size(16, 16)
fn cs_vel_mc(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(dst, c, finish_vel(vec2f(vel_mc(0u, c), vel_mc(1u, c))));
}

@compute @workgroup_size(16, 16)
fn cs_vel_bfecc_error(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(dst, c, finish_vel(vec2f(vel_bfecc_error(0u, c), vel_bfecc_error(1u, c))));
}

@compute @workgroup_size(16, 16)
fn cs_vel_bfecc_final(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(dst, c, finish_vel(vec2f(vel_bfecc_final(0u, c), vel_bfecc_final(1u, c))));
}

// ---- Dye -----------------------------------------------------------------------------------------

fn dye_solid(t: vec2i) -> bool {
  return P.solid != 0u && textureLoad(solid_mask, dye_cell(t), 0).r >= 0.5;
}

fn finish_dye(v: vec4f, decay: f32) -> vec4f {
  let m = clamp(v * decay, vec4f(-P.dye_max), vec4f(P.dye_max));
  return select(m, vec4f(0.0), (bitcast<vec4u>(m) & vec4u(0x7f800000u)) == vec4u(0x7f800000u));
}

// Where a dye texel's parcel was / will be, in dye texels.
fn dye_trace(t: vec2i, way: f32) -> vec2f {
  let ps = dye_to_sim(vec2f(t) + 0.5);
  // The cubic velocity needs the plain domain (see fluid-core.wgsl); anything else keeps the bilinear one.
  if (P.dye_filter != 0u && P.solid == 0u && P.boundary != BOUNDARY_WRAP) {
    return sim_to_dye(trace_cubic(flow, flow_samp, ps, way));
  }
  return sim_to_dye(trace(flow, ps, way));
}

fn dye_pred(t: vec2i) -> vec4f {
  return dye_sample(src, dye_trace(t, -1.0)).v;
}

@compute @workgroup_size(16, 16)
fn cs_dye_sl(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.dye_size)) {
    return;
  }
  let t = vec2i(id.xy);
  if (dye_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  textureStore(dst, t, finish_dye(dye_pred(t), P.dye_decay));
}

@compute @workgroup_size(16, 16)
fn cs_dye_pred(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.dye_size)) {
    return;
  }
  let t = vec2i(id.xy);
  if (dye_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  textureStore(dst, t, finish_dye(dye_pred(t), 1.0));
}

@compute @workgroup_size(16, 16)
fn cs_dye_mc(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.dye_size)) {
    return;
  }
  let t = vec2i(id.xy);
  if (dye_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  let forward = dye_sample(src, dye_trace(t, -1.0));
  let original = textureLoad(src, t, 0);
  let back = dye_sample(aux, dye_trace(t, 1.0)).v;
  let corrected = limited4(forward.v + 0.5 * (original - back), forward.lo, forward.hi);
  textureStore(dst, t, finish_dye(corrected, P.dye_decay));
}

@compute @workgroup_size(16, 16)
fn cs_dye_bfecc_error(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.dye_size)) {
    return;
  }
  let t = vec2i(id.xy);
  if (dye_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  let original = textureLoad(src, t, 0);
  let back = dye_sample(aux, dye_trace(t, 1.0)).v;
  textureStore(dst, t, finish_dye(original + 0.5 * (original - back), 1.0));
}

@compute @workgroup_size(16, 16)
fn cs_dye_bfecc_final(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.dye_size)) {
    return;
  }
  let t = vec2i(id.xy);
  if (dye_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  let x = dye_trace(t, -1.0);
  let bounds = dye_sample(src, x);
  let corrected = limited4(dye_sample(aux, x).v, bounds.lo, bounds.hi);
  textureStore(dst, t, finish_dye(corrected, P.dye_decay));
}
`,s=`// fluid-core.wgsl -- the shared maths of the stable-fluids solver (src/gpu/sim/fluid.ts): the grid
// arrangement, boundary handling and the samplers every pass uses. Included by fluid-advect.wgsl,
// fluid-forces.wgsl and fluid-project.wgsl after the generated \`fluid_uniforms.wgsl\`.
//
// GRID. A MAC ("marker and cell") grid, W x H square cells. Lengths inside the solver are in CELLS with
// the origin at the top-left corner of the domain and y pointing DOWN (the uv direction): cell (i, j)
// covers [i, i+1] x [j, j+1]. Velocity is stored on the FACES between cells, not at cell centres:
//     u(i, j)  x-velocity of the face on the LEFT of cell (i, j)   at (i,       j + 1/2)   i = 0..W, j = 0..H-1
//     v(i, j)  y-velocity of the face on the TOP  of cell (i, j)   at (i + 1/2, j      )   i = 0..W-1, j = 0..H
// both in image heights per second, in one rgba16float texture of (W+1) x (H+1) texels with u in .x and
// v in .y (the row H of u and the column W of v are padding that repeats the last row / column, so a
// hardware-filtered tap at the edge behaves like clamp-to-edge). Pressure, divergence and vorticity
// live at cell centres (W x H). Why not a plain cell-centred ("collocated") grid? The pressure solve
// uses the compact 5-point laplacian, and only face velocities make divergence and the pressure
// gradient the matching compact differences: the projected field is divergence-free to the solver's
// tolerance (collocated grids leave the checkerboard mode in the null space and a sizeable residual
// at short wavelengths), and a solid face is exactly zero, so nothing leaks through a one-cell wall.
//
// CELLS AND FACES have a class. A cell is FLUID, SOLID (obstacle mask >= 0.5, or outside the domain with
// the \`wall\` boundary) or AIR (outside the domain with the \`open\` boundary: pressure fixed at 0, flow
// may leave). \`wrap\` maps outside cells back inside. A face is FREE (both sides fluid or air), BLOCKED
// (exactly one side solid: its velocity is held at 0, it lies on a surface) or INSIDE (both sides solid:
// meaningless, ignored by every interpolation).
//
// Bindings shared by every pass: 0 \`P\` the uniform block, 1 \`solid_mask\` (r8unorm, grid sized).

#include "fluid_uniforms.wgsl"

@group(0) @binding(0) var<uniform> P: FluidUniforms;
@group(0) @binding(1) var solid_mask: texture_2d<f32>;

const BOUNDARY_WALL: u32 = 0u;
const BOUNDARY_OPEN: u32 = 1u;
const BOUNDARY_WRAP: u32 = 2u;

const CELL_FLUID: u32 = 0u;
const CELL_SOLID: u32 = 1u;
const CELL_AIR: u32 = 2u;

const FACE_FREE: u32 = 0u;
const FACE_BLOCKED: u32 = 1u;
const FACE_INSIDE: u32 = 2u;

const WORKGROUP_SIDE: u32 = 16u;

fn wrap_index(i: i32, n: i32) -> i32 {
  return ((i % n) + n) % n;
}

// 0 for NaN and +-Inf, x otherwise. Tests the exponent bits because \`x != x\` may be folded away.
fn finite_or_zero(x: f32) -> f32 {
  return select(x, 0.0, (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u);
}

fn finite2(v: vec2f) -> vec2f {
  return vec2f(finite_or_zero(v.x), finite_or_zero(v.y));
}

// ---- Cells ---------------------------------------------------------------------------------------

fn cell_class(c: vec2i) -> u32 {
  let g = vec2i(P.grid);
  var q = c;
  if (c.x < 0 || c.y < 0 || c.x >= g.x || c.y >= g.y) {
    if (P.boundary == BOUNDARY_WALL) {
      return CELL_SOLID;
    }
    if (P.boundary == BOUNDARY_OPEN) {
      return CELL_AIR;
    }
    q = vec2i(wrap_index(c.x, g.x), wrap_index(c.y, g.y));
  }
  if (P.solid != 0u && textureLoad(solid_mask, q, 0).r >= 0.5) {
    return CELL_SOLID;
  }
  return CELL_FLUID;
}

// The in-range cell a FLUID neighbour lives in (only \`wrap\` ever leaves the range).
fn cell_wrapped(c: vec2i) -> vec2i {
  let g = vec2i(P.grid);
  if (P.boundary == BOUNDARY_WRAP) {
    return vec2i(wrap_index(c.x, g.x), wrap_index(c.y, g.y));
  }
  return c;
}

// ---- Faces ---------------------------------------------------------------------------------------

// The two cells a face separates: axis 0 is a u face (left of cell f), axis 1 a v face (top of cell f).
fn face_cells(axis: u32, f: vec2i) -> array<vec2i, 2> {
  if (axis == 0u) {
    return array<vec2i, 2>(vec2i(f.x - 1, f.y), f);
  }
  return array<vec2i, 2>(vec2i(f.x, f.y - 1), f);
}

fn face_state(axis: u32, f: vec2i) -> u32 {
  if (P.solid == 0u) {
    // No obstacles: only a closed boundary blocks faces, and only those on the edge. This is the hot
    // path (every tap of every interpolation asks), so it skips the cell lookups below.
    if (P.boundary == BOUNDARY_WALL) {
      let g = vec2i(P.grid);
      let on_edge = select(f.y == 0 || f.y == g.y, f.x == 0 || f.x == g.x, axis == 0u);
      return select(FACE_FREE, FACE_BLOCKED, on_edge);
    }
    return FACE_FREE;
  }
  let cells = face_cells(axis, f);
  let a = cell_class(cells[0]);
  let b = cell_class(cells[1]);
  if (a == CELL_SOLID && b == CELL_SOLID) {
    return FACE_INSIDE;
  }
  if (a == CELL_SOLID || b == CELL_SOLID) {
    return FACE_BLOCKED;
  }
  return FACE_FREE;
}

// The face a texel of the velocity texture is responsible for, for one component: the padding row of
// u and column of v repeat the last real one.
fn face_of(axis: u32, texel: vec2i) -> vec2i {
  let g = vec2i(P.grid);
  if (axis == 0u) {
    return vec2i(texel.x, min(texel.y, g.y - 1));
  }
  return vec2i(min(texel.x, g.x - 1), texel.y);
}

// Where the face sits, in cells.
fn face_position(axis: u32, f: vec2i) -> vec2f {
  if (axis == 0u) {
    return vec2f(f32(f.x), f32(f.y) + 0.5);
  }
  return vec2f(f32(f.x) + 0.5, f32(f.y));
}

// Face coordinates mapped onto stored texels: clamped to the real faces, or wrapped.
fn face_index(axis: u32, i: i32, j: i32) -> vec2i {
  let g = vec2i(P.grid);
  if (P.boundary == BOUNDARY_WRAP) {
    return vec2i(wrap_index(i, g.x), wrap_index(j, g.y));
  }
  if (axis == 0u) {
    return vec2i(clamp(i, 0, g.x), clamp(j, 0, g.y - 1));
  }
  return vec2i(clamp(i, 0, g.x - 1), clamp(j, 0, g.y));
}

// One face of a velocity texture as (value, weight): weight 0 for a face inside a solid, value 0 for
// a blocked one. Interpolation renormalises by the weights, which extends the fluid's own velocity
// into solid cells (free-slip along obstacles) instead of dragging it towards zero.
fn face_tap(tex: texture_2d<f32>, axis: u32, i: i32, j: i32) -> vec2f {
  let f = face_index(axis, i, j);
  let s = textureLoad(tex, f, 0);
  let value = select(s.y, s.x, axis == 0u);
  let state = face_state(axis, f);
  if (state == FACE_INSIDE) {
    return vec2f(0.0, 0.0);
  }
  return vec2f(select(value, 0.0, state == FACE_BLOCKED), 1.0);
}

// Bilinear interpolation of one velocity component at position p (cells).
fn face_sample(tex: texture_2d<f32>, axis: u32, p: vec2f) -> f32 {
  let q = select(vec2f(p.x - 0.5, p.y), vec2f(p.x, p.y - 0.5), axis == 0u);
  let b = floor(q);
  let t = q - b;
  let i = i32(b.x);
  let j = i32(b.y);
  let a00 = face_tap(tex, axis, i, j);
  let a10 = face_tap(tex, axis, i + 1, j);
  let a01 = face_tap(tex, axis, i, j + 1);
  let a11 = face_tap(tex, axis, i + 1, j + 1);
  let w00 = (1.0 - t.x) * (1.0 - t.y) * a00.y;
  let w10 = t.x * (1.0 - t.y) * a10.y;
  let w01 = (1.0 - t.x) * t.y * a01.y;
  let w11 = t.x * t.y * a11.y;
  let w = w00 + w10 + w01 + w11;
  if (w < 1e-6) {
    return 0.0;
  }
  return (w00 * a00.x + w10 * a10.x + w01 * a01.x + w11 * a11.x) / w;
}

// The same interpolation, plus the smallest and largest value among the taps that contributed:
// (value, min, max). The bounds are what the MacCormack and BFECC limiters clamp to.
fn face_sample_bounds(tex: texture_2d<f32>, axis: u32, p: vec2f) -> vec3f {
  let q = select(vec2f(p.x - 0.5, p.y), vec2f(p.x, p.y - 0.5), axis == 0u);
  let b = floor(q);
  let t = q - b;
  let i = i32(b.x);
  let j = i32(b.y);
  let a00 = face_tap(tex, axis, i, j);
  let a10 = face_tap(tex, axis, i + 1, j);
  let a01 = face_tap(tex, axis, i, j + 1);
  let a11 = face_tap(tex, axis, i + 1, j + 1);
  let w00 = (1.0 - t.x) * (1.0 - t.y) * a00.y;
  let w10 = t.x * (1.0 - t.y) * a10.y;
  let w01 = (1.0 - t.x) * t.y * a01.y;
  let w11 = t.x * t.y * a11.y;
  let w = w00 + w10 + w01 + w11;
  if (w < 1e-6) {
    return vec3f(0.0);
  }
  var lo = 1e30;
  var hi = -1e30;
  // A tap that carries weight is a tap that exists; the zero-weight ones (inside a solid) are skipped.
  if (a00.y > 0.0) { lo = min(lo, a00.x); hi = max(hi, a00.x); }
  if (a10.y > 0.0) { lo = min(lo, a10.x); hi = max(hi, a10.x); }
  if (a01.y > 0.0) { lo = min(lo, a01.x); hi = max(hi, a01.x); }
  if (a11.y > 0.0) { lo = min(lo, a11.x); hi = max(hi, a11.x); }
  return vec3f((w00 * a00.x + w10 * a10.x + w01 * a01.x + w11 * a11.x) / w, lo, hi);
}

// Velocity (image heights per second) at p (cells).
fn vel_at(tex: texture_2d<f32>, p: vec2f) -> vec2f {
  return vec2f(face_sample(tex, 0u, p), face_sample(tex, 1u, p));
}

// ---- Tracing ---------------------------------------------------------------------------------------

fn clamp_length(d: vec2f, limit: f32) -> vec2f {
  let l = length(d);
  return select(d, d * (limit / l), l > limit);
}

// Where a parcel that is at p now was (way -1) or will be (way +1) one step away, in cells: an
// explicit Euler step, or the midpoint method when \`rk2\` is set (second order: rotation stays a
// rotation instead of spiralling outwards). The displacement is capped at \`max_disp\` cells.
fn trace(tex: texture_2d<f32>, p: vec2f, way: f32) -> vec2f {
  let k = way * P.dt * P.cells_per_h;
  var d = clamp_length(vel_at(tex, p) * k, P.max_disp);
  if (P.rk2 != 0u) {
    d = clamp_length(vel_at(tex, p + 0.5 * d) * k, P.max_disp);
  }
  return p + d;
}

// ---- Higher-order velocity (story 6.8) -----------------------------------------------------------------

// Cubic reconstruction of the staggered velocity for the DYE trace. \`vel_at\` is bilinear: continuous but
// with a kink in its slope at every cell border, which a fine dye grid shows as corners in streaklines
// (the dye is 4 times finer than the velocity, so a kink every 4 texels). These read the velocity
// texture through the hardware filter, nine or four taps instead of the sixteen of a gather, so the
// price is about that of the eight loads of \`vel_at\`. They assume the plain domain: no obstacles (a
// solid face would have to be left out of the stencil) and no periodic wrap (the texture is one face
// wider than the grid); the caller falls back to \`vel_at\` otherwise. \`samp\` is linear, clamp-to-edge.
//   kind 1  cubic B-spline          C2, reproduces linear fields exactly, smooths slightly (not interpolating)
//   kind 2  Catmull-Rom             C1, reproduces linear fields exactly, interpolates the stored faces,
//                                   with small negative lobes (the field may overshoot its faces by a few percent)
//   kind 3  hardware bilinear       the same function as \`vel_at\`, two filtered taps instead of eight loads and
//                                   the face bookkeeping (to the precision of the filter's weights)

// A texture reconstructed by a cubic B-spline at t (texels, centres at +0.5), four bilinear taps.
fn bspline_at(tex: texture_2d<f32>, samp: sampler, t: vec2f, size: vec2f) -> vec4f {
  let coord = t - 0.5;
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
  let p0 = (base - 1.0 + w1 / g0 + 0.5) / size;
  let p1 = (base + 1.0 + w3 / g1 + 0.5) / size;
  let t00 = textureSampleLevel(tex, samp, vec2f(p0.x, p0.y), 0.0);
  let t10 = textureSampleLevel(tex, samp, vec2f(p1.x, p0.y), 0.0);
  let t01 = textureSampleLevel(tex, samp, vec2f(p0.x, p1.y), 0.0);
  let t11 = textureSampleLevel(tex, samp, vec2f(p1.x, p1.y), 0.0);
  return g0.y * (g0.x * t00 + g1.x * t10) + g1.y * (g0.x * t01 + g1.x * t11);
}

// The same with a Catmull-Rom spline: nine bilinear taps (the two middle texels of each axis share one).
fn catmull_rom_at(tex: texture_2d<f32>, samp: sampler, t: vec2f, size: vec2f) -> vec4f {
  let pos1 = floor(t - 0.5) + 0.5;
  let f = t - pos1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let p0 = (pos1 - 1.0) / size;
  let p3 = (pos1 + 2.0) / size;
  let p12 = (pos1 + w2 / w12) / size;
  var sum = textureSampleLevel(tex, samp, vec2f(p0.x, p0.y), 0.0) * (w0.x * w0.y);
  sum += textureSampleLevel(tex, samp, vec2f(p12.x, p0.y), 0.0) * (w12.x * w0.y);
  sum += textureSampleLevel(tex, samp, vec2f(p3.x, p0.y), 0.0) * (w3.x * w0.y);
  sum += textureSampleLevel(tex, samp, vec2f(p0.x, p12.y), 0.0) * (w0.x * w12.y);
  sum += textureSampleLevel(tex, samp, vec2f(p12.x, p12.y), 0.0) * (w12.x * w12.y);
  sum += textureSampleLevel(tex, samp, vec2f(p3.x, p12.y), 0.0) * (w3.x * w12.y);
  sum += textureSampleLevel(tex, samp, vec2f(p0.x, p3.y), 0.0) * (w0.x * w3.y);
  sum += textureSampleLevel(tex, samp, vec2f(p12.x, p3.y), 0.0) * (w12.x * w3.y);
  sum += textureSampleLevel(tex, samp, vec2f(p3.x, p3.y), 0.0) * (w3.x * w3.y);
  return sum;
}

// Velocity (image heights per second) at p (cells) for a grid of \`cells\` cells: u from a reconstruction
// centred on the u faces (texel p + (1/2, 0)), v on the v faces (texel p + (0, 1/2)).
fn vel_at_cubic(tex: texture_2d<f32>, samp: sampler, p: vec2f, cells: vec2f, kind: u32) -> vec2f {
  let size = cells + vec2f(1.0);
  let tu = vec2f(p.x + 0.5, p.y);
  let tv = vec2f(p.x, p.y + 0.5);
  if (kind == 3u) {
    return vec2f(
      textureSampleLevel(tex, samp, tu / size, 0.0).x,
      textureSampleLevel(tex, samp, tv / size, 0.0).y,
    );
  }
  if (kind == 2u) {
    return vec2f(catmull_rom_at(tex, samp, tu, size).x, catmull_rom_at(tex, samp, tv, size).y);
  }
  return vec2f(bspline_at(tex, samp, tu, size).x, bspline_at(tex, samp, tv, size).y);
}

// \`trace\` with the cubic velocity.
fn trace_cubic(tex: texture_2d<f32>, samp: sampler, p: vec2f, way: f32) -> vec2f {
  let cells = vec2f(P.grid);
  let k = way * P.dt * P.cells_per_h;
  var d = clamp_length(vel_at_cubic(tex, samp, p, cells, P.dye_filter) * k, P.max_disp);
  if (P.rk2 != 0u) {
    d = clamp_length(vel_at_cubic(tex, samp, p + 0.5 * d, cells, P.dye_filter) * k, P.max_disp);
  }
  return p + d;
}

// ---- Dye -----------------------------------------------------------------------------------------

struct DyeTap {
  v: vec4f,
  w: f32,
}

// The sim cell a dye texel lies in.
fn dye_cell(t: vec2i) -> vec2i {
  let g = vec2f(P.grid);
  let d = vec2f(P.dye_size);
  return min(vec2i(floor((vec2f(t) + 0.5) * g / d)), vec2i(P.grid) - vec2i(1));
}

fn sim_to_dye(p: vec2f) -> vec2f {
  return p * vec2f(P.dye_size) / vec2f(P.grid);
}

fn dye_to_sim(q: vec2f) -> vec2f {
  return q * vec2f(P.grid) / vec2f(P.dye_size);
}

// A dye texel as (value, weight). Outside the domain: clamped for \`wall\`, wrapped for \`wrap\`, clear
// water (zero) for \`open\`. Texels in solid cells have weight 0.
fn dye_tap(tex: texture_2d<f32>, t: vec2i) -> DyeTap {
  let d = vec2i(P.dye_size);
  var q = t;
  if (t.x < 0 || t.y < 0 || t.x >= d.x || t.y >= d.y) {
    if (P.boundary == BOUNDARY_OPEN) {
      return DyeTap(vec4f(0.0), 1.0);
    }
    if (P.boundary == BOUNDARY_WRAP) {
      q = vec2i(wrap_index(t.x, d.x), wrap_index(t.y, d.y));
    } else {
      q = clamp(t, vec2i(0), d - vec2i(1));
    }
  }
  if (P.solid != 0u && textureLoad(solid_mask, dye_cell(q), 0).r >= 0.5) {
    return DyeTap(vec4f(0.0), 0.0);
  }
  return DyeTap(textureLoad(tex, q, 0), 1.0);
}

struct DyeSample {
  v: vec4f,
  lo: vec4f,
  hi: vec4f,
}

// Bilinear interpolation at q (dye texels, texel centres at +0.5) with the per-channel bounds of the
// contributing taps.
fn dye_sample(tex: texture_2d<f32>, q: vec2f) -> DyeSample {
  let b = floor(q - 0.5);
  let t = q - 0.5 - b;
  let i = vec2i(b);
  let a00 = dye_tap(tex, i);
  let a10 = dye_tap(tex, i + vec2i(1, 0));
  let a01 = dye_tap(tex, i + vec2i(0, 1));
  let a11 = dye_tap(tex, i + vec2i(1, 1));
  let w00 = (1.0 - t.x) * (1.0 - t.y) * a00.w;
  let w10 = t.x * (1.0 - t.y) * a10.w;
  let w01 = (1.0 - t.x) * t.y * a01.w;
  let w11 = t.x * t.y * a11.w;
  let w = w00 + w10 + w01 + w11;
  if (w < 1e-6) {
    return DyeSample(vec4f(0.0), vec4f(0.0), vec4f(0.0));
  }
  var lo = vec4f(1e30);
  var hi = vec4f(-1e30);
  if (a00.w > 0.0) { lo = min(lo, a00.v); hi = max(hi, a00.v); }
  if (a10.w > 0.0) { lo = min(lo, a10.v); hi = max(hi, a10.v); }
  if (a01.w > 0.0) { lo = min(lo, a01.v); hi = max(hi, a01.v); }
  if (a11.w > 0.0) { lo = min(lo, a11.v); hi = max(hi, a11.v); }
  return DyeSample((w00 * a00.v + w10 * a10.v + w01 * a01.v + w11 * a11.v) / w, lo, hi);
}

// ---- Splats --------------------------------------------------------------------------------------

// A capsule of influence: the segment a -> b in uv, inflated by a Gaussian of radius \`shape.x\` (image
// heights, the distance at which the weight is 1/e). A point is a segment with a == b. \`shape.y\` is
// the half-width of a smooth start and end ramp along the segment (0 = a plain flat capsule): with a
// ramp, segments laid end to end (a pointer's path, frame after frame) add up to a uniform stroke,
// because the falling edge of one is exactly the rising edge of the next. \`value\` is what the pass
// adds at full weight: a change of velocity (xy) or dye (rgba).
struct Splat {
  seg: vec4f,
  shape: vec4f,
  value: vec4f,
}

fn splat_weight(uv: vec2f, s: Splat) -> f32 {
  let k = vec2f(P.aspect, 1.0);
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
`,c=`// fluid-forces.wgsl -- everything that adds to the fluid between advection and projection: splats of
// momentum and dye, the vorticity (curl) field, body forces with vorticity confinement, viscosity.
//
// Bindings (besides the shared 0 \`P\` and 1 \`solid_mask\`); an entry point uses only some of them:
//   2 src       the texture being updated: velocity (W+1 x H+1) or, for cs_splat_dye, the dye
//   3 dst       its rgba16float storage output
//   4 splats    read-only storage buffer of \`Splat\`s (P.force_count / P.dye_count of them)
//   5 curl_tex  r32float W x H vorticity (physical units, 1 / s), read by cs_forces
//   6 dye_tex   the dye, for buoyancy
//   7 samp      a filtering sampler for dye_tex
//   8 curl_dst  r32float storage output of cs_curl
//   9 base      the un-diffused velocity of the viscosity iteration
//  10 smooth_dst r32float storage output of cs_curl_smooth: |curl| blurred over 3 x 3 cells
//  11 smooth_tex the same, read by cs_forces

#include "fluid-core.wgsl"

@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<storage, read> splats: array<Splat>;
@group(0) @binding(5) var curl_tex: texture_2d<f32>;
@group(0) @binding(6) var dye_tex: texture_2d<f32>;
@group(0) @binding(7) var samp: sampler;
@group(0) @binding(8) var curl_dst: texture_storage_2d<r32float, write>;
@group(0) @binding(9) var base: texture_2d<f32>;
@group(0) @binding(10) var smooth_dst: texture_storage_2d<r32float, write>;
@group(0) @binding(11) var smooth_tex: texture_2d<f32>;

// ---- Splats ----------------------------------------------------------------------------------------

fn splat_velocity(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  let uv = face_position(axis, f) / vec2f(P.grid);
  var dv = 0.0;
  for (var k = 0u; k < P.force_count; k++) {
    let s = splats[k];
    dv += splat_weight(uv, s) * select(s.value.y, s.value.x, axis == 0u);
  }
  return face_tap(src, axis, f.x, f.y).x + dv;
}

@compute @workgroup_size(16, 16)
fn cs_splat_velocity(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  let v = vec2f(splat_velocity(0u, c), splat_velocity(1u, c));
  let m = P.vmax;
  textureStore(dst, c, vec4f(clamp(finite2(v), vec2f(-m), vec2f(m)), 0.0, 0.0));
}

@compute @workgroup_size(16, 16)
fn cs_splat_dye(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.dye_size)) {
    return;
  }
  let t = vec2i(id.xy);
  if (P.solid != 0u && textureLoad(solid_mask, dye_cell(t), 0).r >= 0.5) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  let uv = (vec2f(t) + 0.5) / vec2f(P.dye_size);
  var d = textureLoad(src, t, 0);
  for (var k = 0u; k < P.dye_count; k++) {
    let s = splats[k];
    d += splat_weight(uv, s) * s.value;
  }
  let m = clamp(d, vec4f(-P.dye_max), vec4f(P.dye_max));
  textureStore(dst, t, select(m, vec4f(0.0), (bitcast<vec4u>(m) & vec4u(0x7f800000u)) == vec4u(0x7f800000u)));
}

// ---- Vorticity ---------------------------------------------------------------------------------------

// Curl at a cell centre in 1 / s: the mean of the four corner circulations of the cell, which
// telescopes to eight face velocities. Positive is dv/dx > du/dy, which is CLOCKWISE on screen (y down).
@compute @workgroup_size(16, 16)
fn cs_curl(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  var w = 0.0;
  if (cell_class(c) == CELL_FLUID) {
    let dv = face_tap(src, 1u, c.x + 1, c.y).x - face_tap(src, 1u, c.x - 1, c.y).x
           + face_tap(src, 1u, c.x + 1, c.y + 1).x - face_tap(src, 1u, c.x - 1, c.y + 1).x;
    let du = face_tap(src, 0u, c.x, c.y + 1).x - face_tap(src, 0u, c.x, c.y - 1).x
           + face_tap(src, 0u, c.x + 1, c.y + 1).x - face_tap(src, 0u, c.x + 1, c.y - 1).x;
    w = 0.25 * P.cells_per_h * (dv - du);
  }
  textureStore(curl_dst, c, vec4f(w, 0.0, 0.0, 0.0));
}

// |curl| blurred with the 3 x 3 binomial kernel [1 2 1; 2 4 2; 1 2 1] / 16. Confinement follows the
// GRADIENT of this, not of the raw curl: the raw gradient of a cell-scale ripple points at a different
// cell every step and confinement amplifies whatever it points at, which grows the ripple into a
// lattice of spurious vortices. The blur keeps the vortices it can resolve (three cells and more)
// and turns the force away from the noise.
@compute @workgroup_size(16, 16)
fn cs_curl_smooth(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  let centre = abs(textureLoad(curl_tex, c, 0).x);
  var sum = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let w = f32((2 - abs(dx)) * (2 - abs(dy)));
      let q = c + vec2i(dx, dy);
      var value = centre;
      if (cell_class(q) == CELL_FLUID) {
        value = abs(textureLoad(curl_tex, cell_wrapped(q), 0).x);
      }
      sum += w * value;
    }
  }
  textureStore(smooth_dst, c, vec4f(sum / 16.0, 0.0, 0.0, 0.0));
}

// ---- Forces --------------------------------------------------------------------------------------------

// |curl| of a neighbour; a solid or open neighbour borrows the centre's value (zero gradient).
fn curl_or(c: vec2i, fallback: f32) -> f32 {
  if (cell_class(c) != CELL_FLUID) {
    return fallback;
  }
  return textureLoad(curl_tex, cell_wrapped(c), 0).x;
}

fn smooth_or(c: vec2i, fallback: f32) -> f32 {
  if (cell_class(c) != CELL_FLUID) {
    return fallback;
  }
  return textureLoad(smooth_tex, cell_wrapped(c), 0).x;
}

// Vorticity confinement (Fedkiw, Stam, Jensen 2001): an acceleration eps * h * (N x w) that points
// round the nearest vortex centre in the sense it already turns, with N the unit gradient of |w|.
// It puts back the small-scale rotation that interpolation in advection smooths away. h is the cell
// size in image heights, so the force vanishes with the grid spacing.
fn confinement(c: vec2i) -> vec2f {
  let w = curl_or(c, 0.0);
  let a = abs(w);
  let here = smooth_or(c, 0.0);
  let gx = 0.5 * (smooth_or(c + vec2i(1, 0), here) - smooth_or(c + vec2i(-1, 0), here));
  let gy = 0.5 * (smooth_or(c + vec2i(0, 1), here) - smooth_or(c + vec2i(0, -1), here));
  let len = sqrt(gx * gx + gy * gy);
  if (len < 1e-4 || a < 1e-3) {
    return vec2f(0.0);
  }
  let n = vec2f(gx, gy) / len;
  return P.vorticity * w * vec2f(n.y, -n.x) / P.cells_per_h;
}

fn face_confinement(axis: u32, f: vec2i) -> f32 {
  var cells = face_cells(axis, f);
  var sum = 0.0;
  var n = 0.0;
  for (var k = 0; k < 2; k++) {
    if (cell_class(cells[k]) == CELL_FLUID) {
      let a = confinement(cell_wrapped(cells[k]));
      sum += select(a.y, a.x, axis == 0u);
      n += 1.0;
    }
  }
  return sum / max(n, 1.0);
}

fn forced_velocity(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  let a = select(P.accel.y, P.accel.x, axis == 0u);
  var accel = a;
  if (P.buoyancy != 0.0) {
    let uv = face_position(axis, f) / vec2f(P.grid);
    let density = textureSampleLevel(dye_tex, samp, uv, 0.0).a;
    accel += P.buoyancy * density * select(P.buoy_dir.y, P.buoy_dir.x, axis == 0u);
  }
  if (P.vorticity != 0.0) {
    accel += face_confinement(axis, f);
  }
  let v = (face_tap(src, axis, f.x, f.y).x + accel * P.dt) * P.vel_decay;
  return clamp(finite_or_zero(v), -P.vmax, P.vmax);
}

@compute @workgroup_size(16, 16)
fn cs_forces(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(dst, c, vec4f(forced_velocity(0u, c), forced_velocity(1u, c), 0.0, 0.0));
}

// ---- Viscosity -----------------------------------------------------------------------------------------

// One Jacobi iteration of the implicit diffusion (1 - nu dt laplacian) u = base, with
// a = nu dt / h^2 in P.diffuse_a. Neighbours inside a solid are left out (zero normal gradient).
fn diffused(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  let b = face_tap(base, axis, f.x, f.y).x;
  let t0 = face_tap(src, axis, f.x - 1, f.y);
  let t1 = face_tap(src, axis, f.x + 1, f.y);
  let t2 = face_tap(src, axis, f.x, f.y - 1);
  let t3 = face_tap(src, axis, f.x, f.y + 1);
  let sum = t0.x * t0.y + t1.x * t1.y + t2.x * t2.y + t3.x * t3.y;
  let n = t0.y + t1.y + t2.y + t3.y;
  return (b + P.diffuse_a * sum) / (1.0 + P.diffuse_a * n);
}

@compute @workgroup_size(16, 16)
fn cs_diffuse(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(dst, c, vec4f(diffused(0u, c), diffused(1u, c), 0.0, 0.0));
}
`,l=`// fluid-multigrid.wgsl -- the extra kernels of the multigrid pressure solve (pressureSolver 'multigrid',
// story 6.8): restriction of the residual, prolongation of the coarse correction, the coarse obstacle
// mask, and a near-exact solve of the coarsest level (up to 32 x 32 cells) inside one workgroup. The smoothing sweeps and the
// divergence are the existing \`cs_jacobi\`, \`cs_jacobi_cold\` and \`cs_divergence\` of fluid-project.wgsl,
// bound to a level's own uniform block and mask.
//
// THE SCHEME. The pressure equation is A phi = d with  A phi = (sum of fluid neighbours' phi) - n phi
// (n = neighbours that are not solid), the same operator on every level, with the cell size scaled out.
// A V-cycle on level l:
//     smooth A phi = d (damped Jacobi, a couple of sweeps)           removes the short wavelengths
//     r = d - A phi; d' = restrict(r); solve A e = d' one level down   the long wavelengths are
//     phi += prolong(e); smooth again                                  short on the coarser grid
// Levels halve the grid (ceil(n / 2), so any size works). Scaling: A on a grid with cells twice as wide
// is 4x the operator of the finer grid, so the restricted residual is the SUM of the four children's
// residuals (4 x their mean; rescaled by 4 / count where an odd size leaves a coarse cell fewer children).
// Prolongation is bilinear between the four nearest coarse cell centres, renormalised over the ones
// that are not solid. A coarse cell is solid only when all its children are, so obstacles survive
// as long as they are wider than the grid is coarse, and the smoothers see the same stencil on every
// level: the boundary rules of fluid-core.wgsl (wall, open, wrap, solid cells) apply unchanged.
//
// Every kernel here is bound with the uniform block and mask of the level its \`P.grid\` describes: the
// FINE level for restrict, prolong and mask (they compute the coarse size as (grid + 1) / 2), the
// level itself for the coarse solve.
//
// Bindings (besides the shared 0 \`P\` and 1 \`solid_mask\`); an entry point uses only some:
//   2 rhs_tex     r32float right-hand side of this level (cs_mg_restrict, cs_mg_coarse)
//   3 phi_tex     r32float pressure of this level, fine side (cs_mg_restrict, cs_mg_prolong)
//   4 corr_tex    r32float correction of the coarser level (cs_mg_prolong)
//   5 out_r32     r32float storage output
//   6 coarse_mask the coarser level's solid mask (cs_mg_prolong)
//   7 out_mask    rgba8unorm storage: the coarser level's mask (cs_mg_mask)

#include "fluid-core.wgsl"

@group(0) @binding(2) var rhs_tex: texture_2d<f32>;
@group(0) @binding(3) var phi_tex: texture_2d<f32>;
@group(0) @binding(4) var corr_tex: texture_2d<f32>;
@group(0) @binding(5) var out_r32: texture_storage_2d<r32float, write>;
@group(0) @binding(6) var coarse_mask: texture_2d<f32>;
@group(0) @binding(7) var out_mask: texture_storage_2d<rgba8unorm, write>;

fn mg_coarse_dims() -> vec2i {
  return (vec2i(P.grid) + vec2i(1)) / 2;
}

// ---- Residual and restriction --------------------------------------------------------------------

// d - A phi at a fluid cell, 0 elsewhere.
fn mg_residual(c: vec2i) -> f32 {
  if (cell_class(c) != CELL_FLUID) {
    return 0.0;
  }
  var sum = 0.0;
  var n = 0.0;
  for (var k = 0; k < 4; k++) {
    let q = c + select(select(vec2i(1, 0), vec2i(-1, 0), k == 1), select(vec2i(0, 1), vec2i(0, -1), k == 3), k >= 2);
    let cls = cell_class(q);
    if (cls == CELL_SOLID) {
      continue;
    }
    n += 1.0;
    if (cls == CELL_FLUID) {
      sum += textureLoad(phi_tex, cell_wrapped(q), 0).x;
    }
  }
  return textureLoad(rhs_tex, c, 0).x - (sum - n * textureLoad(phi_tex, c, 0).x);
}

@compute @workgroup_size(16, 16)
fn cs_mg_restrict(@builtin(global_invocation_id) id: vec3u) {
  let coarse = mg_coarse_dims();
  let k = vec2i(id.xy);
  if (any(k >= coarse)) {
    return;
  }
  let g = vec2i(P.grid);
  var sum = 0.0;
  var count = 0.0;
  for (var dy = 0; dy < 2; dy++) {
    for (var dx = 0; dx < 2; dx++) {
      let c = k * 2 + vec2i(dx, dy);
      if (c.x < g.x && c.y < g.y) {
        sum += mg_residual(c);
        count += 1.0;
      }
    }
  }
  textureStore(out_r32, k, vec4f(sum * 4.0 / max(count, 1.0), 0.0, 0.0, 0.0));
}

// The coarser level's mask: solid where every child is.
@compute @workgroup_size(16, 16)
fn cs_mg_mask(@builtin(global_invocation_id) id: vec3u) {
  let coarse = mg_coarse_dims();
  let k = vec2i(id.xy);
  if (any(k >= coarse)) {
    return;
  }
  let g = vec2i(P.grid);
  var all_solid = true;
  for (var dy = 0; dy < 2; dy++) {
    for (var dx = 0; dx < 2; dx++) {
      let c = k * 2 + vec2i(dx, dy);
      if (c.x < g.x && c.y < g.y && textureLoad(solid_mask, c, 0).r < 0.5) {
        all_solid = false;
      }
    }
  }
  textureStore(out_mask, k, vec4f(select(0.0, 1.0, all_solid), 0.0, 0.0, 1.0));
}

// ---- Prolongation --------------------------------------------------------------------------------

// (correction, weight) of a coarse cell; a cell outside the domain follows the boundary rule.
fn mg_coarse_tap(k: vec2i, coarse: vec2i) -> vec2f {
  var q = k;
  if (k.x < 0 || k.y < 0 || k.x >= coarse.x || k.y >= coarse.y) {
    if (P.boundary == BOUNDARY_OPEN) {
      return vec2f(0.0, 1.0);
    }
    if (P.boundary == BOUNDARY_WRAP) {
      q = vec2i(wrap_index(k.x, coarse.x), wrap_index(k.y, coarse.y));
    } else {
      q = clamp(k, vec2i(0), coarse - vec2i(1));
    }
  }
  if (P.solid != 0u && textureLoad(coarse_mask, q, 0).r >= 0.5) {
    return vec2f(0.0, 0.0);
  }
  return vec2f(textureLoad(corr_tex, q, 0).x, 1.0);
}

// phi + the bilinear interpolation of the coarse correction.
@compute @workgroup_size(16, 16)
fn cs_mg_prolong(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  if (cell_class(c) != CELL_FLUID) {
    textureStore(out_r32, c, vec4f(0.0));
    return;
  }
  let coarse = mg_coarse_dims();
  // Fine cell centres sit at c + 1/2; coarse ones at 2 (k + 1/2).
  let q = (vec2f(c) + 0.5) * 0.5 - 0.5;
  let b = floor(q);
  let t = q - b;
  let k = vec2i(b);
  let a00 = mg_coarse_tap(k, coarse);
  let a10 = mg_coarse_tap(k + vec2i(1, 0), coarse);
  let a01 = mg_coarse_tap(k + vec2i(0, 1), coarse);
  let a11 = mg_coarse_tap(k + vec2i(1, 1), coarse);
  let w00 = (1.0 - t.x) * (1.0 - t.y) * a00.y;
  let w10 = t.x * (1.0 - t.y) * a10.y;
  let w01 = (1.0 - t.x) * t.y * a01.y;
  let w11 = t.x * t.y * a11.y;
  let w = w00 + w10 + w01 + w11;
  var correction = 0.0;
  if (w > 1e-6) {
    correction = (w00 * a00.x + w10 * a10.x + w01 * a01.x + w11 * a11.x) / w;
  }
  textureStore(out_r32, c, vec4f(textureLoad(phi_tex, c, 0).x + correction, 0.0, 0.0, 0.0));
}

// ---- Coarsest level ------------------------------------------------------------------------------

// The whole level (at most 32 x 32 cells, four to a thread) in one workgroup: \`P.mg_sweeps\` sweeps of
// red-black SOR (omega in P.sor_omega) in shared memory, from zero, with a barrier between the colours.
// One dispatch instead of dozens of dependent ones, and the coarsest level ends up solved far better than
// a handful of Jacobi sweeps could.
var<workgroup> mg_phi: array<f32, 1024>;

const MG_SIDE: i32 = 32;

@compute @workgroup_size(16, 16)
fn cs_mg_coarse(@builtin(local_invocation_id) lid: vec3u) {
  let base = vec2i(lid.xy) * 2;
  let g = vec2i(P.grid);
  // Per cell of this thread's 2 x 2 block: the shared-memory index of each fluid neighbour (-1: none),
  // the number of neighbours that count in the diagonal, and the right-hand side.
  var nbr = array<i32, 16>(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1);
  var diag = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  var rhs = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  var live = 0u;
  for (var q = 0; q < 4; q++) {
    let c = base + vec2i(q & 1, q >> 1);
    mg_phi[c.y * MG_SIDE + c.x] = 0.0;
    if (any(c >= g) || cell_class(c) != CELL_FLUID) {
      continue;
    }
    rhs[q] = textureLoad(rhs_tex, c, 0).x;
    for (var k = 0; k < 4; k++) {
      let n = c + select(select(vec2i(1, 0), vec2i(-1, 0), k == 1), select(vec2i(0, 1), vec2i(0, -1), k == 3), k >= 2);
      let cls = cell_class(n);
      if (cls == CELL_SOLID) {
        continue;
      }
      diag[q] += 1.0;
      if (cls == CELL_FLUID) {
        let w = cell_wrapped(n);
        nbr[q * 4 + k] = w.y * MG_SIDE + w.x;
      }
    }
    if (diag[q] > 0.5) {
      live |= 1u << u32(q);
    }
  }
  workgroupBarrier();
  for (var sweep = 0u; sweep < P.mg_sweeps; sweep++) {
    for (var colour = 0; colour < 2; colour++) {
      for (var q = 0; q < 4; q++) {
        let c = base + vec2i(q & 1, q >> 1);
        let red = ((c.x + c.y) & 1) == 0;
        if ((live & (1u << u32(q))) != 0u && red == (colour == 0)) {
          var sum = 0.0;
          for (var k = 0; k < 4; k++) {
            let at = nbr[q * 4 + k];
            if (at >= 0) {
              sum += mg_phi[u32(at)];
            }
          }
          let at = c.y * MG_SIDE + c.x;
          mg_phi[at] = (1.0 - P.sor_omega) * mg_phi[at] + P.sor_omega * (sum - rhs[q]) / diag[q];
        }
      }
      workgroupBarrier();
    }
  }
  for (var q = 0; q < 4; q++) {
    let c = base + vec2i(q & 1, q >> 1);
    if (all(c < g)) {
      let on = (live & (1u << u32(q))) != 0u;
      textureStore(out_r32, c, vec4f(select(0.0, mg_phi[c.y * MG_SIDE + c.x], on), 0.0, 0.0, 0.0));
    }
  }
}
`,u=`// fluid-project.wgsl -- the pressure projection: divergence, Jacobi iterations of the pressure Poisson
// equation, subtraction of the pressure gradient, and the resolve pass that packs what consumers read.
//
// THE MATHS. Incompressibility is div u = 0. After advection and forces the velocity u* has some
// divergence; the projection finds phi with  laplacian(phi) = div u*  and sets  u = u* - grad phi,
// which then has div u = div u* - laplacian(phi) = 0. On the MAC grid every operator is a compact
// difference of neighbouring values, so with the cell size scaled out they are exactly
//     div(i, j)  = u(i+1, j) - u(i, j) + v(i, j+1) - v(i, j)
//     u'(i, j)   = u(i, j) - (phi(i, j) - phi(i-1, j))          v' likewise down the column
//     lap phi    = phi(i+1, j) + phi(i-1, j) + phi(i, j+1) + phi(i, j-1) - 4 phi(i, j)
// and  div u' = div u - lap phi  is zero to the accuracy of the linear solve, with no checkerboard
// null space. \`phi\` has the units of the velocity (image heights per second): it is the velocity
// potential of the correction, i.e. pressure times dt / density, scaled by the cell size. That makes
// it independent of dt, which is why last step's solution is a good starting guess.
//
// BOUNDARIES. A SOLID neighbour contributes nothing and does not count in the diagonal (zero normal
// gradient: the wall), an AIR neighbour (open boundary) counts as phi = 0 (the flow leaves freely),
// and a BLOCKED face keeps velocity 0 (set below). Jacobi: phi' = (sum of fluid neighbours - div) / n.
//
// SOLVERS. \`cs_jacobi\` is the Jacobi iteration (damped, see \`relaxed\`): every cell from its
// neighbours' previous values, one dispatch per iteration, converging like cos(pi / N)^k: hundreds of
// iterations for the longest wavelengths of an N-cell grid. \`cs_sor_red\` and \`cs_sor_black\` are red-black successive
// over-relaxation: the chequerboard is updated one colour at a time (a cell's four neighbours all
// have the other colour, so the update is exact Gauss-Seidel), each new value pushed past the
// Gauss-Seidel value by the factor omega (P.sor_omega, near 2 / (1 + sin(pi / N))). Without
// read-write storage textures a half-sweep reads one texture and writes another (copying the colour
// it does not update), so it costs the same as one Jacobi dispatch; and it converges like
// (1 - 2 pi / N)^k, about N / pi times faster in the long run. An "iteration" in the API is one such
// dispatch either way.
//
// Bindings (besides the shared 0 \`P\` and 1 \`solid_mask\`):
//   2 vel      velocity (W+1 x H+1)                 (cs_divergence, cs_project, cs_resolve)
//   3 div_tex  r32float divergence                  (cs_jacobi, cs_jacobi_cold)
//   4 p_src    r32float pressure of the last iteration (cs_jacobi; cs_project and cs_resolve read it at 4 too)
//   5 p_dst    r32float storage: the new pressure   (cs_jacobi, cs_jacobi_cold)
//   6 div_dst  r32float storage: the divergence     (cs_divergence)
//   7 out_vel  rgba16float storage: projected velocity (cs_project)
//   8 fields   rgba16float storage: the resolved output (cs_resolve)

#include "fluid-core.wgsl"

@group(0) @binding(2) var vel: texture_2d<f32>;
@group(0) @binding(3) var div_tex: texture_2d<f32>;
@group(0) @binding(4) var p_src: texture_2d<f32>;
@group(0) @binding(5) var p_dst: texture_storage_2d<r32float, write>;
@group(0) @binding(6) var div_dst: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var out_vel: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var fields: texture_storage_2d<rgba16float, write>;

// ---- Divergence ----------------------------------------------------------------------------------------

@compute @workgroup_size(16, 16)
fn cs_divergence(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  var d = 0.0;
  if (cell_class(c) == CELL_FLUID) {
    d = face_tap(vel, 0u, c.x + 1, c.y).x - face_tap(vel, 0u, c.x, c.y).x
      + face_tap(vel, 1u, c.x, c.y + 1).x - face_tap(vel, 1u, c.x, c.y).x;
  }
  textureStore(div_dst, c, vec4f(d, 0.0, 0.0, 0.0));
}

// ---- Jacobi ------------------------------------------------------------------------------------------------

// (sum of the neighbours' pressure, number of non-solid neighbours), \`use_prev\` false meaning "all zero".
fn neighbour(c: vec2i, use_prev: bool) -> vec2f {
  let cls = cell_class(c);
  if (cls == CELL_SOLID) {
    return vec2f(0.0, 0.0);
  }
  if (cls == CELL_FLUID && use_prev) {
    return vec2f(textureLoad(p_src, cell_wrapped(c), 0).x, 1.0);
  }
  return vec2f(0.0, 1.0);
}

fn jacobi(c: vec2i, use_prev: bool) -> f32 {
  if (cell_class(c) != CELL_FLUID) {
    return 0.0;
  }
  let sn = neighbour(c + vec2i(1, 0), use_prev) + neighbour(c + vec2i(-1, 0), use_prev)
         + neighbour(c + vec2i(0, 1), use_prev) + neighbour(c + vec2i(0, -1), use_prev);
  if (sn.y < 0.5) {
    return 0.0;
  }
  return (sn.x - textureLoad(div_tex, c, 0).x) / sn.y;
}

// Damped Jacobi: phi' = (1 - w) phi + w J(phi). The undamped iteration (w = 1) multiplies the
// highest-frequency (chequerboard) error mode by -1 every step: an odd number of iterations then
// OVER-corrects it (measured: 31 iterations left four times the divergence of 30) and an even number
// does not touch it. With w = 0.8 that mode shrinks by 0.6 per iteration, every other mode still
// converges, and the smooth ones are slowed by only a fifth.
fn relaxed(c: vec2i, use_prev: bool) -> f32 {
  let own = select(0.0, textureLoad(p_src, c, 0).x, use_prev);
  return (1.0 - P.jacobi_w) * own + P.jacobi_w * jacobi(c, use_prev);
}

@compute @workgroup_size(16, 16)
fn cs_jacobi(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(p_dst, c, vec4f(relaxed(c, true), 0.0, 0.0, 0.0));
}

// The first iteration of a solve that does not warm-start: the previous pressure is taken as zero.
// Red-black SOR half-sweep: cells of colour \`red\` (x + y even) become (1 - omega) phi + omega GS(phi),
// the others are copied. \`use_prev\` false starts from zero (the first red half-sweep of a cold solve).
fn sor(c: vec2i, red: bool, use_prev: bool) -> f32 {
  let own = select(0.0, textureLoad(p_src, c, 0).x, use_prev);
  let is_red = ((c.x + c.y) & 1) == 0;
  if (is_red != red) {
    return own;
  }
  return (1.0 - P.sor_omega) * own + P.sor_omega * jacobi(c, use_prev);
}

@compute @workgroup_size(16, 16)
fn cs_sor_red(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(p_dst, c, vec4f(sor(c, true, true), 0.0, 0.0, 0.0));
}

@compute @workgroup_size(16, 16)
fn cs_sor_red_cold(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(p_dst, c, vec4f(sor(c, true, false), 0.0, 0.0, 0.0));
}

@compute @workgroup_size(16, 16)
fn cs_sor_black(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(p_dst, c, vec4f(sor(c, false, true), 0.0, 0.0, 0.0));
}

@compute @workgroup_size(16, 16)
fn cs_jacobi_cold(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(p_dst, c, vec4f(relaxed(c, false), 0.0, 0.0, 0.0));
}

// ---- Projection ----------------------------------------------------------------------------------------------

fn phi(c: vec2i) -> f32 {
  if (cell_class(c) != CELL_FLUID) {
    return 0.0;
  }
  return textureLoad(p_src, cell_wrapped(c), 0).x;
}

fn projected(axis: u32, c: vec2i) -> f32 {
  let f = face_of(axis, c);
  if (face_state(axis, f) != FACE_FREE) {
    return 0.0;
  }
  let cells = face_cells(axis, f);
  let v = face_tap(vel, axis, f.x, f.y).x - (phi(cells[1]) - phi(cells[0]));
  return clamp(finite_or_zero(v), -P.vmax, P.vmax);
}

@compute @workgroup_size(16, 16)
fn cs_project(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid + vec2u(1u))) {
    return;
  }
  let c = vec2i(id.xy);
  textureStore(out_vel, c, vec4f(projected(0u, c), projected(1u, c), 0.0, 0.0));
}

// ---- Resolve -----------------------------------------------------------------------------------------------------

// The consumer texel of a cell (W x H): x, y the velocity at the cell centre (the mean of its two
// faces per axis, image heights per second), z the vorticity in 1 / s (same sign convention as
// cs_curl), w the pressure potential phi. Solid cells are all zero.
@compute @workgroup_size(16, 16)
fn cs_resolve(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.grid)) {
    return;
  }
  let c = vec2i(id.xy);
  if (cell_class(c) != CELL_FLUID) {
    textureStore(fields, c, vec4f(0.0));
    return;
  }
  let u = 0.5 * (face_tap(vel, 0u, c.x, c.y).x + face_tap(vel, 0u, c.x + 1, c.y).x);
  let v = 0.5 * (face_tap(vel, 1u, c.x, c.y).x + face_tap(vel, 1u, c.x, c.y + 1).x);
  let dv = face_tap(vel, 1u, c.x + 1, c.y).x - face_tap(vel, 1u, c.x - 1, c.y).x
         + face_tap(vel, 1u, c.x + 1, c.y + 1).x - face_tap(vel, 1u, c.x - 1, c.y + 1).x;
  let du = face_tap(vel, 0u, c.x, c.y + 1).x - face_tap(vel, 0u, c.x, c.y - 1).x
         + face_tap(vel, 0u, c.x + 1, c.y + 1).x - face_tap(vel, 0u, c.x + 1, c.y - 1).x;
  let w = 0.25 * P.cells_per_h * (dv - du);
  textureStore(fields, c, vec4f(u, v, w, textureLoad(p_src, c, 0).x));
}
`,d=`rgba16float`,f=`r32float`,p=12,m=16,h=256,g={bilinear:0,bspline:1,"catmull-rom":2,"hardware-bilinear":3},ee={stepRate:60,pressureSolver:`jacobi`,jacobiWeight:.8,sorOmega:0,pressureIterations:30,warmStart:!0,multigridCycles:1,multigridSmooth:1,multigridLevels:0,multigridCoarse:24,velocityScheme:`maccormack`,dyeScheme:`maccormack`,rk2:!0,dyeVelocityFilter:`hardware-bilinear`,limiter:!0,vorticity:0,viscosity:0,viscosityIterations:12,velocityDissipation:.2,dyeDissipation:.5,gravity:[0,0],buoyancy:0,buoyancyDirection:[0,-1],boundary:`wall`,maxCfl:6,dyeLimit:64,dyeOnly:!1},_=n(`FluidUniforms`,{grid:`vec2u`,dye_size:`vec2u`,dt:`f32`,cells_per_h:`f32`,aspect:`f32`,max_disp:`f32`,boundary:`u32`,solid:`u32`,rk2:`u32`,limit:`u32`,force_count:`u32`,dye_count:`u32`,vorticity:`f32`,buoyancy:`f32`,vel_decay:`f32`,dye_decay:`f32`,diffuse_a:`f32`,sor_omega:`f32`,jacobi_w:`f32`,vmax:`f32`,dye_max:`f32`,accel:`vec2f`,buoy_dir:`vec2f`,dye_filter:`u32`,mg_sweeps:`u32`}),v={0:`uniform`,1:`mask`};function y(e,t,n){return{source:e,entry:t,bindings:{...v,...n}}}var b={velSl:y(`advect`,`cs_vel_sl`,{2:`tex`,4:`storage-rgba`}),velPred:y(`advect`,`cs_vel_pred`,{2:`tex`,4:`storage-rgba`}),velMc:y(`advect`,`cs_vel_mc`,{2:`tex`,3:`tex`,4:`storage-rgba`}),velBfeccError:y(`advect`,`cs_vel_bfecc_error`,{2:`tex`,3:`tex`,4:`storage-rgba`}),velBfeccFinal:y(`advect`,`cs_vel_bfecc_final`,{2:`tex`,3:`tex`,4:`storage-rgba`}),dyeSl:y(`advect`,`cs_dye_sl`,{2:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),dyePred:y(`advect`,`cs_dye_pred`,{2:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),dyeMc:y(`advect`,`cs_dye_mc`,{2:`tex`,3:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),dyeBfeccError:y(`advect`,`cs_dye_bfecc_error`,{2:`tex`,3:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),dyeBfeccFinal:y(`advect`,`cs_dye_bfecc_final`,{2:`tex`,3:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),splatVelocity:y(`forces`,`cs_splat_velocity`,{2:`tex`,3:`storage-rgba`,4:`buffer`}),splatDye:y(`forces`,`cs_splat_dye`,{2:`tex`,3:`storage-rgba`,4:`buffer`}),curl:y(`forces`,`cs_curl`,{2:`tex`,8:`storage-r32`}),curlSmooth:y(`forces`,`cs_curl_smooth`,{5:`texu`,10:`storage-r32`}),forces:y(`forces`,`cs_forces`,{2:`tex`,3:`storage-rgba`,5:`texu`,6:`tex`,7:`sampler`,11:`texu`}),diffuse:y(`forces`,`cs_diffuse`,{2:`tex`,3:`storage-rgba`,9:`tex`}),divergence:y(`project`,`cs_divergence`,{2:`tex`,6:`storage-r32`}),jacobi:y(`project`,`cs_jacobi`,{3:`texu`,4:`texu`,5:`storage-r32`}),jacobiCold:y(`project`,`cs_jacobi_cold`,{3:`texu`,4:`texu`,5:`storage-r32`}),sorRed:y(`project`,`cs_sor_red`,{3:`texu`,4:`texu`,5:`storage-r32`}),sorRedCold:y(`project`,`cs_sor_red_cold`,{3:`texu`,4:`texu`,5:`storage-r32`}),sorBlack:y(`project`,`cs_sor_black`,{3:`texu`,4:`texu`,5:`storage-r32`}),project:y(`project`,`cs_project`,{2:`tex`,4:`texu`,7:`storage-rgba`}),resolve:y(`project`,`cs_resolve`,{2:`tex`,4:`texu`,8:`storage-rgba`}),mgRestrict:y(`multigrid`,`cs_mg_restrict`,{2:`texu`,3:`texu`,5:`storage-r32`}),mgMask:y(`multigrid`,`cs_mg_mask`,{7:`storage-rgba8`}),mgProlong:y(`multigrid`,`cs_mg_prolong`,{3:`texu`,4:`texu`,5:`storage-r32`,6:`mask`}),mgCoarse:y(`multigrid`,`cs_mg_coarse`,{2:`texu`,5:`storage-r32`})},x={advect:o,forces:c,project:u,multigrid:l};function S(e,t){let n=GPUShaderStage.COMPUTE;switch(t){case`uniform`:return{binding:e,visibility:n,buffer:{type:`uniform`}};case`mask`:case`tex`:return{binding:e,visibility:n,texture:{sampleType:`float`}};case`texu`:return{binding:e,visibility:n,texture:{sampleType:`unfilterable-float`}};case`storage-rgba`:return{binding:e,visibility:n,storageTexture:{access:`write-only`,format:d}};case`storage-rgba8`:return{binding:e,visibility:n,storageTexture:{access:`write-only`,format:`rgba8unorm`}};case`storage-r32`:return{binding:e,visibility:n,storageTexture:{access:`write-only`,format:f}};case`buffer`:return{binding:e,visibility:n,buffer:{type:`read-only-storage`}};case`sampler`:return{binding:e,visibility:n,sampler:{type:`filtering`}}}}var C=new WeakMap,w=new WeakMap;function T(e,t){let n=w.get(e);n||w.set(e,n=new Map);let r=n.get(t);return r||(r=i(e,{label:`sim/fluid-${t}.wgsl`,code:x[t],chunks:{"fluid_uniforms.wgsl":_.wgsl,"fluid-core.wgsl":s}}),n.set(t,r)),r}function te(e,t){let n=C.get(e);n||C.set(e,n=new Map);let r=n.get(t);if(!r){let i=b[t],a=e.createBindGroupLayout({label:`fluid ${i.entry} layout`,entries:Object.entries(i.bindings).map(([e,t])=>S(Number(e),t))});r={pipeline:e.createComputePipeline({label:`fluid ${i.entry}`,layout:e.createPipelineLayout({label:`fluid ${i.entry} pipeline layout`,bindGroupLayouts:[a]}),compute:{module:T(e,i.source),entryPoint:i.entry}}),layout:a,spec:i},n.set(t,r)}return r}var E=new Float32Array(1),D=new Uint32Array(E.buffer);function O(e){E[0]=e;let t=D[0],n=t>>>16&32768;if((t&2147483647)>2139095040)return n|32256;let r=(t>>>23&255)-127+15,i=t&8388607;if(r>=31)return n|31744;if(r<=0){if(r<-10)return n;let e=i|8388608,t=14-r,a=e>>t;return e>>t-1&1&&a++,n|a}let a=n|r<<10|i>>13;return i&4096&&a++,a}var k=(e,t,n)=>Math.min(n,Math.max(t,e)),A=(e,t)=>Number.isFinite(e)?e:t;function ne(e,t,n=4096){let r=Math.round(k(A(e,128),16,n)),i=Number.isFinite(t)&&t>0?t:1,a=i>=1?r:Math.max(16,Math.round(r*i)),o=i>=1?Math.max(16,Math.round(r/i)):r;return{width:Math.min(a,n),height:Math.min(o,n)}}function j(e,t){let n=(Math.cos(Math.PI/e)+Math.cos(Math.PI/t))/2;return Math.min(1.9,2/(1+Math.sqrt(1-n*n)))}function re(e,t,n=0){let r=[{width:e,height:t}],i=n>0?Math.max(2,Math.floor(n)):64;for(;r.length<i;){let e=r[r.length-1];if(Math.max(e.width,e.height)<=32)break;r.push({width:Math.ceil(e.width/2),height:Math.ceil(e.height/2)})}return r}Object.freeze({"fluid_uniforms.wgsl":_.wgsl,"fluid-core.wgsl":s});var M=1,N=new WeakMap;function ie(e){let t=N.get(e);return t===void 0&&N.set(e,t=M++),t}function P(n){let{device:i,maxStepsPerFrame:o=4,profiler:s=t,label:c=`fluid`}=n,l=n.resolution??128,u=n.dyeResolution??Math.min(1024,l*4),v=(n.width??1)/(n.height??1),y=Math.min(i.limits.maxTextureDimension2D-1,4096),b={...ee,...n.params},x={},S=r(i,_,`${c} params`),C=i.createSampler({label:`${c} sampler`,magFilter:`linear`,minFilter:`linear`}),w=i.createBuffer({label:`${c} momentum splats`,size:256*p*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),T=i.createBuffer({label:`${c} dye splats`,size:256*p*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),E=new Float32Array(256*p),D=new Float32Array(256*p),M=0,N=0,P=a(i,c),ae=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST,F=!1,I=0,L=0,R,oe=0,z,B=0,V=0,H=0;function U(e,t,n,r){let a=i.createTexture({label:`${c} ${e}`,size:[t,n],format:r,usage:ae});return{texture:a,view:a.createView({label:`${c} ${e} view`}),id:ie(a)}}function se(e,t,n,r){return P.resize(e,t),{grid:Object.freeze({width:e,height:t,aspect:e/t,cellSize:1/t,texelSize:Object.freeze([1/e,1/t]),velocityWidth:e+1,velocityHeight:t+1,dyeWidth:n,dyeHeight:r}),velocity:[0,1,2].map(n=>U(`velocity ${n}`,e+1,t+1,d)),dye:[0,1].map(e=>U(`dye ${e}`,n,r,d)),pressure:[U(`pressure 0`,e,t,f),U(`pressure 1`,e,t,f)],divergence:U(`divergence`,e,t,f),curl:U(`vorticity`,e,t,f),curlSmooth:U(`vorticity blur`,e,t,f),fields:U(`fields`,e,t,d),groups:new Map}}function W(e){for(let t of[...e.velocity,...e.dye,...e.pressure,e.divergence,e.curl,e.curlSmooth,e.fields])t.texture.destroy();G(e)}function G(e){for(let t of e.multigrid?.levels??[]){for(let e of[...t.pressure??[],t.rhs,t.mask])e?.texture.destroy();t.uniforms?.destroy()}e.multigrid=void 0}function K(){let e=ne(l,v,y),t=ne(u,e.width/e.height,i.limits.maxTextureDimension2D),n=z?.grid;return n&&n.width===e.width&&n.height===e.height&&n.dyeWidth===t.width&&n.dyeHeight===t.height?!1:(z&&W(z),z=se(e.width,e.height,t.width,t.height),B=0,V=0,H=0,I++,R=void 0,M=0,N=0,!0)}K();function ce(e){for(;z.dye.length<e;)z.dye.push(U(`dye ${z.dye.length}`,z.grid.dyeWidth,z.grid.dyeHeight,d))}let le=e=>`view`in e&&`texture`in e;function ue(e,t,n){let{layout:r,spec:a}=te(i,e),o={...t},s=[e,n?`L${n.id}`:``,...Object.keys(a.bindings).map(t=>{let n=Number(t);if(n<2)return``;let r=o[n];if(!r)throw Error(`fluid pass ${e} is missing binding ${n}`);return`${n}:${le(r)?r.id:ie(r)}`})].join(`|`),c=z.groups.get(s);if(!c){let e=[{binding:0,resource:{buffer:n?n.uniform:S.buffer}},{binding:1,resource:n?n.mask:P.view}];for(let t of Object.keys(a.bindings)){let n=Number(t);if(n<2)continue;let r=o[n];e.push({binding:n,resource:le(r)?r.view:`size`in r?{buffer:r}:r})}c=i.createBindGroup({label:`fluid ${a.entry}`,layout:r,entries:e}),z.groups.set(s,c)}return c}function q(e,t,n){return e.beginComputePass({label:`fluid ${t}`,timestampWrites:n?s.pass(n):void 0})}function J(e,t,n,r,a,o){e.setPipeline(te(i,t).pipeline),e.setBindGroup(0,ue(t,n,o)),e.dispatchWorkgroups(Math.ceil(r/m),Math.ceil(a/m))}let Y=e=>{let t=[0,1,2].filter(t=>t!==e);return[t[0],t[1]]},de=()=>z.dye.map((e,t)=>t).filter(e=>e!==V),fe=()=>k(A(b.stepRate,60),10,240),X=()=>Math.round(k(A(b.multigridCoarse,24),1,256)),Z=()=>1/fe();function Q(){let{grid:e}=z,t=Z(),n=k(A(b.maxCfl,6),.5,32),r=b.boundary===`open`?1:b.boundary===`wrap`?2:0,i=e=>Math.max(0,A(e,0)),a=i(b.viscosity),o=b.buoyancyDirection,s=Math.hypot(o[0],o[1])||1;S.set({grid:[e.width,e.height],dye_size:[e.dyeWidth,e.dyeHeight],dt:t,cells_per_h:e.height,aspect:e.aspect,max_disp:n,boundary:r,solid:+!!P.enabled,rk2:+!!b.rk2,limit:+!!b.limiter,force_count:M,dye_count:N,vorticity:i(b.vorticity),buoyancy:A(b.buoyancy,0),vel_decay:Math.exp(-i(b.velocityDissipation)*t),dye_decay:Math.exp(-i(b.dyeDissipation)*t),diffuse_a:a*t*e.height*e.height,jacobi_w:k(A(b.jacobiWeight,.8),.3,1),sor_omega:b.sorOmega>0?k(b.sorOmega,1,1.95):j(e.width,e.height),vmax:n/(t*e.height),dye_max:k(A(b.dyeLimit,64),1,h),accel:[A(b.gravity[0],0),A(b.gravity[1],0)],buoy_dir:[A(o[0],0)/s,A(o[1],-1)/s],dye_filter:g[b.dyeVelocityFilter]??0,mg_sweeps:X()}),S.upload()}function pe(e){let t=z,n=t.velocity[B],[r,i]=Y(B).map(e=>t.velocity[e]),a=[t.grid.velocityWidth,t.grid.velocityHeight];switch(b.velocityScheme){case`maccormack`:J(e,`velPred`,{2:n,4:r},...a),J(e,`velMc`,{2:n,3:r,4:i},...a),B=t.velocity.indexOf(i);break;case`bfecc`:J(e,`velPred`,{2:n,4:r},...a),J(e,`velBfeccError`,{2:n,3:r,4:i},...a),J(e,`velBfeccFinal`,{2:n,3:i,4:r},...a),B=t.velocity.indexOf(r);break;default:J(e,`velSl`,{2:n,4:r},...a),B=t.velocity.indexOf(r)}}function me(e){let t=z,n=b.dyeScheme;n!==`semi-lagrangian`&&ce(3);let r=t.dye[V],[i,a]=de().map(e=>t.dye[e]),o=t.velocity[B],s=[t.grid.dyeWidth,t.grid.dyeHeight];n===`semi-lagrangian`?(J(e,`dyeSl`,{2:r,4:i,5:o,6:C},...s),V=t.dye.indexOf(i)):n===`maccormack`?(J(e,`dyePred`,{2:r,4:i,5:o,6:C},...s),J(e,`dyeMc`,{2:r,3:i,4:a,5:o,6:C},...s),V=t.dye.indexOf(a)):(J(e,`dyePred`,{2:r,4:i,5:o,6:C},...s),J(e,`dyeBfeccError`,{2:r,3:i,4:a,5:o,6:C},...s),J(e,`dyeBfeccFinal`,{2:r,3:a,4:i,5:o,6:C},...s),V=t.dye.indexOf(i))}function he(e){let t=z,n=t.velocity[B],r=[t.grid.velocityWidth,t.grid.velocityHeight];b.vorticity>0&&(J(e,`curl`,{2:n,8:t.curl},t.grid.width,t.grid.height),J(e,`curlSmooth`,{5:t.curl,10:t.curlSmooth},t.grid.width,t.grid.height));let[i]=Y(B).map(e=>t.velocity[e]);if(J(e,`forces`,{2:n,3:i,5:t.curl,6:t.dye[V],7:C,11:t.curlSmooth},...r),B=t.velocity.indexOf(i),b.viscosity>0){let n=Math.round(k(A(b.viscosityIterations,12),1,64)),a=i,[o,s]=Y(B).map(e=>t.velocity[e]),c=a,l=o;for(let t=0;t<n;t++)J(e,`diffuse`,{2:c,3:l,9:a},...r),c=l,l=l===o?s:o;B=t.velocity.indexOf(c)}}function ge(){let e=z,t=re(e.grid.width,e.grid.height,b.multigridLevels),n=t.map(e=>`${e.width}x${e.height}`).join(`,`);e.multigrid?.key!==n&&(G(e),e.multigrid={levels:t.map((e,t)=>{if(t===0)return{...e,pressure:void 0,current:0,rhs:void 0,mask:void 0,uniforms:void 0};let n=`mg ${t}`;return{...e,pressure:[U(`${n} pressure 0`,e.width,e.height,f),U(`${n} pressure 1`,e.width,e.height,f)],current:0,rhs:U(`${n} rhs`,e.width,e.height,f),mask:U(`${n} mask`,e.width,e.height,`rgba8unorm`),uniforms:r(i,_,`${c} ${n} params`)}}),key:n});let{levels:a}=e.multigrid,o=b.boundary===`open`?1:b.boundary===`wrap`?2:0;for(let t of a)t.uniforms?.set({grid:[t.width,t.height],dye_size:[e.grid.dyeWidth,e.grid.dyeHeight],boundary:o,solid:+!!P.enabled,jacobi_w:k(A(b.jacobiWeight,.8),.3,1),sor_omega:j(t.width,t.height),mg_sweeps:X()}),t.uniforms?.upload();return e.multigrid}function _e(e,t){let n=z,{levels:r}=ge(),i=r.length-1,a=Math.round(k(A(b.multigridSmooth,1),1,8)),o=X();r[0].current=H;let s=e=>{let t=r[e];return e===0?void 0:{id:e,uniform:t.uniforms.buffer,mask:t.mask.view}},c=e=>{let t=r[e];return e===0?n.pressure[t.current]:t.pressure[t.current]},l=e=>{let t=r[e];return e===0?n.pressure[1-t.current]:t.pressure[1-t.current]},u=e=>{r[e].current=1-r[e].current},d=e=>e===0?n.divergence:r[e].rhs,f=(t,n,i)=>{let a=r[t];for(let r=0;r<n;r++)J(e,i&&r===0?`jacobiCold`:`jacobi`,{3:d(t),4:c(t),5:l(t)},a.width,a.height,s(t)),u(t)},p=(t,n)=>{let h=r[t];if(t===i){Math.max(h.width,h.height)<=32?(J(e,`mgCoarse`,{2:d(t),5:l(t)},m,m,s(t)),u(t)):f(t,o,!0);return}let g=r[t+1];f(t,a,n),J(e,`mgRestrict`,{2:d(t),3:c(t),5:d(t+1)},g.width,g.height,s(t)),p(t+1,!0),J(e,`mgProlong`,{3:c(t),4:c(t+1),5:l(t),6:r[t+1].mask},h.width,h.height,s(t)),u(t),f(t,a,!1)};if(P.enabled)for(let t=0;t<i;t++){let n=r[t+1];J(e,`mgMask`,{7:n.mask},n.width,n.height,s(t))}for(let e=0;e<t;e++)p(0,e===0&&!b.warmStart);H=r[0].current}function ve(e,t,n=1){let r=z,i=r.grid.width,a=r.grid.height,o=r.velocity[B];if(J(e,`divergence`,{2:o,6:r.divergence},i,a),b.pressureSolver===`multigrid`){_e(e,Math.max(1,Math.round(n)));let[t]=Y(B).map(e=>r.velocity[e]);J(e,`project`,{2:o,4:r.pressure[H],7:t},r.grid.velocityWidth,r.grid.velocityHeight),B=r.velocity.indexOf(t);return}let s=H,c=Math.max(1,Math.round(t));for(let t=0;t<c;t++){let n=r.pressure[s],o=r.pressure[1-s],c=t===0&&!b.warmStart;J(e,b.pressureSolver===`jacobi`?c?`jacobiCold`:`jacobi`:t%2==1?`sorBlack`:c?`sorRedCold`:`sorRed`,{3:r.divergence,4:n,5:o},i,a),s=1-s}H=s;let[l]=Y(B).map(e=>r.velocity[e]);J(e,`project`,{2:o,4:r.pressure[H],7:l},r.grid.velocityWidth,r.grid.velocityHeight),B=r.velocity.indexOf(l)}function ye(e){if(M===0&&N===0)return;let t=z;M>0&&i.queue.writeBuffer(w,0,E,0,M*p),N>0&&i.queue.writeBuffer(T,0,D,0,N*p);let n=q(e,`inject`,`inject`);if(M>0){let e=t.velocity[B],[r]=Y(B).map(e=>t.velocity[e]);J(n,`splatVelocity`,{2:e,3:r,4:w},t.grid.velocityWidth,t.grid.velocityHeight),B=t.velocity.indexOf(r)}if(N>0){let e=t.dye[V],r=t.dye[de()[0]];J(n,`splatDye`,{2:e,3:r,4:T},t.grid.dyeWidth,t.grid.dyeHeight),V=t.dye.indexOf(r)}n.end(),M=0,N=0}function be(e,t,n){let r=z,i=Z();if(!b.dyeOnly){let n=q(e,`velocity`,t?`advect + forces`:void 0);if(pe(n),he(n),n.end(),x.forces){let[t]=Y(B);x.forces({encoder:e,dt:i,grid:r.grid,read:r.velocity[B].view,write:r.velocity[t].view,dye:r.dye[V].view})&&(B=t)}let a=q(e,`pressure`,t?`pressure`:void 0);ve(a,b.pressureIterations,Math.round(k(A(b.multigridCycles,1),1,8))),a.end()}let a=q(e,`dye`,t?`dye`:n?`dye (last step)`:void 0);if(me(a),a.end(),x.dye){ce(3);let t=(V+1)%r.dye.length;x.dye({encoder:e,dt:i,grid:r.grid,read:r.dye[V].view,write:r.dye[t].view,velocity:r.velocity[B].view})&&(V=t)}}function xe(e,t=`resolve`){let n=z,r=q(e,`resolve`,t);J(r,`resolve`,{2:n.velocity[B],4:n.pressure[H],8:n.fields},n.grid.width,n.grid.height),r.end()}function Se(e,t){if(F)return;let n=Math.max(0,Math.floor(A(t,0)));if(L=n,n!==0||M!==0||N!==0){Q(),ye(e);for(let t=0;t<n;t++)be(e,t===0,t===n-1&&n>1);xe(e)}}function Ce(e,t,n,r,i,a,o){if(t>=256||![n[0],n[1],r[0],r[1],i,a,...o].every(Number.isFinite))return!1;let s=t*p;return e[s]=n[0],e[s+1]=n[1],e[s+2]=r[0],e[s+3]=r[1],e[s+4]=Math.max(i,1e-4),e[s+5]=Math.max(a,0),e[s+6]=0,e[s+7]=0,e[s+8]=o[0]??0,e[s+9]=o[1]??0,e[s+10]=o[2]??0,e[s+11]=o[3]??0,!0}function we(e,t,n,r){i.queue.writeTexture({texture:e.texture},r,{bytesPerRow:t*8},[t,n])}let $=(e,t)=>({texture:e.texture,view:e.view,slot:t});return{params:b,hooks:x,get grid(){return z.grid},get generation(){return I},get fields(){return z.fields.texture},get fieldsView(){return z.fields.view},get dye(){return $(z.dye[V],V)},get velocity(){return $(z.velocity[B],B)},get pressure(){return $(z.pressure[H],H)},get divergence(){return z.divergence.texture},obstacles:P,get stepSeconds(){return Z()},get lastSteps(){return L},get pendingSplats(){return[M,N]},resize(e,t){return e>0&&t>0&&(v=e/t,K())},setResolution(e,t){return Number.isFinite(e)?(l=e,t!==void 0&&Number.isFinite(t)&&(u=t),K()):!1},addForce(e,t,n,r,i=0){return Ce(E,M,e,t,n,i,[r[0],r[1]])?(M++,!0):!1},addDye(e,t,n,r,i=0){return Ce(D,N,e,t,n,i,r)?(N++,!0):!1},update(t,n){if(F)return 0;let r=Z();(!R||Math.abs(r-oe)>r*.001)&&(R=e(r,{maxSteps:o}),oe=r);let{steps:i}=R.advance(Number.isFinite(n)?n:0);return Se(t,i),i},advance(e,t){Se(e,t)},project(e,t){if(F)return;Q();let n=q(e,`project`,`project`);ve(n,t??b.pressureIterations,t??Math.round(k(A(b.multigridCycles,1),1,8))),n.end()},resolve(e){F||(Q(),xe(e,`resolve`))},setVelocity(e){let{width:t,height:n,velocityWidth:r,velocityHeight:i}=z.grid,a=new Uint16Array(r*i*4);for(let o=0;o<i;o++)for(let i=0;i<r;i++){let s=e(i/t,(Math.min(o,n-1)+.5)/n)[0],c=e((Math.min(i,t-1)+.5)/t,o/n)[1],l=(o*r+i)*4;a[l]=O(A(s,0)),a[l+1]=O(A(c,0))}we(z.velocity[B],r,i,a)},setDye(e){let{dyeWidth:t,dyeHeight:n}=z.grid,r=new Uint16Array(t*n*4);for(let i=0;i<n;i++)for(let a=0;a<t;a++){let o=e((a+.5)/t,(i+.5)/n),s=(i*t+a)*4;for(let e=0;e<4;e++)r[s+e]=O(A(o[e]??0,0))}we(z.dye[V],t,n,r)},reset(e){M=0,N=0;let t=z;for(let n of[...t.velocity,...t.dye,...t.pressure,t.divergence,t.curl,t.curlSmooth,t.fields])e.beginRenderPass({label:`${c} clear`,colorAttachments:[{view:n.view,loadOp:`clear`,storeOp:`store`}]}).end();B=0,V=0,H=0},destroy(){F||(F=!0,W(z),P.destroy(),S.destroy(),w.destroy(),T.destroy())}}}export{O as n,P as t};