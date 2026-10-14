import{t as e}from"./meta-Chlsp49L.js";import{n as t}from"./types-ci2WwWg0.js";import{t as n}from"./loop-_CGOOht2.js";import{n as r}from"./profiler-Bi27xYp-.js";import{n as i}from"./targets-Dcl181Ey.js";import{t as a}from"./depth-DtG5nS6F.js";import{c as o,i as s,l as c,n as l,r as u}from"./camera-BT6VSIZb.js";import{n as d,r as f,t as p}from"./uniforms-BE1XSnDx.js";import{t as m}from"./shader-Cd_FDUy8.js";import{n as h,t as g}from"./billboards-BT_4dCEv.js";import{i as _,n as v,t as y}from"./system-Do33CVeV.js";import{n as b}from"./pointer-BbHa9JHH.js";import{i as x}from"./post-C5OKxNhT.js";import{a as S,i as C,r as w,t as ee}from"./orbit-Dpc2wFkv.js";import{n as T,t as E}from"./fluid-surface-Ch0GKyJ-.js";import{n as D,t as te}from"./forward-CXtlFXNw.js";import{n as O,o as ne,r as re}from"./mesh-DqMVT5EZ.js";import{t as k}from"./scene-5a0WSK0f.js";var ie=`// mpm-clear.wgsl -- step 1 of an MLS-MPM step: zero the grid's fixed-point mass and momentum
// (src/gpu/sim/mpm.ts). One invocation per node, 16 bytes each. The dispatch may be two-dimensional for a
// big grid (more than 65535 workgroups), so the node index is x + y * (workgroups.x * size).

#include "mpm-params.wgsl"

// Workgroup size; mpm.ts rewrites this line and @workgroup_size together.
const WG = 64u;

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read_write> grid: array<vec4<i32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let node = gid.x + gid.y * (groups.x * WG);
  if (node >= P.dims.x * P.dims.y * P.dims.z) {
    return;
  }
  grid[node] = vec4<i32>(0);
}
`,ae=`// mpm-core.wgsl -- the pure maths of the MLS-MPM solver (src/gpu/sim/mpm.ts): B-spline weights, the fixed-point
// encoding of the grid, collider distance functions and a few guards. No bindings and no module-scope
// variables, so a test can paste this file in front of a one-line \`fn f(x: vec4f) -> vec4f\` and run it.
//
// WEIGHTS. The quadratic B-spline, nodes at integer multiples of h. A particle at grid coordinate g = x / h
// touches the 3 nodes base .. base + 2 on each axis, base = floor(g - 0.5), fx = g - base in [0.5, 1.5):
//     w0 = 0.5 (1.5 - fx)^2     w1 = 0.75 - (fx - 1)^2     w2 = 0.5 (fx - 0.5)^2
// They sum to 1 and reproduce linear fields: sum_o w_o (base + o) = g, so a particle's position is the weighted
// mean of its nodes' positions (checked in tests/mpm.test.ts). \`mpm_weight_matrix\` returns them as a matrix
// whose column o is the per-axis weight of offset o: the weight of node (i, j, k) is W[i].x * W[j].y * W[k].z.
//
// FIXED POINT. WGSL atomics are integers only, so mass and momentum are summed as i32 with MPM_FIXED_SCALE
// units per 1.0 (2^20). One unit of mass is ONE PARTICLE (every particle has mass 1; the equation of state is
// written in ratios, so the physical rest density never appears). Range: a node holds up to +-2047.99 units of
// mass or of mass * velocity (m/s). That is 255 particles per cell at 8 per cell at rest (32x the rest
// density) and 100 particles' worth of mass moving at 20 m/s. Resolution: one unit in the last place is 9.5e-7,
// so a lone particle moving at 1e-3 m/s (momentum 7.5e-4 at its central node) is held to 0.07 %, and one at 1e-5
// m/s to 6 %. The velocity of a node is a ratio of two fixed-point numbers, so the scale cancels in the decode.
// An i32 wraps on overflow; the grid pass treats negative mass as empty and clamps every velocity it decodes, so
// the failure mode of a clump beyond the range is a wrong velocity bounded by max_speed, never NaN.
//
// Functions
//   mpm_to_fixed(x) -> i32                       round to nearest unit; saturates at the i32 range
//   mpm_from_fixed(i) -> f32
//   mpm_weight_matrix(fx) -> mat3x3f             the three weights per axis, as above
//   mpm_is_finite(x) -> bool                     false for NaN and +-Inf (tests the exponent bits, which a
//                                                compiler cannot fold away as it can \`x != x\`)
//   mpm_finite_or_zero(x) / mpm_finite3(v)       0 for NaN and +-Inf
//   mpm_kernel_above(t) -> f32                   share of a node's weight function above a wall t cells away
//   mpm_collider_sdf(a, b, x) -> vec4f           (unit outward normal, signed distance) of a collider at x
//   mpm_collider_kind(a) -> i32                  0 none, 1 sphere, 2 box, 3 plane
//
// Colliders are two vec4f: a = (centre or point on the plane, kind), b = (radius, 0, 0 | half extent |
// outward normal, friction); the third vec4f of a collider (xyz velocity) is used by the passes only.

const MPM_FIXED_SCALE: f32 = 1048576.0;
const MPM_INV_FIXED_SCALE: f32 = 1.0 / 1048576.0;

fn mpm_to_fixed(x: f32) -> i32 {
  // f32 -> i32 saturates in WGSL; the explicit clamp keeps that independent of the driver.
  return i32(clamp(round(x * MPM_FIXED_SCALE), -2147483520.0, 2147483520.0));
}

fn mpm_from_fixed(i: i32) -> f32 {
  return f32(i) * MPM_INV_FIXED_SCALE;
}

fn mpm_weight_matrix(fx: vec3f) -> mat3x3f {
  let a = vec3f(1.5) - fx;
  let b = fx - vec3f(1.0);
  let c = fx - vec3f(0.5);
  return mat3x3f(0.5 * a * a, vec3f(0.75) - b * b, 0.5 * c * c);
}

fn mpm_is_finite(x: f32) -> bool {
  return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u;
}

// The integral of the quadratic B-spline w(u) (centred on a node, support +-1.5 cells) over u > t, t in cells.
// With a wall t cells from a node and material on the far side, this is how much of the node's kernel the
// material fills: 1 for t <= -1.5, 0 for t >= 1.5. mpm-p2g2.wgsl divides the density estimate by what a fluid
// at rest density filling the container would give, which removes the deficit at the walls.
fn mpm_kernel_above(t: f32) -> f32 {
  if (t <= -1.5) {
    return 1.0;
  }
  if (t <= -0.5) {
    let a = t + 1.5;
    return 1.0 - a * a * a / 6.0;
  }
  if (t <= 0.5) {
    return 0.5 - 0.75 * t + t * t * t / 3.0;
  }
  if (t <= 1.5) {
    let a = 1.5 - t;
    return a * a * a / 6.0;
  }
  return 0.0;
}

fn mpm_finite_or_zero(x: f32) -> f32 {
  return select(x, 0.0, (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u);
}

fn mpm_finite3(v: vec3f) -> vec3f {
  return vec3f(mpm_finite_or_zero(v.x), mpm_finite_or_zero(v.y), mpm_finite_or_zero(v.z));
}

fn mpm_collider_kind(a: vec4f) -> i32 {
  return i32(a.w + 0.5);
}

fn mpm_collider_sdf(a: vec4f, b: vec4f, x: vec3f) -> vec4f {
  let kind = mpm_collider_kind(a);
  let d = x - a.xyz;
  if (kind == 1) {
    let len = max(length(d), 1e-6);
    return vec4f(d / len, len - b.x);
  }
  if (kind == 2) {
    let q = abs(d) - b.xyz;
    let outside = max(q, vec3f(0.0));
    let len = length(outside);
    if (len > 0.0) {
      return vec4f(sign(d) * outside / len, len);
    }
    // Inside: leave through the nearest face.
    var n = vec3f(0.0);
    if (q.x >= q.y && q.x >= q.z) {
      n.x = select(-1.0, 1.0, d.x >= 0.0);
    } else if (q.y >= q.z) {
      n.y = select(-1.0, 1.0, d.y >= 0.0);
    } else {
      n.z = select(-1.0, 1.0, d.z >= 0.0);
    }
    return vec4f(n, max(q.x, max(q.y, q.z)));
  }
  if (kind == 3) {
    let n = normalize(b.xyz);
    return vec4f(n, dot(d, n));
  }
  return vec4f(0.0, 1.0, 0.0, 1.0e9);
}
`,oe=`// mpm-g2p.wgsl -- G2P, the last pass of an MLS-MPM step (src/gpu/sim/mpm.ts): every particle gathers its new
// velocity and affine matrix from the 27 nodes it touches, then moves.
//
//     v_p = sum_i w_ip v_i
//     C_p = (4 / h^2) sum_i w_ip v_i (x_i - x_p)^T        (APIC / MLS: the velocity gradient, to second order)
//     x_p += dt v_p
//
// The particle is then pushed out of every collider and clamped to the container [bounds_min, bounds_max]
// (a particle that reaches a wall loses the velocity into it, up to the wall's own). Anything non-finite is
// replaced by zero and the velocity and C are limited, so no input can put a NaN into the state.
//
// Foam, the 0..1 scalar in positions.w: 1 - smoothstep(foam.x, foam.y, r) for a particle whose density ratio
// r (stored by the stress pass in affine0.w) has fallen to spray level, or smoothstep(foam.z, foam.w, speed) for a
// fast one, whichever is larger, and it fades with \`foam_decay\` per step once the reason is gone. \`aux\` is a
// debug scalar for the colour views: 1 speed (m/s), 2 density ratio r, 0 foam.
//
// Bindings: 1 uniform and 7 storage buffers.

#include "mpm-params.wgsl"
#include "mpm-core.wgsl"

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read> gridVel: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> affine0: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> affine1: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> affine2: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> aux: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x;
  if (p >= P.count) {
    return;
  }
  let position = positions[p];
  var x = position.xyz;

  let dims = vec3i(P.dims);
  let g = x * P.inv_h;
  let base = clamp(vec3i(floor(g - vec3f(0.5))), vec3i(0), dims - vec3i(3));
  let fx = g - vec3f(base);
  let W = mpm_weight_matrix(fx);

  var v = vec3f(0.0);
  var B = mat3x3f(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  for (var k = 0; k < 3; k++) {
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        let w = W[i].x * W[j].y * W[k].z;
        let d = (vec3f(f32(i), f32(j), f32(k)) - fx) * P.h;
        let node = u32(((base.z + k) * dims.y + (base.y + j)) * dims.x + (base.x + i));
        let gv = gridVel[node].xyz;
        v += w * gv;
        B += mat3x3f(gv * (w * d.x), gv * (w * d.y), gv * (w * d.z));
      }
    }
  }
  var C = B * (4.0 * P.inv_h * P.inv_h);
  v = mpm_finite3(v);
  let speed_limit = P.max_speed;
  let speed = length(v);
  if (speed > speed_limit) {
    v *= speed_limit / speed;
  }
  let c_limit = 4.0 * speed_limit * P.inv_h;
  C = mat3x3f(
    clamp(mpm_finite3(C[0]), vec3f(-c_limit), vec3f(c_limit)),
    clamp(mpm_finite3(C[1]), vec3f(-c_limit), vec3f(c_limit)),
    clamp(mpm_finite3(C[2]), vec3f(-c_limit), vec3f(c_limit)),
  );

  x += P.dt * v;

  // Colliders: out along the normal, and the velocity into them removed.
  for (var c = 0u; c < P.collider_count; c++) {
    let a = P.colliders[c * 3u];
    let b = P.colliders[c * 3u + 1u];
    let u = P.colliders[c * 3u + 2u].xyz;
    let s = mpm_collider_sdf(a, b, x);
    if (s.w < 0.0) {
      x -= s.w * s.xyz;
      var rel = v - u;
      let vn = dot(rel, s.xyz);
      if (vn < 0.0) {
        rel -= vn * s.xyz;
      }
      v = u + rel;
    }
  }

  // The container.
  let eps = 1.0e-3 * P.h;
  let lo = P.bounds_min + vec3f(eps);
  let hi = P.bounds_max - vec3f(eps);
  for (var axis = 0; axis < 3; axis++) {
    if (x[axis] <= lo[axis]) {
      x[axis] = lo[axis];
      v[axis] = max(v[axis], P.wall_vmin[axis]);
    } else if (x[axis] >= hi[axis]) {
      x[axis] = hi[axis];
      v[axis] = min(v[axis], P.wall_vmax[axis]);
    }
  }
  x = clamp(x, lo, hi);
  x = select(position.xyz, x, mpm_is_finite(x.x) && mpm_is_finite(x.y) && mpm_is_finite(x.z));

  // Foam.
  let r = affine0[p].w;
  let now = length(v);
  let spray = 1.0 - smoothstep(P.foam.x, P.foam.y, r);
  let fast = smoothstep(P.foam.z, P.foam.w, now);
  let foam = clamp(max(max(spray, fast), position.w * P.foam_decay), 0.0, 1.0);

  positions[p] = vec4f(x, mpm_finite_or_zero(foam));
  velocities[p] = vec4f(v, 0.0);
  affine0[p] = vec4f(C[0], r);
  affine1[p] = vec4f(C[1], 0.0);
  affine2[p] = vec4f(C[2], 0.0);
  var shown = foam;
  if (P.scalar_mode == 1u) {
    shown = now;
  } else if (P.scalar_mode == 2u) {
    shown = r;
  }
  aux[p] = shown;
}
`,se=`// mpm-grid.wgsl -- the grid update of an MLS-MPM step (src/gpu/sim/mpm.ts): decode the fixed-point sums, turn
// momentum into velocity, add gravity and enforce the boundaries. One invocation per node.
//
//     v_i = q_i / m_i        (both are fixed point with the same scale, so the scale cancels)
//     v_i *= exp(-damping dt); v_i += g dt
//     colliders, then the container walls, then |v_i| <= max_speed.
//
// CONTAINER WALLS are the faces of the axis-aligned box [bounds_min, bounds_max] and they move: wall_vmin and
// wall_vmax are the velocities of the six faces. Every node on or beyond a face is a wall node: its velocity
// along the wall normal is kept from going below the wall's own (a retreating wall does not pull the fluid
// along, a wall moving into the fluid pushes it), and its tangential velocity is blended towards the wall's by
// \`friction\` (0 slip, 1 stick). Particles are clamped to the box in the G2P pass.
//
// COLLIDERS are signed-distance shapes (sphere, box, plane) that may move. A node inside one loses the part of
// its velocity (relative to the collider) that points into it, and the tangential part is damped by the
// collider's friction.
//
// The result goes to gridVel (xyz velocity, w mass in particle units) for the G2P pass; the fixed-point grid is
// cleared by the next step.

#include "mpm-params.wgsl"
#include "mpm-core.wgsl"

// Workgroup size; mpm.ts rewrites this line and @workgroup_size together.
const WG = 64u;

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read> grid: array<vec4<i32>>;
@group(0) @binding(2) var<storage, read_write> gridVel: array<vec4f>;

fn wall_axis(v_in: vec3f, axis: i32, is_max: bool, wall_velocity: vec3f) -> vec3f {
  var v = v_in;
  let normal_speed = wall_velocity[axis];
  if (is_max) {
    v[axis] = min(v[axis], normal_speed);
  } else {
    v[axis] = max(v[axis], normal_speed);
  }
  for (var t = 0; t < 3; t++) {
    if (t != axis) {
      v[t] = mix(v[t], wall_velocity[t], P.friction);
    }
  }
  return v;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let node = gid.x + gid.y * (groups.x * WG);
  let nx = P.dims.x;
  let ny = P.dims.y;
  if (node >= nx * ny * P.dims.z) {
    return;
  }
  let cell = grid[node];
  let mass = cell.x;
  // Negative mass means the fixed-point sum wrapped: treat the node as empty rather than trust it.
  if (mass <= 0) {
    gridVel[node] = vec4f(0.0);
    return;
  }

  var v = vec3f(f32(cell.y), f32(cell.z), f32(cell.w)) / f32(mass);
  v *= P.damping_factor;
  v += P.gravity * P.dt;

  let ijk = vec3u(node % nx, (node / nx) % ny, node / (nx * ny));
  let xn = vec3f(ijk) * P.h;

  for (var c = 0u; c < P.collider_count; c++) {
    let a = P.colliders[c * 3u];
    let b = P.colliders[c * 3u + 1u];
    let u = P.colliders[c * 3u + 2u].xyz;
    let s = mpm_collider_sdf(a, b, xn);
    if (s.w < 0.0) {
      var rel = v - u;
      let vn = dot(rel, s.xyz);
      if (vn < 0.0) {
        rel = (rel - vn * s.xyz) * (1.0 - clamp(b.w, 0.0, 1.0));
      }
      v = u + rel;
    }
  }

  for (var axis = 0; axis < 3; axis++) {
    if (xn[axis] <= P.bounds_min[axis]) {
      v = wall_axis(v, axis, false, P.wall_vmin);
    }
    if (xn[axis] >= P.bounds_max[axis]) {
      v = wall_axis(v, axis, true, P.wall_vmax);
    }
  }

  v = mpm_finite3(v);
  let speed = length(v);
  if (speed > P.max_speed) {
    v *= P.max_speed / speed;
  }
  gridVel[node] = vec4f(v, mpm_from_fixed(mass));
}
`,ce=`// mpm-density.wgsl -- the first half of P2G pass 2 in the sorted mode (src/gpu/sim/mpm.ts): the density ratio of
// every particle, gathered from the mass that pass 1 left on the grid, with the wall correction. The arithmetic is
// the first half of mpm-p2g2.wgsl (read its header); the ratio goes to affine0.w, where the scatter half
// (mpm-p2g2s.wgsl) reads it. A thread per particle: all of them are independent, and the gather is a few loads.
//
// Bindings: 1 uniform and 3 storage buffers.

#include "mpm-params.wgsl"
#include "mpm-core.wgsl"

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read_write> grid: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> affine0: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x;
  if (p >= P.count) {
    return;
  }
  let dims = vec3i(P.dims);
  let g = positions[p].xyz * P.inv_h;
  let base = clamp(vec3i(floor(g - vec3f(0.5))), vec3i(0), dims - vec3i(3));
  let fx = g - vec3f(base);
  let W = mpm_weight_matrix(fx);

  var mass = 0.0;
  for (var k = 0; k < 3; k++) {
    for (var j = 0; j < 3; j++) {
      let row = u32(((base.z + k) * dims.y + (base.y + j)) * dims.x + base.x) * 4u;
      let wyz = W[j].y * W[k].z;
      mass += wyz * (W[0].x * mpm_from_fixed(atomicLoad(&grid[row]))
        + W[1].x * mpm_from_fixed(atomicLoad(&grid[row + 4u]))
        + W[2].x * mpm_from_fixed(atomicLoad(&grid[row + 8u])));
    }
  }
  var fill = 1.0;
  if (P.wall_comp != 0u) {
    let lo = P.bounds_min * P.inv_h;
    let hi = P.bounds_max * P.inv_h;
    for (var axis = 0; axis < 3; axis++) {
      var share = 0.0;
      for (var o = 0; o < 3; o++) {
        let node = f32(base[axis] + o);
        let inside = mpm_kernel_above(lo[axis] - node) - mpm_kernel_above(hi[axis] - node);
        share += W[o][axis] * inside;
      }
      fill *= share;
    }
  }
  let a0 = affine0[p];
  affine0[p] = vec4f(a0.xyz, clamp(mass / (P.rest_ppc * max(fill, 0.05)), 0.0, 64.0));
}
`,le=`// mpm-p2g1.wgsl -- P2G, pass 1 of an MLS-MPM step (src/gpu/sim/mpm.ts): every particle scatters its mass and its
// momentum, including the APIC affine term, to the 27 grid nodes its quadratic B-spline touches.
//
//     node mass     m_i  = sum_p w_ip
//     node momentum q_i  = sum_p w_ip (v_p + C_p (x_i - x_p))       (every particle has mass 1)
//
// Many particles write one node in parallel, so the sums are atomic adds on i32 fixed point (mpm-core.wgsl
// documents the scale and range). A node is 4 consecutive i32: mass, momentum x, y, z. Bindings: 1 uniform and
// 6 storage buffers (the limit is 8).

#include "mpm-params.wgsl"
#include "mpm-core.wgsl"

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read_write> grid: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read> velocities: array<vec4f>;
@group(0) @binding(4) var<storage, read> affine0: array<vec4f>;
@group(0) @binding(5) var<storage, read> affine1: array<vec4f>;
@group(0) @binding(6) var<storage, read> affine2: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x;
  if (p >= P.count) {
    return;
  }
  let x = positions[p].xyz;
  let v = velocities[p].xyz;
  let C = mat3x3f(affine0[p].xyz, affine1[p].xyz, affine2[p].xyz);

  let dims = vec3i(P.dims);
  let g = x * P.inv_h;
  let base = clamp(vec3i(floor(g - vec3f(0.5))), vec3i(0), dims - vec3i(3));
  let fx = g - vec3f(base);
  let W = mpm_weight_matrix(fx);

  for (var k = 0; k < 3; k++) {
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        let w = W[i].x * W[j].y * W[k].z;
        let d = (vec3f(f32(i), f32(j), f32(k)) - fx) * P.h;
        let q = w * (v + C * d);
        let node = u32(((base.z + k) * dims.y + (base.y + j)) * dims.x + (base.x + i)) * 4u;
        atomicAdd(&grid[node], mpm_to_fixed(w));
        atomicAdd(&grid[node + 1u], mpm_to_fixed(q.x));
        atomicAdd(&grid[node + 2u], mpm_to_fixed(q.y));
        atomicAdd(&grid[node + 3u], mpm_to_fixed(q.z));
      }
    }
  }
}
`,ue=`// mpm-p2g1s.wgsl -- P2G pass 1 for particles that are sorted by cell (the \`sorted\` mode of src/gpu/sim/mpm.ts).
// The arithmetic is mpm-p2g1.wgsl's; what changes is who does the adding.
//
// An invocation owns one ROW of one CELL of the sort: a cell is the set of particles with one stencil base
// (floor(x / h - 0.5), which is exactly what the sort bins by), so they all touch the same 27 nodes; a row is the
// three nodes along x at one (y, z) of that stencil. The invocation adds the contributions of all the cell's
// particles to its three nodes in registers and writes the sums with one atomic add per value. With about 8
// particles per cell that is 8 times fewer atomics than a thread per particle, which is what pass 1 is bound by,
// and nine invocations per cell keep the GPU fed (a cell alone would be too few threads: a 100 000-particle pool
// touches only 12 000 cells). Neighbouring invocations have neighbouring cells, so at any moment they add to
// different nodes.
//
// A particle the sort binned into a different cell than its own stencil base (the sort pads the cell by 1/4096,
// so a particle within that of a cell face can be off by one) is a stray: the row-0 invocation of its cell adds
// all 27 of its nodes directly, as mpm-p2g1.wgsl does, and the rows skip it.
//
// Bindings: 1 uniform and 7 storage buffers; cell_start is the sort's table (\`cells + 1\` offsets).

#include "mpm-params.wgsl"
#include "mpm-core.wgsl"

const WG = 64u;

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read_write> grid: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read> velocities: array<vec4f>;
@group(0) @binding(4) var<storage, read> affine0: array<vec4f>;
@group(0) @binding(5) var<storage, read> affine1: array<vec4f>;
@group(0) @binding(6) var<storage, read> affine2: array<vec4f>;
@group(0) @binding(7) var<storage, read> cell_start: array<u32>;

fn add_node(node: u32, w: f32, q: vec3f) {
  atomicAdd(&grid[node], mpm_to_fixed(w));
  atomicAdd(&grid[node + 1u], mpm_to_fixed(q.x));
  atomicAdd(&grid[node + 2u], mpm_to_fixed(q.y));
  atomicAdd(&grid[node + 3u], mpm_to_fixed(q.z));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let item = gid.x + gid.y * (groups.x * WG);
  let cell = item / 9u;
  let row = item % 9u;
  let cells = P.dims - vec3u(2u);
  if (cell >= cells.x * cells.y * cells.z) {
    return;
  }
  let first = cell_start[cell];
  let last = cell_start[cell + 1u];
  if (first == last) {
    return;
  }
  let dims = vec3i(P.dims);
  let cbase = vec3i(i32(cell % cells.x), i32((cell / cells.x) % cells.y), i32(cell / (cells.x * cells.y)));
  let k = i32(row / 3u);
  let j = i32(row % 3u);

  var a0 = vec4f(0.0);
  var a1 = vec4f(0.0);
  var a2 = vec4f(0.0);
  for (var p = first; p < last; p++) {
    let g = positions[p].xyz * P.inv_h;
    let base = clamp(vec3i(floor(g - vec3f(0.5))), vec3i(0), dims - vec3i(3));
    let v = velocities[p].xyz;
    let C = mat3x3f(affine0[p].xyz, affine1[p].xyz, affine2[p].xyz);
    let fx = g - vec3f(base);
    let W = mpm_weight_matrix(fx);
    if (any(base != cbase)) {
      // A stray: the first row adds its whole stencil.
      if (row == 0u) {
        for (var kk = 0; kk < 3; kk++) {
          for (var jj = 0; jj < 3; jj++) {
            for (var ii = 0; ii < 3; ii++) {
              let w = W[ii].x * W[jj].y * W[kk].z;
              let d = (vec3f(f32(ii), f32(jj), f32(kk)) - fx) * P.h;
              let node = u32(((base.z + kk) * dims.y + (base.y + jj)) * dims.x + (base.x + ii)) * 4u;
              add_node(node, w, w * (v + C * d));
            }
          }
        }
      }
      continue;
    }
    let wyz = W[j].y * W[k].z;
    let dyz = vec3f(0.0, f32(j) - fx.y, f32(k) - fx.z) * P.h;
    let w0 = W[0].x * wyz;
    let w1 = W[1].x * wyz;
    let w2 = W[2].x * wyz;
    a0 += vec4f(w0, w0 * (v + C * (dyz + vec3f(-fx.x * P.h, 0.0, 0.0))));
    a1 += vec4f(w1, w1 * (v + C * (dyz + vec3f((1.0 - fx.x) * P.h, 0.0, 0.0))));
    a2 += vec4f(w2, w2 * (v + C * (dyz + vec3f((2.0 - fx.x) * P.h, 0.0, 0.0))));
  }
  let node = u32(((cbase.z + k) * dims.y + (cbase.y + j)) * dims.x + cbase.x) * 4u;
  add_node(node, a0.x, a0.yzw);
  add_node(node + 4u, a1.x, a1.yzw);
  add_node(node + 8u, a2.x, a2.yzw);
}
`,de=`// mpm-p2g2.wgsl -- P2G, pass 2 of an MLS-MPM step (src/gpu/sim/mpm.ts): the fluid stress.
//
// DENSITY. The mass the first pass left on the grid is gathered back to each particle with the same weights,
//     rho_p / rho_0 = r = (sum_i w_ip m_i) / rest_ppc,
// where rest_ppc is the number of particles per cell at rest (a cell holds 8 particles of mass 1 at rest density,
// so 8 grid-mass units per cell volume ARE rho_0), corrected for the container walls (below). The ratio r is stored in affine0.w for the next pass (foam)
// and for the density view.
//
// WALLS. Near a wall the gather sees less mass (the fluid stops there) and r reads low, which would let the fluid
// pile up against it. The mass a fluid at exactly rest density would leave on node i is rest_ppc * F_i, where F_i is the
// share of the node's B-spline kernel inside the container (a product of three one-dimensional shares, each a cubic
// polynomial: mpm_kernel_above). Gathering that with the particle's weights gives the density a particle would read in
// a perfectly filled box; r is divided by it. Away from the walls it is exactly 1. The free surface is left alone: its
// deficit is real (there is no fluid beyond it) and gives the zero-pressure boundary condition.
//
// STRESS. Tait equation of state with negative pressure clamped,
//     p / rho_0 = (c^2 / gamma) (r^gamma - 1),     p >= -tension c^2 / gamma,
// whose small-compression sound speed is exactly c; plus the viscous stress of a Newtonian fluid, 2 mu D with the
// symmetric part of the velocity gradient D = (C + C^T) / 2 (the APIC matrix C is the gradient). The particle's
// volume is V = V_0 / r, so with unit mass V p = (p / rho_0) / r and V mu = nu / r (nu = kinematic viscosity). The
// MLS-MPM momentum change of node i from particle p (Hu et al. 2018, eq. 29) is
//     dq_i = w_ip (4 / h^2) dt (V p I - V 2 mu D) (x_i - x_p)
// and is added to the node's momentum, again with fixed-point atomics. Compression pushes the node away from the
// particle; tension pulls it in. Bindings: 1 uniform and 5 storage buffers.

#include "mpm-params.wgsl"
#include "mpm-core.wgsl"

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read_write> grid: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> affine0: array<vec4f>;
@group(0) @binding(4) var<storage, read> affine1: array<vec4f>;
@group(0) @binding(5) var<storage, read> affine2: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x;
  if (p >= P.count) {
    return;
  }
  let x = positions[p].xyz;
  let a0 = affine0[p];
  let C = mat3x3f(a0.xyz, affine1[p].xyz, affine2[p].xyz);

  let dims = vec3i(P.dims);
  let g = x * P.inv_h;
  let base = clamp(vec3i(floor(g - vec3f(0.5))), vec3i(0), dims - vec3i(3));
  let fx = g - vec3f(base);
  let W = mpm_weight_matrix(fx);

  // Density from the grid mass.
  var mass = 0.0;
  for (var k = 0; k < 3; k++) {
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        let w = W[i].x * W[j].y * W[k].z;
        let node = u32(((base.z + k) * dims.y + (base.y + j)) * dims.x + (base.x + i)) * 4u;
        mass += w * mpm_from_fixed(atomicLoad(&grid[node]));
      }
    }
  }
  // Walls: a fluid at rest density filling the container gives each node rest_ppc times the share of its kernel
  // inside the walls, so dividing by the same share seen from this particle removes the deficit near them.
  var fill = 1.0;
  if (P.wall_comp != 0u) {
    let lo = P.bounds_min * P.inv_h;
    let hi = P.bounds_max * P.inv_h;
    for (var axis = 0; axis < 3; axis++) {
      var share = 0.0;
      for (var o = 0; o < 3; o++) {
        let node = f32(base[axis] + o);
        let inside = mpm_kernel_above(lo[axis] - node) - mpm_kernel_above(hi[axis] - node);
        share += W[o][axis] * inside;
      }
      fill *= share;
    }
  }
  let r = clamp(mass / (P.rest_ppc * max(fill, 0.05)), 0.0, 64.0);
  affine0[p] = vec4f(a0.xyz, r);

  // Pressure per rest density, clamped from above (r_max keeps the impulses inside the fixed-point range)
  // and from below (tension).
  let c2g = P.sound_speed * P.sound_speed / P.gamma;
  let rc = clamp(r, 0.001, P.r_max);
  let pressure = max(c2g * (pow(rc, P.gamma) - 1.0), -P.tension * c2g);
  let inv_r = 1.0 / max(rc, 0.25);
  let scale = 4.0 * P.inv_h * P.inv_h * P.dt;
  let strain = (C + transpose(C)) * P.viscosity;       // 2 nu D

  for (var k = 0; k < 3; k++) {
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        let w = W[i].x * W[j].y * W[k].z;
        let d = (vec3f(f32(i), f32(j), f32(k)) - fx) * P.h;
        let dq = (w * scale * inv_r) * (pressure * d - strain * d);
        let node = u32(((base.z + k) * dims.y + (base.y + j)) * dims.x + (base.x + i)) * 4u;
        atomicAdd(&grid[node + 1u], mpm_to_fixed(dq.x));
        atomicAdd(&grid[node + 2u], mpm_to_fixed(dq.y));
        atomicAdd(&grid[node + 3u], mpm_to_fixed(dq.z));
      }
    }
  }
}
`,fe=`// mpm-p2g2s.wgsl -- the scatter half of P2G pass 2 for particles sorted by cell (the \`sorted\` mode of
// src/gpu/sim/mpm.ts): the stress impulses of mpm-p2g2.wgsl (read its header for the equation of state, the
// viscous stress and the walls), added per row of a cell as mpm-p2g1s.wgsl adds mass and momentum (read its header
// for the layout and the strays). The densities were gathered by mpm-density.wgsl and sit in affine0.w.
//
// Bindings: 1 uniform and 5 storage buffers.

#include "mpm-params.wgsl"
#include "mpm-core.wgsl"

const WG = 64u;

@group(0) @binding(0) var<uniform> P: MpmParams;
@group(0) @binding(1) var<storage, read_write> grid: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read> affine0: array<vec4f>;
@group(0) @binding(4) var<storage, read> affine1: array<vec4f>;
@group(0) @binding(5) var<storage, read> affine2: array<vec4f>;
@group(0) @binding(6) var<storage, read> cell_start: array<u32>;

fn add_momentum(node: u32, q: vec3f) {
  atomicAdd(&grid[node + 1u], mpm_to_fixed(q.x));
  atomicAdd(&grid[node + 2u], mpm_to_fixed(q.y));
  atomicAdd(&grid[node + 3u], mpm_to_fixed(q.z));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let item = gid.x + gid.y * (groups.x * WG);
  let cell = item / 9u;
  let row = item % 9u;
  let cells = P.dims - vec3u(2u);
  if (cell >= cells.x * cells.y * cells.z) {
    return;
  }
  let first = cell_start[cell];
  let last = cell_start[cell + 1u];
  if (first == last) {
    return;
  }
  let dims = vec3i(P.dims);
  let cbase = vec3i(i32(cell % cells.x), i32((cell / cells.x) % cells.y), i32(cell / (cells.x * cells.y)));
  let k = i32(row / 3u);
  let j = i32(row % 3u);

  let c2g = P.sound_speed * P.sound_speed / P.gamma;
  let scale = 4.0 * P.inv_h * P.inv_h * P.dt;
  var q0 = vec3f(0.0);
  var q1 = vec3f(0.0);
  var q2 = vec3f(0.0);
  for (var p = first; p < last; p++) {
    let g = positions[p].xyz * P.inv_h;
    let base = clamp(vec3i(floor(g - vec3f(0.5))), vec3i(0), dims - vec3i(3));
    let a0 = affine0[p];
    let C = mat3x3f(a0.xyz, affine1[p].xyz, affine2[p].xyz);
    let rc = clamp(a0.w, 0.001, P.r_max);
    let pressure = max(c2g * (pow(rc, P.gamma) - 1.0), -P.tension * c2g);
    let inv_r = 1.0 / max(rc, 0.25);
    let pressure_over_r = pressure * inv_r;
    let strain = (C + transpose(C)) * (P.viscosity * inv_r);
    let fx = g - vec3f(base);
    let W = mpm_weight_matrix(fx);
    if (any(base != cbase)) {
      if (row == 0u) {
        for (var kk = 0; kk < 3; kk++) {
          for (var jj = 0; jj < 3; jj++) {
            for (var ii = 0; ii < 3; ii++) {
              let w = W[ii].x * W[jj].y * W[kk].z;
              let d = (vec3f(f32(ii), f32(jj), f32(kk)) - fx) * P.h;
              let node = u32(((base.z + kk) * dims.y + (base.y + jj)) * dims.x + (base.x + ii)) * 4u;
              add_momentum(node, (w * scale) * (pressure_over_r * d - strain * d));
            }
          }
        }
      }
      continue;
    }
    let wyz = W[j].y * W[k].z * scale;
    let dyz = vec3f(0.0, f32(j) - fx.y, f32(k) - fx.z) * P.h;
    let d0 = dyz + vec3f(-fx.x * P.h, 0.0, 0.0);
    let d1 = dyz + vec3f((1.0 - fx.x) * P.h, 0.0, 0.0);
    let d2 = dyz + vec3f((2.0 - fx.x) * P.h, 0.0, 0.0);
    q0 += (W[0].x * wyz) * (pressure_over_r * d0 - strain * d0);
    q1 += (W[1].x * wyz) * (pressure_over_r * d1 - strain * d1);
    q2 += (W[2].x * wyz) * (pressure_over_r * d2 - strain * d2);
  }
  let node = u32(((cbase.z + k) * dims.y + (cbase.y + j)) * dims.x + cbase.x) * 4u;
  add_momentum(node, q0);
  add_momentum(node + 4u, q1);
  add_momentum(node + 8u, q2);
}
`,A=1048576;2147483520/A;var j=2048,M=d(`MpmParams`,{dims:`vec3u`,count:`u32`,h:`f32`,inv_h:`f32`,dt:`f32`,rest_ppc:`f32`,gravity:`vec3f`,sound_speed:`f32`,gamma:`f32`,viscosity:`f32`,tension:`f32`,max_speed:`f32`,bounds_min:`vec3f`,friction:`f32`,bounds_max:`vec3f`,r_max:`f32`,wall_vmin:`vec3f`,collider_count:`u32`,wall_vmax:`vec3f`,scalar_mode:`u32`,foam:`vec4f`,foam_decay:`f32`,wall_comp:`u32`,damping_factor:`f32`,colliders:f(`vec4f`,24)}),N={gravity:[0,-9.8,0],soundSpeed:12,gamma:7,viscosity:0,tension:0,densityLimit:1.8,maxSpeed:10,dt:0,courant:.5,viscosityLimit:.1,maxSteps:64,wallCourant:.4,wallFriction:0,damping:0,wallCompensation:!0,particlesPerCell:8,foam:{sprayLow:.2,sprayHigh:.45,speedLow:3,speedHigh:7,decayPerSecond:1.5},scalar:`foam`,sorted:!0,sortEvery:1,profileSteps:1},pe=[`clear`,`sort`,`p2g1`,`p2g2`,`grid`,`g2p`],me={clear:1,p2g1:6,p2g1s:7,p2g2:5,density:3,p2g2s:6,grid:2,g2p:7},P={clear:`mpm clear`,sort:`mpm sort`,p2g1:`mpm p2g 1`,p2g2:`mpm p2g 2`,grid:`mpm grid`,g2p:`mpm g2p`},he=1<<22,F=(e,t,n)=>Math.min(n,Math.max(t,e));function ge(e,t){let{maxSpeed:n,courant:r}=t,i=e,a=Math.max(t.soundSpeed,1),o=r*i/(a+n),s=t.dt>0?t.dt:o,c=a,l=t.soundSpeed<1;if(s>o){let e=r*i/s-n;e>=1?c=Math.min(a,e):(c=1,s=r*i/(1+n)),l=!0}let u=t.viscosityLimit*i*i/s,d=F(t.viscosity,0,u);return d<t.viscosity&&(l=!0),{dt:s,soundSpeed:c,viscosity:d,stepsPerSecond:1/s,clamped:l,stableDt:r*i/(c+n)}}function _e(e,t,n=24301){let r=_(n),i=(e.jitter??.15)*t,a=[],o=[];if(e.shape===`box`)for(let t=0;t<3;t++)a.push(e.min[t]),o.push(e.max[t]);else for(let t=0;t<3;t++)a.push(e.center[t]-e.radius),o.push(e.center[t]+e.radius);let s=[0,1,2].map(e=>Math.max(0,Math.floor((o[e]-a[e])/t+1e-6))),c=[];for(let n=0;n<s[2];n++)for(let l=0;l<s[1];l++)for(let u=0;u<s[0];u++){let d=[u,l,n].map((e,n)=>a[n]+(o[n]-a[n]-s[n]*t)/2+(e+.5)*t+(r()*2-1)*i);e.shape===`sphere`&&Math.hypot(d[0]-e.center[0],d[1]-e.center[1],d[2]-e.center[2])>e.radius||c.push(d[0],d[1],d[2],0)}return new Float32Array(c)}function ve(e,t,n){let[r,i,a]=n,o=Math.abs(i)>.99?[1,0,0]:[0,1,0],s=i*o[2]-a*o[1],c=a*o[0]-r*o[2],l=r*o[1]-i*o[0],u=Math.hypot(s,c,l)||1;s/=u,c/=u,l/=u;let d=i*l-a*c,f=a*s-r*l,p=r*c-i*s,m=[],h=Math.ceil(e/t);for(let n=-h;n<=h;n++)for(let r=-h;r<=h;r++){let i=(n+.5*(r&1))*t,a=r*t*.8660254;Math.hypot(i,a)>e||m.push(s*i+d*a,c*i+f*a,l*i+p*a)}return m}function ye(e){return typeof e==`string`?e.endsWith(`u`)||e===`u32`?`u32`:e.endsWith(`i`)||e===`i32`?`i32`:`f32`:`f32`}function be(e){let{device:t,profiler:i=r,label:a=`mpm`}=e,o=typeof e.grid==`number`?[e.grid,e.grid,e.grid]:[e.grid[0],e.grid[1],e.grid[2]];for(let e of o)if(!Number.isInteger(e)||e<8)throw RangeError(`${a}: grid sizes must be integers of at least 8, got ${o.join(`x`)}`);let s=o[0]*o[1]*o[2],c=s*16,l=Math.min(t.limits.maxStorageBufferBindingSize,t.limits.maxBufferSize);if(c>l)throw RangeError(`${a}: a ${o.join(`x`)} grid needs ${c} bytes per buffer (16 per node), over the device limit of ${l}`);if(t.limits.maxStorageBuffersPerShaderStage<Math.max(...Object.values(me)))throw RangeError(`${a}: the device allows ${t.limits.maxStorageBuffersPerShaderStage} storage buffers per stage, the solver needs ${Math.max(...Object.values(me))}`);let u=e.cellSize??1/Math.max(...o);if(!(u>0))throw RangeError(`${a}: cellSize must be positive, got ${u}`);let d=[o[0]*u,o[1]*u,o[2]*u],f=e.workgroupSize??64,p=e.gridWorkgroupSize??64,m=65535*f,g={...N,...e.material,...e.params,foam:{...N.foam,...e.params?.foam}},b=e.radiusScale??.7,x=()=>u/Math.cbrt(Math.max(g.particlesPerCell,.5)),S=()=>u*u*u/Math.max(g.particlesPerCell,.5),C=Math.floor(e.capacity);if(C>m||C>he)throw RangeError(`${a}: ${C} particles exceed what one dispatch of workgroup size ${f} covers (${m})`);let w=y({device:t,capacity:C,radius:b*x(),extras:{affine0:4,affine1:4,affine2:4,aux:1},profiler:i,label:`${a} particles`}),ee={get positions(){return w.particles.positions},get velocities(){return w.particles.velocities},get count(){return w.count},get capacity(){return w.capacity},get radius(){return w.radius},get restVolume(){return S()},get generation(){return w.generation}},T=t.createBuffer({label:`${a} grid (fixed point)`,size:c,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),E=t.createBuffer({label:`${a} grid velocity`,size:c,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),D=Math.ceil(M.size/256)*256,te=D*j,O=new ArrayBuffer(te),ne={f32:new Float32Array(O),i32:new Int32Array(O),u32:new Uint32Array(O)},re=t.createBuffer({label:`${a} step ring`,size:te,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),k=t.createBuffer({label:`${a} params`,size:D,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),be=0,I=new Map(M.layout.map(e=>[e.name,e]));function L(e,t,n){let r=I.get(t);if(!r)throw TypeError(`${a}: no uniform field "${t}"`);let i=ye(r.type),o=ne[i],s=e*D+r.offset>>2;if(typeof n==`number`)o[s]=n;else for(let e=0;e<n.length;e++)o[s+e]=n[e]}let R=2*u,xe=[R,R,R],z=[d[0]-R,d[1]-R,d[2]-R],Se=(e,t)=>{let n=[0,0,0],r=[0,0,0];for(let i=0;i<3;i++)n[i]=F(e[i],xe[i],z[i]-4*u),r[i]=F(t[i],n[i]+4*u,z[i]);return{min:n,max:r}},B=Se(e.bounds?.min??xe,e.bounds?.max??z),V={min:[...B.min],max:[...B.max]},Ce=[],H,U=0,we=0,Te={steps:0,updates:0},Ee,De=``,W=ge(u,g),Oe=!1,ke=_(5066829),Ae={on:!1},je={pass:e=>Ae.on?i.pass(e):void 0},G=new Map,Me={clear:{code:ie,file:`sim/mpm-clear.wgsl`,workgroup:p,label:P.clear},p2g1:{code:le,file:`sim/mpm-p2g1.wgsl`,workgroup:f,label:P.p2g1},p2g1s:{code:ue,file:`sim/mpm-p2g1s.wgsl`,workgroup:p,label:P.p2g1},p2g2:{code:de,file:`sim/mpm-p2g2.wgsl`,workgroup:f,label:P.p2g2},density:{code:ce,file:`sim/mpm-density.wgsl`,workgroup:f,label:P.p2g2},p2g2s:{code:fe,file:`sim/mpm-p2g2s.wgsl`,workgroup:p,label:P.p2g2},grid:{code:se,file:`sim/mpm-grid.wgsl`,workgroup:p,label:P.grid},g2p:{code:oe,file:`sim/mpm-g2p.wgsl`,workgroup:f,label:P.g2p}},Ne={"mpm-params.wgsl":M.wgsl,"mpm-core.wgsl":ae};function Pe(e){let n=G.get(e);if(!n){let r=Me[e];n=h(t,{label:r.file,code:r.code.replaceAll(`@workgroup_size(64)`,`@workgroup_size(${r.workgroup})`).replaceAll(`const WG = 64u;`,`const WG = ${r.workgroup}u;`),chunks:Ne,workgroupSize:r.workgroup,profiler:je,timestamp:r.label}),G.set(e,n)}return n}let K,Fe=0,q=-1,J=-1;function Ie(e){K??=v({device:t,mode:`reorder`,capacity:w.capacity,profiler:je,label:`mpm sort`}),K.configure({min:[.5*u,.5*u,.5*u],max:[(o[0]-1.5)*u,(o[1]-1.5)*u,(o[2]-1.5)*u],radius:u,cellSize:u}),K.build(e,w)}function Le(e){let t=w.attribute(`position`),n=w.attribute(`velocity`),r=w.attribute(`affine0`),i=w.attribute(`affine1`),a=w.attribute(`affine2`);switch(e){case`clear`:return[k,T];case`p2g1`:return[k,T,t,n,r,i,a];case`p2g1s`:return[k,T,t,n,r,i,a,K.buffers.cellStart];case`p2g2`:return[k,T,t,r,i,a];case`density`:return[k,T,t,r];case`p2g2s`:return[k,T,t,r,i,a,K.buffers.cellStart];case`grid`:return[k,T,E];case`g2p`:return[k,E,t,n,r,i,a,w.attribute(`aux`)]}}function Y(e,t){if(t===`sort`){if(!g.sorted||w.count===0)return;(K===void 0||Fe>=Math.max(1,Math.round(g.sortEvery))||w.count!==q||w.generation!==J)&&(Ie(e),Fe=0,q=w.count,J=w.generation),Fe++;return}let n=g.sorted&&K!==void 0;n&&t===`p2g2`?(X(e,`density`),X(e,`p2g2s`)):X(e,t===`p2g1`&&n?`p2g1s`:t)}function X(e,t){let n=Pe(t);if(t===`p2g1`||t===`p2g2`||t===`density`||t===`g2p`){n.runCount(e,Le(t),w.count);return}if(w.count===0&&(t===`p2g1s`||t===`p2g2s`))return;let r=t===`p2g1s`||t===`p2g2s`?(o[0]-2)*(o[1]-2)*(o[2]-2)*9:s,i=Math.ceil(r/Me[t].workgroup),a=Math.min(i,32768),c=Math.ceil(i/a);n.runGroups(e,Le(t),[a,c,1])}function Z(){return g.scalar===`speed`?1:g.scalar===`density`?2:0}function Re(e,t,n,r,i,a,s){L(e,`dims`,o),L(e,`count`,w.count),L(e,`h`,u),L(e,`inv_h`,1/u),L(e,`dt`,t),L(e,`rest_ppc`,Math.max(g.particlesPerCell,.5)),L(e,`gravity`,g.gravity),L(e,`sound_speed`,n.soundSpeed),L(e,`gamma`,F(g.gamma,1,10)),L(e,`viscosity`,n.viscosity),L(e,`tension`,F(g.tension,0,1)),L(e,`max_speed`,g.maxSpeed),L(e,`bounds_min`,r.min),L(e,`friction`,F(g.wallFriction,0,1)),L(e,`bounds_max`,r.max),L(e,`r_max`,F(g.densityLimit,1.05,6)),L(e,`wall_vmin`,i),L(e,`wall_vmax`,a),L(e,`scalar_mode`,Z()),L(e,`foam`,[g.foam.sprayLow,g.foam.sprayHigh,g.foam.speedLow,g.foam.speedHigh]),L(e,`foam_decay`,Math.exp(-g.foam.decayPerSecond*t)),L(e,`wall_comp`,+!!g.wallCompensation),L(e,`damping_factor`,Math.exp(-Math.max(g.damping,0)*t));let c=Ce.slice(0,8);L(e,`collider_count`,c.length);let l=[];for(let e of c){let t=e.velocity??[0,0,0],n=F(e.friction??0,0,1),[r,i,a]=e.center,o=s,c=[r+t[0]*o,i+t[1]*o,a+t[2]*o];if(e.shape===`sphere`)l.push(...c,1,e.radius??.1,0,0,n);else if(e.shape===`box`){let t=e.halfExtent??[.1,.1,.1];l.push(...c,2,t[0],t[1],t[2],n)}else{let t=e.normal??[0,1,0],r=Math.hypot(t[0],t[1],t[2])||1;l.push(...c,3,t[0]/r,t[1]/r,t[2]/r,n)}l.push(t[0],t[1],t[2],0)}L(e,`colliders`,l)}function ze(e,n,r,i,o){if(n>2048)throw RangeError(`${a}: ${n} steps exceed the ${j} that one submit can hold`);be+n>2048&&(be=0);let s=be;be+=n;let c=F(g.wallCourant,.01,.9)*u*n,l={min:[0,0,0],max:[0,0,0]};for(let e=0;e<3;e++)l.min[e]=F(V.min[e]-B.min[e],-c,c),l.max[e]=F(V.max[e]-B.max[e],-c,c);let d=n*o,f=[l.min[0]/d,l.min[1]/d,l.min[2]/d],p=[l.max[0]/d,l.max[1]/d,l.max[2]/d],m=l.min.some(e=>e!==0)||l.max.some(e=>e!==0);for(let e=0;e<n;e++){let t=(e+1)/n,r={min:[0,1,2].map(e=>B.min[e]+l.min[e]*t),max:[0,1,2].map(e=>B.max[e]+l.max[e]*t)};Re(s+e,o,W,r,f,p,(e+1)*o)}t.queue.writeBuffer(re,s*D,O,s*D,n*D);for(let t=0;t<n;t++){e.copyBufferToBuffer(re,(s+t)*D,k,0,D),Ae.on=t<i;for(let t of r)Y(e,t)}Ae.on=!1,m&&(B={min:[0,1,2].map(e=>B.min[e]+l.min[e]),max:[0,1,2].map(e=>B.max[e]+l.max[e])});for(let e of Ce){let t=e.velocity;t&&(e.center=[e.center[0]+t[0]*d,e.center[1]+t[1]*d,e.center[2]+t[2]*d])}we+=d,Te.steps+=n}function Be(e){if(!H||!H.active||e<=0||H.speed<=0)return;let t=x(),n=t/H.speed,[r,i,a]=H.direction,o=Math.hypot(r,i,a)||1,s=[r/o,i/o,a/o];U+=e;let c=ve(H.radius,t,s),l=[],u=[],d=0;for(;U>=n&&d<64;){U-=n,d++;let e=U*H.speed;for(let n=0;n<c.length;n+=3){let r=(ke()-.5)*.2*t,i=(ke()-.5)*.2*t,a=(ke()-.5)*.2*t;l.push(H.position[0]+c[n]+s[0]*e+r,H.position[1]+c[n+1]+s[1]*e+i,H.position[2]+c[n+2]+s[2]*e+a,0),u.push(s[0]*H.speed,s[1]*H.speed,s[2]*H.speed,0)}}l.length>0&&Ve(new Float32Array(l),new Float32Array(u))}function Ve(e,n){let r=w.count,i=Math.min(e.length/4,w.capacity-r);return i<=0?0:(w.setCount(r+i),q=-1,t.queue.writeBuffer(w.attribute(`position`),r*16,e,0,i*4),n&&t.queue.writeBuffer(w.attribute(`velocity`),r*16,n,0,i*4),i)}function Q(e){let t=_e(e,x(),24301+w.count),n=new Float32Array(t.length),r=e.velocity;if(r&&(r[0]!==0||r[1]!==0||r[2]!==0))for(let e=0;e<t.length;e+=4)n[e]=r[0],n[e+1]=r[1],n[e+2]=r[2];return Ve(t,n)}function $(e){B=Se(e.min??B.min,e.max??B.max),V={min:[...B.min],max:[...B.max]}}async function He(e,n){let r=t.createBuffer({label:`${a} readback`,size:n,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),i=t.createCommandEncoder();i.copyBufferToBuffer(e,0,r,0,n),t.queue.submit([i.finish()]),await r.mapAsync(GPUMapMode.READ);let o=r.getMappedRange().slice(0);return r.unmap(),r.destroy(),o}return{device:t,system:w,particles:ee,params:g,get effective(){return W},dims:o,cellSize:u,get spacing(){return x()},size:d,get bounds(){return B},get capacity(){return w.capacity},get count(){return w.count},get generation(){return w.generation},get time(){return we},stats:Te,gridBytes:c,update(e,t){W=ge(u,g);let r=Math.max(1,Math.round(g.maxSteps)),i=`${W.dt}|${r}`;(!Ee||i!==De)&&(Ee=n(W.dt,{maxSteps:r}),De=i),Te.updates++;let{steps:a}=Ee.advance(t),o=Math.max(0,t)/W.dt>r+1;return Be(a*W.dt),a>0&&ze(e,a,pe,Math.max(0,Math.round(g.profileSteps)),W.dt),{steps:a,behind:o}},step(e,t={}){W=ge(u,g),ze(e,Math.max(1,Math.round(t.count??1)),t.passes??pe,+!!t.timed,W.dt)},setBounds(e){V=Se(e.min??V.min,e.max??V.max)},jumpBounds:$,setColliders(e){Ce=e.slice(0,8).map(e=>({...e}))},addBlock:Q,addParticles:Ve,setPour(e){H=e?{...e}:void 0,e||(U=0)},reset(e={}){w.setCount(0),q=-1,we=0,U=0,Ee=void 0,$(e.bounds??{min:B.min,max:B.max}),e.gravity&&(g.gravity=e.gravity),Ce=(e.colliders??[]).slice(0,8).map(e=>({...e})),H=e.pour?{...e.pour}:void 0;for(let t of e.blocks??[])Q(t);w.radius=b*x()},setCapacity(e){let t=Math.floor(e);if(t>m||t>he)throw RangeError(`${a}: ${t} particles exceed the dispatch limit of ${m}`);w.resize(t)},async readGrid(){let e=new Int32Array(await He(T,c)),t=new Float32Array(s),n=new Float32Array(s*3);for(let r=0;r<s;r++)t[r]=e[r*4]/A,n[r*3]=e[r*4+1]/A,n[r*3+1]=e[r*4+2]/A,n[r*3+2]=e[r*4+3]/A;return{mass:t,momentum:n}},async readGridVelocity(){return new Float32Array(await He(E,c))},destroy(){if(!Oe){Oe=!0;for(let e of G.values())e.destroy();K?.destroy(),w.destroy(),T.destroy(),E.destroy(),re.destroy(),k.destroy()}}}}var I=`rgba16float`,L=`depth32float`,R=[`wave tank`,`dam break`,`pour`],xe=[`liquid`,`spheres`,`speed`,`density`],z=[`48`,`64`,`96`,`128`],Se=[`clear`,`coastal`,`murky`,`tea`,`milk`,`pool`,`ocean`,`custom`],B={1:1,"1/2":.5,"1/4":.25},V={"1/2":.5,"1/4":.25,"1/8":.125},Ce=3.2,H=1.4,U=1.4,we=[.5,.7,.35],Te={sunDirection:we,sunColor:[1,.95,.85],sunIntensity:1.5,skyColor:[.5,.65,.9],groundColor:[.3,.28,.25],horizonColor:[.6,.72,.85],ambient:.5,fogDensity:.012},Ee=40*Math.PI/180,De=60*Math.PI/180,W=Math.PI/180,Oe=7,ke=1.25,Ae=60,je=d(`MpmScene`,{tank_min:`vec2f`,tank_max:`vec2f`,floor_y:`f32`,tile:`f32`}),G=(e,t,n)=>Math.min(n,Math.max(t,e)),Me=e=>{let t=G(e,0,1);return t*t*(3-2*t)};function Ne(e,t,n){let r=n/2,i=Math.hypot(t,e),a=-t/i,o=e/i,s=[],c=[],l=(e,t)=>{let n=s.length/6;for(let n of e)s.push(n[0],n[1],n[2],t[0],t[1],t[2]);c.push(n,n+1,n+2),e.length===4&&c.push(n,n+2,n+3)};return l([[0,0,-r],[0,0,r],[e,t,r],[e,t,-r]],[a,o,0]),l([[e,0,-r],[e,t,-r],[e,t,r],[e,0,r]],[1,0,0]),l([[0,0,-r],[e,t,-r],[e,0,-r]],[0,0,-1]),l([[0,0,r],[e,0,r],[e,t,r]],[0,0,1]),{vertices:new Float32Array(s),indices:new Uint16Array(c),vertexCount:s.length/6,indexCount:c.length}}function Pe(e,t,n,r){let i=o(e,n,r,1),a=[t[0],t[1],t[2]],s=[i[0]-a[0],i[1]-a[1],i[2]-a[2]],c=Math.hypot(...s)||1;return{origin:a,dir:[s[0]/c,s[1]/c,s[2]/c]}}function K(e,t){if(Math.abs(e.dir[1])<.04)return null;let n=(t-e.origin[1])/e.dir[1];return n>0?n:null}function Fe(e,t,n){let r=0,i=1/0;for(let a=0;a<3;a++){let o=e.origin[a],s=e.dir[a];if(Math.abs(s)<1e-9){if(o<t[a]||o>n[a])return!1;continue}let c=(t[a]-o)/s,l=(n[a]-o)/s;if(c>l&&([c,l]=[l,c]),r=Math.max(r,c),i=Math.min(i,l),r>i)return!1}return!0}var q={frame:[.72,.75,.78],paddle:[.3,.36,.44],sand:[.8,.68,.44],pillar:[.78,.2,.12],wall:[.2,.5,.62],blob:[.95,.75,.2]};function J(e,t,n,r,i){let a=c.translation(t);return c.scale(a,n,a),{mesh:e,model:a,color:r,emissive:i}}function Ie(e,t,n,r,i){let a=.045,o=[],s=(t[0]+n[0])/2,c=(t[2]+n[2])/2,l=n[0]-t[0]+a,u=n[2]-t[2]+a;for(let d of[r,i]){for(let r of[t[2],n[2]])o.push(J(e,[s,d,r],[l,a,a],q.frame));for(let r of[t[0],n[0]])o.push(J(e,[r,d,c],[a,a,u],q.frame))}for(let s of[t[0],n[0]])for(let c of[t[2],n[2]])o.push(J(e,[s,(r+i)/2,c],[a,i-r,a],q.frame));return o}var Le=t({meta:e,params:{scene:{type:`select`,default:`wave tank`,options:R,label:`Scene (wave tank: a wall sends waves to a beach)`},restart:{type:`boolean`,default:!1,label:`Restart (flip to run the scene again)`},autoRestart:{type:`boolean`,default:!0,label:`Run the dam break and the pour again when they are done`},view:{type:`select`,default:`liquid`,options:xe,label:`View (liquid, or the particles: foam, speed, density)`},count:{type:`number`,default:1e5,min:1e4,max:8e5,step:5e3,label:`Particles (the more per cell, the smoother; restarts the scene)`},grid:{type:`select`,default:`48`,options:z,label:`Grid cells along the tank (restarts the scene)`},stiffness:{type:`number`,default:10,min:3,max:30,step:.5,label:`Stiffness (sound speed, m/s; limited by the step)`},substeps:{type:`number`,default:0,min:0,max:16,step:1,label:`Sub-steps per 1/60 s (0: the largest stable step; fewer reduce the stiffness)`},viscosity:{type:`number`,default:0,min:0,max:.2,step:.001,label:`Viscosity (m²/s; water is 1e-6, honey is ~0.1)`},damping:{type:`number`,default:.5,min:0,max:3,step:.01,label:`Damping (1/s): calms the slosh and the rest noise`},gravity:{type:`number`,default:9.8,min:0,max:20,step:.1,label:`Gravity (m/s²)`},waveMaker:{type:`number`,default:1,min:0,max:2,step:.01,label:`Wave maker stroke (wave tank)`},wavePeriod:{type:`number`,default:1.9,min:.8,max:5,step:.05,label:`Wave maker period (s)`},sorted:{type:`boolean`,default:!0,label:`Sort particles by cell (fewer atomics)`},particleRadius:{type:`number`,default:.75,min:.4,max:2,step:.01,label:`Drawn particle radius (x particle spacing)`},distance:{type:`number`,default:5.2,min:3,max:14,step:.1,label:`Camera distance`},smoothScale:{type:`select`,default:`1/2`,options:[`1`,`1/2`,`1/4`],label:`Surface smoothing resolution`},thicknessScale:{type:`select`,default:`1/4`,options:[`1/2`,`1/4`,`1/8`],label:`Thickness resolution`},thicknessStride:{type:`number`,default:1,min:1,max:8,step:1,label:`Thickness: draw every n-th particle`},filter:{type:`select`,default:`narrow-range`,options:T,label:`Depth filter`},filterRadius:{type:`number`,default:2.2,min:.25,max:6,step:.05,label:`Filter radius (particle radii)`},iterations:{type:`number`,default:3,min:1,max:6,step:1,label:`Filter iterations`},water:{type:`select`,default:`coastal`,options:Se,label:`Water type`},tint:{type:`color`,default:[.25,.62,.85],label:`Custom colour (after one unit of thickness)`},murk:{type:`number`,default:.1,min:0,max:3,step:.01,label:`Custom turbidity`},density:{type:`number`,default:3,min:.25,max:24,step:.05,label:`Density`},refraction:{type:`number`,default:1,min:0,max:3,step:.01,label:`Refraction`},foam:{type:`number`,default:.75,min:0,max:1,step:.01,label:`Foam`},exposure:{type:`number`,default:1,min:.3,max:2.5,step:.01},autoRotate:{type:`boolean`,default:!0,label:`Camera drifts when left alone`}},presets:{"wave tank":{scene:`wave tank`,view:`liquid`,gravity:9.8,viscosity:0},"dam break":{scene:`dam break`,view:`liquid`,gravity:9.8,viscosity:0},pour:{scene:`pour`,view:`liquid`,gravity:9.8,viscosity:0},"marbles (the spheres)":{view:`spheres`,particleRadius:.5},speed:{view:`speed`},density:{view:`density`},honey:{water:`custom`,tint:[.75,.4,.07],murk:.5,density:1.4,viscosity:.12,gravity:9.8,foam:0},"slow motion":{gravity:3,wavePeriod:3.2},"300 000 particles":{count:3e5,grid:`64`},"cheap cut":{count:4e4,grid:`48`,damping:1,smoothScale:`1/4`,thicknessScale:`1/8`,thicknessStride:2,iterations:1,filterRadius:1.4}},async create({device:e,format:t,canvas:n,params:r,profiler:o}){let d=b(n,{capture:!0}),f=D(e,{colorFormat:I,depthFormat:L}),h={box:O(e,re(),`mpm box`),sphere:O(e,ne({radius:1,widthSegments:32,heightSegments:16}),`mpm sphere`),wedge:O(e,Ne(1,1,1),`mpm wedge`)},_=f.createView(`mpm main`),v=i(e,{label:`mpm scene colour`,format:I,width:1,height:1}),y=a(e,{label:`mpm scene depth`,width:1,height:1,format:L}),ie=i(e,{label:`mpm liquid`,format:I,width:1,height:1}),ae=p(e,je,`mpm room`),oe=m(e,{label:`mpm-3d/scene.wgsl`,code:k,chunks:{...te,"mpm_scene.wgsl":je.wgsl}}),se=e.createBindGroupLayout({label:`mpm room layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),ce=e.createBindGroup({label:`mpm room`,layout:se,entries:[{binding:0,resource:{buffer:ae.buffer}}]}),le=e.createPipelineLayout({bindGroupLayouts:[f.viewLayout,se]}),ue=e.createRenderPipeline({label:`mpm sky`,layout:le,vertex:{module:oe,entryPoint:`fullscreen_vs`},fragment:{module:oe,entryPoint:`fs_sky`,targets:[{format:I}]},depthStencil:{format:L,depthWriteEnabled:!1,depthCompare:`always`}}),de=e.createRenderPipeline({label:`mpm floor`,layout:le,vertex:{module:oe,entryPoint:`vs_floor`},fragment:{module:oe,entryPoint:`fs_floor`,targets:[{format:I}]},depthStencil:{format:L,depthWriteEnabled:!0,depthCompare:`less`}}),fe=x(e,{format:t}),A=E({device:e,format:I,width:1,height:1}),j=g({device:e,format:t,depthFormat:L,profiler:o,style:{mode:`opaque`,minPixels:1,shading:1,scalarRange:[0,1],palette:[[.015,.14,.4],[.06,.4,.7],[.55,.85,1],[1,1,1]]}}),M,N,pe=``,me=``,P=r.restart,he=0,F=0;function ge(e){let t=Ce/(e-4);return[e,Math.ceil(U/t)+4,Math.ceil(H/t)+4]}function ve(){let t=Number(r.grid),n=Math.ceil((r.count*1.3+6e3)/1024)*1024;if(M&&me===`${t}`&&M.capacity>=n)return M;if(M&&me===`${t}`)return M.setCapacity(n),M;M?.destroy();let i=Ce/(t-4);return M=be({device:e,grid:ge(t),cellSize:i,capacity:n,profiler:o,radiusScale:.75,params:{courant:ke,maxSpeed:Oe}}),me=`${t}`,pe=``,M}function ye(e,t,n){let i=t.cellSize,a=2*i,o=[a,a,a],s=[t.size[0]-a,t.size[1]-a,t.size[2]-a],l=o[1],u=s[1],d=s[0]-o[0],f=s[2]-o[2],p=(o[2]+s[2])/2,m=[],g=[...Ie(h.box,o,s,l,u)],_,v=()=>!0,y=o,b,x,S=0,C,w=0,ee=null;if(e===`wave tank`){let e=.55,t=24*W,n=o[0]+.56*d,r=Math.tan(t)*(s[0]-n);m.push({shape:`plane`,center:[n,l,p],normal:[-Math.sin(t),Math.cos(t),0],friction:.3});let i=c.translation([n,l,p]);c.scale(i,[s[0]-n,r,f],i),g.push({mesh:h.wedge,model:i,color:q.sand}),b=[s[0],l+e,s[2]],v=(e,r)=>r-l>=(e-n)*Math.tan(t);let a=.5*e*e/Math.tan(t);_=(d*e-Math.min(a,e*(s[0]-n)))*f,x=e,C=o[0]}else if(e===`dam break`){let e=G(.7*(u-l),.8,1.1);b=[o[0]+.28*d,l+e,s[2]],_=(b[0]-o[0])*e*f;let t=[[.52,.42,-.22,.17,.42],[.66,.5,.2,.17,.5],[.84,.13,0,.1,f*.34]];for(let[e,n,r,i,a]of t){let t=[i,n,e===.84?a:i],s=[o[0]+e*d,l+n,p+r*f];m.push({shape:`box`,center:s,halfExtent:t,friction:.2}),g.push(J(h.box,s,[t[0]*2,t[1]*2,t[2]*2],e===.84?q.wall:q.pillar))}x=.35,S=22}else{let e=.3;b=[s[0],l+e,s[2]];let t=.085,r=3.2,i=Math.PI*t*t*r*8;_=d*e*f+i,ee={position:[o[0]+.3*d,Math.min(l+1.4,u-.3),p],direction:[0,-1,0],speed:r,radius:t,active:!0},w=n,x=e,S=20}let T=G(n*i*i*i/Math.max(_,.001),2,48);t.params.particlesPerCell=T,t.reset({bounds:{min:o,max:s},colliders:m,pour:ee});let E=_e({shape:`box`,min:y,max:b,jitter:.15},t.spacing),D=new Float32Array(E.length),te=0;for(let e=0;e<E.length;e+=4)v(E[e],E[e+1],E[e+2])&&(D.set(E.subarray(e,e+4),te*4),te++);return t.addParticles(D.subarray(0,te*4)),t.system.radius=t.spacing*r.particleRadius,{name:e,colliders:m,objects:g,level:x,loop:S,pistonRest:C,pourLimit:w,top:u,min:o,max:s}}let z=w({yaw:.62,pitch:.4,distance:5.2,target:[1.7,.4,.7]}),Le={...ee,minPitch:.22,maxPitch:1.35,autoSpeed:.1},Y=u(),X,Z,Re=0,ze=.2;function Be(e,t){if(!M||!N)return;let n=Pe(Y.invViewProj,Y.position,e,t),r=M.bounds.min[1]+N.level,i=K(n,r);if(i===null)return;let a=M.bounds,o=.12;return[G(n.origin[0]+n.dir[0]*i,a.min[0]+o,a.max[0]-o),r,G(n.origin[2]+n.dir[2]*i,a.min[2]+o,a.max[2]-o)]}function Ve(e){let t=d.poll(),n=0,i=0,a=!1;for(let r of t){if(!X&&r.justPressed&&M&&N){let e=Pe(Y.invViewProj,Y.position,r.x,r.y),t=M.bounds,n=Fe(e,[t.min[0]-.1,t.min[1]-.01,t.min[2]],[t.max[0],t.min[1]+N.level+.45,t.max[2]]);X={id:r.id,mode:n?`water`:`orbit`,travel:0,start:Re,lastX:r.x,lastY:r.y}}if(X&&r.id===X.id){if(X.travel+=Math.abs(r.dx)+Math.abs(r.dy),F=0,X.mode===`orbit`&&r.down)n+=r.dx,i+=r.dy,a=!0;else if(X.mode===`water`&&r.down&&X.travel>.012){let t=Be(r.x,r.y);if(t){let n=Z?.position??t,r=Math.max(e,1/240),i=[(t[0]-n[0])/r,(t[1]-n[1])/r,(t[2]-n[2])/r],a=Z?.velocity??[0,0,0],o=[0,1,2].map(e=>a[e]+(i[e]-a[e])*.5),s=Math.hypot(...o),c=s>4?4/s:1;Z={position:t,velocity:[o[0]*c,o[1]*c,o[2]*c],active:!0}}}if(r.justReleased||!r.down){if(X.mode===`water`&&!r.cancelled&&X.travel<.012&&Re-X.start<.5&&M&&N){let e=Be(r.x,r.y);e&&M.addBlock({shape:`sphere`,center:[e[0],e[1]+.32,e[2]],radius:.13,velocity:[0,-1.5,0]})}X=void 0,Z=void 0}}}X&&!t.some(e=>e.id===X.id)&&(X=void 0,Z=void 0);let o=r.autoRotate?Le:{...Le,autoSpeed:0};S(z,{yaw:a?-n*3:0,pitch:a?i*2:0,dragging:a},e,o)}let Q=1,$=1,He=0,Ue=0;function We(e){let t=Se.includes(r.water)?r.water:`coastal`,n=t===`custom`,i=r.tint.map(e=>G(e,.001,1)),a=e.particles.restVolume??1,o=e.particles.radius;return{surface:`smooth`,waterType:n?-1:Se.indexOf(t),absorption:[-Math.log(i[0]),-Math.log(i[1]),-Math.log(i[2])],scatter:[i[0]*.6,i[1]*.6,i[2]*.6],turbidity:r.murk,density:r.density,ior:1.333,refraction:r.refraction,roughness:.04,sunDirection:we,thicknessGain:a/(4/3*Math.PI*o*o*o),foamAmount:r.foam,maxRefractionThickness:1.2}}return{resize(e,t){Q=Math.max(1,Math.round(e)),$=Math.max(1,Math.round(t)),v.resize(Q,$),y.resize(Q,$),ie.resize(Q,$),A.resize(Q,$),j.resize(Q,$)},frame({delta:e},t,n){Re+=e,Ue+=e,F+=e,He++;let i=ve(),a=R.includes(r.scene)?r.scene:`wave tank`,u=`${a}|${r.grid}|${Math.round(r.count)}`,d=r.restart!==P;P=r.restart;let p=N!==void 0&&N.loop>0&&r.autoRestart&&he>N.loop&&F>5;(u!==pe||d||p||!N)&&(pe=u,he=0,N=ye(a,i,Math.round(r.count)),z.target=[(N.min[0]+N.max[0])/2,N.min[1]+.4,(N.min[2]+N.max[2])/2]),he+=e,Ve(e),z.distance=r.distance;let m=i.params;m.gravity=[0,-r.gravity,0],m.soundSpeed=r.stiffness,m.viscosity=r.viscosity,m.damping=r.damping,m.dt=r.substeps>=1?1/(Ae*Math.round(r.substeps)):0,m.sorted=r.sorted;let g=xe.includes(r.view)?r.view:`liquid`;if(m.scalar=g===`speed`?`speed`:g===`density`?`density`:`foam`,i.system.radius=i.spacing*r.particleRadius,N.pistonRest!==void 0){let e=Me(he/2.5),t=.4*r.waveMaker*e,n=N.pistonRest+t*.5*(1-Math.cos(2*Math.PI*Ue/r.wavePeriod));i.setBounds({min:[n,N.min[1],N.min[2]],max:N.max})}N.name===`pour`&&i.setPour({position:[N.min[0]+.3*(N.max[0]-N.min[0]),Math.min(N.min[1]+1.4,N.top-.3),(N.min[2]+N.max[2])/2],direction:[0,-1,0],speed:3.2,radius:.085,active:i.count<N.pourLimit});let b=[...N.colliders];Z?.active&&b.push({shape:`sphere`,center:Z.position,radius:ze,velocity:Z.velocity,friction:0}),i.setColliders(b),i.update(t,e);let x=Q/$;l({position:C(z),target:z.target,fovY:s(Ee,x,De),aspect:x,near:.1,far:120},Y);let S=i.bounds,w=[...N.objects],ee=.14;if(w.push(J(h.box,[S.min[0]-ee/2,(S.min[1]+N.top)/2,(S.min[2]+S.max[2])/2],[ee,N.top-S.min[1]+.02,S.max[2]-S.min[2]],q.paddle)),Z?.active){let e=c.translation(Z.position);c.scale(e,[ze,ze,ze],e),w.push({mesh:h.sphere,model:e,color:q.blob})}ae.set({tank_min:[N.min[0],N.min[2]],tank_max:[N.max[0],N.max[2]],floor_y:N.min[1],tile:.25}),ae.upload(),_.update(Y,Q,$,Te);let E=f.upload(w);f.draw(t,E,{view:_,color:v.view,depth:y.view,background:e=>{e.setBindGroup(1,ce),e.setPipeline(ue),e.setBindGroup(0,_.bindGroup),e.draw(3),e.setPipeline(de),e.draw(6)},label:`mpm scene pass`,timestampWrites:o.pass(`scene`)}),g===`liquid`?(A.setQuality({scale:B[r.smoothScale]??.5,thicknessScale:V[r.thicknessScale]??.25,thicknessStride:Math.round(r.thicknessStride),filter:T.includes(r.filter)?r.filter:`narrow-range`,filterRadius:r.filterRadius,iterations:Math.round(r.iterations)}),A.render(t,{particles:i.particles,camera:Y,sceneColor:v.view,sceneDepth:y.view,target:ie.view,params:We(i),profiler:o}),fe.encode(t,n,ie.view,void 0,{exposure:r.exposure,tonemap:`aces`,frame:He},o.pass(`output`))):(fe.encode(t,n,v.view,void 0,{exposure:r.exposure,tonemap:`aces`,frame:He},o.pass(`output`)),j.style.sizeScale=1,j.style.scalarRange=g===`speed`?[0,5]:g===`density`?[.3,1.4]:[0,1],j.draw(t,i.particles,Y,n,{width:Q,height:$,depth:y.view,clear:null,clearDepth:!1,scalar:g===`speed`||g===`density`?i.system.attribute(`aux`):void 0,timestamp:`particles draw`}))},destroy(){d.destroy(),M?.destroy(),A.destroy(),j.destroy(),fe.destroy(),v.destroy(),y.destroy(),ie.destroy(),ae.destroy(),_.destroy(),f.destroy();for(let e of Object.values(h))e.destroy()}}}});export{Le as effect};