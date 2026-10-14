import{n as e}from"./profiler-Bi27xYp-.js";import{n as t,r as n}from"./uniforms-BE1XSnDx.js";import{n as r}from"./billboards-BT_4dCEv.js";import"./particles-CwphI2WA.js";import{i,n as a,t as o}from"./system-Do33CVeV.js";var s=`// pbf-core.wgsl -- what every pass of the position-based fluid solver shares (story 7.4): the two uniform blocks,
// the container and the colliders, the analytic wall density and the pointer impulses. Included by the pbf-*.wgsl
// pass files, which declare their own storage bindings; \`pbf_params.wgsl\` is generated from the uniform structs in
// pbf.ts (PbfParams: one block per update, PbfStep: one block per sub-step).
//
// Bindings 0 and 1 are the same in every pass: params (all passes) and tick (the passes that need the container or
// the step length). See pbf.ts for the numbering of the rest.
//
// THE CONTAINER. An axis-aligned box [tick.bounds_min, tick.bounds_max], the inner surface of the glass. The centre of
// a particle may come no closer to a wall than params.wall_offset (half a particle spacing: a lattice of spacing s
// that fills the box has its outer layer s/2 from the glass). The box is part of the tick uniform because story 7.8
// moves it: a wall that advances pushes the particles in front of it by position projection, a wall that retreats
// leaves them to fall. The projection is a clamp, so a particle can never end a step outside the box, however far the
// wall moved or the particle was thrown.
//
// COLLIDERS. Up to 8 static spheres and boxes, two vec4 each: (centre or min, radius) and (max, kind), kind 1 sphere,
// 2 box, 0 unused. A particle inside one (grown by wall_offset) is pushed out along the shortest way.
//
// FRICTION. A contact removes up to \`friction * penetration depth\` of the particle's tangential displacement over the
// step (Coulomb's law with position-based quantities: the penetration depth stands in for the normal force). A particle
// that merely touches a wall slides freely; one pressed into it, as the bottom of a deep column is, is held back.
//
// WALL DENSITY. A wall hides the fluid that would be behind it, so a particle near a wall sees a density deficit that
// the solver would otherwise read as "free surface" and answer with an attraction towards the fluid. params carries two
// tables (33 samples, d = 0 .. h) computed on the CPU: the density of the missing half-space of fluid at distance d
// from the particle (an integral of Poly6 over the half-space, times the rest number density), and the gradient of the
// same with Spiky. pbf_wall_terms sums them over the walls (2 or 3 axes, both sides). It is exact for a flat wall and
// double counts a little in a corner.

#include "pbf-kernels.wgsl"
#include "pbf_params.wgsl"

@group(0) @binding(0) var<uniform> params: PbfParams;
@group(0) @binding(1) var<uniform> tick: PbfStep;

struct PbfWall {
  // Number density of the missing fluid beyond the walls, in the units of the kernel sums.
  density: f32,
  // Sum over the walls of the gradient of that density with respect to the particle, pointing at the wall.
  grad: vec3f,
}

fn pbf_table_density(d: f32) -> f32 {
  let x = clamp(d / params.h, 0.0, 1.0) * 32.0;
  let k = min(u32(x), 31u);
  let f = x - f32(k);
  let a = params.wall_density[k >> 2u][k & 3u];
  let b = params.wall_density[(k + 1u) >> 2u][(k + 1u) & 3u];
  return mix(a, b, f);
}

fn pbf_table_gradient(d: f32) -> f32 {
  let x = clamp(d / params.h, 0.0, 1.0) * 32.0;
  let k = min(u32(x), 31u);
  let f = x - f32(k);
  let a = params.wall_gradient[k >> 2u][k & 3u];
  let b = params.wall_gradient[(k + 1u) >> 2u][(k + 1u) & 3u];
  return mix(a, b, f);
}

fn pbf_wall_terms(p: vec3f) -> PbfWall {
  var out: PbfWall;
  out.density = 0.0;
  out.grad = vec3f(0.0);
  if (params.boundary_density == 0u) {
    return out;
  }
  let lo = p - tick.bounds_min;
  let hi = tick.bounds_max - p;
  for (var a = 0u; a < params.dimension; a++) {
    // Low wall: the missing fluid lies below, so the density grows as the particle moves down (towards -axis).
    if (lo[a] < params.h) {
      let d = max(lo[a], 0.0);
      out.density += pbf_table_density(d);
      out.grad[a] -= pbf_table_gradient(d);
    }
    if (hi[a] < params.h) {
      let d = max(hi[a], 0.0);
      out.density += pbf_table_density(d);
      out.grad[a] += pbf_table_gradient(d);
    }
  }
  return out;
}

// Pushes x along the unit normal n by \`depth\`, then removes up to friction * depth of the tangential part of the
// displacement since \`prev\` (where the particle was when the step began).
fn pbf_contact(x: vec3f, prev: vec3f, n: vec3f, depth: f32, friction: f32) -> vec3f {
  var out = x + n * depth;
  if (friction > 0.0) {
    let moved = out - prev;
    let tangential = moved - n * dot(moved, n);
    let len = length(tangential);
    if (len > 1e-9) {
      out -= tangential * min(1.0, friction * depth / len);
    }
  }
  return out;
}

// Keeps a particle inside the box and outside the colliders. \`friction_scale\` is 0 for the prediction (the particle
// has not yet been corrected) and 1 for the final position of an iteration.
fn pbf_contain(x_in: vec3f, prev: vec3f, friction_scale: f32) -> vec3f {
  var x = x_in;
  let o = params.wall_offset;
  let friction = params.friction * friction_scale;
  let lo = tick.bounds_min + vec3f(o);
  let hi = tick.bounds_max - vec3f(o);

  for (var c = 0u; c < params.collider_count; c++) {
    let a = params.colliders[c * 2u];
    let b = params.colliders[c * 2u + 1u];
    let kind = u32(b.w + 0.5);
    if (kind == 1u) {
      let d = x - a.xyz;
      let len = length(d);
      let reach = a.w + o;
      if (len < reach) {
        var n = vec3f(0.0, 1.0, 0.0);
        if (len > 1e-6) {
          n = d / len;
        }
        x = pbf_contact(x, prev, n, reach - len, friction);
      }
    } else if (kind == 2u) {
      let below = x - (a.xyz - vec3f(o));
      let above = (b.xyz + vec3f(o)) - x;
      var inside = below.x > 0.0 && above.x > 0.0 && below.y > 0.0 && above.y > 0.0;
      if (params.dimension == 3u) {
        inside = inside && below.z > 0.0 && above.z > 0.0;
      }
      if (inside) {
        // The face of least penetration (the z faces do not exist in 2D).
        var best = below.x;
        var n = vec3f(-1.0, 0.0, 0.0);
        if (above.x < best) { best = above.x; n = vec3f(1.0, 0.0, 0.0); }
        if (below.y < best) { best = below.y; n = vec3f(0.0, -1.0, 0.0); }
        if (above.y < best) { best = above.y; n = vec3f(0.0, 1.0, 0.0); }
        if (params.dimension == 3u) {
          if (below.z < best) { best = below.z; n = vec3f(0.0, 0.0, -1.0); }
          if (above.z < best) { best = above.z; n = vec3f(0.0, 0.0, 1.0); }
        }
        x = pbf_contact(x, prev, n, best, friction);
      }
    }
  }

  // The walls last, so that nothing a collider did can leave the box. A box narrower than twice the offset
  // collapses to its middle instead of inverting.
  let mid = (tick.bounds_min + tick.bounds_max) * 0.5;
  let lo_c = min(lo, mid);
  let hi_c = max(hi, mid);
  for (var a = 0u; a < params.dimension; a++) {
    if (x[a] < lo_c[a]) {
      var n = vec3f(0.0);
      n[a] = 1.0;
      x = pbf_contact(x, prev, n, lo_c[a] - x[a], friction);
    } else if (x[a] > hi_c[a]) {
      var n = vec3f(0.0);
      n[a] = -1.0;
      x = pbf_contact(x, prev, n, x[a] - hi_c[a], friction);
    }
  }
  // Friction moves a particle sideways, possibly past another wall: the clamp is the guarantee.
  x = clamp(x, lo_c, hi_c);
  if (params.dimension == 2u) {
    x.z = 0.0;
  }
  return x;
}

// The pointer impulses: a blend of the velocity towards the pointer's, and a radial burst, inside a smooth falloff.
fn pbf_impulses(p: vec3f, v_in: vec3f) -> vec3f {
  var v = v_in;
  for (var k = 0u; k < params.impulse_count; k++) {
    let a = params.impulses[k * 3u];
    let b = params.impulses[k * 3u + 1u];
    let c = params.impulses[k * 3u + 2u];
    let d = p - a.xyz;
    let q = length(d) / max(a.w, 1e-6);
    if (q < 1.0) {
      let w = (1.0 - q * q) * (1.0 - q * q);
      v += w * (b.w * (b.xyz - v) + c.x * d / max(length(d), 1e-6));
    }
  }
  return v;
}

// A finite value or the fallback: comparisons with NaN are false, so this also catches NaN without isnan.
fn pbf_finite3(v: vec3f, fallback: vec3f) -> vec3f {
  let ok = all(abs(v) < vec3f(1e7));
  return select(fallback, v, ok);
}
`,c=`// pbf-correct.wgsl -- step 3b of a position-based fluid sub-step, once per solver iteration (story 7.4): the position
// correction, the container, and the velocity.
//
//   dp_i = 1/n0 * sum_j (lambda_i + lambda_j + s_corr_ij) grad W_spiky(x_i - x_j)       (+ the walls: wall_k lambda_i g_wall)
//   x_i  = contain(x_i + relax * dp_i)
//   v_i  = (x_i - previous_i) / dt
//
// s_corr = -k (W(r) / W(dq))^n is the artificial pressure of the paper: a small repulsion between close pairs that
// stops the clumping a negative lambda would cause at the free surface (the ratio is capped at 1, so closer pairs than
// dq do not push harder and a large dq cannot blow the fluid up). k arrives in units of lambda at rest
// (params.scorr_k = k / S0), so it means the same thing at any particle spacing and in 2D and 3D.
//
// JACOBI. Every particle reads the positions of the previous iterate and writes a new buffer (\`positions_out\`, the
// back buffer of the position attribute, swapped by the solver afterwards). Nothing depends on the order in which
// particles are processed, which is what makes this parallel, and it converges more slowly than the Gauss-Seidel
// order of the CPU paper: the sum over about 30 neighbours over-corrects (every neighbour's constraint pushes on i),
// which \`eps\` and \`relax\` damp. See pbf.ts for the measured convergence.
//
// The velocity is written every iteration, from the position change since the start of the sub-step, so the last
// iteration leaves the velocity that goes with the final position. The foam amount (positions.w) is raised by fast
// particles with a low density, and decays.

#include "pbf-core.wgsl"
#include "neighbor_bindings.wgsl"

@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4f>;
@group(0) @binding(4) var<storage, read> previous: array<vec4f>;
@group(0) @binding(5) var<storage, read> solve: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> positions_out: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let pw = positions[i];
  let p = pw.xyz;
  let prev = previous[i].xyz;
  let state = solve[i];
  let lambda_i = state.x;
  let c = neighbor_cell_of(neighbor_grid, p);
  var dp = vec3f(0.0);
  let use_scorr = params.scorr_k != 0.0;
  for (var row = 0u; row < neighbor_grid.rows; row++) {
    let span = neighbor_row_span(c, row);
    for (var k = span.x; k < span.y; k++) {
      let j = neighbor_particle(k);
      if (j == i) { continue; }
      var r = p - positions[j].xyz;
      var r2 = neighbor_dist2(neighbor_grid, r);
      if (r2 >= params.h2) { continue; }
      if (r2 < 1e-12) {
        r = pbf_nudge(i, j, params.h);
        r2 = dot(r, r);
      }
      var scorr = 0.0;
      if (use_scorr) {
        let ratio = min(pbf_poly6(r2, params.h2, params.poly6) * params.inv_w_dq, 1.0);
        // The exponent is a small integer (4 in the paper): repeated products, not a pow() per neighbour.
        var power = ratio * ratio;
        power *= power;
        if (params.scorr_n != 4u) {
          power = ratio;
          for (var q = 1u; q < params.scorr_n; q++) {
            power *= ratio;
          }
        }
        scorr = -params.scorr_k * max(power - params.scorr_floor, 0.0);
      }
      let other = solve[j];
      if (use_scorr && params.gate_scale > 0.0) {
        // Optional (gate_scale > 0). Only where the fluid is under pressure (both lambdas negative, about 2 % compression or more): a free blob, a
        // jet or a free surface has nothing pushing back, and a repulsion there only blows it up.
        scorr *= clamp(-0.5 * (lambda_i + other.x) * params.gate_scale, 0.0, 1.0);
      }
      dp += (lambda_i + other.x + scorr) * pbf_spiky_grad(r, params.h, params.spiky);
    }
  }
  if (params.boundary_density != 0u) {
    dp += params.wall_k * lambda_i * pbf_wall_terms(p).grad;
  }
  dp *= params.inv_n0 * params.relax;
  let dp_len = length(dp);
  if (dp_len > params.max_correction) {
    dp *= params.max_correction / dp_len;
  }

  var x = pbf_contain(pbf_finite3(p + dp, p), prev, 1.0);
  var v = (x - prev) * tick.inv_dt;
  let speed = length(v);
  if (speed > params.max_speed) {
    v *= params.max_speed / speed;
  }
  v = pbf_finite3(v, vec3f(0.0));

  // Foam: fast and sparse. The density ratio comes from the density pass of this iteration.
  let sparse = clamp((0.8 - state.y) / 0.45, 0.0, 1.0);
  let fast = clamp((speed - 0.5 * params.foam_speed) / params.foam_speed, 0.0, 1.0);
  let foam = clamp(max(sparse * fast, pw.w * exp(-params.foam_decay * tick.dt)), 0.0, 1.0);

  positions_out[i] = vec4f(x, foam);
  velocities[i] = vec4f(v, 0.0);
}
`,l=`// pbf-density.wgsl -- step 3a of a position-based fluid sub-step, once per solver iteration (story 7.4): the density
// constraint and its Lagrange multiplier, for every particle at once.
//
//   rho_i = (sum_j W_poly6(|x_i - x_j|) + wall)  / n0         dimensionless: 1 is the rest density
//   C_i   = rho_i - 1                                          the constraint
//   lambda_i = -C_i / (sum_k |grad_k C_i|^2 + eps)             the step along the constraint gradient that zeroes C
//
// The sum includes the particle itself and the missing fluid behind the walls (pbf_wall_terms). The gradient
// sum is |sum_j g_ij|^2 (moving particle i) plus sum_j |g_ij|^2 (moving each neighbour j), all over n0^2, with g
// the Spiky gradient; the walls add to the first term only, because a wall does not move. eps is the relaxation
// (params.eps, already in the same units): without it a particle with few neighbours divides by almost nothing.
// A negative C (fewer neighbours than at rest: a free surface, a splash) is scaled by params.neg_pressure, 0 by
// default, so that surface particles are not pulled inward (the tensile instability, see pbf.ts).
//
// Output: solve[i] = (lambda_i, rho_i). The neighbour loop is the one documented in src/wgsl/neighbors.wgsl.

#include "pbf-core.wgsl"
#include "neighbor_bindings.wgsl"

@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> solve: array<vec2f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let p = positions[i].xyz;
  let c = neighbor_cell_of(neighbor_grid, p);
  var density = pbf_poly6(0.0, params.h2, params.poly6);
  var grad_sum = vec3f(0.0);
  var grad_sq = 0.0;
  for (var row = 0u; row < neighbor_grid.rows; row++) {
    let span = neighbor_row_span(c, row);
    for (var k = span.x; k < span.y; k++) {
      let j = neighbor_particle(k);
      if (j == i) { continue; }
      var r = p - positions[j].xyz;
      var r2 = neighbor_dist2(neighbor_grid, r);
      if (r2 >= params.h2) { continue; }
      if (r2 < 1e-12) {
        r = pbf_nudge(i, j, params.h);
        r2 = dot(r, r);
      }
      density += pbf_poly6(r2, params.h2, params.poly6);
      let g = pbf_spiky_grad(r, params.h, params.spiky);
      grad_sum += g;
      grad_sq += dot(g, g);
    }
  }
  let wall = pbf_wall_terms(p);
  let rho = (density + wall.density) * params.inv_n0;
  var constraint = rho - 1.0;
  if (constraint < 0.0) {
    constraint *= params.neg_pressure;
  }
  grad_sum += wall.grad;
  let denominator = (dot(grad_sum, grad_sum) + grad_sq) * params.inv_n0 * params.inv_n0 + params.eps;
  solve[i] = vec2f(-constraint / denominator, rho);
}
`,u=`// pbf-kernels.wgsl -- the smoothing kernels of the position-based fluid solver (story 7.4), as pure functions with
// every constant passed in, so the tests can evaluate them on the GPU and compare with the CPU twin in pbf.ts.
// Not part of the shared library (src/wgsl): the SPH solver keeps its own kernels in sph-kernels.wgsl, and the
// two could be merged once both have settled; every name here starts with \`pbf_\` so they cannot collide.
//
// Macklin and Mueller, "Position Based Fluids" (2013), use Poly6 to estimate density and the gradient of Spiky to
// move particles. Both are normalised to integrate to 1 over the disc (2D) or ball (3D) of radius h, so a sum of
// kernel values over neighbours is a NUMBER density (particles per unit area or volume). The normalisations differ by
// dimension and nothing else does:
//
//   Poly6    W(r) = c6 (h^2 - r^2)^3                c6 = 315 / (64 pi h^9)  (3D)    4 / (pi h^8)  (2D)
//   Spiky    W(r) = cs (h - r)^3                    cs = 15 / (pi h^6)      (3D)    10 / (pi h^5) (2D)
//   Spiky gradient, with respect to the first particle, for r = p_i - p_j:
//            grad W = -3 cs (h - |r|)^2 r / |r|     3 cs = 45 / (pi h^6)    (3D)    30 / (pi h^5) (2D)
//
// pbf_poly6(r2, h2, c6) -> f32                      Poly6 value at squared distance r2 (0 beyond h)
// pbf_spiky_grad(r, h, c3) -> vec3f                 Spiky gradient for the separation r, with c3 = 3 cs; zero
//                                                   beyond h and for coincident particles (the caller nudges those)
// pbf_nudge(i, j, h) -> vec3f                       a tiny deterministic separation for two particles in the same
//                                                   place, so the solver can push them apart instead of dividing by 0
// pbf_hash(x) -> u32                                32-bit integer hash used by pbf_nudge

fn pbf_poly6(r2: f32, h2: f32, c6: f32) -> f32 {
  let d = h2 - r2;
  return select(0.0, c6 * d * d * d, d > 0.0);
}

fn pbf_spiky_grad(r: vec3f, h: f32, c3: f32) -> vec3f {
  let len = length(r);
  let d = h - len;
  if (d <= 0.0 || len < 1e-7) {
    return vec3f(0.0);
  }
  return r * (-c3 * d * d / len);
}

fn pbf_hash(x: u32) -> u32 {
  var v = x * 747796405u + 2891336453u;
  v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (v >> 22u) ^ v;
}

fn pbf_nudge(i: u32, j: u32, h: f32) -> vec3f {
  let a = pbf_hash(i * 2654435761u + j);
  let b = pbf_hash(a ^ 0x9e3779b9u);
  let c = pbf_hash(b ^ 0x85ebca6bu);
  let d = vec3f(f32(a & 0xffffu), f32(b & 0xffffu), f32(c & 0xffffu)) / 32768.0 - vec3f(1.0);
  let len = max(length(d), 1e-3);
  // A fraction of a thousandth of the radius: enough to pick a direction, far too little to be seen.
  return d / len * (h * 1e-3);
}
`,d=`// pbf-predict.wgsl -- step 1 of a position-based fluid sub-step (story 7.4): apply the external forces and predict.
//
//   previous = x                    where the particle was when the step began (the velocity update needs it)
//   v        = v + g dt             gravity, then (first sub-step of an update only) the pointer impulses
//   v        = v exp(-damping dt)   optional drag; zero by default
//   x        = x + v dt, kept inside the container and outside the colliders
//
// \`positions\` holds the PREDICTED position from here on; the solver iterations correct it in place of x. The
// scalar in positions.w (the foam amount) passes through untouched. Bindings: see pbf.ts.

#include "pbf-core.wgsl"

@group(0) @binding(2) var<storage, read_write> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> previous: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let pw = positions[i];
  let p = pw.xyz;
  var v = velocities[i].xyz;
  previous[i] = vec4f(p, 0.0);

  v += params.gravity * tick.dt;
  if (tick.first != 0u) {
    v = pbf_impulses(p, v);
  }
  v *= exp(-params.damping * tick.dt);
  let speed = length(v);
  if (speed > params.max_speed) {
    v *= params.max_speed / speed;
  }
  v = pbf_finite3(v, vec3f(0.0));

  var x = pbf_contain(pbf_finite3(p + v * tick.dt, p), p, 0.0);
  positions[i] = vec4f(x, pw.w);
  velocities[i] = vec4f(v, 0.0);
}
`,ee=`// pbf-viscosity.wgsl -- step 4a of a position-based fluid sub-step (story 7.4): XSPH viscosity, and the vorticity
// of the velocity field for the confinement that follows.
//
//   v_i' = v_i + c * 1/n0 * sum_j (v_j - v_i) W_poly6(|x_i - x_j|)
//   omega_i = 1/n0 * sum_j (v_i - v_j) x grad W_spiky(x_i - x_j)       the curl of v (2 omega for a rigid rotation)
//
// XSPH moves each velocity towards the kernel-weighted mean of its neighbours: a viscosity that costs one pass and
// cannot make the solver unstable, because it is an average. It is applied to the velocity only, after the positions
// are final, so it does not fight the density constraint. It is a sum of pair terms (v_j - v_i) W that are
// antisymmetric, so it conserves linear momentum. \`c\` is a fraction per 1/60 s (params.viscosity), converted to the
// sub-step length so the damping does not depend on the step count.
//
// Writes the new velocity to a second buffer (Jacobi again) and omega (xyz) with its length (w) for pbf-vorticity.

#include "pbf-core.wgsl"
#include "neighbor_bindings.wgsl"

@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read> velocities: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> omega: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> velocities_out: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let p = positions[i].xyz;
  let vi = velocities[i].xyz;
  let c = neighbor_cell_of(neighbor_grid, p);
  var smooth_sum = vec3f(0.0);
  var curl = vec3f(0.0);
  let want_curl = params.vorticity > 0.0;
  for (var row = 0u; row < neighbor_grid.rows; row++) {
    let span = neighbor_row_span(c, row);
    for (var k = span.x; k < span.y; k++) {
      let j = neighbor_particle(k);
      if (j == i) { continue; }
      var r = p - positions[j].xyz;
      var r2 = neighbor_dist2(neighbor_grid, r);
      if (r2 >= params.h2) { continue; }
      if (r2 < 1e-12) {
        r = pbf_nudge(i, j, params.h);
        r2 = dot(r, r);
      }
      let vj = velocities[j].xyz;
      smooth_sum += (vj - vi) * pbf_poly6(r2, params.h2, params.poly6);
      if (want_curl) {
        curl += cross(vi - vj, pbf_spiky_grad(r, params.h, params.spiky));
      }
    }
  }
  let c_step = 1.0 - pow(1.0 - clamp(params.viscosity, 0.0, 0.999), tick.dt * 60.0);
  let v_new = pbf_finite3(vi + c_step * smooth_sum * params.inv_n0, vi);
  velocities_out[i] = vec4f(v_new, 0.0);
  let w = curl * params.inv_n0;
  omega[i] = vec4f(w, length(w));
}
`,te=`// pbf-vorticity.wgsl -- step 4b of a position-based fluid sub-step, optional (story 7.4): vorticity confinement
// (Fedkiw, Stam and Jensen 2001; the form of the position-based fluids paper).
//
// A particle method loses small eddies to numerical damping. Confinement finds where |omega| peaks and adds a force
// that spins the fluid around that peak:
//
//   eta_i = grad |omega|_i = 1/n0 * sum_j (|omega_j| - |omega_i|) grad W_spiky(x_i - x_j)
//   N = eta / |eta|,   dv = epsilon * h * 60 * dt * (N x omega_i)
//
// epsilon is params.vorticity; h * 60 gives it a velocity per second per second so that 1 is a strong effect
// at any particle size. It reads omega from pbf-viscosity and changes only the velocity of its own particle, so it is
// safe in place. It adds energy: keep it small (0.05 to 0.3) or the fluid will never come to rest.

#include "pbf-core.wgsl"
#include "neighbor_bindings.wgsl"

@group(0) @binding(2) var<storage, read> positions: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4f>;
@group(0) @binding(6) var<storage, read> omega: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let p = positions[i].xyz;
  let wi = omega[i];
  let c = neighbor_cell_of(neighbor_grid, p);
  var eta = vec3f(0.0);
  for (var row = 0u; row < neighbor_grid.rows; row++) {
    let span = neighbor_row_span(c, row);
    for (var k = span.x; k < span.y; k++) {
      let j = neighbor_particle(k);
      if (j == i) { continue; }
      var r = p - positions[j].xyz;
      var r2 = neighbor_dist2(neighbor_grid, r);
      if (r2 >= params.h2) { continue; }
      if (r2 < 1e-12) {
        r = pbf_nudge(i, j, params.h);
        r2 = dot(r, r);
      }
      eta += (omega[j].w - wi.w) * pbf_spiky_grad(r, params.h, params.spiky);
    }
  }
  eta *= params.inv_n0;
  let len = length(eta);
  if (len < 1e-6) { return; }
  let force = cross(eta / len, wi.xyz);
  let v = velocities[i];
  velocities[i] = vec4f(pbf_finite3(v.xyz + force * (params.vorticity * params.h * 60.0 * tick.dt), v.xyz), 0.0);
}
`;function f(e,t){return e===3?315/(64*Math.PI*t**9):4/(Math.PI*t**8)}function p(e,t){return e===3?15/(Math.PI*t**6):10/(Math.PI*t**5)}function m(e,t,n){return n<t?f(e,t)*(t*t-n*n)**3:0}function h(e,t,n){return n<t?p(e,t)*(t-n)**3:0}function g(e,t,n){return n<t?-3*p(e,t)*(t-n)**2:0}function _(e,t,n,r=200){let i=(n-t)/r,a=e(t)+e(n);for(let n=1;n<r;n++)a+=e(t+n*i)*(n%2==0?2:4);return a*i/3}function ne(e,t,n){let r=Math.ceil(n/t),i=0,a=0,o=0,s=[0,0,0],c=e===3?r:0;for(let l=-r;l<=r;l++)for(let u=-r;u<=r;u++)for(let r=-c;r<=c;r++){let c=Math.hypot(l,u,r)*t;if(c>=n||(i+=m(e,n,c),c===0))continue;a++;let d=g(e,n,c)/c;o+=(d*c)**2,s[0]+=d*l*t,s[1]+=d*u*t,s[2]+=d*r*t}return{n0:i,s0:o/(i*i),neighbours:a,asymmetry:Math.max(Math.abs(s[0]),Math.abs(s[1]),Math.abs(s[2]))}}function re(e,t,n){let r=(t,r)=>{if(r>=n)return 0;let i=Math.sqrt(n*n-r*r);return _(e===3?e=>2*Math.PI*e*t(3,n,Math.hypot(e,r)):e=>2*t(2,n,Math.hypot(e,r)),0,i,64)},i=1/t**e,a=new Float32Array(33),o=new Float32Array(33),s=n/32,c=0;for(let e=32;e>=0;e--)e<32&&(c+=_(e=>r(m,e),e*s,(e+1)*s,8)),a[e]=c*i,o[e]=r(h,e*s)*i;return{density:a,gradient:o}}var ie=[`predict`,`grid`,`density`,`correct`,`viscosity`,`vorticity`],ae={gravity:[0,-9.81,0],timeStep:1/60,substeps:3,iterations:2,maxSteps:2,relaxation:1,relax:1,artificialPressure:.06,artificialPressureExponent:4,artificialPressureRadius:.2,artificialPressureRest:0,artificialPressureGate:0,tension:0,viscosity:.01,vorticity:0,damping:0,friction:.1,wallDensity:!0,wallStiffness:2,wallOffset:0,maxSpeed:0,maxWallSpeed:0,foamSpeed:1,foamDecay:1.5},v=t(`PbfParams`,{gravity:`vec3f`,h:`f32`,h2:`f32`,poly6:`f32`,spiky:`f32`,inv_n0:`f32`,inv_w_dq:`f32`,scorr_k:`f32`,scorr_n:`u32`,scorr_floor:`f32`,gate_scale:`f32`,eps:`f32`,relax:`f32`,neg_pressure:`f32`,wall_k:`f32`,wall_offset:`f32`,friction:`f32`,max_speed:`f32`,max_correction:`f32`,damping:`f32`,viscosity:`f32`,vorticity:`f32`,foam_speed:`f32`,foam_decay:`f32`,count:`u32`,dimension:`u32`,boundary_density:`u32`,collider_count:`u32`,impulse_count:`u32`,colliders:n(`vec4f`,16),impulses:n(`vec4f`,12),wall_density:n(`vec4f`,9),wall_gradient:n(`vec4f`,9)}),y=t(`PbfStep`,{bounds_min:`vec3f`,dt:`f32`,bounds_max:`vec3f`,inv_dt:`f32`,first:`u32`});function oe(e,t,n,r,i){for(let a of e.layout){let o=t[a.name];if(o===void 0)continue;let s=i+a.offset>>2,c=a.type;if(typeof c!=`string`){let e=o;for(let t=0;t<e.length;t++)n[s+t]=e[t]}else if(c===`u32`)r[s]=o;else if(c===`f32`)n[s]=o;else if(c===`vec3f`){let e=o;n[s]=e[0],n[s+1]=e[1],n[s+2]=e[2]}else throw TypeError(`${e.name}.${a.name}: ${c} is not packed by pbf.ts`)}}function se(e,t,n=e===3?2.2:3,r=.65){let i=t*n,a=ne(e,t,i);return{dimension:e,spacing:t,h:i,n0:a.n0,s0:a.s0,neighbours:a.neighbours,restVolume:t**e,renderRadius:t*r,poly6:f(e,i),spiky:3*p(e,i)}}var b=(e,t)=>Number.isFinite(e)?e:t,x=(e,t,n)=>Math.min(n,Math.max(t,e)),S=8192,C=128;function w(t){let{device:n,dimension:f=3,profiler:p=e,label:h=`pbf`}=t;if(!(t.spacing>0)||!Number.isFinite(t.spacing))throw RangeError(`spacing must be positive and finite, got ${t.spacing}`);if(!(t.capacity>=1))throw RangeError(`capacity must be at least 1, got ${t.capacity}`);let g=se(f,t.spacing,t.kernelScale,t.renderScale),{h:_,spacing:w}=g,le=re(f,w,_),T={...ae,...t.params,gravity:[...t.params?.gravity??ae.gravity]};t.params?.wallOffset||(T.wallOffset=w/2);let ue=t.timedPasses??20,E=0,D={pass:e=>E++<ue?p.pass(e):void 0},O=o({device:n,dimension:f,capacity:t.capacity,radius:g.renderRadius,extras:{previous:4},profiler:D,label:h}),k=a({device:n,dimension:f,mode:`reorder`,capacity:t.capacity,profiler:D,label:`${h} grid`}),de=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,A=n.createBuffer({label:`${h} params`,size:v.size,usage:de}),j=n.createBuffer({label:`${h} tick`,size:y.size,usage:de}),M=n.createBuffer({label:`${h} staging`,size:S*C,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),N=new ArrayBuffer(S),fe=new Float32Array(N),P=new Uint32Array(N),F=0,pe=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,I,L,R=0;function me(e){I?.destroy(),L?.destroy(),I=n.createBuffer({label:`${h} solve`,size:e*8,usage:pe}),L=void 0,R++}me(O.capacity);let z=()=>L??=n.createBuffer({label:`${h} omega`,size:O.capacity*16,usage:pe}),he={"pbf_params.wgsl":v.wgsl+y.wgsl,"pbf-core.wgsl":s,"pbf-kernels.wgsl":u,...k.chunks({group:0,binding:8})},B=(e,t,i)=>r(n,{label:`sim/${e}`,code:t,chunks:he,profiler:D,timestamp:`${h} ${i}`}),V={predict:B(`pbf-predict.wgsl`,d,`predict`),density:B(`pbf-density.wgsl`,l,`density`),correct:B(`pbf-correct.wgsl`,c,`correct`),viscosity:B(`pbf-viscosity.wgsl`,ee,`viscosity`),vorticity:B(`pbf-vorticity.wgsl`,te,`vorticity`)},H={min:[...t.bounds.min],max:[...t.bounds.max]},U={min:[...H.min],max:[...H.max]},W={min:[...H.min],max:[...H.max]},G={min:[...H.min],max:[...H.max]},K=[],q=null,J=0,Y=[],X=0,Z=0,ge=1,_e=!1,Q,ve=()=>T.maxWallSpeed>0?T.maxWallSpeed:w/Math.max(T.timeStep,1e-4),ye={get positions(){return O.positions},get velocities(){return O.velocities},get count(){return O.count},get capacity(){return O.capacity},get radius(){return O.radius},restVolume:g.restVolume,get generation(){return O.generation+R}};function $(){T.timeStep=x(b(T.timeStep,1/60),1/480,1/15),T.substeps=Math.round(x(b(T.substeps,2),1,8)),T.iterations=Math.round(x(b(T.iterations,4),1,32)),T.maxSteps=Math.round(x(b(T.maxSteps,2),1,8)),T.relaxation=x(b(T.relaxation,1),.001,100),T.relax=x(b(T.relax,1),.05,1.5),T.artificialPressure=x(b(T.artificialPressure,0),0,.3),T.artificialPressureExponent=x(b(T.artificialPressureExponent,4),1,12),T.artificialPressureRadius=x(b(T.artificialPressureRadius,.2),.02,.9),T.artificialPressureRest=x(b(T.artificialPressureRest,.5),0,1),T.artificialPressureGate=x(b(T.artificialPressureGate,0),0,10),T.tension=x(b(T.tension,0),0,1),T.viscosity=x(b(T.viscosity,0),0,.9),T.vorticity=x(b(T.vorticity,0),0,4),T.damping=x(b(T.damping,0),0,100),T.friction=x(b(T.friction,0),0,10),T.wallStiffness=x(b(T.wallStiffness,2),0,4),T.wallOffset=x(b(T.wallOffset,w/2),0,_),T.foamSpeed=Math.max(b(T.foamSpeed,1),.001),T.foamDecay=x(b(T.foamDecay,1.5),0,100);for(let e=0;e<3;e++)T.gravity[e]=x(b(T.gravity[e],0),-1e4,1e4)}function be(){let e=[];for(let t of K.slice(0,8))t.kind===`sphere`?e.push(...t.center,t.radius,0,0,0,1):e.push(...t.min,0,...t.max,2);return e}function xe(e){let t=[];for(let n of e.slice(0,4)){let e=n.velocity??[0,0,0];t.push(...n.position,n.radius,...e,n.strength??.5,n.outward??0,0,0,0)}return t}function Se(e){$();let t=ne(f,w,_),r=T.artificialPressureRadius*_,i=m(f,_,r),a=T.timeStep/T.substeps,o=T.maxSpeed>0?T.maxSpeed:1.5*_/a,s=F*S;return P.fill(0),oe(v,{gravity:T.gravity,h:_,h2:_*_,poly6:g.poly6,spiky:g.spiky,inv_n0:1/t.n0,inv_w_dq:1/i,scorr_k:T.artificialPressure/t.s0,scorr_n:Math.round(T.artificialPressureExponent),gate_scale:T.artificialPressureGate>0?t.s0*(1+T.relaxation)/T.artificialPressureGate:0,scorr_floor:T.artificialPressureRest*Math.min(m(f,_,w)/i,1)**Math.round(T.artificialPressureExponent),eps:T.relaxation*t.s0,relax:T.relax,neg_pressure:T.tension,wall_k:T.wallStiffness,wall_offset:T.wallOffset,friction:T.friction,max_speed:o,max_correction:.5*_,damping:T.damping,viscosity:T.viscosity,vorticity:T.vorticity,foam_speed:T.foamSpeed,foam_decay:T.foamDecay,count:O.count,dimension:f,boundary_density:+!!T.wallDensity,collider_count:Math.min(K.length,8),impulse_count:Math.min(e.length,4),colliders:be(),impulses:xe(e),wall_density:Array.from(le.density),wall_gradient:Array.from(le.gradient)},fe,P,0),n.queue.writeBuffer(M,s,N,0,v.size),s}function Ce(e,t,r){let i=e+ce(16,v.size),a=new ArrayBuffer(r.length*y.size),o=new Float32Array(a),s=new Uint32Array(a);return r.forEach((e,n)=>{oe(y,{bounds_min:e.min,dt:t,bounds_max:e.max,inv_dt:1/t,first:+(n===0)},o,s,n*y.size)}),n.queue.writeBuffer(M,i,a),i}function we(){for(let e=0;e<3;e++)G.min[e]=Math.min(G.min[e],U.min[e],W.min[e]),G.max[e]=Math.max(G.max[e],U.max[e],W.max[e]);k.configure({min:G.min,max:G.max,radius:_})}function Te(e,t,n,r){e.copyBufferToBuffer(M,t,j,0,y.size);let i=O.count;if(i<=0)return;let a=[A,j];n.has(`predict`)&&V.predict.runCount(e,[...a,O.positions,O.velocities,O.attribute(`previous`)],i),n.has(`grid`)&&k.build(e,O);let o=k.resources(),s=I;for(let t=0;t<r;t++)n.has(`density`)&&V.density.runCount(e,[...a,O.positions,void 0,void 0,s,void 0,void 0,...o],i),n.has(`correct`)&&(V.correct.runCount(e,[...a,O.positions,O.velocities,O.attribute(`previous`),s,O.back(`position`),void 0,...o],i),O.swap(`position`));let c=T.vorticity>0;n.has(`viscosity`)&&(T.viscosity>0||c)&&(V.viscosity.runCount(e,[...a,O.positions,O.velocities,void 0,void 0,z(),O.back(`velocity`),...o],i),O.swap(`velocity`)),n.has(`vorticity`)&&c&&V.vorticity.runCount(e,[...a,O.positions,O.velocities,void 0,void 0,z(),void 0,...o],i)}let Ee=new Set(ie);function De(e,t){let r=O.capacity-O.count,i=Math.min(r,e.length/4);if(i<=0)return 0;let a=O.count;return O.setCount(a+i),n.queue.writeBuffer(O.attribute(`position`),a*16,e,0,i*4),n.queue.writeBuffer(O.attribute(`velocity`),a*16,t,0,i*4),i}function Oe(e){let t=e.jitter??.05,n=e.velocity??[0,0,0],r=[0,1,2].map(t=>t===2&&f===2?1:Math.max(0,Math.floor((e.max[t]-e.min[t])/w+1e-6))),a=r[0]*r[1]*r[2],o=new Float32Array(a*4),s=new Float32Array(a*4),c=i(39711+ge++),l=0;for(let i=0;i<r[2];i++)for(let a=0;a<r[1];a++)for(let u=0;u<r[0];u++){let r=()=>(c()-.5)*t*w;o[l*4]=e.min[0]+(u+.5)*w+r(),o[l*4+1]=e.min[1]+(a+.5)*w+r(),o[l*4+2]=f===2?0:e.min[2]+(i+.5)*w+r(),s.set(n,l*4),l++}return{positions:o,velocities:s}}function ke(e){let t=Math.hypot(...e.velocity)||1,n=e.velocity.map(e=>e/t),r=`${e.radius}|${n.join(`,`)}`;if(Q?.key===r)return Q.offsets;let i,a;if(f===2)i=[-n[1],n[0],0],a=[0,0,0];else{let e=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];i=[n[1]*e[2]-n[2]*e[1],n[2]*e[0]-n[0]*e[2],n[0]*e[1]-n[1]*e[0]];let t=Math.hypot(...i);i=i.map(e=>e/t),a=[n[1]*i[2]-n[2]*i[1],n[2]*i[0]-n[0]*i[2],n[0]*i[1]-n[1]*i[0]]}let o=[],s=Math.floor(e.radius/w);for(let t=-s;t<=s;t++)for(let n=f===2?0:-s;n<=(f===2?0:s);n++)Math.hypot(t,n)*w>e.radius+1e-9||o.push(i[0]*t*w+a[0]*n*w,i[1]*t*w+a[1]*n*w,i[2]*t*w+a[2]*n*w);return Q={key:r,offsets:new Float32Array(o)},Q.offsets}function Ae(e){if(!q)return;let t=Math.hypot(...q.velocity);if(!(t>1e-6))return;let n=w/t,r=ke(q),a=r.length/3;if(a===0)return;let o=i(20907+ge++),s=[],c=[],l=n-J;for(;l<=e+1e-9&&s.length/4+a<=O.capacity-O.count;){for(let e=0;e<a;e++){let t=()=>(o()-.5)*.04*w;s.push(q.position[0]+r[e*3]-q.velocity[0]*l+t(),q.position[1]+r[e*3+1]-q.velocity[1]*l+t(),f===2?0:q.position[2]+r[e*3+2]-q.velocity[2]*l+t(),0),c.push(...q.velocity,0)}l+=n}J=e-(l-n),s.length>0&&De(new Float32Array(s),new Float32Array(c))}let je={dimension:f,system:O,particles:ye,params:T,constants:g,grid:k,get solve(){return I},async readState(){let e=O.count,t=Math.max(8,e*8),r=n.createBuffer({label:`${h} readback`,size:t,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),i=n.createCommandEncoder();e>0&&i.copyBufferToBuffer(I,0,r,0,e*8),n.queue.submit([i.finish()]),await r.mapAsync(GPUMapMode.READ);let a=new Float32Array(r.getMappedRange().slice(0,e*8));r.unmap(),r.destroy();let o=new Float32Array(e),s=new Float32Array(e);for(let t=0;t<e;t++)o[t]=a[t*2],s[t]=a[t*2+1];return{lambda:o,density:s}},get count(){return O.count},get capacity(){return O.capacity},get generation(){return O.generation+R},get bounds(){return U},get time(){return Z},update(e,t){$();let n=T.timeStep;X+=x(b(t,0),0,.25);let r=Math.floor(X/n+1e-6);X=Math.max(0,X-r*n);let i=Math.min(r,T.maxSteps),a={steps:i,substeps:i*T.substeps,seconds:i*n};if(E=0,i===0||O.count===0)return i>0&&Ae(a.seconds),a;let o=n/T.substeps,s=[],c=ve()*o;for(let e=0;e<a.substeps;e++){for(let e=0;e<3;e++)U.min[e]=U.min[e]+x(W.min[e]-U.min[e],-c,c),U.max[e]=U.max[e]+x(W.max[e]-U.max[e],-c,c);s.push({min:[...U.min],max:[...U.max]})}Ae(a.seconds),we();let l=Se(Y.splice(0,4)),u=Ce(l,o,s);F=(F+1)%C,e.copyBufferToBuffer(M,l,A,0,v.size);for(let t=0;t<a.substeps;t++)Te(e,u+t*y.size,Ee,T.iterations);return Z+=a.seconds,a},run(e,t={}){$(),E=0;let n=t.dt??T.timeStep/T.substeps;we();let r=Se([]),i=Ce(r,n,[{min:[...U.min],max:[...U.max]}]);F=(F+1)%C,e.copyBufferToBuffer(M,r,A,0,v.size),Te(e,i,t.stages?new Set(t.stages):Ee,t.iterations??T.iterations)},setBounds(e,t,n={}){for(let r=0;r<3;r++)W.min[r]=b(e[r],W.min[r]),W.max[r]=b(t[r],W.max[r]),n.snap&&(U.min[r]=W.min[r],U.max[r]=W.max[r])},setColliders(e){K=e.slice(0,8)},impulse(e){Y.length<4&&Y.push(e)},setEmitter(e){q=e?{...e}:null,J=0},addBlock(e){let t=Oe(e);return De(t.positions,t.velocities)},reset(e={}){O.setCount(0),X=0,Z=0,Y=[],J=0,q=e.emitter??null,K=(e.colliders??[]).slice(0,8);let t=e.bounds??H;for(let e=0;e<3;e++)U.min[e]=W.min[e]=t.min[e],U.max[e]=W.max[e]=t.max[e];e.gravity&&(T.gravity=[e.gravity[0],e.gravity[1],e.gravity[2]]);for(let t of e.blocks??[])je.addBlock(t)},setCapacity(e){e=Math.max(1,Math.floor(e)),e!==O.capacity&&(O.resize(e),me(e))},destroy(){if(!_e){_e=!0;for(let e of Object.values(V))e.destroy();k.destroy(),O.destroy(),A.destroy(),j.destroy(),M.destroy(),I?.destroy(),L?.destroy()}}};return je}function ce(e,t){return Math.ceil(t/e)*e}export{w as t};