import{n as e}from"./profiler-Bi27xYp-.js";import{n as t}from"./targets-Dcl181Ey.js";import{n,t as r}from"./uniforms-BE1XSnDx.js";import{n as i,r as a,t as o}from"./fullscreen-Dq3Mq0Js.js";import{n as s,r as c,t as l}from"./common-DyRXdhCv.js";import{t as u}from"./downsample-v-eveBQa.js";var d=`// Bloom downsample chain. The 13-tap filter is the shared one in passes/downsample.wgsl, included as
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
`,f=`#include "fullscreen.wgsl"

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
`,p=`rgba16float`,m=n(`BloomParams`,{threshold:`f32`,knee:`f32`,intensity:`f32`,karis:`f32`}),h={intensity:.6,threshold:1,knee:.5,radius:.7,levels:5,fireflyFilter:!0},g=c(e=>{let t=(e,t)=>({binding:e,visibility:GPUShaderStage.FRAGMENT,...t===`texture`?{texture:{sampleType:`float`}}:t===`sampler`?{sampler:{type:`filtering`}}:{buffer:{type:`uniform`}}}),n=e.createBindGroupLayout({label:`bloom down layout`,entries:[t(0,`texture`),t(1,`sampler`)]}),r=e.createBindGroupLayout({label:`bloom prefilter layout`,entries:[t(0,`texture`),t(1,`sampler`),t(2,`uniform`)]}),i={"downsample13.wgsl":u,"bloom-params.wgsl":m.wgsl},a={srcFactor:`constant`,dstFactor:`one-minus-constant`,operation:`add`};return{downLayout:n,prefilterLayout:r,down:o(e,{label:`bloom down`,fragment:{label:`post/bloom-down.wgsl`,code:d,chunks:i},entryPoint:`fs`,format:p,layout:[n]}),prefilter:o(e,{label:`bloom prefilter`,fragment:{label:`post/bloom-down.wgsl`,code:d,chunks:i},entryPoint:`fs_prefilter`,format:p,layout:[r]}),up:o(e,{label:`bloom up`,fragment:{label:`post/bloom-up.wgsl`,code:f},format:p,blend:{color:a,alpha:a},layout:[n]})}}),_=e=>Math.max(1,e+1>>1);function v(e,t,n=!0){let r=Math.max(1,Math.round(e)),i=Math.max(1,Math.round(t));n&&([r,i]=[_(r),_(i)]);let a=[[r,i]];for(;a.length<8;){let e=[_(r),_(i)];if(Math.min(e[0],e[1])<4)break;a.push(e),[r,i]=e}return a}function y(n,o){let c=o.label??`bloom`,l=o.halfResolution??!0,u=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|(o.readable?GPUTextureUsage.COPY_SRC:0),d=g(n),f=r(n,m,`${c} params`),_=s(n),y=[],b=new WeakMap,x=new WeakMap,S=v(o.width,o.height,l),C=!1,w=e=>{let t=b.get(e);return t||(t=n.createBindGroup({label:`${c} prefilter source`,layout:d.prefilterLayout,entries:[{binding:0,resource:e},{binding:1,resource:_},{binding:2,resource:{buffer:f.buffer}}]}),b.set(e,t)),t},T=e=>{let t=x.get(e);return t||(t=n.createBindGroup({label:`${c} level source`,layout:d.downLayout,entries:[{binding:0,resource:e},{binding:1,resource:_}]}),x.set(e,t)),t};function E(e){for(;y.length<e;){let[e,r]=S[y.length]??[1,1];y.push(t(n,{label:`${c} level ${y.length}`,format:p,width:e,height:r,usage:u}))}}return{format:p,levels:y,maxLevels:()=>S.length,levelSizes:()=>y.map(e=>[e.width,e.height]),resize(e,t){if(C)return!1;S=v(e,t,l);let n=!1;for(let e of y.splice(S.length))e.destroy(),n=!0;return y.forEach((e,t)=>{let[r,i]=S[t]??[1,1];n=e.resize(r,i)||n}),n},encode(t,n,r={},o=e){let s={...h,...r};if(C||!(s.intensity>0))return;let l=Math.min(S.length,Math.max(1,Math.min(8,Math.round(s.levels))));E(l),f.set({threshold:Math.max(0,s.threshold),knee:Math.max(0,s.knee),intensity:s.intensity,karis:+!!s.fireflyFilter}),f.upload(),a(t,y[0].view,d.prefilter,[w(n)],{label:`${c} prefilter`,timestampWrites:o.pass(`bloom-down`)});for(let e=1;e<l;e++)a(t,y[e].view,d.down,[T(y[e-1].view)],{label:`${c} down ${e}`,timestampWrites:o.pass(`bloom-down`)});let u=Math.min(1,Math.max(0,s.radius));for(let e=l-2;e>=0;e--){let n=t.beginRenderPass({label:`${c} up ${e}`,colorAttachments:[{view:y[e].view,loadOp:`load`,storeOp:`store`}],timestampWrites:o.pass(`bloom-up`)});n.setBlendConstant({r:u,g:u,b:u,a:u}),i(n,d.up,T(y[e+1].view)),n.end()}return y[0].view},destroy(){C=!0;for(let e of y.splice(0))e.destroy();f.destroy()}}}var b=`// Final pass of the HDR chain: scene (+ bloom) -> exposure -> tonemap -> sRGB -> dither -> canvas.
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

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let scene = textureSampleLevel(scene_tex, samp, in.uv, 0.0).rgb;
  let glow = textureSampleLevel(bloom_tex, samp, in.uv, 0.0).rgb;

  var radiance = scene + glow;
  if (post.view == VIEW_SCENE) { radiance = scene; }
  if (post.view == VIEW_BLOOM) { radiance = glow; }

  let exposed = max(radiance, vec3f(0.0)) * post.exposure;
  var mapped = post_map_sdr(exposed, post.tonemap);
  if (post.hdr == 1u) { mapped = post_map_hdr(exposed, post.tonemap, post.headroom); }

  let encoded = linear_to_srgb(mapped);
  let noise = post_dither(in.position.xy, post.frame) * post.dither_lsb;
  return vec4f(max(encoded + vec3f(noise), vec3f(0.0)), 1.0);
}
`,x=n(`OutputParams`,{exposure:`f32`,tonemap:`u32`,view:`u32`,hdr:`u32`,headroom:`f32`,dither_lsb:`f32`,frame:`f32`}),S=[`aces`,`reinhard`,`none`],C=[`final`,`scene`,`bloom`],w={none:0,aces:1,reinhard:2},T={final:0,scene:1,bloom:2},E=c(e=>{let t=e.createTexture({label:`post black`,size:[1,1],format:`rgba16float`,usage:GPUTextureUsage.TEXTURE_BINDING});return{layout:e.createBindGroupLayout({label:`post output layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),pipelines:new Map,black:t,blackView:t.createView()}});function D(e,t){let n=t.label??`post output`,i=E(e),c=r(e,x,`${n} params`),l=i.pipelines.get(t.format);l||(l=o(e,{label:`post output ${t.format}`,fragment:{label:`post/output.wgsl`,code:b,chunks:{"output-params.wgsl":x.wgsl}},format:t.format,layout:[i.layout]}),i.pipelines.set(t.format,l));let u,d;return{encode(t,r,o,f,p={},m){let h=f??i.blackView;(!u||d?.[0]!==o||d[1]!==h)&&(u=e.createBindGroup({label:n,layout:i.layout,entries:[{binding:0,resource:o},{binding:1,resource:h},{binding:2,resource:s(e)},{binding:3,resource:{buffer:c.buffer}}]}),d=[o,h]);let g=p.hdr===!0;c.set({exposure:Math.max(0,p.exposure??1),tonemap:w[p.tonemap??`aces`],view:T[p.view??`final`],hdr:+!!g,headroom:Math.max(1,p.headroom??3),dither_lsb:(p.dither??1)/255*(g?.25:1),frame:(p.frame??0)%64}),c.upload(),a(t,r,l,[u],{label:n,timestampWrites:m})},destroy(){c.destroy(),u=void 0,d=void 0}}}function O(n,r){let i=r.label??`post`,a=r.sceneFormat??`rgba16float`;l(n,a,`createPostChain`);let o=t(n,{label:`${i} scene`,format:a,width:r.width,height:r.height}),s=y(n,{label:`${i} bloom`,width:o.width,height:o.height,halfResolution:r.bloomHalfResolution}),c=D(n,{format:r.canvasFormat,label:`${i} output`});return{scene:o,bloom:s,output:c,get width(){return o.width},get height(){return o.height},resize(e,t){let n=o.resize(e,t);return s.resize(o.width,o.height),n},encode(t,n,r={},i=e){let a=r.bloom===!1||r.output?.view===`scene`?void 0:s.encode(t,o.view,r.bloom??{},i);c.encode(t,n,o.view,a,r.output,i.pass(`output`))},destroy(){s.destroy(),c.destroy(),o.destroy()}}}export{D as i,C as n,S as r,O as t};