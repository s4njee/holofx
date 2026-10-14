import{m as o,v as $}from"./wgpu-matrix.module-hZiCFRr9.js";import{b as ee}from"./brdf-DfmsPKoP.js";import{P as te,U as ne,f as ae,c as re,H as ie}from"./post-YOyvqv1Z.js";import{n as le}from"./noise-C55vzw-d.js";import{o as oe}from"./optics-ClQZWXWq.js";import{s as se}from"./jump-flood-DPZk2Fyk.js";import{c as ce,w as fe}from"./surface-CPzQGKfE.js";import{I as me,i as de}from"./ibl-pm7vx_C6.js";import{T as he}from"./text-sdf-HQH47OTV.js";import{h as ge}from"./gallery-CAjxCs5g.js";const pe=`// ---------------------------------------------------------------------------
// Holographic Card — a foil trading card that tilts toward the pointer.
//
// Fullscreen ray cast against a rotated card plane (no geometry). The card has
// two layers:
//   print: procedural artwork under a glossy laminate (clearcoat GGX + IBL).
//   foil:  a metallised layer with
//          - a diffraction grating (concentric grooves around the "sun", plus
//            randomly oriented glitter cells) -> rainbow streaks that sweep as
//            the card tilts relative to the light,
//          - thin-film interference tinting its reflections (oil-slick colours),
//          - anisotropic GGX, brushed radially, for stretched highlights.
// The backdrop receives the card's soft shadow and a coloured glow.
// Requires (prepended): common.wgsl, noise.wgsl, sdf.wgsl, brdf.wgsl,
// optics.wgsl, fullscreen.wgsl, \`Frame\`, \`IblParams\`, ibl.wgsl.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var title_sdf: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;

const SUN = vec2f(0.0, 0.26);

fn card_rot() -> mat3x3f { return mat3x3f(frame.cardX.xyz, frame.cardY.xyz, frame.cardZ.xyz); }

fn sd_title(p: vec2f) -> f32 {
  let rel = p - frame.titleRect.xy;
  let half = frame.titleRect.zw;
  let box = sd_box(rel, half);
  let uv = clamp(vec2f(rel.x / half.x, -rel.y / half.y) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let d = textureSampleLevel(title_sdf, lin, uv, 0.0).r * frame.titleScale;
  return select(d, max(box, d), box > 0.0);
}

// --- Artwork (card units, y up) ----------------------------------------------------

struct Art { albedo: vec3f, foil: f32, ink: f32 };

fn artwork(p: vec2f) -> Art {
  let half = frame.cardHalf;
  // Synthwave sky.
  var c = mix(vec3f(0.04, 0.02, 0.14), vec3f(0.75, 0.16, 0.45), smoothstep(-0.25, 0.75, p.y));
  c = mix(c, vec3f(0.95, 0.45, 0.35), smoothstep(0.05, -0.25, p.y) * 0.6);
  // Striped retro sun.
  let ds = length(p - SUN) - 0.3;
  let stripes = step(0.5, fract((p.y - SUN.y) * 18.0)) * step(p.y, SUN.y - 0.02);
  let sun_col = mix(vec3f(1.0, 0.85, 0.35), vec3f(1.0, 0.3, 0.45), smoothstep(SUN.y + 0.3, SUN.y - 0.3, p.y));
  let sun_mask = smoothstep(0.004, -0.004, ds) * (1.0 - stripes);
  c = mix(c, sun_col, sun_mask);
  // Mountains (two layers).
  let m1 = smoothstep(0.003, -0.003, p.y - (-0.08 + 0.12 * fbm(vec2f(p.x * 2.6, 1.3), 4)));
  c = mix(c, vec3f(0.18, 0.05, 0.25), m1);
  let m2 = smoothstep(0.003, -0.003, p.y - (-0.25 + 0.08 * fbm(vec2f(p.x * 4.0 + 7.0, 3.1), 4)));
  c = mix(c, vec3f(0.07, 0.02, 0.12), m2);
  // Title band and title.
  let band = smoothstep(0.003, -0.003, p.y - (-half.y + 0.3));
  c = mix(c, vec3f(0.02, 0.015, 0.03), band);
  let title = smoothstep(0.002, -0.002, sd_title(p));
  c = mix(c, vec3f(0.95), title);
  // Frame.
  let inner = sd_round_box(p, half - vec2f(0.055), 0.03);
  let frame_mask = smoothstep(-0.002, 0.002, inner);

  var foil = 0.0;
  switch frame.holoMode {
    case 0u: { foil = max(frame_mask, title); }                                 // frame & title
    case 1u: { foil = max(max(frame_mask, title), (1.0 - sun_mask) * 0.65); }   // reverse holo
    default: { foil = max(frame_mask, 0.8 * (1.0 - band) + title * 0.6); }      // full art
  }
  // Ink sits on top of the foil: where art is printed over foil it tints it.
  return Art(c, foil, 1.0 - frame_mask);
}

/// Base grating: concentric grooves around the sun (tangent to circles, so the
/// rainbow fans out radially from it).
fn grating_base(p: vec2f) -> vec2f {
  let r = p - SUN;
  return normalize(vec2f(-r.y, r.x) + vec2f(1e-4, 0.0));
}

/// Glitter: small round flecks, each a tiny grating with its own random
/// orientation. Returns (direction.xy, coverage).
fn glitter(p: vec2f) -> vec3f {
  let q = p * frame.glitterScale;
  let cell = floor(q);
  let rnd = hash22(cell);
  let rnd2 = hash22(cell + 17.0);
  let present = step(1.0 - frame.glitter, rnd.x);
  let centre = 0.3 + 0.4 * rnd2;
  let fleck = smoothstep(0.32, 0.18, length(fract(q) - centre));
  let a = rnd.y * TAU;
  return vec3f(cos(a), sin(a), present * fleck);
}

// --- Shading -------------------------------------------------------------------------

fn shade_card(p: vec2f, world: vec3f, v: vec3f) -> vec3f {
  let rot = card_rot();
  let n = rot * vec3f(0.0, 0.0, 1.0);
  let art = artwork(p);
  let lv = frame.lightPos - world;
  let l = normalize(lv);
  let light = frame.lightColor / dot(lv, lv);

  // Print layer: diffuse ink + glossy laminate.
  let print_m = Material(art.albedo, 0.6, 0.0);
  let coat = Material(vec3f(0.0), 0.08, 0.0);
  var print = light * brdf_direct(print_m, n, v, l) + ibl_irradiance(n) / PI * art.albedo * frame.envIntensity;
  let coat_f = f_schlick(vec3f(0.04), saturate(dot(n, v))).x;
  print += light * brdf_direct(coat, n, v, l) + ibl_specular_radiance(reflect(-v, n), 0.08) * coat_f * frame.envIntensity;

  // Foil layer.
  let t = normalize(rot * vec3f(grating_base(p), 0.0));
  let gl = glitter(p);
  let tg = normalize(rot * vec3f(gl.xy, 0.0));
  // Film thickness drifts slowly across the card (and with a little noise).
  let thickness = frame.filmThickness * (0.75 + 0.5 * fbm(p * 2.5 + 4.0, 3) + 0.15 * length(p - SUN));
  let film = mix(vec3f(1.0), thin_film(saturate(dot(n, v)), thickness, 1.45), frame.filmStrength);
  // Radially brushed metal: tangent along the radius from the sun.
  let radial = normalize(rot * vec3f(normalize(p - SUN + vec2f(1e-4, 0.0)), 0.0));
  let foil_m = Material(vec3f(0.92) * film, frame.foilRoughness, 1.0);
  var foil = light * brdf_direct_aniso(foil_m, n, radial, v, l, frame.anisotropy);
  foil += ibl_specular_radiance(reflect(-v, n), frame.foilRoughness) * film * 0.9 * frame.envIntensity;
  let rainbow = diffraction_grating(l, v, n, t, frame.grooveSpacing, 0.08);
  // Flecks diffract more widely and flash brighter than the base grating.
  let sparkle = diffraction_grating(l, v, n, tg, frame.grooveSpacing, 0.35) * gl.z * 3.0;
  foil += (rainbow + sparkle) * light * frame.holoIntensity;
  // Printed ink partially covers the foil in the artwork area.
  foil = mix(foil, foil * (art.albedo * 1.6 + 0.15), art.ink * frame.inkCover);

  return mix(print, foil, art.foil * frame.foilAmount);
}

fn shade_backdrop(world: vec3f) -> vec3f {
  // Soft studio backdrop.
  let base = mix(vec3f(0.012, 0.010, 0.020), vec3f(0.05, 0.03, 0.07), smoothstep(-2.5, 1.5, world.y));
  // Shadow of the card: where does the segment to the light cross the card plane?
  let rot = card_rot();
  let lv = frame.lightPos - world;
  let o = transpose(rot) * world;
  let d = transpose(rot) * lv;
  var vis = 1.0;
  if (abs(d.z) > 1e-4) {
    let t = -o.z / d.z;
    if (t > 0.0 && t < 1.0) {
      let s = o.xy + d.xy * t;
      let penumbra = 0.02 + frame.lightRadius * t * 2.0;
      vis = smoothstep(-penumbra, penumbra, sd_round_box(s, frame.cardHalf, frame.cardRadius));
    }
  }
  // Coloured bounce from the card onto the wall behind it.
  let glow = exp(-length(world.xy) * 1.6) * frame.glowColor;
  return base * mix(0.35, 1.0, vis) + glow;
}

@fragment
fn fs_main(fv: FullscreenOut) -> @location(0) vec4f {
  let ndc = vec2f(fv.uv.x * 2.0 - 1.0, 1.0 - fv.uv.y * 2.0);
  let far = frame.invViewProj * vec4f(ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - frame.cameraPos);
  let v = -dir;

  // Backdrop plane z = backdropZ.
  let tb = (frame.backdropZ - frame.cameraPos.z) / dir.z;
  var col = shade_backdrop(frame.cameraPos + dir * tb);

  // Card plane through the origin, rotated.
  let rot = card_rot();
  let o = transpose(rot) * frame.cameraPos;
  let d = transpose(rot) * dir;
  let t = -o.z / d.z;
  if (t > 0.0) {
    let p = (o + d * t).xy;
    let cd = sd_round_box(p, frame.cardHalf, frame.cardRadius);
    let px = t * frame.pixelAngle;
    let coverage = smoothstep(px, -px, cd);
    if (coverage > 0.0) {
      // The back of the card is plain dark stock.
      let facing = dot(rot * vec3f(0.0, 0.0, 1.0), v) > 0.0;
      let card = select(vec3f(0.02), shade_card(p, frame.cameraPos + dir * t, v), facing);
      col = mix(col, card, coverage);
    }
  }
  return vec4f(col, 1.0);
}
`,_=[.63,.88],S=30*Math.PI/180;class O{constructor(e=120,s=14){this.stiffness=e,this.damping=s}stiffness;damping;x=0;v=0;step(e,s){const i=Math.max(1,Math.ceil(s/.004166666666666667)),l=s/i;for(let p=0;p<i;p++)this.v+=(this.stiffness*(e-this.x)-this.damping*this.v)*l,this.x+=this.v*l;return this.x}}const Me=async P=>{const{device:e,surface:s,params:i,pointer:l,reducedMotion:p}=P,t=i.add({title:{value:"LIGHT TEMPLE",type:"text",maxLength:24},holoMode:{value:1,options:{"Frame & title":0,"Reverse holo":1,"Full art":2},label:"Foil layout"},holoIntensity:{value:1.2,min:0,max:4,step:.01,label:"Rainbow",hint:"Diffraction-grating strength."},grooveSpacing:{value:1500,min:600,max:4e3,step:10,label:"Groove spacing (nm)",hint:"Finer grooves spread the rainbow over wider angles."},glitter:{value:.18,min:0,max:1,step:.01,hint:"Fraction of tiny cells holding a randomly oriented glitter fleck."},filmThickness:{value:420,min:100,max:1200,step:5,label:"Film (nm)",hint:"Thin-film thickness: shifts the oil-slick colours."},filmStrength:{value:.55,min:0,max:1,step:.01,label:"Film strength"},anisotropy:{value:.75,min:-.95,max:.95,step:.01,hint:"Radially brushed foil: highlights stretch into streaks."},foilRoughness:{value:.22,min:.03,max:.8,step:.01,label:"Foil roughness"},inkCover:{value:.55,min:0,max:1,step:.01,label:"Ink over foil"}},"Foil"),m=i.add({maxTilt:{value:22,min:0,max:45,step:1,label:"Max tilt (°)"},springiness:{value:.5,min:0,max:1,step:.01,hint:"0 = heavy and damped, 1 = bouncy."},lightAngle:{value:35,min:-90,max:90,step:1,label:"Light angle (°)"},intensity:{value:9,min:0,max:40,step:.1,label:"Light intensity"},environment:{value:.6,min:0,max:2,step:.01}},"Motion & light"),M=await te.create(P,{bloom:.06,vignette:.35,grain:.03});let d=null;const G=n=>{n.beta===null||n.gamma===null||(d={beta:n.beta,gamma:n.gamma})};let v=null;i.button("Use device tilt (gyro)",async()=>{const n=DeviceOrientationEvent;try{if(n.requestPermission&&await n.requestPermission()!=="granted")return;window.addEventListener("deviceorientation",G),v=null}catch(y){console.warn("Device orientation unavailable",y)}});const c=await me.create(e);await c.setProcedural({kind:"studio"});const R=new he(e);let a=await R.generate({text:t.title,family:'"Helvetica Neue", Arial, ui-sans-serif, sans-serif',weight:800,size:140});const u=new ne(e,"Frame",{invViewProj:"mat4x4f",cardX:"vec4f",cardY:"vec4f",cardZ:"vec4f",titleRect:"vec4f",cameraPos:"vec3f",envIntensity:"f32",lightPos:"vec3f",lightRadius:"f32",lightColor:"vec3f",pixelAngle:"f32",glowColor:"vec3f",titleScale:"f32",cardHalf:"vec2f",cardRadius:"f32",backdropZ:"f32",holoMode:"u32",glitterScale:"f32",glitter:"f32",filmThickness:"f32",filmStrength:"f32",foilRoughness:"f32",anisotropy:"f32",grooveSpacing:"f32",holoIntensity:"f32",inkCover:"f32",foilAmount:"f32"}),I=await ce(e,"holo-card",fe(re,le,se,ee,oe,ae,u.wgslStruct,c.wgslStruct,de,pe)),z=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]}),V=await e.createRenderPipelineAsync({label:"holo-card",layout:e.createPipelineLayout({bindGroupLayouts:[z,c.bindGroupLayout]}),vertex:{module:I,entryPoint:"vs_fullscreen"},fragment:{module:I,entryPoint:"fs_main",targets:[{format:ie}]}}),q=e.createSampler({magFilter:"linear",minFilter:"linear"}),U=()=>e.createBindGroup({layout:z,entries:[{binding:0,resource:{buffer:u.buffer}},{binding:1,resource:a.texture.createView()},{binding:2,resource:q}]});let C=U(),L=t.title,T=0;i.onChange(()=>{clearTimeout(T),T=window.setTimeout(async()=>{if(t.title===L)return;L=t.title;const n=await R.generate({text:t.title.trim()||" ",family:'"Helvetica Neue", Arial, ui-sans-serif, sans-serif',weight:800,size:140});a.destroy(),a=n,C=U()},200)});const H=new O,N=new O;return{frame({time:n,dt:y,size:b}){const E=b.width/b.height;H.damping=N.damping=26-18*m.springiness;const f=m.maxTilt*Math.PI/180;let x,w;if(d)v??={...d},x=Math.max(-1,Math.min(1,(d.beta-v.beta)/25))*f,w=Math.max(-1,Math.min(1,(d.gamma-v.gamma)/25))*f;else if(l.inside&&l.idle<3)x=(l.smoothUv[1]-.5)*2*f,w=(l.smoothUv[0]-.5)*2*f;else{const k=p?.25:1;x=Math.sin(n*.6)*f*.45*k,w=Math.sin(n*.43+1)*f*.6*k}const Z=H.step(x,y),D=N.step(w,y),r=o.multiply(o.rotationY(D),o.rotationX(Z)),X=_[0]*1.5/(Math.tan(S/2)*E),j=_[1]*1.3/Math.tan(S/2),Y=Math.max(X,j),B=$.fromValues(0,0,Y),K=o.multiply(o.perspective(S,E,.05,50),o.lookAt(B,[0,0,0],[0,1,0])),W=m.lightAngle*Math.PI/180,J=[Math.sin(W)*2.2,1.8,Math.cos(W)*2.2+.4],F=m.intensity,Q=a.height-2*a.padding;let h=.11/Math.max(Q,1);(a.width-2*a.padding)*h>1&&(h=1/(a.width-2*a.padding)),u.set("invViewProj",o.inverse(K)).set("cardX",[r[0],r[1],r[2],0]).set("cardY",[r[4],r[5],r[6],0]).set("cardZ",[r[8],r[9],r[10],0]).set("titleRect",[0,-_[1]+.15,a.width*h/2,a.height*h/2]).set("titleScale",h).set("cameraPos",B).set("envIntensity",m.environment).set("lightPos",J).set("lightRadius",.15).set("lightColor",[F,F*.96,F*.92]).set("pixelAngle",2*Math.tan(S/2)/b.height).set("glowColor",ge("#3a1a4a").map(k=>k*.25)).set("cardHalf",_).set("cardRadius",.05).set("backdropZ",-.9).set("holoMode",t.holoMode).set("glitterScale",420).set("glitter",t.glitter).set("filmThickness",t.filmThickness).set("filmStrength",t.filmStrength).set("foilRoughness",t.foilRoughness).set("anisotropy",t.anisotropy).set("grooveSpacing",t.grooveSpacing).set("holoIntensity",t.holoIntensity).set("inkCover",t.inkCover).set("foilAmount",1).upload(),c.update();const A=e.createCommandEncoder({label:"holo-card"}),g=A.beginRenderPass({colorAttachments:[{view:M.scene(b).view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});g.setPipeline(V),g.setBindGroup(0,C),g.setBindGroup(1,c.bindGroup),g.draw(3),g.end(),M.render(A,s.currentTexture().createView(),{time:n}),e.queue.submit([A.finish()])},dispose(){clearTimeout(T),window.removeEventListener("deviceorientation",G),a.destroy(),R.destroy(),u.destroy(),c.destroy(),M.destroy()}}};export{Me as default};
