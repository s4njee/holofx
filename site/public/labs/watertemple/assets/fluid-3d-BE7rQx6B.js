import{t as e}from"./meta-CO65k7we.js";import{n as t}from"./types-ci2WwWg0.js";import{t as n}from"./loop-_CGOOht2.js";import{n as r}from"./profiler-Bi27xYp-.js";import{n as i}from"./targets-Dcl181Ey.js";import{c as a,i as o,n as s,r as c,s as l,t as u}from"./camera-BT6VSIZb.js";import{n as d,t as f}from"./uniforms-BE1XSnDx.js";import{t as p}from"./shader-Cd_FDUy8.js";import{n as m}from"./pointer-BbHa9JHH.js";import{r as h,t as g}from"./fullscreen-Dq3Mq0Js.js";import{a as _,i as ee,r as te,t as v}from"./orbit-Dpc2wFkv.js";import{n as y}from"./fluid-Bv7YHznw.js";import{t as b}from"./composite-B1jEq-xT.js";import{t as ne}from"./ink-CR_sUU3y.js";import{t as x}from"./march-Bry_o_bS.js";import{t as re}from"./volume-prep-DUv0_12p.js";var S=`// fluid3d-advect.wgsl -- advection of the velocity field (by itself) and of the scalar field (ink: colour
// as optical density in rgb, amount in a) by the velocity, in two schemes. Every kernel writes one
// rgba16float storage texture and reads others as textures.
//
// Bindings (besides the shared 0 \`P\`):
//   2 src    the field being advected: velocity ((nx+1) x (ny+1) x (nz+1)) or the scalar
//   3 aux    scheme scratch: the forward-advected prediction
//   4 dst    the output
//   5 flow   scalar entry points only: the velocity that carries the scalar
//   6 samp   linear, clamp-to-edge sampler
//
// SCHEMES.
//   semi-Lagrangian  1 pass   cs_*_sl / cs_*_pred   f' = A f          sample the field where the parcel came from
//   MacCormack       2 passes cs_*_pred, cs_*_mc    f^ = A f;  f' = f^ + (f - A^R f^) / 2, clamped to the
//                                                   range of the eight samples the forward trace interpolates
// (Selle, Fedkiw, Kim, Liu, Rossignac 2008). The limiter keeps the correction from creating new extrema, which
// is also what makes it stable. BFECC, which the 2D solver also has, is not built here: in 2D it kept no
// more detail than MacCormack for an extra pass, and a pass over a 3D grid is dear.
//
// The scalar entry points \`cs_dye_sl\` and \`cs_dye_mc\` apply the scalar's dissipation; \`cs_dye_pred\` does not.

#include "fluid3d-core.wgsl"

@group(0) @binding(2) var src: texture_3d<f32>;
@group(0) @binding(3) var aux: texture_3d<f32>;
@group(0) @binding(4) var dst: texture_storage_3d<rgba16float, write>;
@group(0) @binding(5) var flow: texture_3d<f32>;
@group(0) @binding(6) var samp: sampler;

fn limited(x: f32, lo: f32, hi: f32) -> f32 {
  return select(x, clamp(x, lo, hi), P.limit != 0u);
}

fn limited4(x: vec4f, lo: vec4f, hi: vec4f) -> vec4f {
  return select(x, clamp(x, lo, hi), P.limit != 0u);
}

// ---- Velocity -----------------------------------------------------------------------------------------------

fn vel_pred(axis: u32, t: vec3i) -> f32 {
  let f = face_of(axis, t);
  if (face_blocked(axis, f)) {
    return 0.0;
  }
  return comp_sample(src, samp, axis, trace(src, samp, face_position(axis, f), -1.0));
}

fn vel_mc(axis: u32, t: vec3i) -> f32 {
  let f = face_of(axis, t);
  if (face_blocked(axis, f)) {
    return 0.0;
  }
  let p = face_position(axis, f);
  let x = trace(src, samp, p, -1.0);
  let forward = comp_sample(src, samp, axis, x);
  let bounds = comp_bounds(src, axis, x);
  let original = textureLoad(src, f, 0)[axis];
  let back = comp_sample(aux, samp, axis, trace(src, samp, p, 1.0));
  return limited(forward + 0.5 * (original - back), bounds.x, bounds.y);
}

fn in_velocity_grid(id: vec3u) -> bool {
  return all(id < P.grid + vec3u(1u));
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_vel_sl(@builtin(global_invocation_id) id: vec3u) {
  if (!in_velocity_grid(id)) {
    return;
  }
  let t = vec3i(id);
  textureStore(dst, t, vec4f(finite3(vec3f(vel_pred(0u, t), vel_pred(1u, t), vel_pred(2u, t))), 0.0));
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_vel_mc(@builtin(global_invocation_id) id: vec3u) {
  if (!in_velocity_grid(id)) {
    return;
  }
  let t = vec3i(id);
  textureStore(dst, t, vec4f(finite3(vec3f(vel_mc(0u, t), vel_mc(1u, t), vel_mc(2u, t))), 0.0));
}

// ---- Scalar ---------------------------------------------------------------------------------------------------

// Non-negative, finite and no larger than P.dye_max; zero in the obstacle.
fn finish_dye(v: vec4f, decay: f32) -> vec4f {
  return clamp(finite4(v * decay), vec4f(0.0), vec4f(P.dye_max));
}

fn dye_pred(t: vec3i) -> vec4f {
  return scalar_sample(src, samp, trace(flow, samp, scalar_pos(t), -1.0));
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_dye_sl(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.scalar_size)) {
    return;
  }
  let t = vec3i(id);
  if (scalar_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  textureStore(dst, t, finish_dye(dye_pred(t), P.dye_decay));
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_dye_pred(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.scalar_size)) {
    return;
  }
  let t = vec3i(id);
  if (scalar_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  textureStore(dst, t, finish_dye(dye_pred(t), 1.0));
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_dye_mc(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.scalar_size)) {
    return;
  }
  let t = vec3i(id);
  if (scalar_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  let p = scalar_pos(t);
  let x = trace(flow, samp, p, -1.0);
  let forward = scalar_sample(src, samp, x);
  let bounds = scalar_bounds(src, x);
  let original = textureLoad(src, t, 0);
  let back = scalar_sample(aux, samp, trace(flow, samp, p, 1.0));
  textureStore(dst, t, finish_dye(limited4(forward + 0.5 * (original - back), bounds.lo, bounds.hi), P.dye_decay));
}
`,C=`// fluid3d-core.wgsl -- the shared maths of the 3D stable-fluids solver (src/gpu/sim/fluid3d.ts): the grid
// arrangement, the boundary rule and the samplers every pass uses. Included by fluid3d-advect.wgsl,
// fluid3d-forces.wgsl and fluid3d-project.wgsl after the generated \`fluid3d_uniforms.wgsl\` (the
// uniform struct plus the workgroup size constants WG_X, WG_Y, WG_Z).
//
// GRID. A MAC ("marker and cell") grid like the 2D solver's, in three dimensions: nx x ny x nz cubic cells,
// y UP, cell (i, j, k) covers [i, i+1] x [j, j+1] x [k, k+1] in CELLS. Velocity lives on the faces
// between cells, one component per face orientation:
//     u(i, j, k)   x-velocity of the face on the -x side of cell (i, j, k)   at (i,       j + 1/2, k + 1/2)
//     v(i, j, k)   y-velocity of the face on the -y side                      at (i + 1/2, j,       k + 1/2)
//     w(i, j, k)   z-velocity of the face on the -z side                      at (i + 1/2, j + 1/2, k)
// all in one rgba16float 3D texture of (nx+1) x (ny+1) x (nz+1) texels with u in .x, v in .y, w in .z (the
// extra row of each component repeats the last real face, so a hardware-filtered tap at the edge behaves
// like clamp-to-edge). Pressure, divergence, vorticity live at cell centres (nx x ny x nz). The compact
// 7-point laplacian then matches the compact divergence and gradient exactly: no chequerboard null space and a
// wall face is exactly zero. The price against a collocated grid is three filtered taps to read one
// velocity (u, v and w are at different places): \`vel_at\`.
//
// UNITS. The solver works in cells inside the shaders (P.inv_h converts length to cells); the uniform
// block and the public API are in LENGTH units (the domain is size = (nx, ny, nz) * h long, h = P.h).
// Velocity: length per second. The pressure potential has the units of velocity (see fluid3d-project.wgsl).
//
// BOUNDARY. Closed box, free-slip: the normal velocity on the six walls is held at 0 by every pass that
// writes velocity, the tangential velocity is free (a filtered tap past the wall clamps to the edge, which
// repeats it). An optional sphere (P.obstacle, centre + radius in length units, radius 0 = none) makes the
// cells whose centre is inside it solid; faces touching a solid cell are held at 0 the same way.

#include "fluid3d_uniforms.wgsl"

@group(0) @binding(0) var<uniform> P: Fluid3dUniforms;

// 0 for NaN and +-Inf, x otherwise. Tests the exponent bits because \`x != x\` may be folded away.
fn finite_or_zero(x: f32) -> f32 {
  return select(x, 0.0, (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u);
}

fn finite3(v: vec3f) -> vec3f {
  return vec3f(finite_or_zero(v.x), finite_or_zero(v.y), finite_or_zero(v.z));
}

fn finite4(v: vec4f) -> vec4f {
  return select(v, vec4f(0.0), (bitcast<vec4u>(v) & vec4u(0x7f800000u)) == vec4u(0x7f800000u));
}

// ---- Cells and faces -------------------------------------------------------------------------------------

// True outside the box and inside the obstacle sphere. \`dims\` is the size of the grid the cell index
// belongs to; the sphere only exists on the full-resolution grid.
fn solid_at(c: vec3i, dims: vec3i) -> bool {
  if (any(c < vec3i(0)) || any(c >= dims)) {
    return true;
  }
  if (P.obstacle.w > 0.0 && all(dims == vec3i(P.grid))) {
    return distance((vec3f(c) + 0.5) * P.h, P.obstacle.xyz) < P.obstacle.w;
  }
  return false;
}

fn cell_solid(c: vec3i) -> bool {
  return solid_at(c, vec3i(P.grid));
}

fn axis_step(axis: u32) -> vec3i {
  return vec3i(select(0, 1, axis == 0u), select(0, 1, axis == 1u), select(0, 1, axis == 2u));
}

// A face is blocked (its velocity is held at 0) when it lies on the wall or touches a solid cell.
fn face_blocked(axis: u32, f: vec3i) -> bool {
  let g = vec3i(P.grid);
  if (P.obstacle.w <= 0.0) {
    return f[axis] <= 0 || f[axis] >= g[axis];
  }
  return cell_solid(f - axis_step(axis)) || cell_solid(f);
}

// The face a texel of the velocity texture is responsible for, for one component: the padding rows
// repeat the last real face.
fn face_of(axis: u32, texel: vec3i) -> vec3i {
  var f = min(texel, vec3i(P.grid) - vec3i(1));
  f[axis] = texel[axis];
  return f;
}

// Where a face sits, in cells.
fn face_position(axis: u32, f: vec3i) -> vec3f {
  return vec3f(f) + vec3f(0.5) - 0.5 * vec3f(axis_step(axis));
}

// One component of one face (0 for a blocked one).
fn face_load(tex: texture_3d<f32>, axis: u32, f: vec3i) -> f32 {
  let s = textureLoad(tex, f, 0);
  return select(s[axis], 0.0, face_blocked(axis, f));
}

// ---- Sampling ---------------------------------------------------------------------------------------------

// Filtered velocity component at position p (cells): one hardware trilinear tap. The texture coordinate
// of face (i, j, k) is (i + 1/2, j + 1/2, k + 1/2) texels, its position is (i, j + 1/2, k + 1/2) for u, hence the
// half-cell shift along the component's own axis.
fn comp_sample(tex: texture_3d<f32>, samp: sampler, axis: u32, p: vec3f) -> f32 {
  let q = clamp(p, vec3f(0.0), vec3f(P.grid));
  let tc = (q + 0.5 * vec3f(axis_step(axis))) / vec3f(P.grid + vec3u(1u));
  return textureSampleLevel(tex, samp, tc, 0.0)[axis];
}

// Smallest and largest value among the eight faces comp_sample interpolates: the MacCormack limiter's range.
fn comp_bounds(tex: texture_3d<f32>, axis: u32, p: vec3f) -> vec2f {
  let q = clamp(p, vec3f(0.0), vec3f(P.grid)) - vec3f(0.5) + 0.5 * vec3f(axis_step(axis));
  let b = vec3i(floor(q));
  let hi = vec3i(P.grid);
  var lo_v = 1e30;
  var hi_v = -1e30;
  for (var n = 0; n < 8; n++) {
    let d = vec3i(n & 1, (n >> 1) & 1, (n >> 2) & 1);
    var f = clamp(b + d, vec3i(0), hi - vec3i(1));
    f[axis] = clamp(b[axis] + d[axis], 0, hi[axis]);
    let s = textureLoad(tex, f, 0)[axis];
    lo_v = min(lo_v, s);
    hi_v = max(hi_v, s);
  }
  return vec2f(lo_v, hi_v);
}

// Velocity at position p (cells), length per second.
fn vel_at(tex: texture_3d<f32>, samp: sampler, p: vec3f) -> vec3f {
  return vec3f(comp_sample(tex, samp, 0u, p), comp_sample(tex, samp, 1u, p), comp_sample(tex, samp, 2u, p));
}

fn clamp_length(d: vec3f, limit: f32) -> vec3f {
  let l = length(d);
  return select(d, d * (limit / l), l > limit);
}

// Where a parcel that is at p now was (way -1) or will be (way +1) one step away, in cells: an explicit
// Euler step, or the midpoint method when \`rk2\` is set (second order: rotation stays a rotation instead
// of spiralling outwards). The displacement is capped at \`max_disp\` cells and the result stays in the box.
fn trace(tex: texture_3d<f32>, samp: sampler, p: vec3f, way: f32) -> vec3f {
  let k = way * P.dt * P.inv_h;
  var d = clamp_length(vel_at(tex, samp, p) * k, P.max_disp);
  if (P.rk2 != 0u) {
    d = clamp_length(vel_at(tex, samp, p + 0.5 * d) * k, P.max_disp);
  }
  return clamp(p + d, vec3f(0.0), vec3f(P.grid));
}

// ---- The scalar grid (ink) ----------------------------------------------------------------------------------

// The scalar grid covers the same box with its own number of texels. Positions in CELLS of the velocity
// grid are turned into texture coordinates by dividing by the grid size (the same for both grids).

// Position (cells) of the centre of scalar texel t.
fn scalar_pos(t: vec3i) -> vec3f {
  return (vec3f(t) + 0.5) * vec3f(P.grid) / vec3f(P.scalar_size);
}

fn scalar_solid(t: vec3i) -> bool {
  if (P.obstacle.w <= 0.0) {
    return false;
  }
  return distance((vec3f(t) + 0.5) / vec3f(P.scalar_size) * P.size, P.obstacle.xyz) < P.obstacle.w;
}

fn scalar_sample(tex: texture_3d<f32>, samp: sampler, p: vec3f) -> vec4f {
  return textureSampleLevel(tex, samp, p / vec3f(P.grid), 0.0);
}

// Per-channel smallest and largest value among the eight texels scalar_sample interpolates: (lo, hi).
struct Bounds {
  lo: vec4f,
  hi: vec4f,
}

fn scalar_bounds(tex: texture_3d<f32>, p: vec3f) -> Bounds {
  let s = vec3i(P.scalar_size);
  let q = p / vec3f(P.grid) * vec3f(P.scalar_size) - 0.5;
  let b = vec3i(floor(q));
  var lo = vec4f(1e30);
  var hi = vec4f(-1e30);
  for (var n = 0; n < 8; n++) {
    let d = vec3i(n & 1, (n >> 1) & 1, (n >> 2) & 1);
    let v = textureLoad(tex, clamp(b + d, vec3i(0), s - vec3i(1)), 0);
    lo = min(lo, v);
    hi = max(hi, v);
  }
  return Bounds(lo, hi);
}

// ---- Splats ---------------------------------------------------------------------------------------------------

// A capsule of influence: the segment a -> b (length units) inflated by a Gaussian of radius r (the
// distance at which the weight is 1/e). A point is a segment with a == b. \`ramp\` is the half-width of a
// smooth start and end along the segment (0 = a plain flat capsule): with a ramp, segments laid end to
// end (a pointer's path, frame after frame) add up to a uniform stroke. \`value\` is what the pass adds at
// full weight: a change of velocity (xyz) or of the scalar (rgba).
struct Splat {
  a: vec4f,     // xyz start, w radius
  b: vec4f,     // xyz end, w ramp
  value: vec4f,
}

fn splat_weight(p: vec3f, s: Splat) -> f32 {
  let a = s.a.xyz;
  let ab = s.b.xyz - a;
  let len = length(ab);
  let ramp = s.b.w;
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
  let x = d / max(s.a.w, 1e-5);
  if (x > 3.0) {
    return 0.0;
  }
  return along * exp(-x * x);
}
`,w=`// fluid3d-forces.wgsl -- everything that adds to the fluid between advection and projection: splats of
// momentum and ink, the cell-centred velocity, the vorticity (curl) field, vorticity confinement, and
// the body forces (gravity, buoyancy from the ink).
//
// Bindings (besides the shared 0 \`P\`); an entry point uses only some of them:
//   2 src       the texture being updated: velocity ((nx+1) x (ny+1) x (nz+1)), the scalar for cs_splat_dye,
//               or the cell-centred velocity for cs_curl
//   3 dst       its rgba16float storage output
//   4 splats    read-only storage buffer of \`Splat\`s (P.force_count / P.dye_count of them)
//   5 curl_tex  rgba16float cells: vorticity (rgb, 1 / s) and its magnitude (a)   (cs_blur)
//   6 dens_tex  the scalar field, for buoyancy
//   7 samp      a filtering sampler for dens_tex
//   8 blur_dst  r32float storage output of cs_blur
//   9 blur_tex  |vorticity| blurred over its 7-point neighbourhood (cs_conf)
//  10 conf_dst  rgba16float storage output of cs_conf
//  11 conf_tex  the confinement acceleration at cell centres, read by cs_forces
//  12 curl_dst  rgba16float storage output of cs_curl

#include "fluid3d-core.wgsl"

@group(0) @binding(2) var src: texture_3d<f32>;
@group(0) @binding(3) var dst: texture_storage_3d<rgba16float, write>;
@group(0) @binding(4) var<storage, read> splats: array<Splat>;
@group(0) @binding(5) var curl_tex: texture_3d<f32>;
@group(0) @binding(6) var dens_tex: texture_3d<f32>;
@group(0) @binding(7) var samp: sampler;
@group(0) @binding(8) var blur_dst: texture_storage_3d<r32float, write>;
@group(0) @binding(9) var blur_tex: texture_3d<f32>;
@group(0) @binding(10) var conf_dst: texture_storage_3d<rgba16float, write>;
@group(0) @binding(11) var conf_tex: texture_3d<f32>;
@group(0) @binding(12) var curl_dst: texture_storage_3d<rgba16float, write>;

fn in_velocity_grid(id: vec3u) -> bool {
  return all(id < P.grid + vec3u(1u));
}

fn in_grid(id: vec3u) -> bool {
  return all(id < P.grid);
}

// ---- Splats -----------------------------------------------------------------------------------------------------

fn splat_velocity(axis: u32, t: vec3i) -> f32 {
  let f = face_of(axis, t);
  if (face_blocked(axis, f)) {
    return 0.0;
  }
  let p = face_position(axis, f) * P.h;
  var dv = 0.0;
  for (var k = 0u; k < P.force_count; k++) {
    let s = splats[k];
    dv += splat_weight(p, s) * s.value[axis];
  }
  return textureLoad(src, f, 0)[axis] + dv;
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_splat_velocity(@builtin(global_invocation_id) id: vec3u) {
  if (!in_velocity_grid(id)) {
    return;
  }
  let t = vec3i(id);
  let v = vec3f(splat_velocity(0u, t), splat_velocity(1u, t), splat_velocity(2u, t));
  textureStore(dst, t, vec4f(clamp(finite3(v), vec3f(-P.vmax), vec3f(P.vmax)), 0.0));
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_splat_dye(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.scalar_size)) {
    return;
  }
  let t = vec3i(id);
  if (scalar_solid(t)) {
    textureStore(dst, t, vec4f(0.0));
    return;
  }
  let p = (vec3f(t) + 0.5) / vec3f(P.scalar_size) * P.size;
  var d = textureLoad(src, t, 0);
  for (var k = 0u; k < P.dye_count; k++) {
    let s = splats[k];
    d += splat_weight(p, s) * s.value;
  }
  textureStore(dst, t, clamp(finite4(d), vec4f(0.0), vec4f(P.dye_max)));
}

// ---- Vorticity ------------------------------------------------------------------------------------------------------

// Velocity at a cell centre: the mean of its two faces along each axis. Written to \`fields\`, the
// texture consumers (debug views) read, and read by cs_curl.
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_center(@builtin(global_invocation_id) id: vec3u) {
  if (!in_grid(id)) {
    return;
  }
  let c = vec3i(id);
  let u = 0.5 * (textureLoad(src, c, 0).x + textureLoad(src, c + vec3i(1, 0, 0), 0).x);
  let v = 0.5 * (textureLoad(src, c, 0).y + textureLoad(src, c + vec3i(0, 1, 0), 0).y);
  let w = 0.5 * (textureLoad(src, c, 0).z + textureLoad(src, c + vec3i(0, 0, 1), 0).z);
  textureStore(dst, c, vec4f(u, v, w, 0.0));
}

// Centre velocity of a neighbour; outside the box or in the obstacle it borrows the cell's own (zero gradient).
fn centre_or(c: vec3i, fallback: vec3f) -> vec3f {
  if (cell_solid(c)) {
    return fallback;
  }
  return textureLoad(src, c, 0).xyz;
}

// Vorticity (curl of the velocity) at a cell centre in 1 / s from central differences of the centre
// velocities, and its magnitude in the alpha channel.
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_curl(@builtin(global_invocation_id) id: vec3u) {
  if (!in_grid(id)) {
    return;
  }
  let c = vec3i(id);
  var w = vec3f(0.0);
  if (!cell_solid(c)) {
    let here = textureLoad(src, c, 0).xyz;
    let xp = centre_or(c + vec3i(1, 0, 0), here);
    let xm = centre_or(c + vec3i(-1, 0, 0), here);
    let yp = centre_or(c + vec3i(0, 1, 0), here);
    let ym = centre_or(c + vec3i(0, -1, 0), here);
    let zp = centre_or(c + vec3i(0, 0, 1), here);
    let zm = centre_or(c + vec3i(0, 0, -1), here);
    w = 0.5 * P.inv_h * vec3f(
      (yp.z - ym.z) - (zp.y - zm.y),
      (zp.x - zm.x) - (xp.z - xm.z),
      (xp.y - xm.y) - (yp.x - ym.x),
    );
  }
  textureStore(curl_dst, c, vec4f(w, length(w)));
}

fn curl_mag(c: vec3i, fallback: f32) -> f32 {
  if (cell_solid(c)) {
    return fallback;
  }
  return textureLoad(curl_tex, c, 0).w;
}

// |vorticity| blurred over the cell and its six neighbours. Confinement follows the GRADIENT of this, not
// of the raw magnitude: the raw gradient of a cell-scale ripple points at a different cell every step
// and confinement amplifies whatever it points at, which grows the ripple into a lattice of spurious
// vortices (the 2D solver showed this). The blur keeps the vortices it can resolve and turns the force
// away from the noise.
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_blur(@builtin(global_invocation_id) id: vec3u) {
  if (!in_grid(id)) {
    return;
  }
  let c = vec3i(id);
  let here = curl_mag(c, 0.0);
  let sum = 2.0 * here
    + curl_mag(c + vec3i(1, 0, 0), here) + curl_mag(c + vec3i(-1, 0, 0), here)
    + curl_mag(c + vec3i(0, 1, 0), here) + curl_mag(c + vec3i(0, -1, 0), here)
    + curl_mag(c + vec3i(0, 0, 1), here) + curl_mag(c + vec3i(0, 0, -1), here);
  textureStore(blur_dst, c, vec4f(sum / 8.0, 0.0, 0.0, 0.0));
}

fn blur_or(c: vec3i, fallback: f32) -> f32 {
  if (cell_solid(c)) {
    return fallback;
  }
  return textureLoad(blur_tex, c, 0).x;
}

// Vorticity confinement (Fedkiw, Stam, Jensen 2001): an acceleration eps * h * (N x w) that points round the
// nearest vortex line in the sense it already turns, with N the unit gradient of |w|. It puts back the
// small-scale rotation that interpolation in advection smooths away, which in 3D is the rolled-up ring of
// a falling drop and the tendrils that come off it. h is the cell size, so the force vanishes with the
// grid spacing.
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_conf(@builtin(global_invocation_id) id: vec3u) {
  if (!in_grid(id)) {
    return;
  }
  let c = vec3i(id);
  var a = vec3f(0.0);
  if (!cell_solid(c)) {
    let here = blur_or(c, 0.0);
    let g = 0.5 * vec3f(
      blur_or(c + vec3i(1, 0, 0), here) - blur_or(c + vec3i(-1, 0, 0), here),
      blur_or(c + vec3i(0, 1, 0), here) - blur_or(c + vec3i(0, -1, 0), here),
      blur_or(c + vec3i(0, 0, 1), here) - blur_or(c + vec3i(0, 0, -1), here),
    );
    let w = textureLoad(curl_tex, c, 0).xyz;
    let len = length(g);
    if (len > 1e-4 && length(w) > 1e-3) {
      a = P.vorticity * P.h * cross(g / len, w);
    }
  }
  textureStore(conf_dst, c, vec4f(a, 0.0));
}

// ---- Forces ------------------------------------------------------------------------------------------------------------

// The confinement acceleration on a face: the mean of the two cells it separates that are in the box.
fn face_confinement(axis: u32, f: vec3i) -> f32 {
  let g = vec3i(P.grid);
  let a = axis_step(axis);
  var sum = 0.0;
  var n = 0.0;
  let lo = f - a;
  if (!cell_solid(lo)) {
    sum += textureLoad(conf_tex, lo, 0)[axis];
    n += 1.0;
  }
  if (!cell_solid(f)) {
    sum += textureLoad(conf_tex, f, 0)[axis];
    n += 1.0;
  }
  return sum / max(n, 1.0);
}

fn forced_velocity(axis: u32, t: vec3i) -> f32 {
  let f = face_of(axis, t);
  if (face_blocked(axis, f)) {
    return 0.0;
  }
  var accel = P.accel[axis];
  if (P.buoyancy != 0.0) {
    let density = textureSampleLevel(dens_tex, samp, face_position(axis, f) / vec3f(P.grid), 0.0).a;
    accel += P.buoyancy * density * P.buoy_dir[axis];
  }
  if (P.vorticity != 0.0) {
    accel += face_confinement(axis, f);
  }
  let v = (textureLoad(src, f, 0)[axis] + accel * P.dt) * P.vel_decay;
  return clamp(finite_or_zero(v), -P.vmax, P.vmax);
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_forces(@builtin(global_invocation_id) id: vec3u) {
  if (!in_velocity_grid(id)) {
    return;
  }
  let t = vec3i(id);
  textureStore(dst, t, vec4f(forced_velocity(0u, t), forced_velocity(1u, t), forced_velocity(2u, t), 0.0));
}
`,T=`// fluid3d-project.wgsl -- the pressure projection in 3D: divergence, the pressure solve (damped Jacobi
// sweeps, or a multigrid V-cycle built from the same sweeps plus a restriction and a prolongation), and the
// subtraction of the pressure gradient.
//
// THE MATHS. Same as the 2D solver (fluid-project.wgsl). After advection and forces the velocity u* has a
// divergence; the projection finds phi with  laplacian(phi) = div u*  and sets  u = u* - grad phi. On the MAC
// grid every operator is a compact difference of neighbouring values, so with the cell size scaled out
//     div(i, j, k)  = u(i+1,j,k) - u(i,j,k) + v(i,j+1,k) - v(i,j,k) + w(i,j,k+1) - w(i,j,k)
//     u'(i, j, k)   = u(i, j, k) - (phi(i, j, k) - phi(i-1, j, k))        v', w' likewise
//     lap phi       = sum of the six neighbours - 6 phi
// and  div u' = div u - lap phi  is zero to the accuracy of the linear solve. phi has the units of the velocity
// (pressure times dt / density, scaled by the cell size), independent of dt, so last step's solution is a good
// starting guess (the warm start). A wall or solid neighbour contributes nothing and does not count in the
// diagonal (zero normal gradient), so the diagonal is the number of fluid neighbours.
//
// MULTIGRID. Damped Jacobi removes error whose wavelength is a few cells in a few sweeps and the long
// wavelengths of an N-cell grid only after of the order of N^2 of them. A V-cycle fixes that: smooth, take the
// residual to a grid with half the cells (\`cs_restrict\`: the mean of the eight child residuals, times 4 because the
// unscaled laplacian of a cell twice as wide is a quarter as strong), solve for the correction there the same
// way, interpolate it back (\`cs_prolong\`, trilinear, zero-gradient at the walls) and smooth again. The
// cost is a few fine sweeps plus 1/8 of that for each coarser level. Obstacles are not represented on the
// coarse grids, so a solver with an obstacle uses plain sweeps.
//
// Every pressure kernel takes its grid size from the texture it reads (\`textureDimensions\`), so the same
// kernels run on every level.
//
// Bindings (besides the shared 0 \`P\`):
//   2 vel      velocity ((nx+1) x (ny+1) x (nz+1))                (cs_divergence, cs_project, cs_residual_fine unused)
//   3 rhs_tex  r32float right-hand side of the level               (cs_jacobi*, cs_restrict)
//   4 p_src    r32float pressure of the last iteration             (cs_jacobi*, cs_project, cs_restrict, cs_prolong)
//   5 p_dst    r32float storage: the new pressure / coarse rhs     (cs_jacobi*, cs_restrict, cs_prolong)
//   6 div_dst  r32float storage: the divergence                    (cs_divergence)
//   7 out_vel  rgba16float storage: projected velocity             (cs_project)
//   8 coarse   r32float pressure correction of the next coarser level (cs_prolong)

#include "fluid3d-core.wgsl"

@group(0) @binding(2) var vel: texture_3d<f32>;
@group(0) @binding(3) var rhs_tex: texture_3d<f32>;
@group(0) @binding(4) var p_src: texture_3d<f32>;
@group(0) @binding(5) var p_dst: texture_storage_3d<r32float, write>;
@group(0) @binding(6) var div_dst: texture_storage_3d<r32float, write>;
@group(0) @binding(7) var out_vel: texture_storage_3d<rgba16float, write>;
@group(0) @binding(8) var coarse: texture_3d<f32>;

// ---- Divergence -----------------------------------------------------------------------------------------------

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_divergence(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.grid)) {
    return;
  }
  let c = vec3i(id);
  var d = 0.0;
  if (!cell_solid(c)) {
    d = face_load(vel, 0u, c + vec3i(1, 0, 0)) - face_load(vel, 0u, c)
      + face_load(vel, 1u, c + vec3i(0, 1, 0)) - face_load(vel, 1u, c)
      + face_load(vel, 2u, c + vec3i(0, 0, 1)) - face_load(vel, 2u, c);
  }
  textureStore(div_dst, c, vec4f(d, 0.0, 0.0, 0.0));
}

// ---- Jacobi ---------------------------------------------------------------------------------------------------------

// (pressure of the neighbour, 1) for a fluid neighbour, (0, 0) for the wall or a solid; \`use_prev\` false
// means "all pressures are zero".
fn neighbour(c: vec3i, dims: vec3i, use_prev: bool) -> vec2f {
  if (solid_at(c, dims)) {
    return vec2f(0.0, 0.0);
  }
  return vec2f(select(0.0, textureLoad(p_src, c, 0).x, use_prev), 1.0);
}

fn jacobi(c: vec3i, dims: vec3i, use_prev: bool) -> f32 {
  if (solid_at(c, dims)) {
    return 0.0;
  }
  let sn = neighbour(c + vec3i(1, 0, 0), dims, use_prev) + neighbour(c + vec3i(-1, 0, 0), dims, use_prev)
         + neighbour(c + vec3i(0, 1, 0), dims, use_prev) + neighbour(c + vec3i(0, -1, 0), dims, use_prev)
         + neighbour(c + vec3i(0, 0, 1), dims, use_prev) + neighbour(c + vec3i(0, 0, -1), dims, use_prev);
  if (sn.y < 0.5) {
    return 0.0;
  }
  return (sn.x - textureLoad(rhs_tex, c, 0).x) / sn.y;
}

// Damped Jacobi: phi' = (1 - w) phi + w J(phi). The undamped iteration (w = 1) multiplies the highest-
// frequency (chequerboard) error mode by -1 every sweep: an odd number of sweeps then over-corrects it. With
// w = 0.8 that mode shrinks by 0.6 per sweep and the smooth ones are slowed by only a fifth. (For a 7-point
// laplacian the best smoothing weight is 6/7; 0.8 is the 2D solver's value and close enough.)
fn relaxed(c: vec3i, dims: vec3i, use_prev: bool) -> f32 {
  let own = select(0.0, textureLoad(p_src, c, 0).x, use_prev);
  return (1.0 - P.jacobi_w) * own + P.jacobi_w * jacobi(c, dims, use_prev);
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_jacobi(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec3i(textureDimensions(p_src));
  if (any(vec3i(id) >= dims)) {
    return;
  }
  let c = vec3i(id);
  textureStore(p_dst, c, vec4f(relaxed(c, dims, true), 0.0, 0.0, 0.0));
}

// The first sweep of a solve that starts from zero (a cold start, or a correction on a coarse level).
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_jacobi_cold(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec3i(textureDimensions(p_src));
  if (any(vec3i(id) >= dims)) {
    return;
  }
  let c = vec3i(id);
  textureStore(p_dst, c, vec4f(relaxed(c, dims, false), 0.0, 0.0, 0.0));
}

// ---- Multigrid ---------------------------------------------------------------------------------------------------------

fn residual(c: vec3i, dims: vec3i) -> f32 {
  if (solid_at(c, dims)) {
    return 0.0;
  }
  let here = textureLoad(p_src, c, 0).x;
  let sn = neighbour(c + vec3i(1, 0, 0), dims, true) + neighbour(c + vec3i(-1, 0, 0), dims, true)
         + neighbour(c + vec3i(0, 1, 0), dims, true) + neighbour(c + vec3i(0, -1, 0), dims, true)
         + neighbour(c + vec3i(0, 0, 1), dims, true) + neighbour(c + vec3i(0, 0, -1), dims, true);
  return textureLoad(rhs_tex, c, 0).x - (sn.x - sn.y * here);
}

// Residual of the fine level, restricted to the next coarser one: rhs_coarse = 4 * mean of the eight children.
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_restrict(@builtin(global_invocation_id) id: vec3u) {
  let coarse_dims = vec3i(textureDimensions(p_dst));
  if (any(vec3i(id) >= coarse_dims)) {
    return;
  }
  let fine_dims = vec3i(textureDimensions(p_src));
  let base = vec3i(id) * 2;
  var sum = 0.0;
  for (var n = 0; n < 8; n++) {
    sum += residual(base + vec3i(n & 1, (n >> 1) & 1, (n >> 2) & 1), fine_dims);
  }
  textureStore(p_dst, vec3i(id), vec4f(0.5 * sum, 0.0, 0.0, 0.0));
}

// p_dst = p_src + trilinear interpolation of the coarse correction.
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_prolong(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec3i(textureDimensions(p_src));
  if (any(vec3i(id) >= dims)) {
    return;
  }
  let c = vec3i(id);
  let cd = vec3i(textureDimensions(coarse));
  let q = (vec3f(c) + 0.5) * 0.5 - 0.5;
  let b = vec3i(floor(q));
  let t = q - vec3f(b);
  var corr = 0.0;
  for (var n = 0; n < 8; n++) {
    let d = vec3i(n & 1, (n >> 1) & 1, (n >> 2) & 1);
    let w = select(1.0 - t.x, t.x, d.x == 1) * select(1.0 - t.y, t.y, d.y == 1) * select(1.0 - t.z, t.z, d.z == 1);
    corr += w * textureLoad(coarse, clamp(b + d, vec3i(0), cd - vec3i(1)), 0).x;
  }
  var value = 0.0;
  if (!solid_at(c, dims)) {
    value = textureLoad(p_src, c, 0).x + corr;
  }
  textureStore(p_dst, c, vec4f(value, 0.0, 0.0, 0.0));
}

// ---- Projection -----------------------------------------------------------------------------------------------------------

fn projected(axis: u32, t: vec3i) -> f32 {
  let f = face_of(axis, t);
  if (face_blocked(axis, f)) {
    return 0.0;
  }
  let gradient = textureLoad(p_src, f, 0).x - textureLoad(p_src, f - axis_step(axis), 0).x;
  return textureLoad(vel, f, 0)[axis] - gradient;
}

@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn cs_project(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.grid + vec3u(1u))) {
    return;
  }
  let t = vec3i(id);
  let v = vec3f(projected(0u, t), projected(1u, t), projected(2u, t));
  textureStore(out_vel, t, vec4f(finite3(v), 0.0));
}
`,E=`rgba16float`,D=`r32float`,ie=12,ae=[4,4,4],oe=64,se=3,ce={stepRate:60,pressureSolver:`multigrid`,jacobiWeight:6/7,pressureIterations:1,smoothing:2,coarseIterations:12,warmStart:!0,velocityScheme:`semi-lagrangian`,scalarScheme:`maccormack`,rk2:!0,limiter:!0,vorticity:0,velocityDissipation:.1,scalarDissipation:.05,gravity:[0,0,0],buoyancy:0,buoyancyDirection:[0,-1,0],maxCfl:6,scalarLimit:64,scalarOnly:!1,obstacle:{center:[.5,.5,.5],radius:0}},le=d(`Fluid3dUniforms`,{grid:`vec3u`,force_count:`u32`,scalar_size:`vec3u`,dye_count:`u32`,size:`vec3f`,h:`f32`,accel:`vec3f`,inv_h:`f32`,buoy_dir:`vec3f`,dt:`f32`,obstacle:`vec4f`,max_disp:`f32`,rk2:`u32`,limit:`u32`,jacobi_w:`f32`,vorticity:`f32`,buoyancy:`f32`,vel_decay:`f32`,dye_decay:`f32`,vmax:`f32`,dye_max:`f32`});function O(e,t,n){return{source:e,entry:t,bindings:{0:`uniform`,...n}}}var k={velSl:O(`advect`,`cs_vel_sl`,{2:`tex`,4:`storage-rgba`,6:`sampler`}),velMc:O(`advect`,`cs_vel_mc`,{2:`tex`,3:`tex`,4:`storage-rgba`,6:`sampler`}),dyeSl:O(`advect`,`cs_dye_sl`,{2:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),dyePred:O(`advect`,`cs_dye_pred`,{2:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),dyeMc:O(`advect`,`cs_dye_mc`,{2:`tex`,3:`tex`,4:`storage-rgba`,5:`tex`,6:`sampler`}),splatVelocity:O(`forces`,`cs_splat_velocity`,{2:`tex`,3:`storage-rgba`,4:`buffer`}),splatDye:O(`forces`,`cs_splat_dye`,{2:`tex`,3:`storage-rgba`,4:`buffer`}),center:O(`forces`,`cs_center`,{2:`tex`,3:`storage-rgba`}),curl:O(`forces`,`cs_curl`,{2:`tex`,12:`storage-rgba`}),blur:O(`forces`,`cs_blur`,{5:`tex`,8:`storage-r32`}),conf:O(`forces`,`cs_conf`,{5:`tex`,9:`texu`,10:`storage-rgba`}),forces:O(`forces`,`cs_forces`,{2:`tex`,3:`storage-rgba`,6:`tex`,7:`sampler`,11:`tex`}),divergence:O(`project`,`cs_divergence`,{2:`tex`,6:`storage-r32`}),jacobi:O(`project`,`cs_jacobi`,{3:`texu`,4:`texu`,5:`storage-r32`}),jacobiCold:O(`project`,`cs_jacobi_cold`,{3:`texu`,4:`texu`,5:`storage-r32`}),restrict:O(`project`,`cs_restrict`,{3:`texu`,4:`texu`,5:`storage-r32`}),prolong:O(`project`,`cs_prolong`,{4:`texu`,5:`storage-r32`,8:`texu`}),project:O(`project`,`cs_project`,{2:`tex`,4:`texu`,7:`storage-rgba`})},A={advect:S,forces:w,project:T};function j(e,t){let n=GPUShaderStage.COMPUTE;switch(t){case`uniform`:return{binding:e,visibility:n,buffer:{type:`uniform`}};case`tex`:return{binding:e,visibility:n,texture:{sampleType:`float`,viewDimension:`3d`}};case`texu`:return{binding:e,visibility:n,texture:{sampleType:`unfilterable-float`,viewDimension:`3d`}};case`storage-rgba`:return{binding:e,visibility:n,storageTexture:{access:`write-only`,format:E,viewDimension:`3d`}};case`storage-r32`:return{binding:e,visibility:n,storageTexture:{access:`write-only`,format:D,viewDimension:`3d`}};case`buffer`:return{binding:e,visibility:n,buffer:{type:`read-only-storage`}};case`sampler`:return{binding:e,visibility:n,sampler:{type:`filtering`}}}}var M=new WeakMap,N=new WeakMap;function P(e){return e.join(`x`)}function F(e,t,n){let r=N.get(e);r||N.set(e,r=new Map);let i=`${t}|${P(n)}`,a=r.get(i);if(!a){let o=`const WG_X: u32 = ${n[0]}u;\nconst WG_Y: u32 = ${n[1]}u;\nconst WG_Z: u32 = ${n[2]}u;\n`;a=p(e,{label:`sim/fluid3d-${t}.wgsl`,code:A[t],chunks:{"fluid3d_uniforms.wgsl":le.wgsl+o,"fluid3d-core.wgsl":C}}),r.set(i,a)}return a}function I(e,t,n){let r=M.get(e);r||M.set(e,r=new Map);let i=`${t}|${P(n)}`,a=r.get(i);if(!a){let o=k[t],s=e.createBindGroupLayout({label:`fluid3d ${o.entry} layout`,entries:Object.entries(o.bindings).map(([e,t])=>j(Number(e),t))});a={pipeline:e.createComputePipeline({label:`fluid3d ${o.entry}`,layout:e.createPipelineLayout({label:`fluid3d ${o.entry} pipeline layout`,bindGroupLayouts:[s]}),compute:{module:F(e,o.source,n),entryPoint:o.entry}}),layout:s,spec:o},r.set(i,a)}return a}var L=(e,t,n)=>Math.min(n,Math.max(t,e)),R=(e,t)=>Number.isFinite(e)?e:t,z=e=>Math.max(8,Math.round(e/8)*8);function ue(e,t=[1,1,1]){let n=z(L(R(e,64),16,256)),r=t.map(e=>Number.isFinite(e)&&e>0?e:1),i=Math.max(...r),a=r.map(e=>L(z(e/i*n),8,256));return{width:a[0],height:a[1],depth:a[2],cellSize:1/n}}function de(e,t,n=256){let r=Math.round(L(R(e,96),16,n)),i=Math.max(...t);return t.map(e=>L(Math.round(e/i*r),8,n))}var B=1,V=new WeakMap;function H(e){let t=V.get(e);return t===void 0&&V.set(e,t=B++),t}function U(e,t,n,r){let i=0,a=1/0;for(let o=0;o<3;o++){let s=e[o],c=t[o];if(Math.abs(c)<1e-9){if(s<n[o]||s>r[o])return null;continue}let l=(n[o]-s)/c,u=(r[o]-s)/c;i=Math.max(i,Math.min(l,u)),a=Math.min(a,Math.max(l,u))}return a>i?{near:i,far:a}:null}function fe(e){let{device:t,maxStepsPerFrame:i=3,profiler:a=r,label:o=`fluid3d`}=e,s=e.resolution??64,c=e.scalarResolution??96,l=e.size??[1,1,1],u=[...e.workgroup??ae],d={...ce,...e.params,obstacle:{...ce.obstacle,...e.params?.obstacle}},p=Math.min(t.limits.maxTextureDimension3D-1,256),m=f(t,le,`${o} params`),h=t.createSampler({label:`${o} sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`,addressModeW:`clamp-to-edge`}),g=t.createBuffer({label:`${o} momentum splats`,size:6144,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),_=t.createBuffer({label:`${o} ink splats`,size:6144,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),ee=new Float32Array(1536),te=new Float32Array(1536),v=0,b=0,ne=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST,x=!1,re=0,S=0,C,w=0,T,O=0,k=0;function A(e,n,r){let i=t.createTexture({label:`${o} ${e}`,dimension:`3d`,size:[n[0],n[1],n[2]],format:r,usage:ne});return{texture:i,view:i.createView({label:`${o} ${e} view`,dimension:`3d`}),id:H(i)}}function j(e,t,n){let r=[e[0]+1,e[1]+1,e[2]+1],i=[],a=[e];for(;a.length<=se&&a[a.length-1].every(e=>e%2==0&&e>=8);)a.push(a[a.length-1].map(e=>e/2));let o=A(`divergence`,e,D);return a.forEach((e,t)=>{i.push({dims:e,p:[A(`pressure ${t}a`,e,D),A(`pressure ${t}b`,e,D)],rhs:t===0?o:A(`rhs ${t}`,e,D),current:0})}),{grid:Object.freeze({width:e[0],height:e[1],depth:e[2],cellSize:t,size:Object.freeze([e[0]*t,e[1]*t,e[2]*t]),velocitySize:Object.freeze(r),scalarSize:Object.freeze(n),levels:i.length}),velocity:[0,1,2].map(e=>A(`velocity ${e}`,r,E)),scalar:[0,1].map(e=>A(`ink ${e}`,n,E)),levels:i,divergence:o,curl:A(`vorticity`,e,E),blur:A(`vorticity blur`,e,D),conf:A(`confinement`,e,E),fields:A(`fields`,e,E),groups:new Map}}function M(e){let t=new Set([...e.velocity,...e.scalar,...e.levels.flatMap(e=>[...e.p,e.rhs]),e.divergence,e.curl,e.blur,e.conf,e.fields]);for(let e of t)e.texture.destroy()}function N(e=!1){let t=ue(s,l),n=[t.width,t.height,t.depth],r=[t.width*t.cellSize,t.height*t.cellSize,t.depth*t.cellSize],i=de(c,r,p),a=T?.grid;return!e&&a&&a.width===n[0]&&a.height===n[1]&&a.depth===n[2]&&a.scalarSize.every((e,t)=>e===i[t])?!1:(T&&M(T),T=j(n,t.cellSize,i),O=0,k=0,re++,C=void 0,v=0,b=0,!0)}N();function P(e){for(;T.scalar.length<e;)T.scalar.push(A(`ink ${T.scalar.length}`,T.grid.scalarSize,E))}let F=e=>`view`in e&&`texture`in e;function z(e,n){let{layout:r,spec:i}=I(t,e,u),a=[e,...Object.keys(i.bindings).map(t=>{let r=Number(t);if(r<1)return``;let i=n[r];if(!i)throw Error(`fluid3d pass ${e} is missing binding ${r}`);return`${r}:${F(i)?i.id:H(i)}`})].join(`|`),o=T.groups.get(a);if(!o){let e=[{binding:0,resource:{buffer:m.buffer}}];for(let t of Object.keys(i.bindings)){let r=Number(t);if(r<1)continue;let i=n[r];e.push({binding:r,resource:F(i)?i.view:`size`in i?{buffer:i}:i})}o=t.createBindGroup({label:`fluid3d ${i.entry}`,layout:r,entries:e}),T.groups.set(a,o)}return o}function B(e,t,n){return e.beginComputePass({label:`fluid3d ${t}`,timestampWrites:n?a.pass(n):void 0})}function V(e,n,r,i){e.setPipeline(I(t,n,u).pipeline),e.setBindGroup(0,z(n,r)),e.dispatchWorkgroups(Math.ceil(i[0]/u[0]),Math.ceil(i[1]/u[1]),Math.ceil(i[2]/u[2]))}let U=e=>{let t=[0,1,2].filter(t=>t!==e);return[t[0],t[1]]},fe=()=>T.scalar.map((e,t)=>t).filter(e=>e!==k),W=e=>[e.grid.width,e.grid.height,e.grid.depth],pe=()=>L(R(d.stepRate,60),10,240),G=()=>1/pe(),K=[0,0];function q(e=K){K=e;let{grid:t}=T,n=G(),r=L(R(d.maxCfl,6),.5,32),i=e=>Math.max(0,R(e,0)),a=d.buoyancyDirection,o=Math.hypot(a[0],a[1],a[2])||1,s=d.obstacle;m.set({grid:[t.width,t.height,t.depth],force_count:e[0],scalar_size:t.scalarSize,dye_count:e[1],size:t.size,h:t.cellSize,accel:[R(d.gravity[0],0),R(d.gravity[1],0),R(d.gravity[2],0)],inv_h:1/t.cellSize,buoy_dir:[R(a[0],0)/o,R(a[1],-1)/o,R(a[2],0)/o],dt:n,obstacle:[R(s.center[0],0),R(s.center[1],0),R(s.center[2],0),i(s.radius)],max_disp:r,rk2:+!!d.rk2,limit:+!!d.limiter,jacobi_w:L(R(d.jacobiWeight,.8),.3,1),vorticity:i(d.vorticity),buoyancy:R(d.buoyancy,0),vel_decay:Math.exp(-i(d.velocityDissipation)*n),dye_decay:Math.exp(-i(d.scalarDissipation)*n),vmax:r*t.cellSize/n,dye_max:L(R(d.scalarLimit,oe),1,256)}),m.upload()}function J(e){let t=T,n=t.velocity[O],[r,i]=U(O).map(e=>t.velocity[e]),a=t.grid.velocitySize;d.velocityScheme===`maccormack`?(V(e,`velSl`,{2:n,4:r,6:h},a),V(e,`velMc`,{2:n,3:r,4:i,6:h},a),O=t.velocity.indexOf(i)):(V(e,`velSl`,{2:n,4:r,6:h},a),O=t.velocity.indexOf(r))}function me(e){let t=T,n=t.velocity[O],r=t.grid.scalarSize;if(d.scalarScheme===`maccormack`){P(3);let i=t.scalar[k],[a,o]=fe().map(e=>t.scalar[e]);V(e,`dyePred`,{2:i,4:a,5:n,6:h},r),V(e,`dyeMc`,{2:i,3:a,4:o,5:n,6:h},r),k=t.scalar.indexOf(o)}else{let i=t.scalar[k],[a]=fe().map(e=>t.scalar[e]);V(e,`dyeSl`,{2:i,4:a,5:n,6:h},r),k=t.scalar.indexOf(a)}}function he(e){let t=T,n=t.velocity[O],r=W(t);d.vorticity>0&&(V(e,`center`,{2:n,3:t.fields},r),V(e,`curl`,{2:t.fields,12:t.curl},r),V(e,`blur`,{5:t.curl,8:t.blur},r),V(e,`conf`,{5:t.curl,9:t.blur,10:t.conf},r));let[i]=U(O).map(e=>t.velocity[e]);V(e,`forces`,{2:n,3:i,6:t.scalar[k],7:h,11:t.conf},t.grid.velocitySize),O=t.velocity.indexOf(i)}function Y(e,t,n,r){for(let i=0;i<n;i++){let n=t.p[t.current],a=t.p[1-t.current];V(e,i===0&&r?`jacobiCold`:`jacobi`,{3:t.rhs,4:n,5:a},t.dims),t.current=1-t.current}}function X(e,t,n){let r=T.levels,i=r[t],a=Math.round(L(R(d.smoothing,2),1,8)),o=t>0||n;if(t===r.length-1){Y(e,i,Math.round(L(R(d.coarseIterations,12),1,64)),!0);return}let s=r[t+1];Y(e,i,a,o),V(e,`restrict`,{3:i.rhs,4:i.p[i.current],5:s.rhs},s.dims),X(e,t+1,!1);let c=i.p[i.current],l=i.p[1-i.current];V(e,`prolong`,{4:c,5:l,8:s.p[s.current]},i.dims),i.current=1-i.current,Y(e,i,a,!1)}function ge(e,t){let n=T,r=n.velocity[O],i=n.levels[0];V(e,`divergence`,{2:r,6:n.divergence},W(n));let a=Math.max(1,Math.round(R(t,1)));if(d.pressureSolver===`multigrid`&&n.levels.length>1&&d.obstacle.radius<=0)for(let t=0;t<a;t++)X(e,0,t===0&&!d.warmStart);else Y(e,i,a,!d.warmStart);let[o]=U(O).map(e=>n.velocity[e]);V(e,`project`,{2:r,4:i.p[i.current],7:o},n.grid.velocitySize),O=n.velocity.indexOf(o)}function _e(e){if(v===0&&b===0)return;let n=T;v>0&&t.queue.writeBuffer(g,0,ee,0,v*ie),b>0&&t.queue.writeBuffer(_,0,te,0,b*ie);let r=B(e,`inject`,`inject`);if(v>0){let e=n.velocity[O],[t]=U(O).map(e=>n.velocity[e]);V(r,`splatVelocity`,{2:e,3:t,4:g},n.grid.velocitySize),O=n.velocity.indexOf(t)}if(b>0){let e=n.scalar[k],t=n.scalar[fe()[0]];V(r,`splatDye`,{2:e,3:t,4:_},n.grid.scalarSize),k=n.scalar.indexOf(t)}r.end(),v=0,b=0}function ve(e,t,n){if(!d.scalarOnly){let n=B(e,`velocity`,t?`advect + forces`:void 0);J(n),he(n),n.end();let r=B(e,`pressure`,t?`pressure`:void 0);ge(r,d.pressureIterations),r.end()}let r=B(e,`scalar`,t?`ink`:n?`ink (last step)`:void 0);me(r),r.end()}function ye(e,t){if(x)return;let n=Math.max(0,Math.floor(R(t,0)));if(S=n,n!==0||v!==0||b!==0){q([v,b]),_e(e);for(let t=0;t<n;t++)ve(e,t===0,t===n-1&&n>1)}}function be(e,t,n,r,i,a,o){if(t>=128||![...n,...r,i,a,...o].every(Number.isFinite))return!1;let s=t*ie;return e[s]=n[0],e[s+1]=n[1],e[s+2]=n[2],e[s+3]=Math.max(i,1e-4),e[s+4]=r[0],e[s+5]=r[1],e[s+6]=r[2],e[s+7]=Math.max(a,0),e[s+8]=o[0]??0,e[s+9]=o[1]??0,e[s+10]=o[2]??0,e[s+11]=o[3]??0,!0}function xe(e,n,r){t.queue.writeTexture({texture:e.texture},r,{bytesPerRow:n[0]*8,rowsPerImage:n[1]},[n[0],n[1],n[2]])}let Z=(e,t)=>({texture:e.texture,view:e.view,slot:t});return{params:d,get grid(){return T.grid},get generation(){return re},get density(){return Z(T.scalar[k],k)},get velocity(){return Z(T.velocity[O],O)},get pressure(){let e=T.levels[0];return Z(e.p[e.current],e.current)},get divergence(){return T.divergence.texture},get fields(){return T.fields.texture},get fieldsView(){return T.fields.view},get stepSeconds(){return G()},get lastSteps(){return S},get pendingSplats(){return[v,b]},setResolution(e,t){return Number.isFinite(e)?(s=e,t!==void 0&&Number.isFinite(t)&&(c=t),N()):!1},setSize(e){return l=e,N()},setWorkgroup(e){let n=e[0]*e[1]*e[2],r=t.limits;if(!e.every(e=>Number.isInteger(e)&&e>=1)||n>r.maxComputeInvocationsPerWorkgroup||e[0]>r.maxComputeWorkgroupSizeX||e[1]>r.maxComputeWorkgroupSizeY||e[2]>r.maxComputeWorkgroupSizeZ)throw RangeError(`workgroup ${e.join(` x `)} exceeds the device limits`);u=[e[0],e[1],e[2]],T.groups.clear()},addImpulse(e,t,n,r,i=0){return be(ee,v,e,t,n,i,[r[0],r[1],r[2]])?(v++,!0):!1},addDensity(e,t,n,r,i=0){return be(te,b,e,t,n,i,r)?(b++,!0):!1},update(e,t){if(x)return 0;let r=G();(!C||Math.abs(r-w)>r*.001)&&(C=n(r,{maxSteps:i}),w=r);let{steps:a}=C.advance(Number.isFinite(t)?t:0);return ye(e,a),a},advance(e,t){ye(e,t)},project(e,t){if(x)return;q();let n=B(e,`project`,`project`);ge(n,t??d.pressureIterations),n.end()},resolve(e){if(x)return;q();let t=B(e,`resolve`,`resolve`);V(t,`center`,{2:T.velocity[O],3:T.fields},W(T)),t.end()},setVelocity(e){let{velocitySize:t,cellSize:n,width:r,height:i,depth:a}=T.grid,[o,s,c]=t,l=n,u=new Uint16Array(o*s*c*4);for(let t=0;t<c;t++)for(let n=0;n<s;n++)for(let c=0;c<o;c++){let d=((t*s+n)*o+c)*4,f=Math.min(n,i-1),p=Math.min(t,a-1),m=Math.min(c,r-1),h=c===0||c===r?0:e(c*l,(f+.5)*l,(p+.5)*l)[0],g=n===0||n===i?0:e((m+.5)*l,n*l,(p+.5)*l)[1],_=t===0||t===a?0:e((m+.5)*l,(f+.5)*l,t*l)[2];u[d]=y(R(h,0)),u[d+1]=y(R(g,0)),u[d+2]=y(R(_,0))}xe(T.velocity[O],t,u)},setDensity(e){let{scalarSize:t,size:n}=T.grid,[r,i,a]=t,o=new Uint16Array(r*i*a*4);for(let t=0;t<a;t++)for(let s=0;s<i;s++)for(let c=0;c<r;c++){let l=e((c+.5)/r*n[0],(s+.5)/i*n[1],(t+.5)/a*n[2]),u=((t*i+s)*r+c)*4;for(let e=0;e<4;e++)o[u+e]=y(R(l[e]??0,0))}xe(T.scalar[k],t,o)},reset(){N(!0)},destroy(){x||(x=!0,M(T),m.destroy(),g.destroy(),_.destroy())}}}var W=d(`MarchParams`,{box_min:`vec3f`,abs_gain:`f32`,box_max:`vec3f`,scatter:`f32`,light_dir:`vec3f`,phase_g:`f32`,light_color:`vec3f`,edge_strength:`f32`,ambient:`vec3f`,exposure:`f32`,water:`vec3f`,steps:`u32`,light_size:`vec3u`,light_steps:`u32`,sphere:`vec4f`,jitter:`f32`,frame:`u32`,lighting:`u32`,occupancy:`u32`,view:`u32`,slice:`f32`,debug_gain:`f32`}),pe=[`32`,`48`,`64`,`80`,`96`,`128`],G=[`64`,`96`,`128`,`160`],K=[`multigrid`,`jacobi`],q=[`semi-lagrangian`,`maccormack`],J=[`mixed inks`,`chosen colour`],me=[`drops from above`,`plume from below`],he=[`off`,`light volume`,`per-sample march`],Y=[`pushes the fluid`,`orbits the camera`],X=[`ink`,`velocity slice`,`ink slice`],ge=[1,1.25,1],_e=Math.PI/180,ve=36*_e,ye=50*_e,be=3,xe=3,Z=[[.1,.14,.62],[.8,.07,.12],[.05,.58,.6],[.96,.58,.06],[.82,.1,.56],[.08,.62,.3]];function Se(e){return e<=.04045?e/12.92:((e+.055)/1.055)**2.4}function Ce(e){return[0,1,2].map(t=>-Math.log(Math.min(1,Math.max(.02,e[t]??1))))}function we(e){return Z[(Math.floor(e)%Z.length+Z.length)%Z.length].map(Se)}function Te(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}var Ee=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],Q=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],De=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]};function Oe(e,t,n,r){let i=Q(t,r);if(Math.abs(i)<1e-6)return null;let a=Q(Ee(n,e),r)/i;return a<0?null:[e[0]+t[0]*a,e[1]+t[1]*a,e[2]+t[2]*a]}var ke=t({meta:e,params:{resolution:{type:`select`,default:`64`,options:pe,label:`Velocity cells (long side; re-creates the fluid)`},scalarResolution:{type:`select`,default:`96`,options:G,label:`Ink texels (long side; re-creates the fluid)`},pressureSolver:{type:`select`,default:`multigrid`,options:K,label:`Pressure solver`},pressureIterations:{type:`number`,default:2,min:1,max:12,step:1,label:`Pressure work per step (V-cycles, or Jacobi sweeps)`},scalarScheme:{type:`select`,default:`maccormack`,options:q,label:`Ink advection`},vorticity:{type:`number`,default:4,min:0,max:24,step:.5,label:`Vorticity confinement (keeps the rings tight)`},buoyancy:{type:`number`,default:1.2,min:-4,max:6,step:.05,label:`Ink weight (positive sinks, negative rises like smoke)`},velocityDissipation:{type:`number`,default:.25,min:0,max:3,step:.01,label:`Water friction (1 / s)`},inkFade:{type:`number`,default:.2,min:0,max:1,step:.005,label:`Ink fade (1 / s)`},speed:{type:`number`,default:1,min:.2,max:2,step:.01,label:`Flow speed (below 1 is slow motion and costs less; steps are skipped, so it judders a little)`},inks:{type:`select`,default:`mixed inks`,options:J,label:`Ink colours`},inkColor:{type:`color`,default:[.012,.03,.3],label:`Ink colour when chosen (linear)`},emitter:{type:`select`,default:`drops from above`,options:me,label:`Ambient`},dropRate:{type:`number`,default:.3,min:0,max:3,step:.05,label:`Ambient drops per second`},dropSize:{type:`number`,default:.07,min:.025,max:.14,step:.001,label:`Drop radius (tank height = 1)`},dropAmount:{type:`number`,default:3,min:.2,max:4,step:.05,label:`Ink in a drop`},dropSpeed:{type:`number`,default:.05,min:0,max:1.5,step:.01,label:`Starting speed of a drop`},push:{type:`number`,default:1.2,min:0,max:4,step:.05,label:`Push (fraction of pointer speed)`},trail:{type:`number`,default:0,min:0,max:1,step:.01,label:`Ink left by a push`},drag:{type:`select`,default:Y[0],options:Y,label:`Dragging`},inkDensity:{type:`number`,default:8,min:.5,max:30,step:.1,label:`Ink strength (absorption)`},scatter:{type:`number`,default:3,min:0,max:20,step:.1,label:`Milkiness (scattering)`},steps:{type:`number`,default:64,min:12,max:256,step:1,label:`March steps per ray`},renderScale:{type:`number`,default:.5,min:.2,max:1,step:.01,label:`March resolution (fraction of the canvas)`},lighting:{type:`select`,default:he[1],options:he,label:`Lighting`},shadowSteps:{type:`number`,default:12,min:3,max:32,step:1,label:`Steps toward the light`},skipEmpty:{type:`boolean`,default:!0,label:`Skip empty space`},jitter:{type:`boolean`,default:!0,label:`Jitter the ray starts`},sunAzimuth:{type:`number`,default:35,min:0,max:360,step:1,label:`Sun direction`},sunElevation:{type:`number`,default:55,min:10,max:88,step:1,label:`Sun elevation (degrees)`},obstacle:{type:`number`,default:0,min:0,max:.2,step:.005,label:`Sphere obstacle radius (0 = none; uses Jacobi pressure)`},exposure:{type:`number`,default:1.1,min:.3,max:3,step:.01},autoRotate:{type:`boolean`,default:!0,label:`Camera drifts when left alone`},view:{type:`select`,default:X[0],options:X,label:`View`},slice:{type:`number`,default:.5,min:0,max:1,step:.01,label:`Slice position`},debugGain:{type:`number`,default:1,min:.1,max:20,step:.1,label:`Debug view gain`},stepsPerFrame:{type:`number`,default:0,min:0,max:32,step:1,label:`Solver steps per frame (0 = by clock; for benchmarks)`},marchRepeat:{type:`number`,default:1,min:1,max:16,step:1,label:`Repeat the ray march (for benchmarks)`}},presets:{"ink drop":{},"smoke plume":{emitter:`plume from below`,inks:`chosen colour`,inkColor:[.86,.88,.9],buoyancy:-3,vorticity:8,velocityDissipation:.15,inkFade:.35,dropRate:.5,dropSize:.06,dropAmount:1.6,dropSpeed:.05,inkDensity:1.5,scatter:6,exposure:1.3},"many inks":{dropRate:1,dropSize:.05,dropAmount:2,inkFade:.3,vorticity:5,buoyancy:1.4,inkDensity:7},"slow ring":{speed:.55,dropRate:.2,dropSize:.08,dropSpeed:.1,vorticity:3,inks:`chosen colour`},"low-cost":{resolution:`32`,scalarResolution:`64`,pressureIterations:1,scalarScheme:`semi-lagrangian`,vorticity:2,steps:32,renderScale:.35,lighting:`off`,skipEmpty:!0},"high quality":{resolution:`96`,scalarResolution:`160`,pressureIterations:2,steps:112,renderScale:.75,shadowSteps:16}},async create({device:e,format:t,canvas:n,params:r,profiler:d}){let y=Te(7229),S=m(n,{capture:!0}),C=n.style.userSelect;n.style.userSelect=`none`;let w=typeof matchMedia==`function`&&matchMedia(`(prefers-reduced-motion: reduce)`).matches,T=fe({device:e,resolution:Number(r.resolution),scalarResolution:Number(r.scalarResolution),size:ge,maxStepsPerFrame:be,profiler:d,label:`fluid-3d`}),E=()=>[...T.grid.size],D=e=>[e[0]+E()[0]/2,e[1],e[2]+E()[2]/2],ie=e=>[e[0]-E()[0]/2,e[1],e[2]-E()[2]/2],ae={"march_params.wgsl":W.wgsl,"ink.wgsl":ne},oe=g(e,{fragment:{label:`fluid-3d/march.wgsl`,code:x,chunks:ae},format:[`rgba16float`,`rgba16float`]}),se=g(e,{fragment:{label:`fluid-3d/composite.wgsl`,code:b,chunks:ae},format:t}),ce=p(e,{label:`fluid-3d/volume-prep.wgsl`,code:re,chunks:ae}),le=e.createComputePipeline({label:`fluid-3d light volume`,layout:`auto`,compute:{module:ce,entryPoint:`cs_light`}}),O=e.createComputePipeline({label:`fluid-3d occupancy`,layout:`auto`,compute:{module:ce,entryPoint:`cs_occupancy`}}),k=f(e,u,`fluid-3d camera`),A=f(e,W,`fluid-3d params`),j=e.createSampler({label:`fluid-3d sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`,addressModeW:`clamp-to-edge`}),M=i(e,{label:`fluid-3d radiance`,format:`rgba16float`,width:2,height:2}),N=i(e,{label:`fluid-3d transmittance`,format:`rgba16float`,width:2,height:2}),P,F,I,L,R=[16,16,16],z=-1,ue=0;function de(){if(z===T.generation&&P&&I)return;z=T.generation,P?.destroy(),I?.destroy();let[t,n,r]=T.grid.scalarSize;R=[t,n,r].map(e=>Math.max(16,Math.ceil(e/2/4)*4));let i=(t,n)=>e.createTexture({label:t,dimension:`3d`,size:[n[0],n[1],n[2]],format:`rgba16float`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});P=i(`fluid-3d light volume`,R),F=P.createView({dimension:`3d`}),I=i(`fluid-3d occupancy`,[Math.ceil(t/4),Math.ceil(n/4),Math.ceil(r/4)]),L=I.createView({dimension:`3d`})}let B=new Map;function V(e,t){let n=B.get(e);return n||(B.size>64&&B.clear(),n=t(),B.set(e,n)),n}let H=te({yaw:.65,pitch:.28,distance:2.6,target:[0,.5,0]}),pe={...v,minPitch:.04,maxPitch:1.4,autoSpeed:.1},G=c(),K=Math.max(1,n.width||1),q=Math.max(1,n.height||1),J=0,me=(e,t,n)=>a(G.invViewProj,e,t,n);function Z(e,t){let n=me(e,t,0),r=me(e,t,1),i=[n[0],n[1],n[2]];return{origin:i,dir:De(Ee([r[0],r[1],r[2]],i))}}function Se(){let e=G.position;return De([H.target[0]-e[0],H.target[1]-e[1],H.target[2]-e[2]])}let Q,ke=0,Ae,je=Math.floor(y()*6);function Me(){return r.inks===`chosen colour`?[...r.inkColor]:(je+=1+Math.floor(y()*2),we(je))}function Ne(e,t){let n=Ce(e);return[n[0]*t,n[1]*t,n[2]*t,t]}function Pe(e,t=1,n=Me()){let i=r.dropSize*t,a=r.dropAmount,[o,s,c]=E(),l=e=>[Math.min(Math.max(e[0],.04),o-.04),Math.min(Math.max(e[1],.04),s-.04),Math.min(Math.max(e[2],.04),c-.04)],u=l(e);T.addDensity(u,u,i,Ne(n,a));for(let e=0;e<4;e++){let e=y()*Math.PI*2,t=y()*2-1,r=i*(.5+.5*y()),o=l([u[0]+Math.cos(e)*Math.sqrt(1-t*t)*r,u[1]+t*r,u[2]+Math.sin(e)*Math.sqrt(1-t*t)*r]);T.addDensity(o,o,i*(.45+.3*y()),Ne(n,a*.6))}let d=r.dropSpeed*(r.buoyancy<0?1:-1);d!==0&&T.addImpulse(u,u,i*1.4,[0,d,0])}let $=.7,Fe=!1;function Ie(e){let t=E();Fe||(Fe=!0,r.emitter===`drops from above`&&Pe([t[0]*.5,t[1]*.8,t[2]*.5],1.15));let n=r.dropRate*(w?.3:1)*(1-.7*ke);if(r.emitter===`plume from below`){$+=e*n*4;let r=0;for(;$>=1&&r<3;){--$,r++;let e=J*.7;Pe([t[0]*(.5+.12*Math.sin(e)),t[1]*.1,t[2]*(.5+.12*Math.cos(e*1.3))],.6+.3*y())}}else $+=e*n,$>=1&&($=Math.min($-1,1),Pe([t[0]*(.25+.5*y()),t[1]*(.72+.18*y()),t[2]*(.25+.5*y())],.75+.5*y()));$=Math.min($,4)}function Le(e){let t=S.poll(),n=E(),i=0,a=0,o=!1,s=!1;for(let c of t){let t=Z(c.x,c.y),l=D(t.origin),u=U(l,t.dir,[0,0,0],n);if(!Q&&c.justPressed){let e=u!==null,n=e&&r.drag===Y[0];if(Q={id:c.id,mode:n?`push`:`orbit`,travel:0,start:J,onTank:e,pressed:{x:c.x,y:c.y}},n&&u){let e=u.near+.35*(u.far-u.near);Q.plane={point:[l[0]+t.dir[0]*e,l[1]+t.dir[1]*e,l[2]+t.dir[2]*e],normal:Se()}}}if(Q&&c.id===Q.id){if(s=!0,(c.down||c.justReleased)&&(Q.travel+=Math.abs(c.dx)+Math.abs(c.dy)),Q.mode===`push`&&c.down&&Q.plane){let n=Oe(l,t.dir,Q.plane.point,Q.plane.normal);if(n&&Q.travel>.01){let t=Q.last??n,i=Ee(n,t),a=Math.hypot(...i),o=a/Math.max(e,1/240);if(o>.001&&a>1e-5){let e=.075,s=r.push*Math.min(o,xe)/a,c=[i[0]*s,i[1]*s,i[2]*s];T.addImpulse(t,n,e,c,e*.5),r.trail>0&&(Ae??=Me(),T.addDensity(t,n,e*.6,Ne(Ae,r.dropAmount*r.trail*.4),e*.3))}Q.last=n}}else Q.mode===`orbit`&&c.down&&(i+=c.dx,a+=c.dy,o=!0);if(c.justReleased||!c.down){if(!c.cancelled&&Q.travel<.012&&J-Q.start<.55&&Q.onTank&&u){let e=u.near+.04*(u.far-u.near);Pe([l[0]+t.dir[0]*e,Math.min(l[1]+t.dir[1]*e,n[1]-.12),l[2]+t.dir[2]*e],1.1)}Q=void 0,Ae=void 0}}}Q&&!t.some(e=>e.id===Q.id)&&(Q=void 0);let c=r.autoRotate&&!w;_(H,{yaw:o?-i*3:0,pitch:o?a*2:0,dragging:o},e,c?pe:{...pe,autoSpeed:0});let l=1-Math.exp(-e*(s?6:.8));ke+=(+!!s-ke)*l}function Re(){let e=T.params;e.pressureSolver=r.pressureSolver,e.pressureIterations=r.pressureIterations,e.scalarScheme=r.scalarScheme,e.vorticity=r.vorticity,e.buoyancy=r.buoyancy,e.velocityDissipation=r.velocityDissipation,e.scalarDissipation=r.inkFade;let t=T.grid.size;e.obstacle={center:[t[0]*.5,t[1]*.3,t[2]*.5],radius:r.obstacle}}return{resize(e,t){K=Math.max(1,Math.round(e)),q=Math.max(1,Math.round(t))},frame({delta:t},n,i){let a=Math.min(Math.max(t,0),.1);J+=a;let c=K/q;T.setResolution(Number(r.resolution),Number(r.scalarResolution)),Re(),de(),Le(a);let u=E();H.target=[0,u[1]*.5,0],s({position:ee(H),target:H.target,fovY:o(ve,c,ye),aspect:c,near:.05,far:50},G),l(k,G,K,q),k.upload();let f=a*r.speed;Ie(f),r.stepsPerFrame>0?T.advance(n,r.stepsPerFrame):T.update(n,f),r.view===`velocity slice`&&T.resolve(n);let p=r.sunAzimuth*_e,m=r.sunElevation*_e,g=[Math.cos(m)*Math.sin(p),Math.sin(m),Math.cos(m)*Math.cos(p)],_=Math.max(0,he.indexOf(r.lighting)),te=ie([u[0]*.5,u[1]*.3,u[2]*.5]);A.set({box_min:[-u[0]/2,0,-u[2]/2],abs_gain:r.inkDensity,box_max:[u[0]/2,u[1],u[2]/2],scatter:r.scatter,light_dir:g,phase_g:.35,light_color:[2.6,2.5,2.3],edge_strength:1,ambient:[.55,.62,.72],exposure:r.exposure,water:[.18,.06,.04],steps:Math.round(r.steps),light_size:R,light_steps:Math.round(r.shadowSteps),sphere:[...te,r.obstacle],jitter:+!!r.jitter,frame:0,lighting:_,occupancy:+!!r.skipEmpty,view:Math.max(0,X.indexOf(r.view)),slice:r.slice,debug_gain:r.debugGain}),A.upload();let v=T.density,y=`${T.generation}:${v.slot}`;if(r.view===`ink`&&(r.skipEmpty||_===1)){let t=n.beginComputePass({label:`fluid-3d prepare`,timestampWrites:d.pass(`light + occupancy`)});if(_===1&&(t.setPipeline(le),t.setBindGroup(0,V(`light:${y}:${z}`,()=>e.createBindGroup({label:`fluid-3d light`,layout:le.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:A.buffer}},{binding:1,resource:v.view},{binding:2,resource:j},{binding:3,resource:F}]}))),t.dispatchWorkgroups(Math.ceil(R[0]/4),Math.ceil(R[1]/4),Math.ceil(R[2]/4))),r.skipEmpty){t.setPipeline(O),t.setBindGroup(0,V(`occ:${y}:${z}`,()=>e.createBindGroup({label:`fluid-3d occupancy`,layout:O.getBindGroupLayout(0),entries:[{binding:1,resource:v.view},{binding:4,resource:L}]})));let[n,r,i]=T.grid.scalarSize.map(e=>Math.ceil(e/4));t.dispatchWorkgroups(Math.ceil(n/4),Math.ceil(r/4),Math.ceil(i/4))}t.end()}let b=Math.min(Math.max(r.renderScale,.1),1),ne=Math.max(1,Math.round(K*b)),x=Math.max(1,Math.round(q*b));M.resize(ne,x)&&ue++,N.resize(ne,x);let re=V(`march:${y}:${z}`,()=>e.createBindGroup({label:`fluid-3d march`,layout:oe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:A.buffer}},{binding:1,resource:{buffer:k.buffer}},{binding:2,resource:v.view},{binding:3,resource:F},{binding:4,resource:L},{binding:5,resource:j}]}));if(r.view===`ink`){let e=Math.max(1,Math.round(r.marchRepeat));for(let t=0;t<e;t++)h(n,[M.view,N.view],oe,[re],{label:`fluid-3d march`,timestampWrites:t===0?d.pass(`march`):t===e-1?d.pass(`march (last)`):void 0})}let S=V(`composite:${y}:${ue}`,()=>e.createBindGroup({label:`fluid-3d composite`,layout:se.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:A.buffer}},{binding:1,resource:{buffer:k.buffer}},{binding:2,resource:M.view},{binding:3,resource:N.view},{binding:4,resource:j},{binding:5,resource:T.fieldsView},{binding:6,resource:v.view}]}));h(n,i,se,[S],{label:`fluid-3d composite`,timestampWrites:d.pass(`composite`)})},destroy(){S.destroy(),n.style.userSelect=C,T.destroy(),k.destroy(),A.destroy(),M.destroy(),N.destroy(),P?.destroy(),I?.destroy(),B.clear()}}}});export{ke as effect};