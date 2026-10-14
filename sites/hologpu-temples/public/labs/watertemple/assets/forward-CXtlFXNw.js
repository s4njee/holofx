import{l as e,s as t,t as n}from"./camera-BT6VSIZb.js";import{n as r,t as i}from"./uniforms-BE1XSnDx.js";import{t as a}from"./shader-Cd_FDUy8.js";import{t as o}from"./mesh-DqMVT5EZ.js";var s=`// The forward renderer's shader: transform, one directional light, hemisphere ambient, distance fog.
// Group 0 is per view (camera and light), group 1 is per object (dynamic offset into one buffer).
// \`scene-light.wgsl\` and \`scene-object.wgsl\` are generated from the TypeScript struct definitions.

#include "camera.wgsl"
#include "scene-light.wgsl"
#include "scene-object.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> light: SceneLight;
@group(1) @binding(0) var<uniform> obj: SceneObject;

struct ForwardVarying {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
}

@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> ForwardVarying {
  let world = obj.model * vec4f(position, 1.0);
  var out: ForwardVarying;
  out.position = cam.view_proj * world;
  out.world = world.xyz;
  out.normal = obj.normal * normal;
  return out;
}

@fragment fn fs(in: ForwardVarying) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let ambient = mix(light.ground_color, light.sky_color, n.y * 0.5 + 0.5) * light.ambient;
  let sun = light.sun_color * (light.sun_intensity * max(dot(n, light.sun_dir), 0.0));
  let lit = mix(obj.color.rgb * (ambient + sun), obj.color.rgb, obj.color.a);
  // The distance to a mirrored camera equals the real path length through the mirror.
  let fog = 1.0 - exp(-light.fog_density * length(in.world - cam.position));
  return vec4f(mix(lit, light.horizon_color, fog), 1.0);
}
`,c=r(`SceneLight`,{sun_dir:`vec3f`,sun_intensity:`f32`,sun_color:`vec3f`,fog_density:`f32`,sky_color:`vec3f`,ambient:`f32`,ground_color:`vec3f`,horizon_color:`vec3f`}),l=r(`SceneObject`,{model:`mat4x4f`,normal:`mat3x3f`,color:`vec4f`}),u={"scene-light.wgsl":c.wgsl,"scene-object.wgsl":l.wgsl},d=(e,t)=>Math.ceil(t/e)*e;function f(r,f){let{colorFormat:p,depthFormat:m,maxObjects:h=64}=f,g=d(r.limits.minUniformBufferOffsetAlignment,l.size),_=g*h,v=r.createBuffer({label:`scene objects`,size:_,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),y=new Float32Array(_/4),b=r.createBindGroupLayout({label:`scene view layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),x=r.createBindGroupLayout({label:`scene object layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:l.size}}]}),S=r.createBindGroup({label:`scene objects`,layout:x,entries:[{binding:0,resource:{buffer:v,size:l.size}}]}),C=a(r,{label:`scene/forward.wgsl`,code:s,chunks:u}),w=r.createPipelineLayout({label:`scene forward layout`,bindGroupLayouts:[b,x]}),T=e=>r.createRenderPipeline({label:`scene forward (${e===`ccw`?`normal`:`mirrored`})`,layout:w,vertex:{module:C,entryPoint:`vs`,buffers:[o]},fragment:{module:C,entryPoint:`fs`,targets:[{format:p}]},primitive:{topology:`triangle-list`,cullMode:`back`,frontFace:e},depthStencil:{format:m,depthWriteEnabled:!0,depthCompare:`less`}}),E={normal:T(`ccw`),mirrored:T(`cw`)},D=e.create(),O=new Set,k=Object.fromEntries(l.layout.map(e=>[e.name,e.offset/4]));return{viewLayout:b,createView(e){let a=i(r,n,`${e} camera`),o=i(r,c,`${e} light`),s={camera:a,light:o,bindGroup:r.createBindGroup({label:`${e} view`,layout:b,entries:[{binding:0,resource:{buffer:a.buffer}},{binding:1,resource:{buffer:o.buffer}}]}),update(e,n,r,i){t(a,e,n,r);let[s,c,l]=i.sunDirection,u=Math.hypot(s,c,l)||1;o.set({sun_dir:[s/u,c/u,l/u],sun_intensity:i.sunIntensity,sun_color:i.sunColor,fog_density:i.fogDensity,sky_color:i.skyColor,ambient:i.ambient,ground_color:i.groundColor,horizon_color:i.horizonColor}),a.upload(),o.upload()},destroy(){a.destroy(),o.destroy(),O.delete(s)}};return O.add(s),s},upload(t){if(t.length>h)throw RangeError(`Forward renderer holds ${h} objects, got ${t.length}`);return t.forEach((t,n)=>{let r=n*g>>2;y.set(t.model,r+k.model),e.invert(t.model,D);let i=r+k.normal;for(let e=0;e<3;e++)for(let t=0;t<3;t++)y[i+e*4+t]=D[t*4+e];let a=r+k.color;y[a]=t.color[0],y[a+1]=t.color[1],y[a+2]=t.color[2],y[a+3]=t.emissive??0}),t.length>0&&r.queue.writeBuffer(v,0,y.buffer,0,t.length*g),{objects:t}},draw(e,t,n){let r=e.beginRenderPass({label:n.label??`scene forward`,colorAttachments:[{view:n.color,clearValue:n.clearColor??{r:0,g:0,b:0,a:1},loadOp:`clear`,storeOp:`store`}],depthStencilAttachment:{view:n.depth,depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`store`},timestampWrites:n.timestampWrites});n.background?.(r),r.setPipeline(n.mirrored?E.mirrored:E.normal),r.setBindGroup(0,n.view.bindGroup);let i;t.objects.forEach((e,t)=>{r.setBindGroup(1,S,[t*g]),e.mesh!==i&&(r.setVertexBuffer(0,e.mesh.vertexBuffer),r.setIndexBuffer(e.mesh.indexBuffer,e.mesh.indexFormat),i=e.mesh),r.drawIndexed(e.mesh.indexCount)}),r.end()},destroy(){v.destroy();for(let e of[...O])e.destroy()}}}export{f as n,u as t};