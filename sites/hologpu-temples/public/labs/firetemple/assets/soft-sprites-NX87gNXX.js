import{a as e}from"./effect-meta-BxLI9aV5.js";import{a as t,r as n,t as r}from"./shader-rxwXc-Rh.js";import{d as i,n as a,r as o,u as s}from"./post-B63xyOYX.js";import{n as c}from"./types-ci2WwWg0.js";import{t as l}from"./sprite-Dyze9AaX.js";import{a as u,c as d,d as f,f as p,g as m,i as h,l as g,m as _,n as v,o as y,p as b,r as x,s as S,t as C,u as w}from"./orbit-Bcn1geid.js";import{t as T}from"./camera-Dn2fs9IM.js";import{t as E}from"./shade-Ohm-CdyU.js";var D={label:`sprite.wgsl`,code:l,chunks:{}},O={label:`sprites.wgsl`,code:`// The instanced sprite renderer's shader (src/gpu/sprites.ts). One quad per instance, built in the
// vertex stage from \`sprite.wgsl\`: camera-facing, stretched along its on-screen velocity, never
// smaller than a pixel. The fragment stage shades it with \`shade_sprite\` (the default lives in
// sprites.ts; an effect can supply its own) and fades it against the scene depth.
//
// \`sprite-settings.wgsl\` is generated from the TypeScript struct; \`sprite-shade.wgsl\` is supplied
// at run time and must define \`fn shade_sprite(s: SpriteSample) -> vec3f\`.

#include "camera.wgsl"
#include "sprite.wgsl"
#include "sprite-settings.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> settings: SpriteSettings;
@group(0) @binding(2) var scene_depth: texture_depth_2d;

// What a shading function gets for one pixel of one sprite.
struct SpriteSample {
  // Quad-local position, -1..1, +x along the motion.
  p: vec2f,
  // The instance's colour (rgb, linear) and its fourth component.
  color: vec4f,
  // The instance's free parameter.
  param: f32,
  // \`settings.shape\`.
  shape: u32,
  // Length / width of the quad, 1 when unstretched.
  ratio: f32,
  // \`settings.user\`, for values a custom shading function needs.
  user: vec4f,
}

#include "sprite-shade.wgsl"

struct SpriteVarying {
  @builtin(position) position: vec4f,
  @location(0) p: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  // param, stretch ratio, radiance scale, effective half-width in world units
  @location(2) @interpolate(flat) misc: vec4f,
  // View-space distance along the view axis. The quad lies in a plane of constant view z.
  @location(3) @interpolate(flat) view_z: f32,
}

@vertex fn vs(
  @builtin(vertex_index) vertex_index: u32,
  @location(0) position_size: vec4f,
  @location(1) velocity_param: vec4f,
  @location(2) color: vec4f,
) -> SpriteVarying {
  var out: SpriteVarying;
  let view_pos = (cam.view * vec4f(position_size.xyz, 1.0)).xyz;
  let view_z = -view_pos.z;
  let base_size = position_size.w * settings.size_scale;
  // Dead slots of a fixed-capacity buffer (size or alpha of 0) and sprites behind the eye are
  // moved outside the clip volume, so they cost four vertices and no pixels.
  if (base_size <= 0.0 || color.a <= 0.0 || view_z <= 0.0) {
    out.position = vec4f(0.0, 0.0, 2.0, 1.0);
    return out;
  }

  let pixels_per_unit = cam.proj[1][1] * cam.viewport.y * 0.5 / view_z;
  let sized = sprite_pixel_clamp(base_size, pixels_per_unit, settings.min_pixels);

  let view_velocity = (cam.view * vec4f(velocity_param.xyz, 0.0)).xyz;
  let screen_velocity = sprite_screen_velocity(view_pos, view_velocity);
  let ratio = sprite_stretch_ratio(screen_velocity, settings.stretch, settings.max_stretch);
  let corner = sprite_corner(vertex_index);
  let offset = sprite_stretch_offset(corner, screen_velocity, sized.x, ratio, settings.trail);

  out.position = cam.proj * vec4f(view_pos.xy + offset, view_pos.z, 1.0);
  out.p = corner;
  out.color = color;
  let radiance_scale = settings.intensity * sized.y * pow(ratio, -settings.stretch_dim);
  out.misc = vec4f(velocity_param.w, ratio, radiance_scale, sized.x);
  out.view_z = view_z;
  return out;
}

@fragment fn fs(in: SpriteVarying) -> @location(0) vec4f {
  var fade = sprite_near_fade(in.view_z, settings.near_fade.x, settings.near_fade.y);
  if (settings.depth_mode != 0u) {
    let depth = textureLoad(scene_depth, vec2i(in.position.xy), 0);
    let scene_z = camera_linear_depth(cam, depth);
    if (settings.depth_mode == 1u) {
      fade *= sprite_depth_fade(scene_z, in.view_z, 0.0);
    } else {
      // The fade distance can grow with the sprite: a spark and a glow puff need different ones.
      let reach = settings.fade_distance + settings.fade_scale * in.misc.w;
      fade *= sprite_depth_fade_contrast(scene_z, in.view_z, reach, settings.fade_contrast);
    }
  }
  if (fade <= 0.0) {
    return vec4f(0.0);
  }

  var s: SpriteSample;
  s.p = in.p;
  s.color = in.color;
  s.param = in.misc.x;
  s.shape = settings.shape;
  s.ratio = in.misc.y;
  s.user = settings.user;
  // Alpha is written as 0 and the blend state keeps the target's own alpha either way.
  return vec4f(max(shade_sprite(s), vec3f(0.0)) * (fade * in.misc.z), 0.0);
}
`,chunks:{"camera.wgsl":T,"sprite.wgsl":l}},k=[`disc`,`gaussian`,`ember`,`streak`],A=[`none`,`hard`,`soft`],j={shape:`gaussian`,sizeScale:1,intensity:1,stretch:0,maxStretch:8,trail:0,stretchDim:0,depth:`soft`,fadeDistance:0,fadeScale:1,fadeContrast:1,nearFade:[0,0],minPixels:1,user:[0,0,0,0]},M=i(`SpriteSettings`,{size_scale:`f32`,intensity:`f32`,stretch:`f32`,max_stretch:`f32`,trail:`f32`,stretch_dim:`f32`,fade_distance:`f32`,fade_scale:`f32`,fade_contrast:`f32`,min_pixels:`f32`,near_fade:`vec2f`,shape:`u32`,depth_mode:`u32`,user:`vec4f`}),N={label:`sprite-shade.wgsl`,code:`// Default sprite shading: instance colour * alpha, shaped by settings.shape.
#include "sprite.wgsl"

fn shade_sprite(s: SpriteSample) -> vec3f {
  let base = s.color.rgb * s.color.a;
  let peak = max(base.r, max(base.g, base.b));
  switch (s.shape) {
    case 0u: {
      return base * sprite_disc(s.p, 0.5);
    }
    case 2u: {
      let ember = sprite_ember(s.p, 0.3, 0.12);
      return mix(base, vec3f(peak), 0.6 * ember.y) * ember.x;
    }
    case 3u: {
      let streak = sprite_streak(s.p, 0.5, 0.7);
      return mix(base, vec3f(peak), 0.6 * streak * streak) * streak;
    }
    default: {
      return base * sprite_gaussian(s.p, 4.0);
    }
  }
}
`,chunks:n(D)},P={arrayStride:48,stepMode:`instance`,attributes:[{shaderLocation:0,offset:0,format:`float32x4`},{shaderLocation:1,offset:16,format:`float32x4`},{shaderLocation:2,offset:32,format:`float32x4`}]};function F(e,n){let{capacity:i,camera:a,format:o=`rgba16float`,label:c=`sprites`}=n;if(!Number.isInteger(i)||i<1)throw RangeError(`Sprite capacity must be a positive integer, got ${i}`);if(n.buffer&&n.buffer.size<i*48)throw RangeError(`Sprite buffer holds ${Math.floor(n.buffer.size/48)} sprites, capacity is ${i}`);let l=n.buffer===void 0,u=n.buffer??e.createBuffer({label:`${c} instances`,size:i*48,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),d=s(e,M,`${c} settings`),p={...j},m=n.shade??N,h=r(e,t({...O,label:`${c}/sprites.wgsl`},m.chunks??{},{"sprite-settings.wgsl":M.wgsl,"sprite-shade.wgsl":m.code})),g=e.createBindGroupLayout({label:`${c} layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`,minBindingSize:f.size}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`,minBindingSize:M.size}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`depth`}}]}),_=e.createRenderPipeline({label:c,layout:e.createPipelineLayout({label:c,bindGroupLayouts:[g]}),vertex:{module:h,entryPoint:`vs`,buffers:[P]},fragment:{module:h,entryPoint:`fs`,targets:[{format:o,blend:{color:{srcFactor:`one`,dstFactor:`one`,operation:`add`},alpha:{srcFactor:`zero`,dstFactor:`one`,operation:`add`}}}]},primitive:{topology:`triangle-list`,cullMode:`none`}}),v=e.createTexture({label:`${c} no depth`,size:[1,1],format:`depth32float`,usage:GPUTextureUsage.TEXTURE_BINDING}),y=v.createView(),b,x,S=t=>(x&&b===t||(b=t,x=e.createBindGroup({label:c,layout:g,entries:[{binding:0,resource:{buffer:a}},{binding:1,resource:{buffer:d.buffer}},{binding:2,resource:t}]})),x),C=0;return{capacity:i,buffer:u,settings:p,get count(){return C},update(t,n){if(!Number.isInteger(n)||n<0||n>i)throw RangeError(`Sprite count must be 0..${i}, got ${n}`);if(t.length<n*12)throw RangeError(`${n} sprites need ${n*12} floats, got ${t.length}`);C=n,C>0&&e.queue.writeBuffer(u,0,t.buffer,t.byteOffset,C*48)},draw(e,t){let n=t.depth?A.indexOf(p.depth):0,r=typeof p.shape==`number`?p.shape:k.indexOf(p.shape);d.set({size_scale:p.sizeScale,intensity:p.intensity,stretch:p.stretch,max_stretch:p.maxStretch,trail:p.trail,stretch_dim:p.stretchDim,fade_distance:p.fadeDistance,fade_scale:p.fadeScale,fade_contrast:p.fadeContrast,min_pixels:p.minPixels,near_fade:p.nearFade,shape:Math.max(0,r),depth_mode:Math.max(0,n),user:p.user}),d.upload();let a=e.beginRenderPass({label:t.label??c,colorAttachments:[{view:t.target,loadOp:`load`,storeOp:`store`}],timestampWrites:t.timestampWrites}),o=Math.min(t.count??C,i);o>0&&(t.scissor&&a.setScissorRect(...t.scissor),a.setPipeline(_),a.setBindGroup(0,S(t.depth??y)),a.setVertexBuffer(0,u,0,o*48),a.draw(6,o)),a.end()},destroy(){l&&u.destroy(),d.destroy(),v.destroy()}}}var I=4e3,L=4048,R=.52,z=.46,B=Math.PI*2,V=6.5,H=.9,U=-.42,ee=.995;function W(e,t,n){let r=Math.imul(e+1,2654435761)^Math.imul(t+1663821227,2246822507)^Math.imul(n+1,3266489909);return r^=r>>>16,r=Math.imul(r,2146121005),r^=r>>>15,r=Math.imul(r,2221713035),r^=r>>>16,(r>>>0)/4294967296}var G=e=>{let t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)},K=new Float32Array(3);function q(e,t,n,r){let i=B*W(e,t,2),a=z*Math.sqrt(W(e,t,3)),o=.4+.8*W(e,t,4),s=.07+.2*W(e,t,5),c=.7+1.4*W(e,t,6),l=.7+1.4*W(e,t,7),u=B*W(e,t,8),d=B*W(e,t,9),f=R+o*n+.035*n*n,p=1+.45*Math.sin(.35*r-.6*f)+.2*Math.sin(.83*r+1.3),m=.05*n*n*p,h=a*(1+.25*n),g=s*n;return K[0]=Math.cos(i)*h+H*m+g*(Math.sin(c*n+u)-Math.sin(u)),K[1]=f,K[2]=Math.sin(i)*h+U*m+g*(Math.cos(l*n+d)-Math.cos(d)),K}function te(e,t,n){let r=Math.max(0,Math.min(I,Math.round(n.count))),i=Math.round(r*Math.min(1,Math.max(0,n.sparks))),a=r-i,o=n.size,s=0,c=(t,n,r,i,a,o,c,l,u,d,f)=>{let p=s*12;e[p]=t,e[p+1]=n,e[p+2]=r,e[p+3]=i,e[p+4]=a,e[p+5]=o,e[p+6]=c,e[p+7]=l+Math.min(ee,Math.max(0,u)),e[p+8]=1,e[p+9]=.8+.4*d,e[p+10]=.6+.8*d,e[p+11]=f,s++},l=1/120;for(let e=0;e<a;e++){let n=3.5+5*W(e,0,0),r=t/n+W(e,0,1),i=Math.floor(r),a=(r-i)*n,s=q(e,i,a,t),u=s[0],d=s[1],f=s[2],p=q(e,i,a+l,t+l),m=(p[0]-u)/l,h=(p[1]-d)/l,g=(p[2]-f)/l,_=a/n,v=(1-_)**1.2,y=.78+.22*Math.sin(a*(5+9*W(e,i,10))+B*W(e,i,11)),b=(.03+.045*W(e,i,12))*(.55+.45*v)*o,x=16*G(a/.25)*G((1-_)/.12)*y;c(u,d,f,b,m,h,g,0,v,W(e,i,13),x)}for(let e=0;e<i;e++){let n=e+65536,r=2.2+1.8*W(n,0,0),i=t/r+W(n,0,1),a=Math.floor(i),s=(i-a)*r,l=B*W(n,a,2),u=.3*Math.sqrt(W(n,a,3)),d=.5+2.8*W(n,a,4)**1.4,f=2+3.6*W(n,a,5),p=(.02+.016*W(n,a,6))*o,m=Math.cos(l),h=Math.sin(l),g=.5700000000000001-p,_=(f+Math.sqrt(f*f+2*V*Math.max(g,0)))/V,v=Math.min(s,_),y=u+d*v,b=.5700000000000001+f*v-.5*V*v*v,x=s<_,S=s/r,C=(1-S)**.6;x||(C*=Math.exp(-(s-_)*1.1));let w=30*G(s/.12)*G((1-S)/.2);c(m*y,Math.max(b,p),h*y,p,x?m*d:0,x?f-V*v:0,x?h*d:0,1,C,W(n,a,7),w)}if(n.puffs<=0)return s;for(let e=0;e<18;e++){let r=e+131072,i=1.1+.7*W(r,0,0),a=t/i+W(r,0,1),o=Math.floor(a),s=a-o,l=s*i,u=B*W(r,o,2),d=.3*Math.sqrt(W(r,o,3)),f=1-.75*s,p=.1*Math.sin(l*3.1+B*W(r,o,4))*s,m=Math.cos(u)*d*f+p+H*.12*s*s,h=Math.sin(u)*d*f+U*.12*s*s,g=.6+(.95+.5*W(r,o,5))*l,_=.36-.2*s,v=G(s/.18)*G((1-s)/.55);c(m,g,h,_,0,0,0,2,.86-.5*s,.5,2.4*v*n.puffs)}for(let e=0;e<30;e++){let r=e+196608,i=t/(8+5*W(r,0,0))+W(r,0,1),a=Math.floor(i),o=i-a,s=B*W(r,a,2)+.25*o,l=.5+(2.4+2.2*W(r,a,3))*o**.8,u=.22+.3*W(r,a,4)+.1*Math.sin(B*o+e),d=.6+.75*o,f=.9*(G(o/.15)*G((1-o)/.4))*n.puffs/(1+.5*l*l);c(Math.cos(s)*l+H*.3*o,u,Math.sin(s)*l+U*.3*o,d,0,0,0,2,.5,.35,f)}return s}var J={label:`soft-sprites/shade.wgsl`,code:E,chunks:{"sprite.wgsl":l}},ne=[`soft`,`hard`,`split`,`off`],re=[`auto`,...k],Y={sunDirection:[-.45,.8,.4],sunColor:[.55,.68,1],sunIntensity:.22,skyColor:[.16,.2,.34],groundColor:[.5,.2,.07],horizonColor:[.008,.01,.018],ambient:.32,fogDensity:.045},X=[.3,.29,.28],Z=[.2,.19,.19],Q=[.07,.06,.055],$=(e,t=[1,1,1],n=0)=>{let r=m.translation(e);return m.rotateY(r,n,r),m.scale(r,t,r)},ie=c({meta:e,params:{intersection:{type:`select`,default:`soft`,options:ne},fadeDistance:{type:`number`,default:1,min:.05,max:4,step:.05,label:`fade distance (× sprite size)`},fadeContrast:{type:`number`,default:2,min:1,max:4,step:.1,label:`fade contrast`},stretch:{type:`number`,default:1,min:0,max:6,step:.05,label:`velocity stretch`},size:{type:`number`,default:1,min:.25,max:5,step:.05,label:`sprite size`},count:{type:`number`,default:1400,min:0,max:I,step:50},sparks:{type:`number`,default:.3,min:0,max:1,step:.01,label:`sparks share`},shape:{type:`select`,default:`auto`,options:re},intensity:{type:`number`,default:1,min:0,max:4,step:.05},puffs:{type:`number`,default:1,min:0,max:4,step:.05,label:`glow puffs`},speed:{type:`number`,default:1,min:0,max:3,step:.01},...a},presets:{compare:{intersection:`split`,size:1.8,puffs:4,count:500,sparks:.35,stretch:.5,intensity:.7,bloom:.25},sparks:{sparks:.85,count:2200,stretch:3.5,speed:1.3,size:.9,puffs:.7,bloom:.8},embers:{sparks:.06,count:900,stretch:.4,speed:.6,size:1.2,bloom:.75}},async create({device:e,format:t,hdr:n,canvas:r,params:i,profiler:a}){let s=o(e,{format:t,hdr:n,label:`soft-sprites`}),c=w(e,{label:`soft-sprites depth`,width:1,height:1}),l=h(e,{colorFormat:s.scene.format,depthFormat:c.format,maxObjects:32}),f=l.createView(`soft-sprites`),T={ground:u(e,d({width:80,depth:80}),`ground`),box:u(e,y(),`box`),column:u(e,S({radialSegments:28}),`column`),bowl:u(e,S({radiusTop:.5,radiusBottom:.32,radialSegments:32}),`bowl`),sphere:u(e,g({widthSegments:32,heightSegments:20}),`sphere`)},E=[{mesh:T.ground,model:m.identity(),color:Z},{mesh:T.column,model:$([0,.06,0],[.9,.12,.9]),color:Q},{mesh:T.bowl,model:$([0,.3,0],[1.2,.4,1.2]),color:Q},{mesh:T.column,model:$([0,R-.03,0],[z*2.1,.06,z*2.1]),color:[5,.9,.1],emissive:1},{mesh:T.box,model:$([2.1,.3,1.35],[1.9,.6,.9],.35),color:X},{mesh:T.box,model:$([2.45,.85,1.25],[.8,.5,.7],-.2),color:X},{mesh:T.box,model:$([-1.95,.45,1.1],[.9,.9,.9],.6),color:X},{mesh:T.sphere,model:$([-.85,.42,2],[.84,.84,.84]),color:X},{mesh:T.box,model:$([.2,.09,-3.9],[9.5,.18,2.2]),color:Z}];for(let[e,t]of[[-3.3,-1],[-1.5,-3.2],[1.5,-3.2],[3.3,-1]])E.push({mesh:T.box,model:$([e,.2,t],[1,.4,1]),color:X},{mesh:T.column,model:$([e,2.3,t],[.62,3.8,.62]),color:X},{mesh:T.box,model:$([e,4.35,t],[1,.3,1]),color:X});let D=l.upload(E),O=new Float32Array(L*12),A=F(e,{capacity:L,camera:f.camera.buffer,format:s.scene.format,shade:J,label:`soft-sprites`}),j=F(e,{capacity:L,camera:f.camera.buffer,format:s.scene.format,buffer:A.buffer,shade:J,label:`soft-sprites-hard`}),M=C(r,v({yaw:.42,pitch:.2,distance:8.6,target:[.25,1.55,-.2]}),{minPitch:.04,maxPitch:1.2,autoSpeed:.05}),N=b(),P=1,I=1,B=40,V=(e,t)=>{let n=e.settings;n.depth=t,n.fadeDistance=0,n.fadeScale=i.fadeDistance,n.fadeContrast=i.fadeContrast,n.stretch=i.stretch,n.maxStretch=24,n.trail=1,n.stretchDim=.5,n.intensity=i.intensity,n.nearFade=[.3,1.2],n.minPixels=1;let r=k.indexOf(i.shape);n.shape=r<0?k.length:r};return{resize(e,t){P=e,I=t,s.resize(P,I),c.resize(P,I)},frame(e,t,n){B+=Math.min(e.delta,.1)*i.speed;let r=M.update(e.delta),o=P/I;p({position:x(r),target:r.target,fovY:_(.72,o,.8),aspect:o,near:.1,far:90},N),f.update(N,P,I,Y);let u=te(O,B,{count:i.count,sparks:i.sparks,size:i.size,puffs:i.puffs});A.update(O,u),l.draw(t,D,{view:f,color:s.scene.view,depth:c.view,clearColor:{r:Y.horizonColor[0],g:Y.horizonColor[1],b:Y.horizonColor[2],a:1},label:`soft-sprites scene`,timestampWrites:a.pass(`scene`)});let d={target:s.scene.view,depth:c.view};if(i.intersection===`split`&&P>=4){let e=Math.floor(P/2);V(j,`hard`),V(A,`soft`),j.draw(t,{...d,count:u,scissor:[0,0,e-1,I],label:`soft-sprites hard half`,timestampWrites:a.pass(`sprites (hard)`)}),A.draw(t,{...d,scissor:[e+1,0,P-e-1,I],label:`soft-sprites soft half`,timestampWrites:a.pass(`sprites (soft)`)})}else{let e=i.intersection===`hard`?`hard`:i.intersection===`off`?`none`:`soft`;V(A,e),A.draw(t,{...d,label:`soft-sprites sprites`,timestampWrites:a.pass(`sprites`)})}s.encode(t,n,e,i,a)},destroy(){M.destroy(),j.destroy(),A.destroy();for(let e of Object.values(T))e.destroy();l.destroy(),c.destroy(),s.destroy()}}}});export{ie as effect};