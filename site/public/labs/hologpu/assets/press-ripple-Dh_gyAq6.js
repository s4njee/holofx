import{a as e,d as t,f as n,g as r,o as i,r as a,t as o}from"./effect-DJnwN9gs.js";import{n as s}from"./common-DDMx69ab.js";var c=.6,l={intensity:{...s(.2,0,1,`Maximum wavefront opacity; overlapping waves do not add brightness.`,`Light`),css:!0},width:{...s(2,.5,12,`Soft wavefront standard deviation in CSS pixels.`,`Geometry`),unit:`px`},tint:{type:`color`,default:`#d9e5ff`,css:!0,group:`Palette`,description:`Ripple colour; alpha also scales opacity.`}},u=n(e,i,t(`press-ripple:uniforms`,`${r(l).wgsl}
@group(0) @binding(1) var<uniform> params:Params;
struct Ripples { events:array<vec4f,4> };
@group(0) @binding(2) var<uniform> ripples:Ripples;
@group(0) @binding(3) var<uniform> clock:vec4f;`),t(`press-ripple:fragment`,`
@fragment fn fragment(in:VertexOut)->@location(0) vec4f {
  let dpr=max(frame.dpr,0.0001);
  let size=frame.resolution/dpr;
  var opacity=0.0;
  for(var i=0u;i<4u;i++) {
    let event=ripples.events[i];
    let age=clock.x-event.z;
    if(event.w<0.5 || age<0.0 || age>=0.6) {continue;}
    let progress=clamp(age/0.6,0.0,1.0);
    if(frame.reducedMotion>0.5) {
      // Only the latest press fades. The host stays still and no ring expands.
      if(i==3u) {opacity=progress*(1.0-progress)*4.0;}
    } else {
      let centre=event.xy*size;
      let reach=length(max(centre,size-centre))+params.width*3.0;
      let radius=reach*(1.0-(1.0-progress)*(1.0-progress));
      let distance=length(in.uv*size-centre)-radius;
      let sigma=max(params.width,0.5/dpr);
      let ring=exp(-0.5*distance*distance/(sigma*sigma));
      let fade=smoothstep(0.0,0.04,progress)*pow(1.0-progress,1.5);
      opacity=max(opacity,ring*fade);
    }
  }
  let alpha=clamp(opacity*params.intensity*params.tint.a,0.0,1.0);
  return vec4f(params.tint.rgb*alpha,alpha);
}`)),d=o({id:`press-ripple`,budget:{expectedMs:.4,referenceSize:[640,400]},family:`procedural`,title:`Soft press wavefront`,tier:`T1`,core:!1,tags:[`button`,`card`,`press`,`interaction`,`launch-page`],features:[],inputs:[`pointer-down`],params:l,presets:{pearl:{tint:`#d9e5ff`,intensity:.2,width:2},ember:{tint:`#ffc89a`,intensity:.22,width:2.5},ink:{tint:`#314c79`,intensity:.16,width:1.5}},quality:{resolutionScale:[.5,1]},reducedMotion:{time:0},fallback:`transparent`,poster:new URL(`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAABQCAYAAABoMayFAAADT0lEQVR4AezZ0Y6bMBBA0aj//9GVwgsCBBh7iWfm9CHqJkA8Z1ZXlfrv4w8BAgSKCghg0cUbmwCBz0cA/RYQIFBWoHQAy27d4AQIfAUE8MvghQCBigICWHHrZiZA4CsggF+Ggi9GJkDAf4L4HSBAoK6AfwHW3b3JCZQXEMDyvwIVAcxMYBEQwMXBKwECBQUEsODSjUyAwCIggIuDVwJVBMy5EhDAFYa/EiBQS0AAa+3btAQIrAQEcIXhrwQI5BbYTieAWxE/EyBQRkAAy6zaoAQIbAUEcCviZwIEygiUCmCZrRqUAIFbAgJ4i8lFBAhkFBDAjFs1EwECtwQE8BZTgouMQIDATkAAdyTeIECgioAAVtm0OQkQ2AkI4I7EG/kETETgWEAAj128S4BAAQEBLLBkIxIgcCwggMcu3iWQRcAcJwICeILjIwIEcgsIYO79mo4AgRMBATzB8REBArEFrk4vgFdCPidAIK2AAKZdrcEIELgSEMArIZ8TIJBWIHUA027NYAQIDBEQwCGMHkKAQEQBAYy4NWcmQGCIgAAOYZzwIY5EgMClgABeErmAAIGsAgKYdbPmIkDgUkAAL4lcEE/AiQncExDAe06uIkAgoYAAJlyqkQgQuCcggPecXEUgioBzNggIYAOWSwkQyCUggLn2aRoCBBoEBLABy6UECMwt0Ho6AWwVcz0BAmkEBDDNKg1CgECrgAC2irmeAIE0AqkCmGYrBiFA4BUBAXyF2ZcQIDCjgADOuBVnIkDgFQEBfIX5hS/xFQQINAsIYDOZGwgQyCIggFk2aQ4CBJoFBLCZzA3zCTgRgWcCAvjMzV0ECCQQEMAESzQCAQLPBATwmZu7CMwi4BwdAgLYgedWAgRiCwhg7P05PQECHQIC2IHnVgIEfivQ++0C2CvofgIEwgoIYNjVOTgBAr0CAtgr6H4CBMIKhA5gWHUHJ0BgCgEBnGINDkGAwC8EBPAX6r6TAIEpBARwijU8OIRbCBDoFhDAbkIPIEAgqoAARt2ccxMg0C0ggN2EHvC+gG8kMEZAAMc4egoBAgEFBDDg0hyZAIExAgI4xtFTCLwl4HsGCgjgQEyPIkAgloAAxtqX0xIgMFBAAAdiehQBAn8rMPrp/wEAAP//QjI79wAAAAZJREFUAwBBIAChDFaBqAAAAABJRU5ErkJggg==`,``+import.meta.url).href,cardFallback:{kind:`none`},async create(e){let t=new Float32Array(16),n=e.device.createBuffer({label:`press-ripple-events`,size:t.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),r=e.device.createBuffer({label:`press-ripple-clock`,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});e.device.queue.writeBuffer(n,0,t);try{let i=await a(e.session,u,e.format,`hgpu-press-ripple`,[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]),o=e.device.createBindGroup({layout:i.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.frameBuffer}},{binding:1,resource:{buffer:e.paramsBuffer}},{binding:2,resource:{buffer:n}},{binding:3,resource:{buffer:r}}]}),s=!1,l=!1,d=e=>t.some((n,r)=>r%4==3&&n>0&&e>=t[r-1]&&e-t[r-1]<c);return{resize(){},update(){},onPointerDown(e,n){return n.reducedMotion&&t.fill(0),t.copyWithin(0,4),t.set([e[0],e[1],n.interactionTime??n.time,1],12),c},shouldRender(e){return d(e.interactionTime??e.time)||s},render(a,l,u){let f=a.interactionTime??a.time;for(let e=0;e<4;e++)f-t[e*4+2]>=c&&(t[e*4+3]=0);e.device.queue.writeBuffer(n,0,t),e.device.queue.writeBuffer(r,0,new Float32Array([f,0,0,0])),i.draw(l,u,[o]),s=d(f)},reset(){t.fill(0),s=!1},sources:{fragment:u},diagnostics:i.diagnostics,bufferTaps(){return{ripples:{buffer:n,stride:16,count:4,label:`Oldest-first press events`}}},memory(){return{textureBytes:0,bufferBytes:l?0:t.byteLength+16}},dispose(){l||(l=!0,i.dispose(),n.destroy(),r.destroy())}}}catch(e){throw n.destroy(),r.destroy(),e}}});export{d as t};