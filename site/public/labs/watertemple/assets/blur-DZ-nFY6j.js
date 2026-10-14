import{n as e}from"./targets-Dcl181Ey.js";import{n as t,t as n}from"./uniforms-BE1XSnDx.js";import{r,t as i}from"./fullscreen-Dq3Mq0Js.js";import{n as a,r as o,t as s}from"./common-DyRXdhCv.js";var c=`#include "fullscreen.wgsl"
#include "blur_params.wgsl"

@group(0) @binding(0) var<uniform> params: BlurParams;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

// One axis of a Gaussian, exp(-i^2 / 2 sigma^2) for taps i = -radius..radius, normalised by the
// sum of the weights actually used so a truncated kernel still conserves energy.
//
// Taps i and i + 1 are fetched together: a bilinear sample placed between them, at their
// weight-weighted mean offset, returns exactly w_i * texel_i + w_(i+1) * texel_(i+1), so the loop
// makes half the fetches. That needs a filterable source and the clamp-to-edge linear sampler.
@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let step = params.direction / vec2f(textureDimensions(src));
  let k = -0.5 / (params.sigma * params.sigma);

  var sum = textureSampleLevel(src, samp, in.uv, 0.0);
  var total = 1.0;
  for (var i = 1; i <= params.radius; i += 2) {
    let w0 = exp(k * f32(i * i));
    let has_next = i < params.radius;
    let w1 = select(0.0, exp(k * f32((i + 1) * (i + 1))), has_next);
    let w = w0 + w1;
    if (w < 1e-6) { break; }
    let offset = (f32(i) * w0 + f32(i + 1) * w1) / w;
    let a = textureSampleLevel(src, samp, in.uv + step * offset, 0.0);
    let b = textureSampleLevel(src, samp, in.uv - step * offset, 0.0);
    sum += (a + b) * w;
    total += 2.0 * w;
  }
  return sum / total;
}
`,l=t(`BlurParams`,{direction:`vec2f`,radius:`i32`,sigma:`f32`}),u=o(e=>({layout:e.createBindGroupLayout({label:`blur layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),pipelines:new Map}));function d(e,t){let n=u(e),r=n.pipelines.get(t);return r||(r=i(e,{label:`blur ${t}`,fragment:{label:`passes/blur.wgsl`,code:c,chunks:{"blur_params.wgsl":l.wgsl}},format:t,layout:[n.layout]}),n.pipelines.set(t,r)),r}function f(t,i){let{label:o,format:c}=i;s(t,c,`createBlur`);let{layout:f}=u(t),p=d(t,c),m=e(t,{...i,label:`${o} intermediate`}),h=n(t,l,`${o} horizontal params`),g=n(t,l,`${o} vertical params`);h.set({direction:[1,0]}),g.set({direction:[0,1]});let _=new WeakMap,v=new WeakMap,y=(e,n,r)=>{let i=e.get(r);return i||(i=t.createBindGroup({label:`${o} bind group`,layout:f,entries:[{binding:0,resource:{buffer:n.buffer}},{binding:1,resource:r},{binding:2,resource:a(t)}]}),e.set(r,i)),i};return{encode(e,t,n,i){let a=Math.min(64,Math.max(0,Math.round(i.radius))),s=Math.max(i.sigma??(a+1)/3,.1);for(let e of[h,g])e.set({radius:a,sigma:s}),e.upload();r(e,m.view,p,[y(_,h,t)],{label:`${o} horizontal`}),r(e,n,p,[y(v,g,m.view)],{label:`${o} vertical`})},resize:(e,t)=>m.resize(e,t),destroy(){m.destroy(),h.destroy(),g.destroy()}}}export{f as t};