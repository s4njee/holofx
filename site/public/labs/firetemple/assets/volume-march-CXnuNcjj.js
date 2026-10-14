import{t as e}from"./effect-meta-BxLI9aV5.js";import{a as t}from"./shader-rxwXc-Rh.js";import{d as n,g as r,h as i,m as a,n as o,p as s,r as c,u as l}from"./post-B63xyOYX.js";import{t as u}from"./fullscreen-BDXEFvdz.js";import{t as d}from"./math-fT5w54uK.js";import{n as f}from"./types-ci2WwWg0.js";import{t as p}from"./fbm-C42g5uzM.js";import{t as m}from"./noise-BHiu8YkL.js";import{t as h}from"./hash-bWx0F85T.js";import{t as g}from"./texture-DeVOcqJ7.js";import{i as _}from"./flicker-rx1gUUj0.js";import{t as v}from"./volume-DpXys9mC.js";import{a as y,c as b,d as x,f as S,g as C,h as w,i as T,l as E,m as D,n as O,p as k,r as ee,s as te,t as ne,u as re}from"./orbit-Bcn1geid.js";import{t as A}from"./camera-Dn2fs9IM.js";import{t as j}from"./lighting-B08vxPLD.js";import{t as M}from"./march-Dghjko6_.js";function N(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function P(e={}){let t=Math.max(4,Math.floor(e.size??64)),n=e.sigma??1.5,r=t*t,i=N(e.seed??1),a=Math.min(Math.ceil(n*4.8),Math.floor((t-1)/2)),o=a*2+1,s=new Float64Array(o*o);for(let e=-a;e<=a;e++)for(let t=-a;t<=a;t++)s[(e+a)*o+t+a]=Math.exp(-(t*t+e*e)/(2*n*n));let c=new Uint8Array(r),l=new Float64Array(r),u=(e,n)=>{c[e]=+(n===1);let r=e%t,i=(e-r)/t;for(let e=0;e<o;e++){let c=(i+e-a+t)%t*t,u=e*o;for(let e=0;e<o;e++)l[c+(r+e-a+t)%t]+=n*s[u+e]}},d=()=>{let e=-1,t=-1/0;for(let n=0;n<r;n++)c[n]===1&&l[n]>t&&(t=l[n],e=n);return e},f=()=>{let e=-1,t=1/0;for(let n=0;n<r;n++)c[n]===0&&l[n]<t&&(t=l[n],e=n);return e},p=Math.max(1,Math.floor(r/10));for(let e=0;e<p;){let t=Math.floor(i()*r);c[t]===0&&(u(t,1),e++)}for(let e=0;e<r*4;e++){let e=d();u(e,-1);let t=f();if(u(t,1),t===e)break}let m=new Int32Array(r),h=c.slice(),g=l.slice();for(let e=p-1;e>=0;e--){let t=d();u(t,-1),m[t]=e}c.set(h),l.set(g);for(let e=p;e<r;e++){let t=f();u(t,1),m[t]=e}let _=new Uint8Array(r);for(let e=0;e<r;e++)_[e]=Math.floor(m[e]*256/r);return _}var F;function I(){return F??=P()}function ie(e,t={}){let n=t.size!==void 0||t.seed!==void 0||t.sigma!==void 0,r=Math.max(4,Math.floor(t.size??64));return g(e,{label:`blue noise`,width:r,height:r,format:`r8unorm`,data:n?P(t):I()})}var L={label:`volume/depth-downsample.wgsl`,code:`// Pass 1 of a reduced-resolution march (reduced.ts): the full-resolution depth buffer reduced to
// the march resolution, as view-space depth in world units (r32float).
//
// Each low-resolution texel covers a block of \`divisor\` x \`divisor\` full-resolution pixels and has
// to pick ONE depth for its ray. Averaging would invent a depth no pixel has. Taking the nearest
// in every block on a checkerboard and the farthest on the other squares (Shopf, "Mixed Resolution
// Rendering", GDC 2009) means that around any silhouette both the foreground and the background
// depth are present among neighbouring texels, so the depth-aware upsample can always find a texel
// that was marched to the right depth. A plain bilinear upsample cannot use that and would show the
// checkerboard as a zigzag: for it every block takes its farthest depth.

#include "fullscreen.wgsl"
#include "volume-reduce-params.wgsl"

@group(0) @binding(0) var<uniform> reduce: VolumeReduceParams;
@group(0) @binding(1) var scene_depth: texture_depth_2d;

// View-space depth, with everything beyond the medium treated as one distance (see reduced.ts).
fn view_depth(depth: f32) -> f32 {
  let z = reduce.near * reduce.far / (reduce.far - depth * (reduce.far - reduce.near));
  return min(z, reduce.depth_limit);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let texel = vec2i(in.position.xy);
  let last = vec2i(textureDimensions(scene_depth)) - vec2i(1);
  let divisor = i32(reduce.divisor);
  var nearest = 1.0;
  var farthest = 0.0;
  for (var y = 0; y < divisor; y++) {
    for (var x = 0; x < divisor; x++) {
      let d = textureLoad(scene_depth, min(texel * divisor + vec2i(x, y), last), 0);
      nearest = min(nearest, d);
      farthest = max(farthest, d);
    }
  }
  let pick_near = reduce.checker != 0u && ((texel.x + texel.y) & 1) == 0;
  return vec4f(view_depth(select(farthest, nearest, pick_near)), 0.0, 0.0, 1.0);
}
`,chunks:{"fullscreen.wgsl":u}},R={label:`volume/upsample.wgsl`,code:`// Pass 3 of a reduced-resolution march (reduced.ts): the low-resolution march result, upsampled to
// the scene's resolution and composited over it.
//
// The march target holds vec4f(radiance, transmittance). Plain bilinear upsampling smears it across
// silhouettes: a low-resolution texel that marched all the way to the far wall bleeds its fog over
// the near object in front, as a halo one low-resolution texel wide. The depth-aware filter weighs
// each of the four texels by how close the depth it was marched against is to this pixel's own
// depth (volume_upsample_weights), so the edge of the volume against geometry stays as sharp as
// the geometry.
//
// Output is premultiplied: rgb = radiance, a = 1 - transmittance, for the blend
// (one, one-minus-src-alpha), which leaves scene * transmittance + radiance in the target.

#include "fullscreen.wgsl"
#include "volume.wgsl"
#include "volume-reduce-params.wgsl"

@group(0) @binding(0) var<uniform> reduce: VolumeReduceParams;
@group(0) @binding(1) var scene_depth: texture_depth_2d;
@group(0) @binding(2) var march: texture_2d<f32>;
@group(0) @binding(3) var march_depth: texture_2d<f32>;

fn view_depth(depth: f32) -> f32 {
  let z = reduce.near * reduce.far / (reduce.far - depth * (reduce.far - reduce.near));
  return min(z, reduce.depth_limit);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = vec2i(in.position.xy);
  let last = vec2i(textureDimensions(march)) - vec2i(1);

  // This pixel's centre in low-resolution texel coordinates (texel centres at integers).
  let at = (vec2f(pixel) + vec2f(0.5)) / reduce.divisor - vec2f(0.5);
  // The 2x2 footprint is slid back inside the texture at the borders instead of collapsing onto
  // the last row or column: the weights there are the same (0 and 1), but the depth-aware filter
  // keeps four distinct candidates, so the checkerboard of depths still offers both sides.
  let base = clamp(vec2i(floor(at)), vec2i(0), max(last - vec2i(1), vec2i(0)));
  let t00 = base;
  let t10 = min(base + vec2i(1, 0), last);
  let t01 = min(base + vec2i(0, 1), last);
  let t11 = min(base + vec2i(1, 1), last);

  var weights = volume_bilinear_weights(clamp(at - vec2f(base), vec2f(0.0), vec2f(1.0)));
  if (reduce.depth_aware != 0u) {
    let depths = vec4f(
      textureLoad(march_depth, t00, 0).r,
      textureLoad(march_depth, t10, 0).r,
      textureLoad(march_depth, t01, 0).r,
      textureLoad(march_depth, t11, 0).r,
    );
    let depth = view_depth(textureLoad(scene_depth, pixel, 0));
    weights = volume_upsample_weights(weights, depths, depth, reduce.tolerance);
  }

  // Written as the first texel plus weighted differences: where the four texels agree the
  // differences are exactly zero, so a constant field comes through bit for bit.
  let first = textureLoad(march, t00, 0);
  let result = first
    + (textureLoad(march, t10, 0) - first) * weights.y
    + (textureLoad(march, t01, 0) - first) * weights.z
    + (textureLoad(march, t11, 0) - first) * weights.w;
  return vec4f(result.rgb, 1.0 - result.a);
}
`,chunks:{"fullscreen.wgsl":u,"volume.wgsl":v}},z=[`depth-aware`,`bilinear`],B=`rgba16float`,V=`r32float`,H=n(`VolumeReduceParams`,{near:`f32`,far:`f32`,divisor:`f32`,tolerance:`f32`,depth_limit:`f32`,depth_aware:`u32`,checker:`u32`}),U={"volume-reduce-params.wgsl":H.wgsl};function W(e,t){return Math.max(1,Math.ceil(Math.max(1,Math.round(e))/t))}var G={color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`}};function ae(e,n){let{label:r}=n,o=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|(n.readback?GPUTextureUsage.COPY_SRC:0),c=s(e,{label:`${r} march`,format:B,width:1,height:1,usage:o}),u=s(e,{label:`${r} march depth`,format:V,width:1,height:1,usage:o}),d=l(e,H,`${r} reduce params`),f={binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},p={binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`depth`}},m=e=>({binding:e,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`unfilterable-float`}}),h=e.createBindGroupLayout({label:`${r} depth downsample layout`,entries:[f,p]}),g=e.createBindGroupLayout({label:`${r} upsample layout`,entries:[f,p,m(2),m(3)]}),_=a(e,{label:`${r} depth downsample`,fragment:t(L,U),format:V,layout:[h]}),v=new Map,y=n.divisor??2,b=1,x=1,S=0,C=.1,w=100,T=3e38,E=`depth-aware`,D=new WeakMap,O=new WeakMap,k=e=>{d.set({near:C,far:w,divisor:y,depth_limit:T,depth_aware:+(E===`depth-aware`),checker:+(E===`depth-aware`),...e===void 0?void 0:{tolerance:e}}),d.upload()};return{target:c,depth:u,get divisor(){return y},get uvScale(){return[c.width*y/b,c.height*y/x]},get generation(){return S},resize(e,t,n=y){b=Math.max(1,Math.round(e)),x=Math.max(1,Math.round(t)),y=n;let r=W(b,y),i=W(x,y),a=c.resize(r,i);return u.resize(r,i),a&&(S++,D=new WeakMap,O=new WeakMap),a},encodeDepth(t,n){C=n.near,w=n.far,T=n.depthLimit??3e38,E=n.filter??`depth-aware`,k();let a=D.get(n.sceneDepth);a||(a=e.createBindGroup({label:`${r} depth downsample`,layout:h,entries:[{binding:0,resource:{buffer:d.buffer}},{binding:1,resource:n.sceneDepth}]}),D.set(n.sceneDepth,a));let o=t.beginRenderPass({label:`${r} depth downsample`,colorAttachments:[{view:u.view,loadOp:`clear`,storeOp:`store`}],timestampWrites:n.timestampWrites});i(o,_,a),o.end()},composite(n,o){let{color:s,sceneDepth:l}=o;E=o.filter??E,k(o.depthTolerance??.02);let f=v.get(s.format);f||(f=a(e,{label:`${r} upsample ${s.format}`,fragment:t(R,U),format:s.format,blend:G,layout:[g]}),v.set(s.format,f));let p=O.get(l);p||(p=e.createBindGroup({label:`${r} upsample`,layout:g,entries:[{binding:0,resource:{buffer:d.buffer}},{binding:1,resource:l},{binding:2,resource:c.view},{binding:3,resource:u.view}]}),O.set(l,p));let m=n.beginRenderPass({label:`${r} upsample`,colorAttachments:[{view:s.view,loadOp:`load`,storeOp:`store`}],timestampWrites:o.timestampWrites});i(m,f,p),m.end()},destroy(){c.destroy(),u.destroy(),d.destroy()}}}var oe={label:`volume-march/lighting.wgsl`,code:j,chunks:{"fullscreen.wgsl":u,"camera.wgsl":A,"noise.wgsl":m,"hash.wgsl":h,"math.wgsl":d}},se={label:`volume-march/march.wgsl`,code:M,chunks:{"fullscreen.wgsl":u,"camera.wgsl":A,"hash.wgsl":h,"fbm.wgsl":p,"noise.wgsl":m,"math.wgsl":d,"volume.wgsl":v}},ce=n(`MarchParams`,{uv_scale:`vec2f`,time:`f32`,step_length:`f32`,max_steps:`i32`,jitter_mode:`u32`,frame:`u32`,early_out:`f32`,flame:`f32`,smoke:`f32`,intensity:`f32`,wind:`f32`,flicker:`f32`}),le=n(`LightParams`,{fire_position:`vec3f`,fire_intensity:`f32`,fire_color:`vec3f`,time:`f32`,post_x:`f32`,post_height:`f32`,post_radius:`f32`}),K=[`1`,`1/2`,`1/4`],ue={1:1,"1/2":2,"1/4":4},de=[`none`,`white`,`ign`,`r2`,`blue`],fe=5.5,pe=.3,me=120,he=1.35,q=2.05,J=.045,Y={min:[-2,0,-2],max:[2,4.6,2]};function ge(e){let t=0;for(let n=0;n<8;n++){let r=(n&1?Y.max:Y.min)[0],i=(n&2?Y.max:Y.min)[1],a=(n&4?Y.max:Y.min)[2];t=Math.max(t,-(e[2]*r+e[6]*i+e[10]*a+e[14]))}return t}function X(e,t=[1,1,1],n=0,r=0){let i=C.translation(e);return C.rotateY(i,r,i),C.rotateZ(i,n,i),C.scale(i,t,i),i}var Z={rate:3,depth:.2,shimmer:.02,shimmerRate:13},_e=1-(Z.depth+Z.shimmer)/2,Q=f({meta:e,params:{steps:{type:`number`,default:64,min:8,max:128,step:1,label:`max steps`},resolution:{type:`select`,default:`1/2`,options:K},jitter:{type:`select`,default:`ign`,options:de},animateJitter:{type:`boolean`,default:!1,label:`animate jitter`},upsample:{type:`select`,default:`depth-aware`,options:z},earlyOut:{type:`number`,default:.02,min:0,max:.25,step:.005,label:`early out`},flame:{type:`number`,default:1,min:.4,max:1.6,step:.01},smoke:{type:`number`,default:1,min:0,max:2.5,step:.01},intensity:{type:`number`,default:1,min:0,max:3,step:.01},wind:{type:`number`,default:.2,min:-1,max:1,step:.01},speed:{type:`number`,default:1,min:0,max:2.5,step:.01},distance:{type:`number`,default:5.6,min:2.2,max:14,step:.1},orbit:{type:`number`,default:.06,min:-.5,max:.5,step:.01,label:`auto orbit`},...o},presets:{reference:{steps:128,resolution:`1`,earlyOut:.005},budget:{steps:32,resolution:`1/4`},"no-jitter":{steps:24,resolution:`1`,jitter:`none`},"edge-closeup":{distance:2.6,resolution:`1/4`,upsample:`bilinear`,orbit:0},smoulder:{flame:.55,smoke:2,intensity:.7,wind:.5}},async create({device:e,format:n,hdr:i,canvas:o,params:u,profiler:d}){let f=c(e,{format:n,hdr:i,label:`volume-march`}),p=ae(e,{label:`volume-march`}),m=e.createTexture({label:`volume-march blue noise stand-in`,size:[1,1],format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING}),h=!1,g=s(e,{label:`volume-march albedo`,format:`rgba8unorm`,width:1,height:1}),v=re(e,{label:`volume-march depth`,width:1,height:1}),A=T(e,{colorFormat:g.format,depthFormat:v.format}),j=A.createView(`volume-march`),M={ground:y(e,b({width:90,depth:90}),`ground`),sphere:y(e,E({widthSegments:128,heightSegments:64}),`ball`),rod:y(e,te({radialSegments:32}),`rod`)},N=[.09,.09,.1],P=[.11,.075,.05],F=[{mesh:M.ground,model:X([0,0,0]),color:[.21,.18,.15],emissive:1},{mesh:M.rod,model:X([he,q/2,0],[J*2,q,J*2]),color:N,emissive:1},{mesh:M.rod,model:X([-1.35,q/2,0],[J*2,q,J*2]),color:N,emissive:1},{mesh:M.rod,model:X([0,1.98,0],[.06,3,.06],Math.PI/2),color:N,emissive:1},{mesh:M.rod,model:X([0,1.86,0],[.024,.24,.024]),color:N,emissive:1},{mesh:M.sphere,model:X([0,1.5,0],[.62,.54,.62]),color:N,emissive:1}];for(let e=0;e<6;e++){let t=e/6*Math.PI*2+.3,n=.36+.05*Math.sin(e*2.4);F.push({mesh:M.rod,model:C.multiply(C.rotationY(t),X([n,.24,0],[.15+e%3*.02,.95,.15],Math.PI/2-.42)),color:P,emissive:1})}for(let e=0;e<11;e++){let t=e/11*Math.PI*2,n=.3+.09*Math.sin(e*5.3),r=.27+.07*Math.sin(e*3.1);F.push({mesh:M.sphere,model:C.multiply(C.rotationY(t),X([.98+.05*Math.sin(e*1.7),.05,0],[n*1.2,n*.75,n],0,e)),color:[r,r*.97,r*.93],emissive:1})}let I=l(e,le,`volume-march light`);I.set({post_x:he,post_height:q,post_radius:J});let L=a(e,{fragment:t(oe,{"light-params.wgsl":le.wgsl}),format:f.scene.format}),R=l(e,ce,`volume-march params`),z=l(e,x,`volume-march camera`),B=a(e,{fragment:t(se,{"march-params.wgsl":ce.wgsl}),format:p.target.format}),V,H,U=-1,W=1,G=1,K=k(),Y=O({yaw:.62,pitch:.15,distance:u.distance,target:[0,1.55,0],idleTime:60}),Q=ne(o,Y,{autoSpeed:0,minPitch:.04,maxPitch:1.25}),$=0,ve=0;return{resize(e,t){W=e,G=t,f.resize(e,t),g.resize(e,t),v.resize(e,t),p.resize(e,t,ue[u.resolution]??2),V=void 0},frame(t,n,i){$+=t.delta*u.speed,Q.update(t.delta,!1);let a=Math.min(Math.max((Y.idleTime-1.5)/2,0),1);Y.yaw+=u.orbit*a*a*(3-2*a)*t.delta,Y.distance=u.distance;let o=W/G;S({position:ee(Y),target:Y.target,fovY:D(.72,o,.62),aspect:o,near:pe,far:me},K),ve+=t.delta*Math.min(u.speed,1);let s=_(ve,1,Z)/_e;j.update(K,W,G,{sunDirection:[0,1,0],sunColor:[0,0,0],sunIntensity:0,skyColor:[0,0,0],groundColor:[0,0,0],horizonColor:[0,0,0],ambient:0,fogDensity:0}),A.draw(n,A.upload(F),{view:j,color:g.view,depth:v.view,label:`volume-march scene`,timestampWrites:d.pass(`scene`)}),I.set({fire_position:[0,.55,0],fire_intensity:3*u.intensity*u.flame*s,fire_color:[1,.5,.2],time:$}),I.upload(),V??=e.createBindGroup({label:`volume-march lighting`,layout:L.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:j.camera.buffer}},{binding:1,resource:{buffer:I.buffer}},{binding:2,resource:g.view},{binding:3,resource:v.view}]}),r(n,f.scene.view,L,[V],{timestampWrites:d.pass(`lighting`)});let c=ue[u.resolution]??2;c!==p.divisor&&p.resize(W,G,c);let l=u.upsample;p.encodeDepth(n,{sceneDepth:v.view,near:pe,far:me,depthLimit:ge(K.view),filter:l,timestampWrites:d.pass(`march depth`)});let y=Math.round(u.steps);w(z,K,W,G),z.upload(),R.set({uv_scale:p.uvScale,time:$,step_length:fe/y,max_steps:y,jitter_mode:Math.max(0,de.indexOf(u.jitter)),frame:u.animateJitter?t.frame:0,early_out:u.earlyOut,flame:u.flame,smoke:u.smoke,intensity:u.intensity,wind:u.wind,flicker:s}),R.upload(),u.jitter===`blue`&&!h&&(m.destroy(),m=ie(e),h=!0,H=void 0),(!H||U!==p.generation)&&(U=p.generation,H=e.createBindGroup({label:`volume-march march`,layout:B.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:R.buffer}},{binding:1,resource:{buffer:z.buffer}},{binding:2,resource:p.depth.view},{binding:3,resource:m.createView()}]})),r(n,p.target.view,B,[H],{timestampWrites:d.pass(`march`)}),p.composite(n,{color:f.scene,sceneDepth:v.view,filter:l,timestampWrites:d.pass(`upsample`)}),f.encode(n,i,t,u,d)},destroy(){Q.destroy();for(let e of Object.values(M))e.destroy();A.destroy(),g.destroy(),v.destroy(),I.destroy(),R.destroy(),z.destroy(),m.destroy(),p.destroy(),f.destroy()}}}});export{Q as effect};