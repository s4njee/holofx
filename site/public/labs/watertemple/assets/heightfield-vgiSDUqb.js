import{t as e}from"./loop-_CGOOht2.js";import{n as t}from"./profiler-Bi27xYp-.js";import{n,r,t as i}from"./uniforms-BE1XSnDx.js";import{t as a}from"./shader-Cd_FDUy8.js";import{r as o}from"./fullscreen-Dq3Mq0Js.js";import{n as s}from"./obstacles-CsV74c88.js";var c=`// The compute-pass variant of the heightfield solver: the same three kernels as the render variant,
// one thread per cell, reading the previous state as a texture and writing a write-only storage
// texture (no read-write storage textures, so it runs everywhere compute does).
#include "sim_core.wgsl"

@group(0) @binding(3) var state_out: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(16, 16)
fn cs_splat(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.size)) {
    return;
  }
  textureStore(state_out, vec2i(id.xy), sim_splat(vec2i(id.xy)));
}

@compute @workgroup_size(16, 16)
fn cs_step(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.size)) {
    return;
  }
  textureStore(state_out, vec2i(id.xy), sim_step(vec2i(id.xy)));
}

@compute @workgroup_size(16, 16)
fn cs_resolve(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.size)) {
    return;
  }
  textureStore(state_out, vec2i(id.xy), sim_resolve(vec2i(id.xy)));
}
`,l=`// heightfield-core.wgsl -- the maths of the heightfield solver, shared by the render-pass and the
// compute-pass variant so that both run the SAME code and differ only in how they are launched.
//
// Included (as an effect-local chunk) by heightfield-render.wgsl and heightfield-compute.wgsl, after
// the generated \`sim_params.wgsl\` (struct SimParams). Bindings, group 0:
//   0  P           uniform SimParams
//   1  state_in    rgba16float   the previous state:  x height, y velocity (z, w unused)
//   2  solid_mask  r8unorm       obstacle mask, grid sized: >= 0.5 is solid
//
// UNITS. Heights are in CELLS (1 = one grid cell, so a stored gradient is a dimensionless slope) and
// velocity in cells per STEP. Time is only in the uniform: k = (c dt / cell)^2 is the squared Courant
// number, v_decay and h_decay are per-step multipliers the CPU computed from rates per second.
//
// SCHEME. Symplectic (semi-implicit) Euler for u_tt = c^2 laplacian(u) - damping u_t:
//     v' = (v + k L(h)) v_decay          h' = (h + v') h_decay
// which is the leapfrog scheme with the velocity kept on half steps: second-order accurate, no
// numerical damping of its own, stable while k (1 - cos) combined along the worst mode stays below 4,
// i.e. C = sqrt(k) <= 0.866 for the 9-point laplacian below (0.707 for the 5-point one).
//
// L is the isotropic 9-point laplacian [1 4 1; 4 -20 4; 1 4 1] / 6. The plain 5-point stencil is
// four times as cheap in taps but propagates diagonally slower than along the axes, so rings turn
// into rounded diamonds; this one is round to the fourth order.
//
// WALLS. A neighbour that lies outside the grid or inside a solid cell is replaced by the centre
// cell's own height: zero normal gradient, i.e. a reflecting wall without a sign flip. Solid cells
// themselves hold height 0 and velocity 0.

#include "sim_params.wgsl"

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var state_in: texture_2d<f32>;
@group(0) @binding(2) var solid_mask: texture_2d<f32>;

const SOLID_THRESHOLD: f32 = 0.5;
// Hard limits. The Courant clamp makes them unreachable; they keep a bad impulse from ever turning
// into Inf in a half-float texture (65504 max).
const HEIGHT_LIMIT: f32 = 512.0;
const VELOCITY_LIMIT: f32 = 64.0;

fn sim_is_solid(c: vec2i) -> bool {
  if (P.solid == 0u) {
    return false;
  }
  return textureLoad(solid_mask, c, 0).r >= SOLID_THRESHOLD;
}

// The height cell \`c\` presents to a neighbour with height \`centre\`.
fn sim_height(c: vec2i, centre: f32) -> f32 {
  let e = clamp(c, vec2i(0), vec2i(P.size) - vec2i(1));
  if (sim_is_solid(e)) {
    return centre;
  }
  return textureLoad(state_in, e, 0).x;
}

fn sim_bump(q: f32) -> f32 {
  let t = max(1.0 - q * q, 0.0);
  return t * t;
}

// Adds the queued impulses. Impulse i is two vec4s:
//   a = (x, y, radius, amplitude) in cells; b = (x1, y1, kind, 0)
//   kind 0: a bump of height \`amplitude\` at (x, y)
//   kind 1: a footprint moving from (x, y) to (x1, y1): amplitude * (bump(from) - bump(to))
fn sim_splat(c: vec2i) -> vec4f {
  var s = textureLoad(state_in, c, 0);
  if (sim_is_solid(c)) {
    return vec4f(0.0);
  }
  let p = vec2f(c) + 0.5;
  var dh = 0.0;
  for (var i = 0u; i < P.impulse_count; i++) {
    let a = P.impulses[2u * i];
    let b = P.impulses[2u * i + 1u];
    var w = sim_bump(length(p - a.xy) / a.z);
    if (b.z > 0.5) {
      w -= sim_bump(length(p - b.xy) / a.z);
    }
    dh += a.w * w;
  }
  s.x = clamp(s.x + dh, -HEIGHT_LIMIT, HEIGHT_LIMIT);
  return s;
}

fn sim_step(c: vec2i) -> vec4f {
  if (sim_is_solid(c)) {
    return vec4f(0.0);
  }
  let s = textureLoad(state_in, c, 0);
  let h = s.x;
  let n = sim_height(c + vec2i(0, -1), h);
  let so = sim_height(c + vec2i(0, 1), h);
  let e = sim_height(c + vec2i(1, 0), h);
  let w = sim_height(c + vec2i(-1, 0), h);
  let ne = sim_height(c + vec2i(1, -1), h);
  let nw = sim_height(c + vec2i(-1, -1), h);
  let se = sim_height(c + vec2i(1, 1), h);
  let sw = sim_height(c + vec2i(-1, 1), h);
  let lap = (4.0 * (n + so + e + w) + (ne + nw + se + sw) - 20.0 * h) * (1.0 / 6.0);

  var v_decay = P.v_decay;
  var h_decay = P.h_decay;
  if (P.sponge_cells > 0.0) {
    // The sponge: extra damping that ramps up quadratically over the last \`sponge_cells\` cells, so
    // a wave is eaten before it can reflect and the ramp itself reflects almost nothing.
    let edge = min(min(c.x, c.y), min(i32(P.size.x) - 1 - c.x, i32(P.size.y) - 1 - c.y));
    let t = max(1.0 - f32(edge) / P.sponge_cells, 0.0);
    let sigma = P.sponge_rate * t * t;
    v_decay *= 1.0 - sigma;
    h_decay *= 1.0 - 0.5 * sigma;
  }
  let v = clamp((s.y + P.k * lap) * v_decay, -VELOCITY_LIMIT, VELOCITY_LIMIT);
  let next = clamp((h + v) * h_decay, -HEIGHT_LIMIT, HEIGHT_LIMIT);
  return vec4f(next, v, 0.0, 0.0);
}

// The consumer-facing texel: height and velocity unchanged, plus the Sobel gradient of the height
// (central difference smoothed across the neighbouring rows), in cells per cell = a pure slope.
// x grows right, y grows DOWN, matching uv.
fn sim_resolve(c: vec2i) -> vec4f {
  if (sim_is_solid(c)) {
    return vec4f(0.0);
  }
  let s = textureLoad(state_in, c, 0);
  let h = s.x;
  let n = sim_height(c + vec2i(0, -1), h);
  let so = sim_height(c + vec2i(0, 1), h);
  let e = sim_height(c + vec2i(1, 0), h);
  let w = sim_height(c + vec2i(-1, 0), h);
  let ne = sim_height(c + vec2i(1, -1), h);
  let nw = sim_height(c + vec2i(-1, -1), h);
  let se = sim_height(c + vec2i(1, 1), h);
  let sw = sim_height(c + vec2i(-1, 1), h);
  let gx = ((ne + 2.0 * e + se) - (nw + 2.0 * w + sw)) * 0.125;
  let gy = ((sw + 2.0 * so + se) - (nw + 2.0 * n + ne)) * 0.125;
  return vec4f(h, s.y, gx, gy);
}
`,u=`// The render-pass variant of the heightfield solver: three fullscreen fragment passes over the
// grid-sized ping-pong render targets. Nothing here needs compute or storage textures, so the same
// code ports to WebGL2 (texelFetch + a half-float colour attachment).
#include "fullscreen.wgsl"
#include "sim_core.wgsl"

@fragment fn fs_splat(in: FullscreenVarying) -> @location(0) vec4f {
  return sim_splat(vec2i(in.position.xy));
}

@fragment fn fs_step(in: FullscreenVarying) -> @location(0) vec4f {
  return sim_step(vec2i(in.position.xy));
}

@fragment fn fs_resolve(in: FullscreenVarying) -> @location(0) vec4f {
  return sim_resolve(vec2i(in.position.xy));
}
`,d=`rgba16float`,f=.8,p=1.5,m=.2,h=24,g=[.02,8],_=16,v={waveSpeed:.45,damping:.6,leak:.05,boundary:`absorb`,courant:.5,spongeCells:14,spongeStrength:1},y=n(`SimParams`,{size:`vec2u`,k:`f32`,v_decay:`f32`,h_decay:`f32`,sponge_cells:`f32`,sponge_rate:`f32`,solid:`u32`,impulse_count:`u32`,impulses:r(`vec4f`,128)}),b=new WeakMap;function x(e,t){let n=t===`render`?GPUShaderStage.FRAGMENT:GPUShaderStage.COMPUTE,r=[{binding:0,visibility:n,buffer:{type:`uniform`}},{binding:1,visibility:n,texture:{sampleType:`unfilterable-float`}},{binding:2,visibility:n,texture:{sampleType:`unfilterable-float`}}];t===`compute`&&r.push({binding:3,visibility:n,storageTexture:{access:`write-only`,format:d}});let i=e.createBindGroupLayout({label:`heightfield ${t} layout`,entries:r}),o=e.createPipelineLayout({label:`heightfield ${t} pipeline layout`,bindGroupLayouts:[i]}),s=a(e,{label:`sim/heightfield-${t}.wgsl`,code:t===`render`?u:c,chunks:{"sim_params.wgsl":y.wgsl,"sim_core.wgsl":l}}),f=n=>t===`render`?e.createRenderPipeline({label:`heightfield render ${n}`,layout:o,vertex:{module:s,entryPoint:`fullscreen_vs`},fragment:{module:s,entryPoint:`fs_${n}`,targets:[{format:d}]}}):e.createComputePipeline({label:`heightfield compute ${n}`,layout:o,compute:{module:s,entryPoint:`cs_${n}`}});return{layout:i,splat:f(`splat`),step:f(`step`),resolve:f(`resolve`)}}function S(e,t){let n=b.get(e);return n||b.set(e,n={}),n[t]??=x(e,t)}var C=(e,t,n)=>Math.min(n,Math.max(t,e));function w(e,t,n=4096){let r=Math.round(C(Number.isFinite(e)?e:256,16,n)),i=Number.isFinite(t)&&t>0?t:1,a=i>=1?r:Math.max(16,Math.round(r*i)),o=i>=1?Math.max(16,Math.round(r/i)):r;return{width:Math.min(a,n),height:Math.min(o,n)}}function T(e,t){return Object.freeze({width:e,height:t,aspect:e/t,cellSize:1/t,texelSize:Object.freeze([1/e,1/t])})}function E(n){let{device:r,kind:a=`render`,maxStepsPerFrame:c=16,profiler:l=t,label:u=`heightfield`}=n,b=n.resolution??256,x=(n.width??1)/(n.height??1),E=Math.min(r.limits.maxTextureDimension2D,4096),D={...v,...n.params},O=S(r,a),k=i(r,y,`${u} params`),A=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|(a===`compute`?GPUTextureUsage.STORAGE_BINDING:0),j=!1,M=0,N=0,P=0,F,I=0,L,R=new Float32Array(512),z=0,B=s(r,u);function V(e,t){let n=T(e,t),i=n=>r.createTexture({label:`${u} ${n}`,size:[e,t],format:d,usage:A}),o=[i(`state A`),i(`state B`)],s=i(`output`);B.resize(e,t);let c=(e,t,n)=>{let i=[{binding:0,resource:{buffer:k.buffer}},{binding:1,resource:e.createView()},{binding:2,resource:B.view}];return a===`compute`&&i.push({binding:3,resource:t.createView()}),r.createBindGroup({label:`${u} ${n}`,layout:O.layout,entries:i})};return{grid:n,state:o,stateViews:[o[0].createView(),o[1].createView()],output:s,outputView:s.createView({label:`${u} output view`}),stepGroups:[c(o[0],o[1],`step A to B`),c(o[1],o[0],`step B to A`)],resolveGroups:[c(o[0],s,`resolve A`),c(o[1],s,`resolve B`)]}}function H(e){e.state[0].destroy(),e.state[1].destroy(),e.output.destroy()}function U(){let e=w(b,x,E);return L&&e.width===L.grid.width&&e.height===L.grid.height?!1:(L&&H(L),L=V(e.width,e.height),N=0,M++,F=void 0,!0)}U();let W=()=>C(Number.isFinite(D.courant)?D.courant:.5,.1,f),G=()=>C(Number.isFinite(D.waveSpeed)?D.waveSpeed:v.waveSpeed,g[0],g[1]),K=()=>W()*L.grid.cellSize/G();function q(){let{grid:e}=L,t=W(),n=K(),r=D.boundary===`absorb`,i=C(Math.round(D.spongeCells),0,Math.floor(Math.min(e.width,e.height)/3)),a=Math.max(0,Number.isFinite(D.damping)?D.damping:0),o=Math.max(0,Number.isFinite(D.leak)?D.leak:0),s=Math.max(0,Number.isFinite(D.spongeStrength)?D.spongeStrength:1),c=new Float32Array(512),l=e.height;for(let t=0;t<z;t++){let n=t*8,r=Math.max(p,(R[n+2]??0)*l),i=C((R[n+3]??0)*m*r,-24,h);c[n]=(R[n]??0)*e.width,c[n+1]=(R[n+1]??0)*e.height,c[n+2]=r,c[n+3]=i,c[n+4]=(R[n+4]??0)*e.width,c[n+5]=(R[n+5]??0)*e.height,c[n+6]=R[n+6]??0}k.set({size:[e.width,e.height],k:t*t,v_decay:Math.exp(-a*n),h_decay:Math.exp(-o*n),sponge_cells:r?i:0,sponge_rate:C(s*t,0,.5),solid:+!!B.enabled,impulse_count:z,impulses:c}),k.upload()}function J(e,t,n,r,i,s){let c=s?l.pass(s):void 0;if(a===`render`)o(e,r,t,[n],{label:i,timestampWrites:c});else{let r=e.beginComputePass({label:i,timestampWrites:c});r.setPipeline(t),r.setBindGroup(0,n),r.dispatchWorkgroups(Math.ceil(L.grid.width/_),Math.ceil(L.grid.height/_)),r.end()}}function Y(e,t){if(j)return;let n=Math.max(0,Math.floor(t));if(P=n,n===0&&z===0)return;q();let r=L;z>0&&(J(e,O.splat,r.stepGroups[N],r.stateViews[1-N],`sim splat`,`sim splat`),N=1-N,z=0);for(let t=0;t<n;t++){let i=t===0||t===n-1?`sim step`:void 0;J(e,O.step,r.stepGroups[N],r.stateViews[1-N],`sim step`,i),N=1-N}J(e,O.resolve,r.resolveGroups[N],r.outputView,`sim resolve`,`sim resolve`)}function X(e,t,n,r,i,a,o){if(z>=64||![e,t,n,r,i,a].every(Number.isFinite))return!1;let s=z*8;return R[s]=e,R[s+1]=t,R[s+2]=Math.max(0,n),R[s+3]=r,R[s+4]=i,R[s+5]=a,R[s+6]=+!!o,z++,!0}return{kind:a,params:D,get grid(){return L.grid},get generation(){return M},get texture(){return L.output},get view(){return L.outputView},obstacles:B,get stepSeconds(){return K()},get lastSteps(){return P},get pendingImpulses(){return z},resize(e,t){return e>0&&t>0&&(x=e/t,U())},setResolution(e){return Number.isFinite(e)?(b=e,U()):!1},addDrop(e,t,n,r){return X(e,t,n,r,0,0,!1)},displace(e,t,n,r){return X(e[0],e[1],n,r,t[0],t[1],!0)},update(t,n){if(j)return 0;let r=K();(!F||Math.abs(r-I)>r*.001)&&(F=e(r,{maxSteps:c}),I=r);let{steps:i}=F.advance(Number.isFinite(n)?n:0);return Y(t,i),i},advance(e,t){Y(e,t)},reset(e){z=0;for(let t of[...L.state,L.output])e.beginRenderPass({label:`${u} clear`,colorAttachments:[{view:t.createView(),loadOp:`clear`,storeOp:`store`}]}).end();N=0},destroy(){j||(j=!0,H(L),B.destroy(),k.destroy())}}}export{E as n,w as t};