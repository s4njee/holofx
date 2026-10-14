import{t as e}from"./hash-7TJvDAm4.js";import{i as t,n,r,t as i}from"./compute-BDNIjA0G.js";import{n as a,t as o}from"./feedback-CkBwRjOP.js";function s(e,t=!1){return`
@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var vel: texture_2d<f32>;
@group(1) @binding(2) var aux: texture_2d<f32>;
@group(1) @binding(3) var material: texture_2d<f32>;
${e===`ink`?`@group(2) @binding(0) var resistance: texture_2d<f32>;`:``}
${t?`struct Rects {count:u32,pad0:u32,pad1:u32,pad2:u32,rects:array<vec4f>};
@group(2) @binding(0) var<storage,read> obstacles:Rects;
fn solid(i:vec2i,n:vec2i)->bool {
  let cell=select(i,((i%n)+n)%n,params.boundary==1u);
  let q=(vec2f(cell)+0.5)/vec2f(n);
  for(var j=0u;j<min(obstacles.count,arrayLength(&obstacles.rects));j++) {
    let r=obstacles.rects[j]; if(all(q>=r.xy) && all(q<r.zw)) {return true;}
  }
  return false;
}
// Slab intersection stops semi-Lagrangian characteristics at the first solid rectangle;
// even a backtrace spanning multiple cells cannot tunnel through a thin heading.
fn obstacle_backtrace(start:vec2f,end:vec2f,n:vec2f)->vec2f {
  let a=start/n;let b=end/n;let d=b-a;var hit=1.0;
  for(var j=0u;j<min(obstacles.count,arrayLength(&obstacles.rects));j++) {
    let radius=select(0,1,params.boundary==1u);
    for(var oy=-radius;oy<=radius;oy++) {for(var ox=-radius;ox<=radius;ox++) {
    let r=obstacles.rects[j]+vec4f(f32(ox),f32(oy),f32(ox),f32(oy));
    let safe=select(select(vec2f(-1e-8),vec2f(1e-8),d>=vec2f(0)),d,abs(d)>vec2f(1e-8));
    let t0=(r.xy-a)/safe;let t1=(r.zw-a)/safe;
    let near=min(t0,t1);let far=max(t0,t1);
    let enter=max(near.x,near.y);let exit=min(far.x,far.y);
    if(enter>=0.0 && enter<=exit && enter<=hit) {hit=max(0.0,enter-0.0001);}
    }}
  }
  return mix(start,end,hit);
}`:``}
fn wrap_cell(i: vec2i,n: vec2i) -> vec2i { return ((i%n)+n)%n; }
fn load_cell(image: texture_2d<f32>,i: vec2i) -> vec4f {
  let n=vec2i(textureDimensions(image));
  if(params.boundary==1u) { return textureLoad(image,wrap_cell(i,n),0); }
  return textureLoad(image,clamp(i,vec2i(0),n-1),0);
}
fn bilerp(image: texture_2d<f32>,p: vec2f) -> vec4f {
  let b=vec2i(floor(p-0.5));let t=fract(p-0.5);
  return mix(mix(load_cell(image,b),load_cell(image,b+vec2i(1,0)),t.x),mix(load_cell(image,b+vec2i(0,1)),load_cell(image,b+vec2i(1,1)),t.x),t.y);
}
fn face_velocity(i: vec2i) -> vec2f {
  let n=vec2i(textureDimensions(vel));var v=load_cell(vel,i).xy;
  if(params.boundary==0u) { if(i.x<0 || i.x>=n.x-1) {v.x=0.0;}if(i.y<0 || i.y>=n.y-1) {v.y=0.0;} }
  ${t?`if(solid(i,n) || solid(i+vec2i(1,0),n)) {v.x=0.0;} if(solid(i,n) || solid(i+vec2i(0,1),n)) {v.y=0.0;}`:``}
  return v;
}
fn velocity_at(p: vec2f) -> vec2f {
  return vec2f(bilerp(vel,p-vec2f(0.5,0)).x,bilerp(vel,p-vec2f(0,0.5)).y);
}
fn wall_velocity(v: vec2f,i: vec2i,n: vec2i) -> vec2f {
  var result=v;
  if(params.boundary==0u) { if(i.x==n.x-1) {result.x=0.0;}if(i.y==n.y-1) {result.y=0.0;} }
  ${t?`if(solid(i,n) || solid(i+vec2i(1,0),n)) {result.x=0.0;} if(solid(i,n) || solid(i+vec2i(0,1),n)) {result.y=0.0;}`:``}
  return result;
}
fn gaussian(p: vec2f,c: vec2f,r: f32) -> f32 { let d=(p-c)/max(r,0.001);return exp(-dot(d,d)*0.5); }
fn source_position() -> vec2f { return ${e===`smoke`?`vec2f(0.5,0.86)`:`vec2f(0.5+0.23*cos(frame.time*0.7),0.5+0.19*sin(frame.time*0.9))`}; }
fn pointer_position(n: vec2f) -> vec2f { return frame.pointer*n/n.y; }
fn pointer_weight(p: vec2f,n: vec2f) -> f32 {
  return select(0.0,gaussian(p,pointer_position(n),params.radius),frame.buttons!=0u);
}
fn paper_grain(i: vec2i) -> f32 {
  let p=vec2u(i);let h=hash_u32((p.x*1664525u) ^ hash_u32(p.y*1013904223u+frame.seed));
  return f32(h)/4294967295.0;
}
${e===`ink`?`fn paper_resistance(i: vec2i) -> f32 {
  let n=vec2f(textureDimensions(src));
  let r=vec2i(textureDimensions(resistance));
  let uv=(vec2f(i)+0.5)/n;
  return clamp(textureLoad(resistance,clamp(vec2i(uv*vec2f(r)),vec2i(0),r-1),0).r,0.0,1.0);
}
fn pigment_transfer(m: vec4f,i: vec2i) -> vec2f {
  let grain=mix(1.0,0.35+1.3*paper_grain(i),params.grain);
  let rate=params.absorption*grain*(1.0+1.5*exp(-m.z))*(1.0-paper_resistance(i));
  return m.xy*(1.0-exp(-rate*frame.delta));
}`:``}
`}function c(e,t){return[`divergence`,`curl`,`pressure`,`zero`,`shadow`,`obstacleMask`].includes(t)?`r32float`:e===`ink`&&[`initMaterial`,`advectMaterial`,`deposit`,`absorb`,`zeroMaterial`].includes(t)?`rgba32float`:`rgba16float`}function ee(e,t,n=!1){let r=`@group(1) @binding(4) var destination: texture_storage_2d<${c(e,t)},write>;`,i={obstacleMask:`textureStore(destination,i,vec4f(select(0.0,1.0,solid(i,n)),0,0,0));`,enforceVelocity:`textureStore(destination,i,vec4f(wall_velocity(load_cell(src,i).xy,i,n),0,0));`,clearMaterial:`textureStore(destination,i,select(load_cell(src,i),vec4f(0),solid(i,n)));`,initVelocity:`
  var v=vec2f(0.0);
  if(params.initial==2u) { v=params.initialVelocity; }
  if(params.initial==3u) { v=vec2f(sin((f32(i.x)+1.0)/nf.x*6.2831853),sin((f32(i.y)+1.0)/nf.y*6.2831853))*0.18; }
  if(params.initial==0u) {
    let offset=(random(frame.seed+71u)-0.5)*0.12;
    for(var j=0u;j<3u;j++) {
      let c=vec2f(nf.x/nf.y*(0.27+0.23*f32(j)),0.42+offset+0.11*sin(f32(j)*2.0));
      let dx=(vec2f(i)+vec2f(1.0,0.5))/nf.y-c;
      let dy=(vec2f(i)+vec2f(0.5,1.0))/nf.y-c;
      let s=select(-1.0,1.0,j%2u==0u);
      v+=vec2f(-dx.y*exp(-dot(dx,dx)/0.035),dy.x*exp(-dot(dy,dy)/0.035))*s*1.4;
    }
  }
  textureStore(destination,i,vec4f(wall_velocity(v,i,n),0,0));`,initMaterial:`
  let shift=(random(frame.seed+31u)-0.5)*0.12;
  let a=gaussian(p,vec2f(nf.x/nf.y*0.34,${e===`smoke`?`0.72`:`0.43`}+shift),${e===`smoke`?`0.09`:`0.12`});
  let b=gaussian(p,vec2f(nf.x/nf.y*0.66,${e===`smoke`?`0.8`:`0.57`}-shift),0.1);
  let weights=select(vec2f(a,b),vec2f(0.5),params.initial==2u)*params.initialAmount;
  ${e===`fluid`?`let m=vec4f(params.dyeA.rgb*weights.x+params.dyeB.rgb*weights.y,0);`:e===`ink`?`let m=vec4f(weights,weights.x+weights.y,0);`:`let m=vec4f(weights.x+weights.y,(weights.x+weights.y)*params.heat,0,0);`}
  textureStore(destination,i,${n?`select(m,vec4f(0),solid(i,n))`:`m`});`,zero:`textureStore(destination,i,vec4f(0));`,zeroRgba:`textureStore(destination,i,vec4f(0));`,zeroMaterial:`textureStore(destination,i,vec4f(0));`,advectVelocity:`
  let dt=frame.delta;let px=vec2f(i)+vec2f(1.0,0.5);let py=vec2f(i)+vec2f(0.5,1.0);
  let qx=px-velocity_at(px)*dt*nf.y;let qy=py-velocity_at(py)*dt*nf.y;
  let v=vec2f(bilerp(vel,qx-vec2f(0.5,0)).x,bilerp(vel,qy-vec2f(0,0.5)).y)*exp(-params.drag*dt);
  textureStore(destination,i,vec4f(wall_velocity(v,i,n),0,0));`,copy:`textureStore(destination,i,load_cell(src,i));`,diffuse:`
  let alpha=params.viscosity*frame.delta;
  let rhs=load_cell(aux,i).xy;
  let neighbours=load_cell(src,i+vec2i(-1,0)).xy+load_cell(src,i+vec2i(1,0)).xy+load_cell(src,i+vec2i(0,-1)).xy+load_cell(src,i+vec2i(0,1)).xy;
  let v=(rhs+alpha*neighbours)/(1.0+4.0*alpha);
  textureStore(destination,i,vec4f(wall_velocity(v,i,n),0,0));`,curl:`
  // Center face velocities first, then differentiate. Curl is in domain units.
  let vr=velocity_at(cell+vec2f(1,0));let vl=velocity_at(cell-vec2f(1,0));
  let vb=velocity_at(cell+vec2f(0,1));let vt=velocity_at(cell-vec2f(0,1));
  let curl=((vr.y-vl.y)-(vb.x-vt.x))*0.5*nf.y;
  textureStore(destination,i,vec4f(curl,0,0,0));`,force:`
  let curl=load_cell(aux,i).x;
  let grad=vec2f(abs(load_cell(aux,i+vec2i(1,0)).x)-abs(load_cell(aux,i-vec2i(1,0)).x),abs(load_cell(aux,i+vec2i(0,1)).x)-abs(load_cell(aux,i-vec2i(0,1)).x));
  let normal=grad/max(length(grad),0.00001);
  var force=vec2f(normal.y,-normal.x)*curl*params.vorticity/nf.y;
  let srcPos=source_position()*vec2f(nf.x/nf.y,1.0);
  let emitter=gaussian(p,srcPos,params.radius);
  force+=${e===`smoke`?`vec2f(0,-1)`:`vec2f(-sin(frame.time*0.7),cos(frame.time*0.9))`}*emitter*params.source*params.force;
  let pointer=pointer_weight(p,nf);
  force+=clamp(frame.velocity*vec2f(nf.x/nf.y,1),vec2f(-2),vec2f(2))*pointer*params.force*12.0;
  ${e===`smoke`?`let m=load_cell(material,i);force.y+=params.weight*m.x-params.buoyancy*m.y;`:``}
  let v=face_velocity(i)+force*frame.delta;
  textureStore(destination,i,vec4f(wall_velocity(clamp(v,vec2f(-2),vec2f(2)),i,n),0,0));`,divergence:`
  ${n?`if(solid(i,n)) {textureStore(destination,i,vec4f(0));return;}`:``}
  let v=face_velocity(i);let l=face_velocity(i-vec2i(1,0));let t=face_velocity(i-vec2i(0,1));
  textureStore(destination,i,vec4f(v.x-l.x+v.y-t.y,0,0,0));`,pressure:`
  ${n?`if(solid(i,n)) {textureStore(destination,i,vec4f(0));return;}`:``}
  var sum=0.0;var count=0.0;
  let offsets=array<vec2i,4>(vec2i(-1,0),vec2i(1,0),vec2i(0,-1),vec2i(0,1));
  for(var j=0u;j<4u;j++) {
    let q=i+offsets[j];
    if((params.boundary==1u || (all(q>=vec2i(0)) && all(q<n))) ${n?`&& !solid(q,n)`:``}) {sum+=load_cell(src,q).x;count+=1.0;}
  }
  // Neumann walls omit absent neighbours. Pressure is defined up to an additive constant.
  let pNew=(sum-load_cell(aux,i).x)/max(count,1.0);
  textureStore(destination,i,vec4f(pNew,0,0,0));`,project:`
  let p0=load_cell(aux,i).x;
  let grad=vec2f(load_cell(aux,i+vec2i(1,0)).x-p0,load_cell(aux,i+vec2i(0,1)).x-p0);
  textureStore(destination,i,vec4f(wall_velocity(face_velocity(i)-grad,i,n),0,0));`,advectMaterial:`
  ${n?`if(solid(i,n)) {textureStore(destination,i,vec4f(0));return;}`:``}
  ${e===`ink`?`// Capillary transport is material movement through porous paper, separate from the projected fluid.
  let fibers=0.72+0.22*sin(uv.x*61.0+sin(uv.y*17.0)*1.4)+0.12*sin(uv.x*137.0+uv.y*9.0);
  let wick=vec2f(sin(uv.y*23.0+uv.x*31.0)*0.04, fibers)*params.paperFlow;
  let back=cell-(velocity_at(cell)+wick)*frame.delta*nf.y;`:`let back=cell-velocity_at(cell)*frame.delta*nf.y;`}
  let q=${n?`obstacle_backtrace(cell,back,nf)`:`back`};
  var m=bilerp(src,q);let fade=exp(-params.dissipation*frame.delta);
  ${e===`ink`?`// Paper transport has clean incoming water at the top, rather than repeating the clamped edge pigment.
  if(params.paperFlow>0.0 && q.y<0.5) {m=vec4f(0);}`:``}
  ${e===`fluid`?`m*=fade;`:e===`ink`?`m=vec4f(m.xy*fade,m.z*exp(-params.evaporation*frame.delta),0);`:`m=vec4f(m.x*fade,m.y*exp(-params.cooling*frame.delta),0,0);`}
  var emitter=gaussian(p,source_position()*vec2f(nf.x/nf.y,1),params.radius);
  ${e===`ink`?`if(params.feed==1u) {
    let edge=0.024+0.008*sin(uv.x*27.0)+0.004*sin(uv.x*71.0);
    let band=exp(-pow((uv.y-edge)/0.021,2.0)*0.5);
    let sides=smoothstep(0.025,0.12,uv.x)*(1.0-smoothstep(0.88,0.975,uv.x));
    let variation=0.76+0.16*sin(uv.x*43.0)+0.08*sin(uv.x*107.0);
    let envelope=select(1.0,1.0-smoothstep(params.feedDuration-1.0,params.feedDuration,frame.time),params.feedDuration>0.0);
    emitter=band*sides*variation*envelope;
  }`:``}
  let pointer=pointer_weight(p,nf)*max(frame.pressure,0.5);
  let amount=(emitter*params.source+pointer*2.0)*frame.delta*3.0;
  let colorMix=0.5+0.5*sin(frame.time*0.63);
  ${e===`fluid`?`m+=vec4f(mix(params.dyeA.rgb,params.dyeB.rgb,colorMix)*amount,0);`:e===`ink`?`m+=vec4f(amount*(1.0-colorMix),amount*colorMix,amount*1.4,0);`:`m+=vec4f(amount,amount*params.heat,0,0);`}
  textureStore(destination,i,clamp(m,vec4f(0),vec4f(32)));`,deposit:`
  ${e===`ink`?`let m=load_cell(material,i);let old=load_cell(src,i);textureStore(destination,i,vec4f(min(old.xy+pigment_transfer(m,i),vec2f(128)),0,0));`:`textureStore(destination,i,vec4f(0));`}`,absorb:`
  ${e===`ink`?`let m=load_cell(src,i);textureStore(destination,i,vec4f(max(m.xy-pigment_transfer(m,i),vec2f(0)),m.z,0));`:`textureStore(destination,i,load_cell(src,i));`}`,shadow:`
  ${e===`smoke`?`let direction=params.lightDirection/max(length(params.lightDirection),0.0001);
  let ray=select(vec2f(0,-1),direction,length(params.lightDirection)>0.0001);
  let steps=max(params.shadowSteps,2u);let stride=nf.y*0.45/f32(steps);var optical=0.0;
  for(var j=0u;j<steps;j++) {
    let q=cell+ray*stride*(f32(j)+0.5);
    if(all(q>=vec2f(0)) && all(q<nf)) { optical+=bilerp(material,q).x*0.45/f32(steps); }
  }
  textureStore(destination,i,vec4f(exp(-optical*params.extinction),0,0,0));`:`textureStore(destination,i,vec4f(1,0,0,0));`}`};if(!(t in i))throw Error(`Unknown solver pass ${t}`);return s(e,n)+`
`+r+`
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u) {
  let n=vec2i(textureDimensions(destination));let i=vec2i(gid.xy);if(any(i>=n)) {return;}
  let nf=vec2f(n);let cell=vec2f(i)+0.5;let uv=cell/nf;let p=cell/nf.y;`+i[t]+`
}`}function te(e){return`
@group(1) @binding(0) var dye: texture_2d<f32>;
@group(1) @binding(1) var flow: texture_2d<f32>;
@group(1) @binding(2) var pressure: texture_2d<f32>;
@group(1) @binding(3) var divergence: texture_2d<f32>;
@group(1) @binding(4) var curl: texture_2d<f32>;
@group(1) @binding(5) var extra: texture_2d<f32>;
${e===`ink`?`@group(2) @binding(0) var resistance: texture_2d<f32>;`:``}
@fragment fn fragment(in:VertexOut) -> @location(0) vec4f {
  let m=sample_bilinear(dye,in.uv);var rgb=params.background.rgb;
  ${e===`fluid`?`rgb=mix(rgb,vec3f(1)-exp(-max(m.rgb,vec3f(0))*1.8),clamp(length(m.rgb)*1.8,0,1));`:e===`ink`?`let deposit=sample_bilinear(extra,in.uv).xy;
  let a=-log(max(params.dyeA.rgb,vec3f(0.03)));let b=-log(max(params.dyeB.rgb,vec3f(0.03)));
  // A wax coating rejects the visible wet wash as well as irreversible absorption.
  let wax=clamp(sample_bilinear(resistance,in.uv).r,0.0,1.0);
  let pigments=max(m.xy+deposit,vec2f(0))*(1.0-wax);
  let cell=vec2u(in.uv*vec2f(textureDimensions(dye)));
  let grain=f32(hash_u32((cell.x*1664525u) ^ hash_u32(cell.y*1013904223u+frame.seed)))/4294967295.0;
  rgb*=exp(-(a*pigments.x+b*pigments.y)*params.opticalDensity)*(1.0-params.grain*0.035*grain);`:`let transmittance=sample_bilinear(extra,in.uv).x;
  let opacity=1.0-exp(-max(m.x,0.0)*params.extinction);
  let warm=clamp(m.y*0.15,0,1);
  let scattering=mix(params.dyeA.rgb,params.dyeB.rgb,warm)*(0.2+0.8*transmittance);
  rgb=mix(rgb,scattering,opacity);`}
  if(params.view==1u) {let v=sample_bilinear(flow,in.uv).xy;rgb=vec3f(v*2.0+0.5,0.5);}
  if(params.view==2u) {let x=sample_bilinear(pressure,in.uv).x;rgb=vec3f(0.5+x*3.0,0.5-abs(x)*3.0,0.5-x*3.0);}
  if(params.view==3u) {let x=sample_bilinear(divergence,in.uv).x;rgb=vec3f(0.5+x*30.0,0.5-abs(x)*30.0,0.5-x*30.0);}
  if(params.view==4u) {let x=sample_bilinear(curl,in.uv).x;rgb=vec3f(0.5+x*0.1,0.5-abs(x)*0.1,0.5-x*0.1);}
  return vec4f(clamp(rgb,vec3f(0),vec3f(1)),1);
}`}var l=new WeakMap;async function u(s,u,d,f=!1){let p=s.device,m=t(p),h=u===`ink`?p.createBindGroupLayout({label:`hgpu-ink-paper-resistance`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.FRAGMENT,texture:{sampleType:`unfilterable-float`}}]}):void 0,g=f?p.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}}]}):void 0,_,v,y,b=new Float32Array([0,0,0,0,.24,.3,.76,.41,.35,.58,.65,.69]);new Uint32Array(b.buffer)[0]=2;let x,S=``,C=!1,w=()=>{if(!f)return;x||(x=p.createBuffer({label:`hgpu-fluid-default-obstacles`,size:b.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),p.queue.writeBuffer(x,0,b));let e=JSON.stringify(_?.snapshot()??Array.from(b.slice(4)));e!==S&&(S=e,C=!0);let t=_?.buffer(p)??x;t!==v&&(v=t,y=p.createBindGroup({layout:g,entries:[{binding:0,resource:{buffer:t}}]}))},T=e=>p.createBindGroupLayout({label:`hgpu-${u}-${e}-state`,entries:[...[0,1,2,3].map(e=>({binding:e,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`unfilterable-float`}})),{binding:4,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:`write-only`,format:e}}]}),E=l.get(p);if(!E){let e=T(`rgba16float`),t=T(`r32float`);E={rgba:e,material:T(`rgba32float`),scalar:t,display:p.createBindGroupLayout({label:`hgpu-${u}-display-state`,entries:[0,1,2,3,4,5].map(e=>({binding:e,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`unfilterable-float`}}))})},l.set(p,E)}let{rgba:ne,material:re,scalar:ie,display:D}=E,O=e=>c(u,e)===`r32float`?ie:c(u,e)===`rgba32float`?re:ne,k=[`initVelocity`,`initMaterial`,`zero`,`zeroRgba`,`advectVelocity`,`copy`,`diffuse`,`curl`,`force`,`divergence`,`pressure`,`project`,`advectMaterial`,...f?[`obstacleMask`,`enforceVelocity`,`clearMaterial`]:[],...u===`ink`?[`zeroMaterial`,`deposit`,`absorb`]:[],...u===`smoke`?[`shadow`]:[]],A={},j={},M=[],N;try{for(let t of k){let n=r(d,ee(u,t,f),[e]),a=await i(s.session,n,`hgpu-${u}-${t}`,[m,O(t),...h?[h]:[],...g?[g]:[]]);A[t]=a,j[t]=n,M.push(...a.diagnostics)}let t=r(d,te(u),[e]);N=await n(s.session,t,s.format,`hgpu-${u}-display`,[m,D,...h?[h]:[]]),j.display=t,M.push(...N.diagnostics)}catch(e){throw Object.values(A).forEach(e=>e.dispose()),e}let P={},F={},I={velocity:`rgba16float`,dye:u===`ink`?`rgba32float`:`rgba16float`,pressure:`r32float`,curl:`r32float`,divergence:`r32float`,projectedDivergence:`r32float`,diffusionRhs:`rgba16float`,...f?{obstacleMask:`r32float`}:{},...u===`ink`?{paper:`rgba32float`}:{},...u===`smoke`?{shadow:`r32float`}:{}},L=[0,0],R,z=!1,B;try{R=p.createTexture({label:`hgpu-${u}-unused`,size:[1,1],format:`rgba16float`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),z=!0,u===`smoke`&&(B=new o(p,s.params.layout.byteLength,`hgpu-smoke-shadow-quality`))}catch(e){throw Object.values(A).forEach(e=>e.dispose()),N.dispose(),z&&R.destroy(),e}let V=new WeakMap,ae=0,H=new Map,U=e=>(V.has(e)||V.set(e,++ae),V.get(e)),W=e=>P[e]?.read??F[e]??R,G,K,q=()=>{if(!h)return[];let e=s.inputs?.get(`resistance`)?.texture??R;return e!==G&&(G=e,K=p.createBindGroup({label:`hgpu-ink-paper-resistance`,layout:h,entries:[{binding:0,resource:e.createView()}]})),[K]},oe=(e,t,n)=>{let r=`${c(u,e)}:${[...t,n].map(U).join(`,`)}`,i=H.get(r);return i||(i=p.createBindGroup({label:`hgpu-${u}-${e}`,layout:O(e),entries:[...t,n].map((e,t)=>({binding:t,resource:e.createView()}))}),H.set(r,i)),i},J=(e,t,n,r,i=R,a=R,o=R,s=R)=>A[e].dispatch(t,[n,oe(e,[i,a,o,s],r),...q(),...y?[y]:[]],[Math.ceil(L[0]/8),Math.ceil(L[1]/8)]);function Y(e){let t=Math.min(Number(s.params.values.grid),p.limits.maxTextureDimension2D),n=Math.max(e[0],e[1],1),r=[Math.max(8,Math.round(t*e[0]/n)),Math.max(8,Math.round(t*e[1]/n))];if(r[0]===L[0]&&r[1]===L[1])return!1;for(let e of Object.values(P))e.dispose();for(let e of Object.values(F))e.destroy();for(let e of Object.keys(P))delete P[e];for(let e of Object.keys(F))delete F[e];H=new Map,L=r;for(let[e,t]of Object.entries(I))[`velocity`,`dye`,`pressure`,`paper`].includes(e)?P[e]=a(s.session,{label:`hgpu-${u}-${e}`,format:t,size:L}):F[e]=p.createTexture({label:`hgpu-${u}-${e}`,format:t,size:[...L],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});return!0}function se(e,t,n){Y(t.resolution),w(),f&&(C=!0);for(let[t,r]of Object.entries(P)){let i=t===`velocity`?`initVelocity`:t===`dye`?`initMaterial`:r.format===`r32float`?`zero`:r.format===`rgba32float`?`zeroMaterial`:`zeroRgba`;J(i,e,n,r.read),J(i,e,n,r.write)}for(let[t,r]of Object.entries(F))J(I[t]===`r32float`?`zero`:`zeroRgba`,e,n,r);f&&J(`obstacleMask`,e,n,W(`obstacleMask`)),J(`curl`,e,n,W(`curl`),R,W(`velocity`)),J(`divergence`,e,n,W(`divergence`),R,W(`velocity`)),J(`divergence`,e,n,W(`projectedDivergence`),R,W(`velocity`)),u===`smoke`&&J(`shadow`,e,n,W(`shadow`),R,R,R,W(`dye`))}let X=Object.fromEntries(s.params.layout.fields.map(e=>[e.name,e.offset])),Z=(e,t,n=!1)=>n?new DataView(e).getUint32(X[t],!0):new DataView(e).getFloat32(X[t],!0),Q,$=``;return{...f?{setInput(e,t){if(e!==`obstacles`)throw RangeError(`fluid-obstacles accepts only the obstacles input`);if(t!==null&&(!t||typeof t!=`object`||!(`kind`in t)||t.kind!==`dom-rects`||!(`buffer`in t)||typeof t.buffer!=`function`||!(`snapshot`in t)||typeof t.snapshot!=`function`))throw TypeError(`obstacles needs a DomRectsInput or null`);_=t??void 0}}:{},resize:Y,initialize:se,step(e,t,n,r){w();let i=P.velocity,a=P.dye,o=P.pressure;if(J(`advectVelocity`,e,n,i.write,R,i.read),i.swap(),Z(r,`viscosity`)>0){J(`copy`,e,n,W(`diffusionRhs`),i.read);for(let t=0;t<4;t++)J(`diffuse`,e,n,i.write,i.read,R,W(`diffusionRhs`)),i.swap()}J(`curl`,e,n,W(`curl`),R,i.read),J(`force`,e,n,i.write,R,i.read,W(`curl`),a.read),i.swap(),J(`divergence`,e,n,W(`divergence`),R,i.read);let c=Math.max(2,Math.round(Z(r,`iterations`,!0)*s.qualitySteps()));for(let t=0;t<c;t++)J(`pressure`,e,n,o.write,o.read,R,W(`divergence`)),o.swap();if(J(`project`,e,n,i.write,R,i.read,o.read),i.swap(),J(`divergence`,e,n,W(`projectedDivergence`),R,i.read),J(`advectMaterial`,e,n,a.write,a.read,i.read),a.swap(),u===`ink`){let t=P.paper;J(`deposit`,e,n,t.write,t.read,R,R,a.read),t.swap(),J(`absorb`,e,n,a.write,a.read),a.swap()}},display(e,t,n,r){if(f){w(),J(`obstacleMask`,e,r,W(`obstacleMask`));let t=P.velocity,n=P.dye;if(J(`enforceVelocity`,e,r,t.write,t.read),t.swap(),J(`clearMaterial`,e,r,n.write,n.read),n.swap(),C){let n=P.pressure;J(`divergence`,e,r,W(`divergence`),R,t.read),J(`zero`,e,r,n.read);let i=Math.max(2,Math.round(Number(s.params.values.iterations)*s.qualitySteps()));for(let t=0;t<i;t++)J(`pressure`,e,r,n.write,n.read,R,W(`divergence`)),n.swap();J(`project`,e,r,t.write,R,t.read,n.read),t.swap(),C=!1}J(`divergence`,e,r,W(`projectedDivergence`),R,t.read)}if(u===`smoke`){let t=s.params.pack().slice(0),r=Math.max(2,Math.round(Number(s.params.values.shadowSteps)*s.qualitySteps()));new DataView(t).setUint32(X.shadowSteps,r,!0);let i=B.group(e,n,t);J(`shadow`,e,i,W(`shadow`),R,R,R,W(`dye`))}let i=[W(`dye`),W(`velocity`),W(`pressure`),W(`projectedDivergence`),W(`curl`),W(u===`ink`?`paper`:`shadow`)],a=i.map(U).join(`,`);(!Q||a!==$)&&(Q=p.createBindGroup({label:`hgpu-${u}-display`,layout:D,entries:i.map((e,t)=>({binding:t,resource:e.createView()}))}),$=a),N.draw(e,t,[r,Q,...q()])},sources:j,diagnostics:M,textureTaps(){let e={};for(let[t,n]of Object.entries(I))e[t]={texture:W(t),format:n,width:L[0],height:L[1],kind:`float`,label:`${u}: ${t}`};return e},bufferTaps(){return f&&v?{obstacles:{buffer:v,stride:16,count:v.size/16,label:`DOM rectangles (u32 count header, vec4f boxes)`}}:{}},memory(){return{textureBytes:Object.values(P).reduce((e,t)=>e+t.bytes,8)+Object.keys(F).reduce((e,t)=>e+L[0]*L[1]*(I[t]===`r32float`?4:8),0),bufferBytes:(B?.bytes??0)+(x?.size??0)}},dispose(){Object.values(A).forEach(e=>e.dispose()),N.dispose(),Object.values(P).forEach(e=>e.dispose()),Object.values(F).forEach(e=>e.destroy()),R.destroy(),x?.destroy(),_=void 0,y=void 0,B?.dispose(),H.clear(),Q=void 0,K=void 0,G=void 0}}}var d={grid:{type:`u32`,uniform:!1,default:256,min:32,max:1024,step:32,group:`Solver`,description:`Actual longest simulation dimension in cells; aspect ratio follows the stage. Changing it restarts all fields.`},iterations:{type:`u32`,default:16,min:2,max:80,step:2,group:`Solver`,description:`Jacobi pressure iterations per fixed step; adaptive quality may cap this count.`},boundary:{type:`enum`,default:`closed`,options:[`closed`,`periodic`],group:`Solver`,description:`Impermeable free-slip walls or a wrapping domain.`},viscosity:{type:`f32`,default:.02,min:0,max:1,step:.01,group:`Solver`,description:`Implicit velocity diffusion strength in squared grid cells per second; four Jacobi iterations.`},drag:{type:`f32`,default:.15,min:0,max:3,step:.01,unit:`1/s`,group:`Solver`,description:`Exponential velocity damping, separate from viscosity.`},vorticity:{type:`f32`,default:.5,min:0,max:3,step:.01,group:`Solver`,description:`Grid-scaled vorticity confinement restoring small swirls lost to advection.`},dissipation:{type:`f32`,default:.1,min:0,max:3,step:.01,unit:`1/s`,group:`Material`,description:`Exponential loss of suspended dye or smoke density.`},source:{type:`f32`,default:.65,min:0,max:3,step:.01,group:`Injection`,description:`Continuous autonomous dye or smoke injection rate; zero disables the emitter.`},force:{type:`f32`,default:.3,min:0,max:2,step:.01,group:`Injection`,description:`Autonomous jet strength and pointer drag impulse scale.`},radius:{type:`f32`,default:.045,min:.01,max:.2,step:.005,group:`Injection`,description:`Gaussian emitter radius as a fraction of stage height.`},initial:{type:`enum`,default:`vortices`,options:[`vortices`,`rest`,`uniform`,`compression`],group:`Initial state`,description:`Seeded vortices, stationary material, periodic constant flow, or a divergent convergence probe.`},initialVelocity:{type:`vec2`,default:[.15,0],min:-.5,max:.5,step:.01,group:`Initial state`,description:`Constant face velocity in stage-height units per second for the uniform initial state.`},initialAmount:{type:`f32`,default:1.5,min:0,max:4,step:.05,group:`Initial state`,description:`Initial dye or smoke amount; zero creates a completely empty material field.`},view:{type:`enum`,default:`material`,options:[`material`,`velocity`,`pressure`,`divergence`,`curl`],group:`Diagnostics`,description:`Material display or solver fields. Divergence shows the post-projection residual.`},dyeA:{type:`color`,default:`#35bacf`,group:`Palette`,description:`First dye colour; ink interprets it as pigment reflectance.`},dyeB:{type:`color`,default:`#ef795e`,group:`Palette`,description:`Second dye colour or smoke scattering colour.`},background:{type:`color`,default:`#101623`,group:`Palette`,description:`Opaque stage background, or the paper reflectance for ink.`}},f={resistance:{type:`texture`,default:`resistance`,group:`Paper`,description:`Optional red-channel wax coverage mask; white prevents pigment deposition.`},feed:{type:`enum`,default:`orbit`,options:[`orbit`,`top`],group:`Injection`,description:`Orbiting emitter or a wash deposited along the top edge of the paper.`},feedDuration:{type:`f32`,default:0,min:0,max:30,step:.5,group:`Injection`,description:`Seconds before the top feed stops; zero keeps feeding continuously.`},paperFlow:{type:`f32`,default:0,min:0,max:.5,step:.01,group:`Paper`,description:`Downward capillary transport in paper heights per second, independent of the fluid velocity.`},absorption:{type:`f32`,default:.9,min:0,max:4,step:.01,unit:`1/s`,group:`Paper`,description:`Irreversible transfer rate from suspended pigment to stationary paper deposits.`},evaporation:{type:`f32`,default:.35,min:0,max:3,step:.01,unit:`1/s`,group:`Paper`,description:`Loss of transported water. Drying accelerates deposition.`},grain:{type:`f32`,default:.5,min:0,max:1,step:.01,group:`Paper`,description:`Seeded paper variation in absorption and reflectance; zero makes paper uniform.`},opticalDensity:{type:`f32`,default:1.8,min:.1,max:6,step:.1,group:`Paper`,description:`Beer-Lambert pigment optical thickness; an artistic subtractive model.`}},p={buoyancy:{type:`f32`,default:.7,min:0,max:3,step:.01,group:`Thermal`,description:`Upward force proportional to temperature above ambient.`},weight:{type:`f32`,default:.08,min:0,max:1,step:.01,group:`Thermal`,description:`Downward force proportional to smoke density.`},heat:{type:`f32`,default:1.2,min:0,max:4,step:.05,group:`Thermal`,description:`Initial and emitted temperature above ambient.`},cooling:{type:`f32`,default:.35,min:0,max:3,step:.01,unit:`1/s`,group:`Thermal`,description:`Exponential temperature relaxation to ambient.`},extinction:{type:`f32`,default:3,min:.1,max:8,step:.1,group:`Lighting`,description:`Beer-Lambert extinction for density and the screen-space shadow march.`},lightDirection:{type:`vec2`,default:[-.6,-.8],min:-1,max:1,step:.05,group:`Lighting`,description:`Screen-plane direction toward the light; zero uses straight upward.`},shadowSteps:{type:`u32`,default:12,min:2,max:32,step:2,group:`Lighting`,description:`Density samples toward the light per simulated cell; adaptive quality may cap this count.`}};export{u as i,p as n,d as r,f as t};