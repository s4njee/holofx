import{t as e}from"./effect-DJnwN9gs.js";import{t}from"./hash-7TJvDAm4.js";import{i as n,r,t as i}from"./compute-BDNIjA0G.js";import{n as a,t as o}from"./particles-CPPRki3G.js";import{n as s}from"./common-DDMx69ab.js";var c={count:{type:`u32`,default:512,min:256,max:2048,step:256,uniform:!1,group:`Particles`,description:`Bounded dust record count; one particle field per launch page.`},size:{...s(4,.5,12,`Gaussian quad diameter in CSS pixels.`,`Geometry`),unit:`px`},intensity:{...s(.18,0,1,`Low additive opacity, normalized above 512 records.`,`Light`),css:!0},tint:{type:`color`,default:`#ffd8ae`,css:!0,group:`Palette`,description:`Brand dust colour; alpha scales the opacity.`},speed:{...s(.035,0,.15,`Slow orbital phase in radians per second; drift stays within six CSS pixels.`,`Motion`),step:.005},radius:{...s(120,24,240,`Pointer falloff radius in CSS pixels.`,`Interaction`),unit:`px`},repulsion:{...s(12,0,32,`Maximum gentle pointer displacement in CSS pixels.`,`Interaction`),unit:`px`}},l=r(c,`
@group(1) @binding(0) var<storage,read_write> particles:array<vec4f>;
@group(1) @binding(1) var<uniform> clock:vec4f;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u) {
  if(id.x>=arrayLength(&particles)){return;}
  let h=hash_u32(id.x+frame.seed*65537u);
  let anchor=vec2f(random(h),random(hash_u32(h+1u)))*0.94+0.03;
  let weight=mix(0.25,0.75,random(hash_u32(h+2u)));
  let scale=mix(0.65,1.35,random(hash_u32(h+3u)));
  let cssSize=max(frame.resolution/max(frame.dpr,0.0001),vec2f(1));
  var centre=anchor;
  if(frame.reducedMotion<0.5) {
    let phase=random(hash_u32(h+4u))*6.28318530718;
    let rate=select(1.0,2.0,random(hash_u32(h+5u))>0.5);
    // Bounded orbits retain the seeded scatter at time zero and never accumulate drift.
    let angle=phase+clock.x*rate;
    let drift=(vec2f(sin(angle),cos(angle))-vec2f(sin(phase),cos(phase)))*3.0;
    centre+=drift/cssSize;
    if(all(frame.pointer>=vec2f(0)) && all(frame.pointer<=vec2f(1))) {
      let offset=(centre-frame.pointer)*cssSize;
      let distance=length(offset);
      let falloff=pow(max(0.0,1.0-distance/max(params.radius,1.0)),2.0);
      let direction=offset/max(distance,0.001);
      centre+=direction*min(params.repulsion,32.0)*falloff/cssSize;
    }
  }
  particles[id.x]=vec4f(clamp(centre,vec2f(0),vec2f(1)),weight,scale);
}`,[t]),u=r(c,`
@group(1) @binding(0) var<storage,read> particles:array<vec4f>;
struct DustOut {
  @builtin(position) position:vec4f,
  @location(0) local:vec2f,
  @location(1) weight:f32,
};
@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) id:u32)->DustOut {
  let p=particles[id];
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let local=corners[vertex];
  var out:DustOut;
  let centre=p.xy*vec2f(2,-2)+vec2f(-1,1);
  out.position=vec4f(centre+local*params.size*p.w*frame.dpr/frame.resolution,0,1);
  out.local=local;
  out.weight=p.z*min(1.0,512.0/f32(arrayLength(&particles)));
  return out;
}
@fragment fn particleFragment(in:DustOut)->@location(0) vec4f {
  let radius=dot(in.local,in.local);
  let gaussian=max(0.0,(exp(-4.0*radius)-exp(-4.0))/(1.0-exp(-4.0)));
  let alpha=gaussian*in.weight*clamp(params.intensity,0.0,1.0)*params.tint.a;
  return vec4f(params.tint.rgb*alpha,alpha);
}`),d=e({id:`particle-drift`,budget:{expectedMs:.7,referenceSize:[640,400]},family:`particles`,title:`Quiet bokeh dust drift`,tier:`T3`,core:!1,tags:[`dust`,`bokeh`,`pointer`,`ambient`,`launch-page`],features:[],inputs:[`pointer`],params:c,presets:{ember:{tint:`#ffd8ae`,intensity:.18,size:4},pearl:{tint:`#c8ddf7`,intensity:.16,size:3.5},rose:{tint:`#edc2d5`,intensity:.16,size:4.5}},quality:{resolutionScale:[.5,1]},defaultResolutionScale:.5,reducedMotion:{time:0},fallback:`transparent`,poster:new URL(`/labs/hologpu/assets/poster-oqjcpr5z.png`,``+import.meta.url).href,async create(e){let t=e.device,r=n(t),s=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}}]}),c=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}}]}),d=t.createBuffer({label:`particle-drift-bounded-clock`,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),f,p,m;try{f=await i(e.session,l,`particle-drift-pose`,[r,s]),p=await a(e.session,u,{label:`particle-drift-gaussian`,format:e.format,layouts:[r,c],mode:`quad`,additive:!0,additiveAlpha:`over`});let n=t.createBindGroup({layout:r,entries:[{binding:0,resource:{buffer:e.frameBuffer}},{binding:1,resource:{buffer:e.paramsBuffer}}]}),h,g,_=0,v=``,y=!1;return{resize(){let n=Math.min(2048,Math.max(256,Number(e.params.values.count)));if(_===n)return;let r=o(e.session,{count:n,stride:16,label:`particle-drift-records`,pingPong:!1}),i=t.createBindGroup({layout:s,entries:[{binding:0,resource:{buffer:r.read}},{binding:1,resource:{buffer:d}}]}),a=t.createBindGroup({layout:c,entries:[{binding:0,resource:{buffer:r.read}}]});m?.dispose(),m=r,_=n,h=i,g=a,v=``},update(){},reset(){v=``},shouldRender(t){return!t.reducedMotion&&Number(e.params.values.speed)>0&&Number(e.params.values.intensity)>0},render(r,i,a){if(y||!m)return;let o=r.reducedMotion?0:r.time*Number(e.params.values.speed)%(Math.PI*2),s=JSON.stringify([r.seed,o,r.reducedMotion,...r.resolution,r.dpr,...r.reducedMotion?[]:[...r.pointer,e.params.values.radius,e.params.values.repulsion]]);s!==v&&(t.queue.writeBuffer(d,0,new Float32Array([o,0,0,0])),f.dispatch(i,[n,h],[Math.ceil(_/128)]),v=s),p.draw(i,a,[n,g],_)},bufferTaps(){return m?{particles:{buffer:m.read,stride:16,count:_,label:`Dust UV centre / opacity weight / diameter scale`}}:{}},memory(){return{textureBytes:0,bufferBytes:y?0:(m?.bytes??0)+16}},sources:{pose:f.source,quads:p.source},diagnostics:[...f.diagnostics,...p.diagnostics],dispose(){y||(y=!0,m?.dispose(),d.destroy(),f.dispose(),p.dispose())}}}catch(e){throw m?.dispose(),d.destroy(),f?.dispose(),p?.dispose(),e}}});export{d as t};