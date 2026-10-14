const s=new WeakMap,l=new WeakMap,m=`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;

struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

@fragment fn fs(v: Out) -> @location(0) vec4f {
  return textureSampleLevel(src, smp, v.uv, 0.0);
}`;function f(e,t){return Math.floor(Math.log2(Math.max(e,t)))+1}function c(e,t){let n=s.get(e);n||s.set(e,n=new Map);let i=n.get(t);if(!i){const r=e.createShaderModule({label:"mipmaps",code:m});i=e.createRenderPipeline({label:`mipmaps:${t}`,layout:"auto",vertex:{module:r,entryPoint:"vs"},fragment:{module:r,entryPoint:"fs",targets:[{format:t}]}}),n.set(t,i)}return i}function g(e,t,n){if(t.mipLevelCount<2)return;const i=c(e,t.format);let r=l.get(e);r||l.set(e,r=e.createSampler({minFilter:"linear",magFilter:"linear"}));const p=n??e.createCommandEncoder({label:"mipmaps"});for(let a=1;a<t.mipLevelCount;a++){const u=e.createBindGroup({layout:i.getBindGroupLayout(0),entries:[{binding:0,resource:t.createView({baseMipLevel:a-1,mipLevelCount:1})},{binding:1,resource:r}]}),o=p.beginRenderPass({colorAttachments:[{view:t.createView({baseMipLevel:a,mipLevelCount:1}),loadOp:"clear",storeOp:"store"}]});o.setPipeline(i),o.setBindGroup(0,u),o.draw(3),o.end()}n||e.queue.submit([p.finish()])}export{g,f as m};
