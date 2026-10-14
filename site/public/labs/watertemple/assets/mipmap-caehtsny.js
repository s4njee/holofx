import{r as e,t}from"./fullscreen-Dq3Mq0Js.js";import{n,r,t as i}from"./common-DyRXdhCv.js";var a=`#include "fullscreen.wgsl"

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

// textureLoad keeps nearest working on unfilterable formats (r32float, rgba32float).
@fragment fn fs_nearest(in: FullscreenVarying) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(src));
  let texel = vec2u(clamp(in.uv * size, vec2f(0.0), size - 1.0));
  return textureLoad(src, texel, 0);
}

@fragment fn fs_linear(in: FullscreenVarying) -> @location(0) vec4f {
  return textureSampleLevel(src, samp, in.uv, 0.0);
}
`,o=r(e=>{let t=e=>({binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:e}});return{layouts:{nearest:e.createBindGroupLayout({label:`blit nearest layout`,entries:[t(`unfilterable-float`)]}),linear:e.createBindGroupLayout({label:`blit linear layout`,entries:[t(`float`),{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]})},pipelines:new Map,groups:{nearest:new WeakMap,linear:new WeakMap}}});function s(r,i,s,c,l={}){let u=l.filter??`linear`,d=o(r),f=`${u}:${c.format}`,p=d.pipelines.get(f);p||(p=t(r,{label:`blit ${u} ${c.format}`,fragment:{label:`passes/blit.wgsl`,code:a},entryPoint:u===`nearest`?`fs_nearest`:`fs_linear`,format:c.format,layout:[d.layouts[u]]}),d.pipelines.set(f,p));let m=d.groups[u],h=m.get(s);h||(h=r.createBindGroup({label:`blit ${u} source`,layout:d.layouts[u],entries:[{binding:0,resource:s},...u===`linear`?[{binding:1,resource:n(r)}]:[]]}),m.set(s,h)),e(i,c.view,p,[h])}function c(e,t){return 32-Math.clz32(Math.max(e,t))}var l=new WeakMap;function u(e){let t=l.get(e);return t||(t=Array.from({length:e.depthOrArrayLayers},(t,n)=>Array.from({length:e.mipLevelCount},(t,r)=>e.createView({label:`${e.label} mip ${r} layer ${n}`,dimension:`2d`,baseMipLevel:r,mipLevelCount:1,baseArrayLayer:n,arrayLayerCount:1}))),l.set(e,t)),t}function d(e,t,n){if(t.dimension!==`2d`||t.sampleCount!==1)throw Error(`generateMipmaps: only single-sampled 2D textures are supported`);if(t.mipLevelCount===1){if(t.width===1&&t.height===1)return;throw Error(`generateMipmaps: ${t.width}x${t.height} texture has a single mip level; create it with mipLevelCount: mipLevelCount(width, height)`)}let r=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT;if((t.usage&r)!==r)throw Error(`generateMipmaps: the texture needs TEXTURE_BINDING and RENDER_ATTACHMENT usage`);i(e,t.format,`generateMipmaps`);let a=n??e.createCommandEncoder({label:`${t.label} mipmaps`});for(let n of u(t))for(let r=1;r<n.length;r++){let i=n[r-1],o=n[r];i&&o&&s(e,a,i,{view:o,format:t.format},{filter:`linear`})}n||e.queue.submit([a.finish()])}export{c as n,d as t};