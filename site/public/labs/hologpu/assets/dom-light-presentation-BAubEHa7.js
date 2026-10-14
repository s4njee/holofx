import{c as e,d as t,f as n,o as r,r as i}from"./effect-DJnwN9gs.js";async function a(a,o,s,c=`fluid`){let l=o.getContext(`webgpu`);if(!l)throw Error(`Canvas WebGPU context unavailable`);let u=!1,d=`srgb`,f=a.capabilities.preferredFormat;if(s)for(let e of[`display-p3`,`srgb`])try{await a.validate(async()=>{l.configure({device:a.device,format:`rgba16float`,alphaMode:`opaque`,colorSpace:e,toneMapping:{mode:`extended`},usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC})});let t=l.getConfiguration();if(t?.format!==`rgba16float`||t.colorSpace!==e||t.toneMapping?.mode!==`extended`)throw Error(`Extended presentation was not accepted`);u=!0,d=e,f=`rgba16float`;break}catch{if(l.unconfigure(),a.state!==`ready`)throw Error(`Device lost during presentation setup`)}u||l.configure({device:a.device,format:f,alphaMode:`opaque`,colorSpace:d,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});let p=a.device,m=p.createBuffer({label:`dom-light`,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});try{let s=await i(a,n(r,e,t(`dom-light`,`
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> light: vec4f;
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let base = srgb_to_linear(vec3f(8.0, 15.0, 20.0) / 255.0);
  let original = textureLoad(image, vec2i(p.xy), 0).rgb;
  // Keep empty regions dark; particle input is the raw additive trail, before tone mapping.
  ${c===`fluid`?`let emission = max(original - base, vec3f(0));`:u?`let emission = max(original * light.y, vec3f(0));`:`let c = max(original * light.y, vec3f(0)); let emission = (vec3f(1) - base) * c / (vec3f(1) + c);`}
  var rgb = base + emission * light.x;
  ${u?d===`display-p3`?`rgb = mat3x3f(vec3f(.82259287,.03319951,.01708535),vec3f(.17753395,.9667835,.07239572),vec3f(0,0,.91030148)) * rgb;`:``:`// A hue-preserving shoulder keeps boosted SDR dye from clipping to white.
  let peak = max(emission.r, max(emission.g, emission.b));
  let boosted = peak * light.x;
  let headroom = 1.0 - max(base.r, max(base.g, base.b));
  let mapped = boosted / (1.0 + peak / headroom * (light.x - 1.0));
  rgb = base + emission * (mapped / max(peak, 0.00001));`}
  return vec4f(linear_to_srgb(max(rgb, vec3f(0))), 1);
}`)),f,`dom-light-present`,[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]),h=new WeakMap,g=NaN,_=NaN,v=!1;return{hdr:u,configuration:l.getConfiguration(),generation:a.generation,draw(e,t,n,r=1){if(v)throw Error(`Light presentation disposed`);if(t.width!==o.width||t.height!==o.height)throw RangeError(`Light presentation size mismatch`);(n!==g||r!==_)&&(g=n,_=r,p.queue.writeBuffer(m,0,new Float32Array([n,r,0,0])));let i=h.get(t.texture);i||(i=p.createBindGroup({layout:s.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:t.texture.createView()},{binding:1,resource:{buffer:m}}]}),h.set(t.texture,i));let a=l.getCurrentTexture();return s.draw(e,a.createView(),[i]),a},dispose(){v||(v=!0,l.unconfigure(),m.destroy(),s.dispose())}}}catch(e){throw m.destroy(),l.unconfigure(),e}}export{a as t};