import{n as e,r as t,t as n}from"./uniforms-BE1XSnDx.js";import{r,t as i}from"./fullscreen-Dq3Mq0Js.js";import{n as a,t as o}from"./mipmap-caehtsny.js";var s=e(`WaterBake`,{period:`i32`,octaves:`i32`,gain:`f32`,choppiness:`f32`,strength:`f32`,seed_z:`f32`,texel:`f32`,with_height:`u32`}),c=`
#include "fullscreen.wgsl"
#include "noise.wgsl"
#include "normals.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> bake: WaterBake;

// Converts the unit-less height gradient (per cell of the lowest octave) to a slope. Chosen so that
// strength 1 gives an RMS slope of about 0.25 for the default octaves and gain.
const SLOPE_GAIN: f32 = 0.2;

// Height in roughly [-1, 1]: a fractal sum of seamlessly tileable 3D gradient noise. The third axis is
// the seed (a slice through the noise volume), because shifting a periodic 2D pattern only translates it.
fn height(uv: vec2f) -> f32 {
  var sum = 0.0;
  var norm = 0.0;
  var amp = 1.0;
  for (var i = 0; i < bake.octaves; i++) {
    let per = bake.period * (1 << u32(i));
    let p = uv * f32(per);
    let n = gnoise_3d_tile(vec3f(p, bake.seed_z + 3.7 * f32(i)), vec3i(per, per, 1 << 20));
    // 1 - 2|n| puts a sharp crest line on every zero crossing of the noise.
    let crest = 1.0 - 2.0 * abs(n);
    sum += amp * mix(n, crest, bake.choppiness);
    norm += amp;
    amp *= bake.gain;
  }
  return sum / max(norm, 1e-6);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  // uv is the texel centre; the neighbours are one texel away, and the noise is periodic, so the
  // finite difference across the tile edge sees the texels on the other side: no seam.
  let uv = in.uv;
  let dx = vec2f(bake.texel, 0.0);
  let dy = vec2f(0.0, bake.texel);
  let grad_uv = vec2f(
    height(uv + dx) - height(uv - dx),
    height(uv + dy) - height(uv - dy),
  ) / (2.0 * bake.texel);
  let grad_cell = grad_uv / f32(bake.period);
  let n = normal_from_gradient(grad_cell, SLOPE_GAIN * bake.strength);
  let h = select(0.0, height(uv), bake.with_height != 0u);
  return vec4f(n.xy, h, 1.0);
}
`;function l(e){return Number.isInteger(e)&&e>0&&!(e&e-1)}function u(e,t,n){return Math.min(n,Math.max(t,Math.round(e)))}function d(e,t={}){let d=t.size??512;if(!l(d)||d<16||d>2048)throw RangeError(`createWaterNormalMap: size must be a power of two in 16..2048, got ${d}`);let f=u(t.period??6,1,64),p=u(t.octaves??5,1,8),m=t.height??!1,h=m?`rgba16float`:`rg16float`,g=a(d,d),_=t.label??`water normal map`,v=e.createTexture({label:_,size:[d,d],format:h,mipLevelCount:g,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),y=n(e,s,`${_} params`),b=t.seed??1;y.set({period:f,octaves:p,gain:Math.min(1,Math.max(0,t.gain??.5)),choppiness:Math.min(1,Math.max(0,t.choppiness??.35)),strength:Math.max(0,t.strength??1),seed_z:b*13.37,texel:1/d,with_height:+!!m}),y.upload();let x=i(e,{label:`${_} bake`,fragment:{label:`bake/water-normals.wgsl`,code:c,chunks:{"params.wgsl":s.wgsl}},format:h}),S=e.createBindGroup({label:`${_} bake`,layout:x.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:y.buffer}}]}),C=e.createCommandEncoder({label:`${_} bake`});r(C,v.createView({label:`${_} level 0`,baseMipLevel:0,mipLevelCount:1}),x,[S]),o(e,v,C),e.queue.submit([C.finish()]),y.destroy();let w=0;for(let e=0;e<g;e++){let t=Math.max(1,d>>e);w+=t*t*(m?8:4)}return{texture:v,view:v.createView({label:`${_} view`}),format:h,size:d,mipLevelCount:g,bytes:w,destroy:()=>v.destroy()}}function f(e,t={}){return e.createSampler({label:`water repeat sampler`,addressModeU:`repeat`,addressModeV:`repeat`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,maxAnisotropy:u(t.anisotropy??8,1,16)})}var p=8,m=e(`FlowBake`,{rocks:t(`vec4f`,p),count:`u32`,turbulence:`f32`,texel:`f32`}),h=`
#include "fullscreen.wgsl"
#include "fbm.wgsl"
#include "flow.wgsl"
#include "math.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> bake: FlowBake;

// The world is 2 wide and 1 tall, x periodic. Velocity is v = (dpsi/dy, -dpsi/dx) of
// a stream function psi, so it is divergence-free by construction (up to the finite-difference step).
// Streamlines are the level sets of psi: banks are streamlines (nothing crosses them) and so are the
// rock outlines.
const WORLD_W: f32 = 2.0;
// Flux of the whole river; the centre speed is U / half-width.
const U_FLOW: f32 = 0.11;

// Meandering centre line and breathing width, both periodic in x with period 2.
fn centre_y(x: f32) -> f32 {
  return 0.5 + 0.07 * sin(PI * x) + 0.025 * sin(TAU * x + 1.3);
}
fn half_width(x: f32) -> f32 {
  return 0.30 + 0.05 * sin(PI * x + 2.1) + 0.02 * sin(TAU * x - 0.7);
}
// -1 at one bank, 0 on the centre line, +1 at the other; unclamped outside the river.
fn across(p: vec2f) -> f32 {
  return (p.y - centre_y(p.x)) / half_width(p.x);
}

// psi = U * F(s) with F(s) = s - s^3/3: the velocity along the channel has the parabolic profile
// F'(s) = 1 - s^2 (fast in the middle, zero at the banks), and narrows -> speeds up through 1 / width.
fn psi_channel(p: vec2f) -> f32 {
  let s = clamp(across(p), -1.0, 1.0);
  return U_FLOW * (s - s * s * s / 3.0);
}

fn channel_velocity(p: vec2f) -> vec2f {
  let e = 1e-3;
  return vec2f(
    psi_channel(p + vec2f(0.0, e)) - psi_channel(p - vec2f(0.0, e)),
    -(psi_channel(p + vec2f(e, 0.0)) - psi_channel(p - vec2f(e, 0.0))),
  ) / (2.0 * e);
}

// Rock i: .x = world x, .y = across-channel position s, .z = radius.
fn rock_centre(i: u32) -> vec2f {
  let x = bake.rocks[i].x;
  return vec2f(x, centre_y(x) + bake.rocks[i].y * half_width(x));
}

// Offset from rock centre c to p, taking the nearer of the periodic images.
fn wrapped(p: vec2f, c: vec2f) -> vec2f {
  var d = p - c;
  d.x -= WORLD_W * round(d.x / WORLD_W);
  return d;
}

fn psi(p: vec2f) -> f32 {
  let s = across(p);
  var total = psi_channel(p);
  // Potential flow around a cylinder of radius R in a uniform stream u: psi = psi_u * (1 - R^2 / r^2).
  // Each rock adds its dipole -R^2 psi_u / r^2, evaluated for the channel's own velocity at the rock.
  // The taper fades the dipoles out toward the banks so no flow leaks across them (flux stays exact);
  // it is 1 over the rocks, which sit at |s| < 0.45.
  let taper = 1.0 - smoothstep(0.7, 1.0, abs(s));
  for (var i = 0u; i < bake.count; i++) {
    let c = rock_centre(i);
    let radius = bake.rocks[i].z;
    let d = wrapped(p, c);
    let u = channel_velocity(c);
    let r2 = max(dot(d, d), radius * radius);
    // The periodic wrap above jumps by a whole period half way round the world, and the dipole does not match
    // across that jump (its u.y * d.x part flips sign), which would draw a seam of spurious velocity
    // there. The window is 1 over and around the rock and 0 well before the jump.
    let window = 1.0 - smoothstep(0.35, 0.9, abs(d.x));
    total -= taper * window * radius * radius * (u.x * d.y - u.y * d.x) / r2;
  }
  // Eddies: curl of a tileable noise potential (Bridson et al.), faded to zero at the banks.
  let env = max(1.0 - s * s, 0.0);
  let q = vec2f(p.x * 4.0, p.y * 4.0);
  total += bake.turbulence * 0.012 * env * env * fbm_2d_tile(q, vec2i(8, 64), 3, 0.5);
  return total;
}

// Distance from p to the nearest rock edge (negative inside a rock); large with no rocks.
fn rock_clearance(p: vec2f) -> f32 {
  var clearance = 1e3;
  for (var i = 0u; i < bake.count; i++) {
    clearance = min(clearance, length(wrapped(p, rock_centre(i))) - bake.rocks[i].z);
  }
  return clearance;
}

// Foam: a ring at each rock, a tapering wake behind it (downstream along the local current), and a
// faint line in the bank shallows.
fn foam_mask(p: vec2f, depth_bank: f32) -> f32 {
  var foam = 0.45 * (1.0 - smoothstep(0.0, 0.14, depth_bank));
  for (var i = 0u; i < bake.count; i++) {
    let c = rock_centre(i);
    let radius = bake.rocks[i].z;
    let d = wrapped(p, c);
    let r = length(d);
    let rim = 1.0 - smoothstep(0.0, 0.03, r - radius);
    let flow_dir = normalize(channel_velocity(c) + vec2f(1e-5, 0.0));
    let along = dot(d, flow_dir);
    let sideways = dot(d, vec2f(-flow_dir.y, flow_dir.x));
    let width = 0.5 * radius + 0.12 * max(along, 0.0);
    let wake = smoothstep(0.0, 0.03, along) * exp(-max(along, 0.0) / (5.0 * radius)) *
      exp(-0.5 * sideways * sideways / (width * width));
    foam = max(foam, max(0.6 * rim, 0.6 * wake));
  }
  return foam;
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let p = vec2f(in.uv.x * WORLD_W, in.uv.y);
  let eps = 0.5 * bake.texel;
  let v = vec2f(
    psi(p + vec2f(0.0, eps)) - psi(p - vec2f(0.0, eps)),
    -(psi(p + vec2f(eps, 0.0)) - psi(p - vec2f(eps, 0.0))),
  ) / (2.0 * eps);

  let s = across(p);
  // Shallow ramp at the banks (zero exactly on the bank streamline), 1 in the middle third; the rocks
  // add their own ramp, 0.08 wide.
  let depth_bank = smoothstep(0.0, 0.5, 1.0 - abs(s));
  let clearance = rock_clearance(p);
  let depth = min(depth_bank, smoothstep(0.0, 0.08, clearance));
  // Still water against solid ground. A mask on the velocity only keeps the field divergence-free
  // where the flow runs along the mask's contours: along the bank (the mask depends on s alone) and
  // on the rock outline itself, so the rock mask is thin, and the stream function already makes the
  // flow tangent there.
  let moving = v * smoothstep(0.0, 0.1, depth_bank) * smoothstep(0.004, 0.01, clearance);
  // No foam on dry ground.
  let foam = foam_mask(p, depth_bank) * smoothstep(0.0, 0.004, depth);
  return vec4f(flow_encode(moving), foam, depth);
}
`;function g(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function _(e,t){let n=g(t*2654435761),r=2/Math.max(e,1),i=[];for(let t=0;t<e;t++){let e=(t+.5+(n()-.5)*.5)*r,a=(t%2==0?1:-1)*(.1+.32*n()),o=.03+.022*n();i.push(e%2,a,o,0)}return i}function v(e,t={}){let a=t.width??1024;if(!Number.isInteger(a)||a<32||a>4096||a%2!=0)throw RangeError(`createFlowMap: width must be an even integer in 32..4096, got ${a}`);let o=a/2,s=u(t.rocks??6,0,p),c=t.label??`flow map`,l=`rgba8unorm`,d=e.createTexture({label:c,size:[a,o],format:l,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),f=n(e,m,`${c} params`);f.set({rocks:_(s,t.seed??1),count:s,turbulence:Math.min(3,Math.max(0,t.turbulence??.6)),texel:1/o}),f.upload();let g=i(e,{label:`${c} bake`,fragment:{label:`bake/flow.wgsl`,code:h,chunks:{"params.wgsl":m.wgsl}},format:l}),v=e.createBindGroup({label:`${c} bake`,layout:g.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:f.buffer}}]}),y=e.createCommandEncoder({label:`${c} bake`});return r(y,d.createView({label:`${c} target`}),g,[v]),e.queue.submit([y.finish()]),f.destroy(),{texture:d,view:d.createView({label:`${c} view`}),format:l,width:a,height:o,bytes:a*o*4,destroy:()=>d.destroy()}}function y(e){return e.createSampler({label:`flow map sampler`,addressModeU:`repeat`,addressModeV:`clamp-to-edge`,magFilter:`linear`,minFilter:`linear`})}export{f as i,y as n,d as r,v as t};