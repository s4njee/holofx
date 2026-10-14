import{n as e,t}from"./uniforms-BE1XSnDx.js";import{r as n,t as r}from"./fullscreen-Dq3Mq0Js.js";import{n as i,t as a}from"./mipmap-caehtsny.js";var o=[`cellular`,`sine`],s=e(`CausticsBake`,{cells:`i32`,method:`u32`,sharp:`f32`}),c=`
#include "fullscreen.wgsl"
#include "caustics.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> bake: CausticsBake;

// Four slices of one loop, a quarter loop apart: r at 0, g at TAU/4, b at TAU/2, a at 3 TAU/4.
@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  let q = HALF_PI;
  return vec4f(
    caustics_eval(bake.method, uv, bake.cells, 0.0, bake.sharp),
    caustics_eval(bake.method, uv, bake.cells, q, bake.sharp),
    caustics_eval(bake.method, uv, bake.cells, 2.0 * q, bake.sharp),
    caustics_eval(bake.method, uv, bake.cells, 3.0 * q, bake.sharp),
  );
}
`;function l(e){return Number.isInteger(e)&&e>0&&!(e&e-1)}function u(e,t,n){return Math.min(n,Math.max(t,Math.round(e)))}function d(e,d={}){let f=d.size??512;if(!l(f)||f<32||f>2048)throw RangeError(`createCausticsMap: size must be a power of two in 32..2048, got ${f}`);let p=u(d.cells??12,1,32),m=d.method??`cellular`,h=Math.max(0,o.indexOf(m)),g=d.label??`caustics map`,_=i(f,f),v=`rgba16float`,y=e.createTexture({label:g,size:[f,f],format:v,mipLevelCount:_,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),b=t(e,s,`${g} params`);b.set({cells:p,method:h,sharp:Math.min(1,Math.max(0,d.sharpness??.85))}),b.upload();let x=r(e,{label:`${g} bake`,fragment:{label:`bake/caustics.wgsl`,code:c,chunks:{"params.wgsl":s.wgsl}},format:v}),S=e.createBindGroup({label:`${g} bake`,layout:x.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:b.buffer}}]}),C=e.createCommandEncoder({label:`${g} bake`});n(C,y.createView({label:`${g} level 0`,baseMipLevel:0,mipLevelCount:1}),x,[S]),a(e,y,C),e.queue.submit([C.finish()]),b.destroy();let w=0;for(let e=0;e<_;e++){let t=Math.max(1,f>>e);w+=t*t*8}return{texture:y,view:y.createView({label:`${g} view`}),format:v,size:f,cells:p,mipLevelCount:_,bytes:w,destroy:()=>y.destroy()}}function f(e){return e.createSampler({label:`caustics repeat sampler`,addressModeU:`repeat`,addressModeV:`repeat`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`})}export{f as n,d as t};