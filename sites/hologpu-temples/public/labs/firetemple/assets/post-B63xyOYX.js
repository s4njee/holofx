import{a as e,t}from"./shader-rxwXc-Rh.js";import{n}from"./profiler-Bi27xYp-.js";import{t as r}from"./fullscreen-BDXEFvdz.js";import{t as i}from"./color-DJti51Mr.js";import{t as a}from"./math-fT5w54uK.js";function o(e,n){let{fragment:r,blend:i,layout:a=`auto`}=n,o=n.label??r.label,s=typeof n.format==`string`?[n.format]:n.format,c=t(e,r);return e.createRenderPipeline({label:o,layout:a===`auto`?`auto`:e.createPipelineLayout({label:`${o} layout`,bindGroupLayouts:[...a]}),vertex:{module:c,entryPoint:`fullscreen_vs`},fragment:{module:c,entryPoint:n.entryPoint??`fs`,targets:s.map(e=>({format:e,blend:i}))}})}function s(e,t,...n){e.setPipeline(t),n.forEach((t,n)=>e.setBindGroup(n,t)),e.draw(3)}function c(e,t,n,r=[],i={}){let a=i.load?`load`:`clear`,o=e.beginRenderPass({label:i.label??n.label,colorAttachments:(`length`in t?t:[t]).map(e=>({view:e,loadOp:a,storeOp:`store`})),timestampWrites:i.timestampWrites});s(o,n,...r),o.end()}function l(e,t){if(!Number.isFinite(e))throw RangeError(`Render target ${t} must be finite`);return Math.max(1,Math.round(e))}function u(e,t){let{label:n,format:r}=t,i=t.usage??GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING,a=l(t.width,`width`),o=l(t.height,`height`),s=!1,c=()=>e.createTexture({label:n,size:[a,o],format:r,usage:i}),u=c(),d=u.createView({label:`${n} view`});return{label:n,format:r,usage:i,get texture(){return u},get view(){return d},get width(){return a},get height(){return o},resize(e,t){let r=l(e,`width`),i=l(t,`height`);return s||r===a&&i===o?!1:(u.destroy(),a=r,o=i,u=c(),d=u.createView({label:`${n} view`}),!0)},destroy(){s=!0,u.destroy()}}}function d(e,t){return{array:e,count:t}}var f={f32:{scalar:`f32`,length:1,align:4,size:4},i32:{scalar:`i32`,length:1,align:4,size:4},u32:{scalar:`u32`,length:1,align:4,size:4},vec2f:{scalar:`f32`,length:2,align:8,size:8},vec3f:{scalar:`f32`,length:3,align:16,size:12},vec4f:{scalar:`f32`,length:4,align:16,size:16},vec2i:{scalar:`i32`,length:2,align:8,size:8},vec3i:{scalar:`i32`,length:3,align:16,size:12},vec4i:{scalar:`i32`,length:4,align:16,size:16},vec2u:{scalar:`u32`,length:2,align:8,size:8},vec3u:{scalar:`u32`,length:3,align:16,size:12},vec4u:{scalar:`u32`,length:4,align:16,size:16},mat3x3f:{scalar:`f32`,length:9,align:16,size:48,columns:3,rows:3},mat4x4f:{scalar:`f32`,length:16,align:16,size:64,columns:4,rows:4}},p=new Set([`vec3f`,`vec4f`,`vec3i`,`vec4i`,`vec3u`,`vec4u`,`mat4x4f`]),m=/^[A-Za-z_][A-Za-z0-9_]*$/,h=(e,t)=>Math.ceil(t/e)*e;function g(e,t){if(typeof t==`string`){if(!Object.hasOwn(f,t))throw TypeError(`${e}: unsupported type "${t}"`);let n=f[t];return{align:n.align,size:n.size,wgsl:t}}if(!p.has(t.array))throw TypeError(`${e}: array<${t.array}> has a stride that is not a multiple of 16, which the uniform address space requires; pack the data into vec4f`);if(!Number.isInteger(t.count)||t.count<1)throw RangeError(`${e}: array count must be a positive integer, got ${t.count}`);let n=f[t.array];return{align:16,size:t.count*h(n.align,n.size),wgsl:`array<${t.array}, ${t.count}>`}}function _(e,t){if(!m.test(e))throw TypeError(`"${e}" is not a valid WGSL identifier`);let n=Object.entries(t);if(n.length===0)throw RangeError(`${e}: a uniform struct needs a field`);let r=[],i=[],a=0,o=1;for(let[t,s]of n){if(!m.test(t))throw TypeError(`${e}: "${t}" is not a valid WGSL identifier`);let n=g(`${e}.${t}`,s),c=h(n.align,a);r.push({name:t,type:s,offset:c,size:n.size}),i.push(`  ${t}: ${n.wgsl},`),a=c+n.size,o=Math.max(o,n.align)}return{name:e,layout:r,size:h(o,a),align:o,wgsl:`struct ${e} {\n${i.join(`
`)}\n}\n`,fields:t}}var v=e=>typeof e==`object`&&!!e&&`length`in e,y=new Float32Array(16);function b(e,t,n,r){let i=e.u32[n];return e[t][n]=r??0,e.u32[n]!==i}function x(e,t,n,r,i){let a=n>>2,o=!1;if(t.columns!==void 0&&t.rows!==void 0){let n=r.length===t.columns*4?4:t.rows;for(let s=0;s<t.columns;s++)for(let c=0;c<t.rows;c++){let l=r[i+s*n+c];o=b(e,t.scalar,a+s*4+c,l)||o}}else for(let n=0;n<t.length;n++)o=b(e,t.scalar,a+n,r[i+n])||o;return o}function S(e,t,n,r){let i=`${t}.${n.name}`,{type:a}=n;if(typeof a==`string`){let t=f[a];if(t.length===1){if(typeof r!=`number`)throw TypeError(`${i}: expected a number`);return b(e,t.scalar,n.offset>>2,r)}if(!v(r))throw TypeError(`${i}: expected ${a} as an array of numbers`);let o=t.columns!==void 0&&r.length===t.columns*4;if(r.length!==t.length&&!o)throw RangeError(`${i}: ${a} takes ${t.length} numbers, got ${r.length}`);return x(e,t,n.offset,r,0)}let o=f[a.array],s=h(o.align,o.size);if(!v(r))throw TypeError(`${i}: expected a flat array of numbers`);let c=r.length/o.length;if(!Number.isInteger(c)||c>a.count)throw RangeError(`${i}: array<${a.array}, ${a.count}> takes up to ${a.count*o.length} numbers in multiples of ${o.length}, got ${r.length}`);let l=!1;for(let t=0;t<a.count;t++){let i=t<c,a=n.offset+t*s;l=(i?x(e,o,a,r,t*o.length):x(e,o,a,y,0))||l}return l}function C(e,t,n=t.name){let r=new ArrayBuffer(h(16,t.size)),i={f32:new Float32Array(r),i32:new Int32Array(r),u32:new Uint32Array(r)},a=new Map(t.layout.map(e=>[e.name,e])),o=e.createBuffer({label:n,size:r.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),s=!1;return{struct:t,buffer:o,set(e){for(let[n,r]of Object.entries(e)){let e=a.get(n);if(!e)throw TypeError(`${t.name} has no field "${n}"`);r!==void 0&&S(i,t.name,e,r)&&(s=!0)}},upload(){return s?(e.queue.writeBuffer(o,0,r),s=!1,!0):!1},destroy(){o.destroy()}}}function w(e){let t=new WeakMap;return n=>{let r=t.get(n);return r===void 0&&(r=e(n),t.set(n,r)),r}}var T=w(e=>e.createSampler({label:`passes linear sampler`,magFilter:`linear`,minFilter:`linear`})),E=new Set([`r8unorm`,`rg8unorm`,`rgba8unorm`,`rgba8unorm-srgb`,`bgra8unorm`,`bgra8unorm-srgb`,`r16float`,`rg16float`,`rgba16float`,`rgb10a2unorm`]),D=new Set([`r32float`,`rg32float`,`rgba32float`]);function O(e,t,n){if(!E.has(t)){if(D.has(t)){if(e.features.has(`float32-filterable`))return;throw Error(`${n}: ${t} is not filterable on this device (it needs the 'float32-filterable' feature). Use rgba16float, or request the feature when creating the device.`)}if(!(t===`rg11b10ufloat`&&e.features.has(`rg11b10ufloat-renderable`)))throw Error(`${n}: ${t} cannot be filtered and rendered to. Use rgba8unorm, rgba16float or another filterable colour format.`)}}var k={label:`passes/downsample.wgsl`,code:`#include "fullscreen.wgsl"

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

// 13 bilinear taps, offsets in source texels from the target pixel's centre (a is -2,-2; j is -1,-1):
//   a . b . c
//   . j . k .
//   d . e . f
//   . l . m .
//   g . h . i
fn tap(uv: vec2f, texel: vec2f, x: f32, y: f32) -> vec4f {
  return textureSampleLevel(src, samp, uv + vec2f(x, y) * texel, 0.0);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  let texel = 1.0 / vec2f(textureDimensions(src));

  let a = tap(uv, texel, -2.0, -2.0);
  let b = tap(uv, texel, 0.0, -2.0);
  let c = tap(uv, texel, 2.0, -2.0);
  let d = tap(uv, texel, -2.0, 0.0);
  let e = tap(uv, texel, 0.0, 0.0);
  let f = tap(uv, texel, 2.0, 0.0);
  let g = tap(uv, texel, -2.0, 2.0);
  let h = tap(uv, texel, 0.0, 2.0);
  let i = tap(uv, texel, 2.0, 2.0);
  let j = tap(uv, texel, -1.0, -1.0);
  let k = tap(uv, texel, 1.0, -1.0);
  let l = tap(uv, texel, -1.0, 1.0);
  let m = tap(uv, texel, 1.0, 1.0);

  // Five boxes of four taps each: the centre box (j k l m) weighs 0.5 and the four corner boxes
  // (a b d e, b c e f, d e g h, e f h i) 0.125 each, so e is shared by four of them. Weights sum to 1.
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
`,chunks:{"fullscreen.wgsl":r}},A={label:`post/bloom-down.wgsl`,code:`// Bloom downsample chain. The 13-tap filter is the shared one in passes/downsample.wgsl, included as
// the chunk "downsample13.wgsl" (it brings \`src\`, \`samp\`, \`tap\` and the plain \`fs\` entry point).
// This file adds the first-level entry point: soft-knee threshold + Karis average, then intensity.
#include "downsample13.wgsl"
#include "color.wgsl"
#include "bloom-params.wgsl"

@group(0) @binding(2) var<uniform> bloom: BloomParams;

// Unity-style soft knee on the brightest channel. Everything at or below (threshold - knee) is
// removed; between there and (threshold + knee) a quadratic fades the contribution in so the glow
// does not pop on and off as a pixel crosses the threshold. Above that the excess over the
// threshold is kept, with hue preserved by scaling the whole colour.
fn _bloom_prefilter(colour: vec3f) -> vec3f {
  let c = clamp(colour, vec3f(0.0), vec3f(65000.0));
  let brightness = max(c.r, max(c.g, c.b));
  let knee = max(bloom.knee, 1e-5);
  let soft = clamp(brightness - bloom.threshold + knee, 0.0, 2.0 * knee);
  let curve = soft * soft / (4.0 * knee);
  let kept = max(curve, brightness - bloom.threshold) / max(brightness, 1e-5);
  return c * kept;
}

// Karis average: weight each of the five 4-tap boxes by 1 / (1 + luma) so one very bright pixel
// cannot dominate a box. Without it a single hot pixel becomes a flickering firefly at lower mips as
// the image moves. Weights are renormalised, so the result is a weighted mean (this does remove
// energy from isolated hot pixels on purpose; turn it off with \`karis = 0\` to conserve it).
fn _bloom_weight(box_colour: vec3f, base: f32) -> f32 {
  if (bloom.karis < 0.5) { return base; }
  return base / (1.0 + luminance(box_colour));
}

@fragment fn fs_prefilter(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  let texel = 1.0 / vec2f(textureDimensions(src));

  let a = tap(uv, texel, -2.0, -2.0).rgb;
  let b = tap(uv, texel, 0.0, -2.0).rgb;
  let c = tap(uv, texel, 2.0, -2.0).rgb;
  let d = tap(uv, texel, -2.0, 0.0).rgb;
  let e = tap(uv, texel, 0.0, 0.0).rgb;
  let f = tap(uv, texel, 2.0, 0.0).rgb;
  let g = tap(uv, texel, -2.0, 2.0).rgb;
  let h = tap(uv, texel, 0.0, 2.0).rgb;
  let i = tap(uv, texel, 2.0, 2.0).rgb;
  let j = tap(uv, texel, -1.0, -1.0).rgb;
  let k = tap(uv, texel, 1.0, -1.0).rgb;
  let l = tap(uv, texel, -1.0, 1.0).rgb;
  let m = tap(uv, texel, 1.0, 1.0).rgb;

  // The same five overlapping boxes as the plain filter: centre 0.5, four corners 0.125 each.
  let p0 = _bloom_prefilter((a + b + d + e) * 0.25);
  let p1 = _bloom_prefilter((b + c + e + f) * 0.25);
  let p2 = _bloom_prefilter((d + e + g + h) * 0.25);
  let p3 = _bloom_prefilter((e + f + h + i) * 0.25);
  let p4 = _bloom_prefilter((j + k + l + m) * 0.25);
  let w0 = _bloom_weight(p0, 0.125);
  let w1 = _bloom_weight(p1, 0.125);
  let w2 = _bloom_weight(p2, 0.125);
  let w3 = _bloom_weight(p3, 0.125);
  let w4 = _bloom_weight(p4, 0.5);
  let mean = (p0 * w0 + p1 * w1 + p2 * w2 + p3 * w3 + p4 * w4) / (w0 + w1 + w2 + w3 + w4);
  return vec4f(mean * bloom.intensity, 1.0);
}
`,chunks:{"color.wgsl":i,"math.wgsl":a}},j={label:`post/bloom-up.wgsl`,code:`#include "fullscreen.wgsl"

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

// 3x3 tent filter, weights 1 2 1 / 2 4 2 / 1 2 1 over 16, taps one texel of \`src\` apart and
// bilinearly filtered, so the coarse level is reconstructed smoothly rather than blockily.
// The pass blends this over the finer level with a constant factor (see bloom.ts), so the shader
// itself does not know about radius.
fn up_tap(uv: vec2f, texel: vec2f, x: f32, y: f32) -> vec3f {
  return textureSampleLevel(src, samp, uv + vec2f(x, y) * texel, 0.0).rgb;
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  let texel = 1.0 / vec2f(textureDimensions(src));
  var sum = up_tap(uv, texel, 0.0, 0.0) * 4.0;
  sum += (up_tap(uv, texel, -1.0, 0.0) + up_tap(uv, texel, 1.0, 0.0) +
          up_tap(uv, texel, 0.0, -1.0) + up_tap(uv, texel, 0.0, 1.0)) * 2.0;
  sum += up_tap(uv, texel, -1.0, -1.0) + up_tap(uv, texel, 1.0, -1.0) +
         up_tap(uv, texel, -1.0, 1.0) + up_tap(uv, texel, 1.0, 1.0);
  return vec4f(sum / 16.0, 1.0);
}
`,chunks:{"fullscreen.wgsl":r}},M=`rgba16float`,N=_(`BloomParams`,{threshold:`f32`,knee:`f32`,intensity:`f32`,karis:`f32`}),P={intensity:.6,threshold:1,knee:.5,radius:.7,levels:0,fireflyFilter:!0},F=w(t=>{let n=(e,t)=>({binding:e,visibility:GPUShaderStage.FRAGMENT,...t===`texture`?{texture:{sampleType:`float`}}:t===`sampler`?{sampler:{type:`filtering`}}:{buffer:{type:`uniform`}}}),r=t.createBindGroupLayout({label:`bloom down layout`,entries:[n(0,`texture`),n(1,`sampler`)]}),i=t.createBindGroupLayout({label:`bloom prefilter layout`,entries:[n(0,`texture`),n(1,`sampler`),n(2,`uniform`)]}),a=e(A,k.chunks,{"downsample13.wgsl":k.code,"bloom-params.wgsl":N.wgsl}),s={srcFactor:`constant`,dstFactor:`one-minus-constant`,operation:`add`};return{downLayout:r,prefilterLayout:i,down:o(t,{label:`bloom down`,fragment:a,entryPoint:`fs`,format:M,layout:[r]}),prefilter:o(t,{label:`bloom prefilter`,fragment:a,entryPoint:`fs_prefilter`,format:M,layout:[i]}),up:o(t,{label:`bloom up`,fragment:j,format:M,blend:{color:s,alpha:s},layout:[r]})}}),I=e=>Math.max(1,e+1>>1);function L(e,t,n=!0){let r=Math.max(1,Math.round(e)),i=Math.max(1,Math.round(t));n&&([r,i]=[I(r),I(i)]);let a=[[r,i]];for(;a.length<8;){let e=[I(r),I(i)];if(Math.min(e[0],e[1])<4)break;a.push(e),[r,i]=e}return a}function R(e,t,n=!0){let r=Math.round(Math.log2(Math.max(1,Math.min(e,t))/34))+ +!n,i=L(e,t,n).length;return Math.max(1,Math.min(i,8,r))}function z(e,t){let r=t.label??`bloom`,i=t.halfResolution??!0,a=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|(t.readable?GPUTextureUsage.COPY_SRC:0),o=F(e),l=C(e,N,`${r} params`),d=T(e),f=[],p=new WeakMap,m=new WeakMap,h=L(t.width,t.height,i),g=[t.width,t.height],_=!1,v=t=>{let n=p.get(t);return n||(n=e.createBindGroup({label:`${r} prefilter source`,layout:o.prefilterLayout,entries:[{binding:0,resource:t},{binding:1,resource:d},{binding:2,resource:{buffer:l.buffer}}]}),p.set(t,n)),n},y=t=>{let n=m.get(t);return n||(n=e.createBindGroup({label:`${r} level source`,layout:o.downLayout,entries:[{binding:0,resource:t},{binding:1,resource:d}]}),m.set(t,n)),n};function b(t){for(;f.length<t;){let[t,n]=h[f.length]??[1,1];f.push(u(e,{label:`${r} level ${f.length}`,format:M,width:t,height:n,usage:a}))}}return{format:M,levels:f,maxLevels:()=>h.length,levelSizes:()=>f.map(e=>[e.width,e.height]),resize(e,t){if(_)return!1;h=L(e,t,i),g=[e,t];let n=!1;for(let e of f.splice(h.length))e.destroy(),n=!0;return f.forEach((e,t)=>{let[r,i]=h[t]??[1,1];n=e.resize(r,i)||n}),n},encode(e,t,a={},u=n){let d={...P,...a};if(_||!(d.intensity>0))return;let p=d.levels>0?d.levels:R(...g,i),m=Math.min(h.length,Math.max(1,Math.min(8,Math.round(p))));b(m),l.set({threshold:Math.max(0,d.threshold),knee:Math.max(0,d.knee),intensity:d.intensity,karis:+!!d.fireflyFilter}),l.upload(),c(e,f[0].view,o.prefilter,[v(t)],{label:`${r} prefilter`,timestampWrites:u.pass(`bloom-down`)});for(let t=1;t<m;t++)c(e,f[t].view,o.down,[y(f[t-1].view)],{label:`${r} down ${t}`,timestampWrites:u.pass(`bloom-down`)});let x=Math.min(1,Math.max(0,d.radius));for(let t=m-2;t>=0;t--){let n=e.beginRenderPass({label:`${r} up ${t}`,colorAttachments:[{view:f[t].view,loadOp:`load`,storeOp:`store`}],timestampWrites:u.pass(`bloom-up`)});n.setBlendConstant({r:x,g:x,b:x,a:x}),s(n,o.up,y(f[t+1].view)),n.end()}return f[0].view},destroy(){_=!0;for(let e of f.splice(0))e.destroy();l.destroy()}}}var B={label:`post/output.wgsl`,code:`// Final pass of the HDR chain: scene (+ bloom) -> exposure -> tonemap -> sRGB -> dither -> canvas.
#include "fullscreen.wgsl"
#include "color.wgsl"
#include "output-params.wgsl"

@group(0) @binding(0) var scene_tex: texture_2d<f32>;
@group(0) @binding(1) var bloom_tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> post: OutputParams;

const TONEMAP_NONE = 0u;
const TONEMAP_ACES = 1u;
const TONEMAP_REINHARD = 2u;
const VIEW_FINAL = 0u;
const VIEW_SCENE = 1u;
const VIEW_BLOOM = 2u;
const ALPHA_OPAQUE = 0u;
const ALPHA_ADDITIVE = 1u;
const ALPHA_COVERAGE = 2u;
const ALPHA_LUMINANCE = 3u;

// The tonemap curve itself, not clamped for \`none\` so the HDR shoulder can continue past 1.
fn post_curve(c: vec3f, mode: u32) -> vec3f {
  if (mode == TONEMAP_ACES) { return tonemap_aces(c); }
  if (mode == TONEMAP_REINHARD) { return tonemap_reinhard(c); }
  return max(c, vec3f(0.0));
}

// Display-referred linear colour in [0, 1] for an SDR canvas.
fn post_map_sdr(c: vec3f, mode: u32) -> vec3f {
  return min(post_curve(c, mode), vec3f(1.0));
}

// Extended-range mapping for an HDR canvas. Up to scene value 1.0 (after exposure) it is exactly the
// SDR curve, so SDR content looks the same as it does on an SDR canvas. Above that, instead of
// clipping to 1 the curve keeps going with the slope the SDR curve had at 1.0 and rolls off
// smoothly (C1-continuous) towards \`headroom\`, in multiples of SDR white:
//   y(x) = f0 + d * slope / (1 + d * slope / (headroom - f0)),   d = x - 1
fn post_map_hdr(c: vec3f, mode: u32, headroom: f32) -> vec3f {
  let f0 = post_curve(vec3f(1.0), mode).x;
  let eps = 0.001;
  let slope = max((f0 - post_curve(vec3f(1.0 - eps), mode).x) / eps, 1e-3);
  // A headroom of 1 (or less) means "no HDR": the shoulder then tops out at SDR white.
  let room = max(max(headroom, 1.0) - f0, 1e-3);
  let d = max(c - vec3f(1.0), vec3f(0.0));
  let above = vec3f(f0) + d * slope / (vec3f(1.0) + d * slope / room);
  return select(above, post_map_sdr(c, mode), c <= vec3f(1.0));
}

// Interleaved gradient noise (Jimenez 2014): cheap, well distributed, no texture. Two evaluations
// at unrelated offsets summed give triangular-PDF noise in [-1, 1], which decorrelates the
// quantisation error from the signal (plain uniform noise leaves a little noise-modulated banding).
fn post_ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn post_dither(pixel: vec2f, frame: f32) -> f32 {
  let shift = vec2f(5.588238 * frame);
  return post_ign(pixel + shift) + post_ign(pixel.yx + vec2f(37.0, 91.0) + shift) - 1.0;
}

// Burn to white. The tonemap curves work per channel, so a very bright colour with an empty
// channel (flame orange has almost no blue) saturates to a pure secondary: (16, 12, 0) displays as
// lemon yellow however bright it gets. Film and eyes do the opposite: the hottest part of a flame
// goes white. This blends a colour toward a neutral of its own peak as that peak passes 2x paper
// white, complete by 16x. Colours at or below paper white are untouched.
fn post_whiten(c: vec3f, amount: f32) -> vec3f {
  let peak = max(c.r, max(c.g, c.b));
  let stops_over = log2(max(peak, 1e-4)) - 1.0;
  let w = amount * smoothstep(0.0, 3.0, stops_over);
  return mix(c, vec3f(peak), w);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let scene_texel = textureSampleLevel(scene_tex, samp, in.uv, 0.0);
  let scene = scene_texel.rgb;
  let glow = textureSampleLevel(bloom_tex, samp, in.uv, 0.0).rgb;

  var radiance = scene + glow;
  if (post.view == VIEW_SCENE) { radiance = scene; }
  if (post.view == VIEW_BLOOM) { radiance = glow; }

  let exposed = post_whiten(max(radiance, vec3f(0.0)) * post.exposure, post.whiten);
  var mapped = post_map_sdr(exposed, post.tonemap);
  if (post.hdr == 1u) { mapped = post_map_hdr(exposed, post.tonemap, post.headroom); }

  let encoded = linear_to_srgb(mapped);
  let noise = post_dither(in.position.xy, post.frame) * post.dither_lsb;
  if (post.alpha_mode == ALPHA_OPAQUE) {
    return vec4f(max(encoded + vec3f(noise), vec3f(0.0)), 1.0);
  }

  // See-through output for a premultiplied canvas: the page shows wherever alpha is below 1, and
  // the colour is added on top of it (the canvas blends as rgb + (1 - alpha) * page).
  let peak = max(encoded.r, max(encoded.g, encoded.b));
  // No dither where nothing is drawn: a fully transparent pixel must leave the page untouched.
  let grain = noise * smoothstep(0.0, 2.0 / 255.0, peak);
  let rgb = max(encoded + vec3f(grain), vec3f(0.0));

  var alpha = 0.0;
  if (post.alpha_mode == ALPHA_COVERAGE) { alpha = clamp(scene_texel.a, 0.0, 1.0); }
  if (post.alpha_mode == ALPHA_LUMINANCE) {
    // Taken from the colour that is actually written (dither included), so with a gain of 1 or
    // more no channel is ever above alpha: a valid premultiplied colour, whatever the browser
    // does with invalid ones.
    let written = max(rgb.r, max(rgb.g, rgb.b));
    alpha = clamp(max(scene_texel.a, written * post.alpha_gain), 0.0, 1.0);
  }

  // The underlay is a second, darker layer under the light: it dims the page around the fire,
  // using the bloom as a soft mask, so the flame stays the brightest thing on a page that is
  // already near white. \`veil\` is how much of the page it hides, at most \`underlay\`; the curve
  // lets it reach further out than the visible glow does. The two layers multiply (the page is
  // seen through both), so the underlay adds to every alpha mode instead of hiding behind it.
  let halo = linear_to_srgb(post_map_sdr(max(glow, vec3f(0.0)) * post.exposure, post.tonemap));
  let reach = 1.0 - clamp(max(halo.r, max(halo.g, halo.b)), 0.0, 1.0);
  let veil = clamp(post.underlay, 0.0, 1.0) * (1.0 - reach * reach * reach);
  alpha = 1.0 - (1.0 - alpha) * (1.0 - veil);
  return vec4f(rgb, alpha);
}
`,chunks:{"fullscreen.wgsl":r,"color.wgsl":i,"math.wgsl":a}},V=_(`OutputParams`,{exposure:`f32`,tonemap:`u32`,view:`u32`,hdr:`u32`,headroom:`f32`,dither_lsb:`f32`,frame:`f32`,alpha_mode:`u32`,alpha_gain:`f32`,underlay:`f32`,whiten:`f32`}),H=[`final`,`scene`,`bloom`],U=[`opaque`,`additive`,`coverage`,`luminance`],W={none:0,aces:1,reinhard:2},G={opaque:0,additive:1,coverage:2,luminance:3},K={final:0,scene:1,bloom:2},q=w(e=>{let t=e.createTexture({label:`post black`,size:[1,1],format:`rgba16float`,usage:GPUTextureUsage.TEXTURE_BINDING});return{layout:e.createBindGroupLayout({label:`post output layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),pipelines:new Map,black:t,blackView:t.createView()}});function J(t,n){let r=n.label??`post output`,i=q(t),a=C(t,V,`${r} params`),s=i.pipelines.get(n.format);s||(s=o(t,{label:`post output ${n.format}`,fragment:e(B,{"output-params.wgsl":V.wgsl}),format:n.format,layout:[i.layout]}),i.pipelines.set(n.format,s));let l,u;return{encode(e,n,o,d,f={},p){let m=d??i.blackView;(!l||u?.[0]!==o||u[1]!==m)&&(l=t.createBindGroup({label:r,layout:i.layout,entries:[{binding:0,resource:o},{binding:1,resource:m},{binding:2,resource:T(t)},{binding:3,resource:{buffer:a.buffer}}]}),u=[o,m]);let h=f.hdr===!0;a.set({exposure:Math.max(0,f.exposure??1),tonemap:W[f.tonemap??`aces`],view:K[f.view??`final`],hdr:+!!h,headroom:Math.max(1,f.headroom??3),dither_lsb:(f.dither??1)/255*(h?.25:1),frame:(f.frame??0)%64,alpha_mode:G[f.alpha??`opaque`],alpha_gain:Math.max(0,f.alphaGain??1),underlay:Math.min(1,Math.max(0,f.underlay??0)),whiten:Math.min(1,Math.max(0,f.whiten??0))}),a.upload(),c(e,n,s,[l],{label:r,timestampWrites:p})},destroy(){a.destroy(),l=void 0,u=void 0}}}function Y(e,t){let r=t.label??`post`,i=t.sceneFormat??`rgba16float`;O(e,i,`createPostChain`);let a=u(e,{label:`${r} scene`,format:i,width:t.width,height:t.height}),o=z(e,{label:`${r} bloom`,width:a.width,height:a.height,halfResolution:t.bloomHalfResolution}),s=J(e,{format:t.canvasFormat,label:`${r} output`});return{scene:a,bloom:o,output:s,get width(){return a.width},get height(){return a.height},resize(e,t){let n=a.resize(e,t);return o.resize(a.width,a.height),n},encode(e,t,r={},i=n){let c=r.bloom===!1||r.output?.view===`scene`?void 0:o.encode(e,a.view,r.bloom??{},i);s.encode(e,t,a.view,c,r.output,i.pass(`output`))},destroy(){o.destroy(),s.destroy(),a.destroy()}}}var X={exposure:{type:`number`,default:1,min:0,max:4,step:.01},bloom:{type:`number`,default:.6,min:0,max:2,step:.01},bloomThreshold:{type:`number`,default:1,min:0,max:8,step:.05,label:`bloom threshold`},bloomRadius:{type:`number`,default:.7,min:0,max:1,step:.01,label:`bloom radius`}},Z={alpha:{type:`select`,default:`luminance`,options:U},alphaGain:{type:`number`,default:1,min:0,max:4,step:.05,label:`alpha gain`},underlay:{type:`number`,default:.3,min:0,max:1,step:.01}},Q=e=>U.includes(e??``);function $(e,t,n=!1){return{bloom:e.bloom>0&&{intensity:e.bloom,threshold:e.bloomThreshold,radius:e.bloomRadius},output:{exposure:e.exposure,frame:t.frame,hdr:n,alpha:Q(e.alpha)?e.alpha:`opaque`,alphaGain:e.alphaGain,underlay:e.underlay,whiten:e.burn}}}function ee(e,t){let n=Y(e,{canvasFormat:t.format,width:1,height:1,bloomHalfResolution:t.bloomHalfResolution,label:t.label??`tail`}),r=t.hdr===!0;return{scene:n.scene,chain:n,resize:(e,t)=>n.resize(e,t),encode(e,t,i,a,o,s){let c=$(a,i,r),l=s?.bloom,u=l===void 0?c.bloom:l===!1?!1:c.bloom===!1?l.intensity!==void 0&&l:{...c.bloom,...l};n.encode(e,t,{bloom:u,output:{...c.output,...s?.output}},o)},destroy:()=>n.destroy()}}export{P as a,T as c,_ as d,d as f,c as g,s as h,H as i,w as l,o as m,X as n,R as o,u as p,ee as r,O as s,Z as t,C as u};