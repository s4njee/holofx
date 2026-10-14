import{v as L,m as T}from"./wgpu-matrix.module-hZiCFRr9.js";import{b as Se}from"./brdf-DfmsPKoP.js";import{P as Me,U as oe,f as de,c as ce,H as Ae}from"./post-YOyvqv1Z.js";import{n as fe}from"./noise-C55vzw-d.js";import{s as ue}from"./jump-flood-DPZk2Fyk.js";import{c as me,w as he}from"./surface-CPzQGKfE.js";import{I as qe,i as Le}from"./ibl-pm7vx_C6.js";import{T as Te}from"./text-sdf-HQH47OTV.js";import{h as z}from"./gallery-CAjxCs5g.js";const ze=`// ---------------------------------------------------------------------------
// Embossed Card — height-field bake (runs only when the card design changes).
//
// Output (rgba16float), in card texture space:
//   r = height 0..1 (0.5 = card surface; emboss rises toward 1, deboss sinks toward 0)
//   g = design coverage 0..1 (where foil / ink goes)
//   b = roughness variation 0..1 (0.5 = none)
// Requires (prepended): common.wgsl, noise.wgsl, sdf.wgsl, fullscreen.wgsl, \`Bake\`.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> bake: Bake;
@group(0) @binding(1) var head_sdf: texture_2d<f32>;
@group(0) @binding(2) var sub_sdf: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;

/// Distance to text whose SDF texture is placed at rect = (centre, half-size) in card units.
fn sd_text_tex(tex: texture_2d<f32>, rect: vec4f, scale_pad: vec2f, p: vec2f) -> f32 {
  let rel = p - rect.xy;
  let half = rect.zw;
  let box = sd_box(rel, half);
  let uv = clamp(vec2f(rel.x / half.x, -rel.y / half.y) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let d = textureSampleLevel(tex, lin, uv, 0.0).r * scale_pad.x;
  let glyph_box = sd_box(rel, max(half - vec2f(scale_pad.y), vec2f(1e-3)));
  return select(d, max(glyph_box, d - box), box > 0.0);
}

/// A small "temple" mark: a ring around a triangle.
fn sd_logo(p: vec2f) -> f32 {
  let ring = sd_ring(p, 0.075, 0.006);
  let tri = sd_equilateral_triangle(p + vec2f(0.0, 0.006), 0.038);
  return min(ring, op_onion(tri, 0.005));
}

/// Material microstructure in ~[-1, 1] (x) and roughness variation (y).
fn micro(p: vec2f) -> vec2f {
  let q = p + vec2f(bake.seed * 13.7, bake.seed * 7.3);
  switch bake.material {
    // Cotton paper: soft cloudy formation + fine fibres in random directions.
    case 0u: {
      let cloud = fbm(q * 18.0, 4);
      let fibres = gradient_noise(rot2(0.6) * q * vec2f(260.0, 22.0)) + gradient_noise(rot2(-0.9) * q * vec2f(240.0, 25.0));
      return vec2f(cloud * 0.5 + fibres * 0.35, 0.5 + 0.2 * cloud);
    }
    // Brushed metal: long scratches along x, plus faint large-scale waviness.
    case 1u: {
      let brush = gradient_noise(vec2f(q.x * 6.0, q.y * 900.0)) * 0.7 + gradient_noise(vec2f(q.x * 2.0, q.y * 2400.0)) * 0.3;
      return vec2f(brush * 0.6 + fbm(q * 6.0, 3) * 0.3, 0.5 + 0.35 * brush);
    }
    // Pebbled leather: cellular grain with wrinkles; tops are slightly glossier.
    case 2u: {
      let c = worley(q * 70.0 + fbm(q * 9.0, 3) * 0.6);
      let pebble = smoothstep(0.0, 0.35, c.y - c.x) * 2.0 - 1.0;
      let wrinkle = fbm(q * 12.0, 4);
      return vec2f(pebble * 0.8 + wrinkle * 0.4, 0.5 - 0.3 * pebble);
    }
    // Smooth matte stock: almost flat.
    default: {
      return vec2f(fbm(q * 90.0, 3) * 0.4, 0.5);
    }
  }
}

@fragment
fn fs_bake(v: FullscreenOut) -> @location(0) vec4f {
  // Card units, origin at the centre, y up.
  let p = (v.uv - 0.5) * 2.0 * bake.cardHalf * vec2f(1.0, -1.0);

  var d = 1e9;
  d = min(d, sd_text_tex(head_sdf, bake.headRect, bake.headScalePad, p));
  d = min(d, sd_text_tex(sub_sdf, bake.subRect, bake.subScalePad, p));
  d = min(d, sd_logo(p - bake.logoPos));
  if (bake.border != 0u) {
    let inset = bake.cardHalf - vec2f(0.075);
    d = min(d, op_onion(sd_round_box(p, inset, 0.03), 0.0035));
  }

  // Pressed profile: a smooth shoulder of width \`bevel\`, like a real die.
  let profile = smoothstep(0.0, max(bake.bevel, 1e-4), -d);
  let m = micro(p);
  // Pressed areas are flattened by the die, so they keep less of the grain.
  let h = 0.5 + 0.45 * bake.relief * profile + bake.microAmount * m.x * (1.0 - 0.7 * profile);
  // Ink/foil covers the whole glyph (not just the fully pressed part), with ~1 texel of AA.
  let coverage = smoothstep(-0.0006, 0.0006, -d);
  return vec4f(clamp(h, 0.0, 1.0), coverage, m.y, 1.0);
}
`,Ge=`// ---------------------------------------------------------------------------
// Embossed Card — a letterpress / embossed business card under a moving light.
//
// One fullscreen pass, no geometry:
//   1. Cast the camera ray against the card's top plane (relief ceiling).
//      Miss -> the table, with the card's soft shadow and contact occlusion.
//   2. Hit -> parallax occlusion mapping through the baked height field:
//      linear search over depth layers, then a secant refinement.
//   3. Normal from the height field's gradient; material = paper/metal/leather
//      base or foil/ink where the design mask says so.
//   4. Light: the pointer light (GGX, inverse-square) with relief self-shadows
//      (march the height field toward the light), plus IBL for reflections.
// Requires (prepended): common.wgsl, noise.wgsl, sdf.wgsl, brdf.wgsl,
// fullscreen.wgsl, \`Frame\`, \`IblParams\`, ibl.wgsl.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var height_tex: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;

fn card_uv(xy: vec2f) -> vec2f {
  return vec2f(xy.x, -xy.y) / (2.0 * frame.cardHalf) + 0.5;
}

fn relief(xy: vec2f) -> vec4f {
  return textureSampleLevel(height_tex, lin, card_uv(xy), 0.0);
}

fn card_base_z() -> f32 { return frame.cardLift; }

/// World z of the relief surface for a height-texture value.
fn surface_z(h: f32) -> f32 { return card_base_z() + h * frame.reliefDepth; }

/// Steep parallax + secant refinement. \`p\` is where the ray enters the relief
/// ceiling; returns the world-space hit on the height field.
fn parallax(p: vec3f, dir: vec3f) -> vec3f {
  let steps = f32(frame.pomSteps);
  // Ray travels from the ceiling (h = 1) down to the floor (h = 0).
  let travel = dir * (frame.reliefDepth / max(-dir.z, 0.05));
  var prev_t = 0.0;
  var prev_gap = 1.0 - relief(p.xy).r; // ray height above surface, in h units (>= 0 above)
  if (prev_gap <= 0.0) { return p; }
  for (var i = 1.0; i <= steps; i += 1.0) {
    let t = i / steps;
    let q = p + travel * t;
    let ray_h = 1.0 - t;
    let gap = ray_h - relief(q.xy).r;
    if (gap <= 0.0) {
      // Secant between the last sample above and the first below the surface.
      let tt = mix(prev_t, t, prev_gap / max(prev_gap - gap, 1e-5));
      return p + travel * tt;
    }
    prev_t = t;
    prev_gap = gap;
  }
  return p + travel;
}

fn relief_normal(xy: vec2f) -> vec3f {
  let e = 1.0 / vec2f(textureDimensions(height_tex)) * 2.0 * frame.cardHalf; // one texel in card units
  let hx = relief(xy + vec2f(e.x, 0.0)).r - relief(xy - vec2f(e.x, 0.0)).r;
  let hy = relief(xy + vec2f(0.0, e.y)).r - relief(xy - vec2f(0.0, e.y)).r;
  let dzdx = hx * frame.reliefDepth / (2.0 * e.x);
  let dzdy = hy * frame.reliefDepth / (2.0 * e.y);
  return normalize(vec3f(-dzdx, -dzdy, 1.0));
}

/// Soft self-shadowing by the relief: march toward the light until the ray
/// clears the relief ceiling, tracking how far it dips below the surface.
fn relief_shadow(p: vec3f, l: vec3f) -> f32 {
  let ceiling = surface_z(1.0);
  if (l.z <= 0.01) { return 0.0; }
  let len = max(ceiling - p.z, 0.0) / l.z;
  if (len <= 0.0) { return 1.0; }
  var vis = 1.0;
  for (var i = 1.0; i <= 12.0; i += 1.0) {
    let t = len * i / 12.0;
    let q = p + l * t;
    let depth_below = surface_z(relief(q.xy).r) - q.z;
    // Penumbra widens with distance travelled (contact-hardening).
    vis = min(vis, saturate(1.0 - depth_below / (0.02 * frame.reliefDepth + t * frame.lightRadius * 0.15)));
  }
  return vis;
}

struct Shaded { color: vec3f, n: vec3f, vis: f32 };

fn shade_card(hit: vec3f, v: vec3f) -> Shaded {
  let r = relief(hit.xy);
  let n = relief_normal(hit.xy);
  let foil = smoothstep(0.2, 0.8, r.g) * f32(frame.foil != 0u);
  let rough_var = (r.b - 0.5) * 0.6;
  var m = Material(frame.baseAlbedo, saturate(frame.baseRoughness + rough_var), frame.baseMetallic);
  m = Material(
    mix(m.albedo, frame.foilAlbedo, foil),
    mix(m.roughness, saturate(frame.foilRoughness + rough_var * 0.3), foil),
    mix(m.metallic, frame.foilMetallic, foil));

  let lv = frame.lightPos - hit;
  let dist2 = dot(lv, lv);
  let l = lv * inverseSqrt(dist2);
  let vis = relief_shadow(hit + n * 1e-4, l);
  let direct = frame.lightColor * brdf_direct(m, n, v, l) * vis / (dist2 + frame.lightRadius * frame.lightRadius);
  // Paper edge: a hint of darkening right at the card's cut edge.
  let edge = smoothstep(0.0, 0.012, -sd_round_box(hit.xy, frame.cardHalf, frame.cardRadius));
  let col = (direct + ibl_shade(m, n, v) * frame.envIntensity) * mix(0.75, 1.0, edge);
  return Shaded(col, n, vis);
}

fn shade_table(q: vec3f, v: vec3f) -> vec3f {
  // Dark walnut-ish desk: long stretched grain.
  let g = fbm(vec2f(q.x * 1.5, q.y * 14.0) + fbm(q.xy * 2.0, 3) * 0.6, 5);
  let albedo = frame.tableAlbedo * (0.75 + 0.35 * g);
  let m = Material(albedo, 0.55 - 0.15 * g, 0.0);
  let n = vec3f(0.0, 0.0, 1.0);

  // Soft shadow of the (lifted) card: where does the ray toward the light cross
  // the card's underside plane, and is that inside the card?
  let lv = frame.lightPos - q;
  let dist2 = dot(lv, lv);
  let l = lv * inverseSqrt(dist2);
  var vis = 1.0;
  if (frame.lightPos.z > frame.cardLift + 1e-3) {
    let s = q.xy + lv.xy * (frame.cardLift / lv.z);
    let penumbra = frame.lightRadius * frame.cardLift / (frame.lightPos.z - frame.cardLift) + 0.002;
    vis = smoothstep(-penumbra, penumbra, sd_round_box(s, frame.cardHalf, frame.cardRadius));
  }
  // Contact occlusion under and around the card's footprint.
  let footprint = sd_round_box(q.xy, frame.cardHalf, frame.cardRadius);
  let ao = mix(0.35, 1.0, smoothstep(-0.01, frame.cardLift * 6.0 + 0.03, footprint));

  let direct = frame.lightColor * brdf_direct(m, n, v, l) * vis / (dist2 + frame.lightRadius * frame.lightRadius);
  return direct + ibl_shade(m, n, v) * frame.envIntensity * ao;
}

@fragment
fn fs_main(fv: FullscreenOut) -> @location(0) vec4f {
  let ndc = vec2f(fv.uv.x * 2.0 - 1.0, 1.0 - fv.uv.y * 2.0);
  let far = frame.invViewProj * vec4f(ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - frame.cameraPos);
  let v = -dir;

  // Table (z = 0).
  let t_table = -frame.cameraPos.z / dir.z;
  let q = frame.cameraPos + dir * t_table;
  var col = shade_table(q, v);
  var dbg = vec3f(0.0);

  // Card: enter at the relief ceiling.
  let ceiling = surface_z(1.0);
  let t_top = (ceiling - frame.cameraPos.z) / dir.z;
  let p = frame.cameraPos + dir * t_top;
  let card_d = sd_round_box(p.xy, frame.cardHalf, frame.cardRadius);
  // Anti-alias the card silhouette over ~one pixel.
  let px = t_top * frame.pixelAngle;
  let coverage = smoothstep(px, -px, card_d);
  if (coverage > 0.0) {
    let hit = parallax(p, dir);
    let s = shade_card(hit, v);
    col = mix(col, s.color, coverage);
    let r = relief(hit.xy);
    switch frame.debugView {
      case 1u: { dbg = vec3f(r.r); }
      case 2u: { dbg = srgb_to_linear(s.n * 0.5 + 0.5); }
      case 3u: { dbg = vec3f(s.vis); }
      default: {}
    }
    dbg *= coverage;
  }
  if (frame.debugView != 0u) { col = dbg; }
  return vec4f(col, 1.0);
}
`,G=[1,1/1.75],He=.035,H=28*Math.PI/180,y={paper:{label:"Cotton paper (letterpress)",albedo:"#f1ece2",roughness:.85,metallic:0,micro:.05,relief:-1,foil:"ink"},metal:{label:"Brushed steel",albedo:"#c8cbd0",roughness:.32,metallic:1,micro:.025,relief:1,foil:"none"},leather:{label:"Black leather",albedo:"#1e1a18",roughness:.55,metallic:0,micro:.09,relief:-1,foil:"gold"},matte:{label:"Matte black stock",albedo:"#141414",roughness:.75,metallic:0,micro:.02,relief:1,foil:"gold"}},Ie={paper:0,metal:1,leather:2,matte:3},De={gold:{albedo:"#ffd27a",roughness:.22,metallic:1},silver:{albedo:"#eef0f3",roughness:.18,metallic:1},copper:{albedo:"#f2a27a",roughness:.25,metallic:1},ink:{albedo:"#1d2a4a",roughness:.6,metallic:0}},je=async X=>{const{device:t,surface:pe,params:w,pointer:d,reducedMotion:ge}=X,K=window.matchMedia("(pointer: coarse)").matches,a=w.add({material:{value:"paper",options:Object.fromEntries(Object.entries(y).map(([e,r])=>[r.label,e])),hint:"Each material comes with its own relief direction and foil default."},headline:{value:"Light Temple",type:"text",maxLength:32},subline:{value:"WEBGPU LIGHTING STUDIO",type:"text",maxLength:48},relief:{value:"auto",options:{"Material default":"auto",Emboss:"emboss",Deboss:"deboss"}},foil:{value:"auto",options:{"Material default":"auto",None:"none",Gold:"gold",Silver:"silver",Copper:"copper",Ink:"ink"}},depth:{value:.6,min:.1,max:2,step:.01,label:"Depth (mm)"},bevel:{value:.35,min:.05,max:1.5,step:.01,label:"Shoulder (mm)",hint:"Width of the pressed edge. Real dies are around 0.2–0.5 mm."},border:{value:!0}},"Card"),g=w.add({lightHeight:{value:.45,min:.08,max:2,step:.01,label:"Height",hint:"Lower = more raking light, deeper relief shadows."},intensity:{value:1.4,min:0,max:6,step:.01},color:{value:"#ffe2c4",type:"color"},lightRadius:{value:.08,min:.005,max:.5,step:.005,label:"Radius"},environment:{value:.35,min:0,max:1.5,step:.01,hint:"Studio IBL fill (gives metals something to reflect)."}},"Light"),i=w.add({tilt:{value:32,min:0,max:60,step:1,label:"Tilt (°)",hint:"Viewing angle. Parallax occlusion mapping only shows depth off-axis."},lift:{value:.03,min:0,max:.3,step:.005,hint:"How far the card floats above the desk."},table:{value:"#3a2a20",type:"color",label:"Desk"},pomSteps:{value:K?16:32,min:4,max:96,step:1,label:"POM steps"},parallax:{value:!ge,label:"Pointer parallax"},debug:{value:0,options:{Lit:0,Height:1,Normals:2,"Relief shadow":3}}},"View & debug"),I=await Me.create(X,{bloom:.03,vignette:.35,grain:.025,exposure:1.1}),c=await qe.create(t);await c.setProcedural({kind:"studio"});const D=new Te(t),_=new oe(t,"Bake",{cardHalf:"vec2f",material:"u32",relief:"f32",headRect:"vec4f",subRect:"vec4f",headScalePad:"vec2f",subScalePad:"vec2f",logoPos:"vec2f",bevel:"f32",microAmount:"f32",seed:"f32",border:"u32"}),Y=await me(t,"embossed-card-bake",he(ce,fe,ue,de,_.wgslStruct,ze)),$=await t.createRenderPipelineAsync({label:"embossed-card-bake",layout:"auto",vertex:{module:Y,entryPoint:"vs_fullscreen"},fragment:{module:Y,entryPoint:"fs_bake",targets:[{format:"rgba16float"}]}}),J=K?1536:2560,C=t.createTexture({label:"card-height",size:[J,Math.round(J/1.75)],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),Q=t.createSampler({magFilter:"linear",minFilter:"linear"}),be='"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';let f=null,u=null,P="",B="";const Z=async()=>{const e=`${a.headline}|${a.subline}`;if(e===P)return;P=e;const[r,n]=await Promise.all([D.generate({text:a.headline.trim()||" ",family:be,weight:600,size:200}),D.generate({text:a.subline.trim()||" ",family:'"Helvetica Neue", Arial, ui-sans-serif, sans-serif',weight:500,size:120})]);if(e!==P){r.destroy(),n.destroy();return}f?.destroy(),u?.destroy(),f=r,u=n,B=""},ee=(e,r,n,m,s)=>{const h=e.height-2*e.padding;let l=m/Math.max(h,1);return(e.width-2*e.padding)*l>s&&(l=s/(e.width-2*e.padding)),{rect:[r,n,e.width*l/2,e.height*l/2],scalePad:[l,e.padding*l]}},te=()=>{if(!f||!u)return;const e=y[a.material]??y.paper,r=a.relief==="auto"?e.relief:a.relief==="emboss"?1:-1,n=JSON.stringify([a.material,r,a.bevel,a.border,P]);if(n===B)return;B=n;const m=1/44,s=ee(f,0,-.02,.17,1.6),h=ee(u,0,-.28,.045,1.3);_.set("cardHalf",G).set("material",Ie[a.material]??0).set("relief",r).set("headRect",s.rect).set("headScalePad",s.scalePad).set("subRect",h.rect).set("subScalePad",h.scalePad).set("logoPos",[0,.3]).set("bevel",a.bevel*m).set("microAmount",e.micro).set("seed",.37).set("border",a.border?1:0).upload();const l=t.createBindGroup({layout:$.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:_.buffer}},{binding:1,resource:f.texture.createView()},{binding:2,resource:u.texture.createView()},{binding:3,resource:Q}]}),b=t.createCommandEncoder({label:"card-bake"}),p=b.beginRenderPass({colorAttachments:[{view:C.createView(),loadOp:"clear",storeOp:"store"}]});p.setPipeline($),p.setBindGroup(0,l),p.draw(3),p.end(),t.queue.submit([b.finish()])};await Z(),te();let E=0;w.onChange(()=>{clearTimeout(E),E=window.setTimeout(()=>{Z().then(te)},200)});const k=new oe(t,"Frame",{invViewProj:"mat4x4f",cameraPos:"vec3f",reliefDepth:"f32",lightPos:"vec3f",lightRadius:"f32",lightColor:"vec3f",envIntensity:"f32",baseAlbedo:"vec3f",baseRoughness:"f32",foilAlbedo:"vec3f",foilRoughness:"f32",tableAlbedo:"vec3f",baseMetallic:"f32",cardHalf:"vec2f",cardLift:"f32",cardRadius:"f32",foilMetallic:"f32",pixelAngle:"f32",foil:"u32",pomSteps:"u32",debugView:"u32"}),ae=await me(t,"embossed-card",he(ce,fe,ue,Se,de,k.wgslStruct,c.wgslStruct,Le,Ge)),re=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]}),ve=await t.createRenderPipelineAsync({label:"embossed-card",layout:t.createPipelineLayout({bindGroupLayouts:[re,c.bindGroupLayout]}),vertex:{module:ae,entryPoint:"vs_fullscreen"},fragment:{module:ae,entryPoint:"fs_main",targets:[{format:Ae}]}}),xe=t.createBindGroup({layout:re,entries:[{binding:0,resource:{buffer:k.buffer}},{binding:1,resource:C.createView()},{binding:2,resource:Q}]});let o=[.3,.2],R=0,O=0;return{frame({time:e,dt:r,size:n}){const m=n.width/n.height,s=1-Math.pow(2,-r/.25),[h,l]=d.inside&&i.parallax?d.smoothUv:[.5,.5];R+=((h-.5)*.12-R)*s,O+=((l-.5)*.08-O)*s;const b=i.tilt*Math.PI/180+O,p=G[0]*1.3/(Math.tan(H/2)*m),ye=G[1]*1.45/Math.tan(H/2),V=Math.max(p,ye),ne=L.fromValues(Math.sin(R)*V,-Math.sin(b)*V,Math.cos(b)*Math.cos(R)*V),we=T.lookAt(ne,[0,0,0],[0,1,0]),_e=T.perspective(H,m,.05,50),Pe=T.multiply(_e,we),F=T.inverse(Pe),le=!d.inside||d.idle>4;let S;if(le)S=[Math.sin(e*.37)*.9,Math.sin(e*.53)*.45];else{const A=[d.uv[0]*2-1,1-d.uv[1]*2],q=L.transformMat4([A[0],A[1],0],F),Re=L.transformMat4([A[0],A[1],1],F),j=L.subtract(Re,q),se=(i.lift-q[2])/j[2];S=[q[0]+j[0]*se,q[1]+j[1]*se]}const ie=1-Math.pow(2,-r/(le?.8:.07));o=[o[0]+(S[0]-o[0])*ie,o[1]+(S[1]-o[1])*ie];const M=y[a.material]??y.paper,ke=a.foil==="auto"?M.foil:a.foil,v=De[ke],N=z(g.color),U=g.intensity;k.set("invViewProj",F).set("cameraPos",ne).set("reliefDepth",a.depth/44).set("lightPos",[o[0],o[1],i.lift+g.lightHeight]).set("lightRadius",g.lightRadius).set("lightColor",[N[0]*U,N[1]*U,N[2]*U]).set("envIntensity",g.environment).set("baseAlbedo",z(M.albedo)).set("baseRoughness",M.roughness).set("baseMetallic",M.metallic).set("foilAlbedo",v?z(v.albedo):[0,0,0]).set("foilRoughness",v?.roughness??.5).set("foilMetallic",v?.metallic??0).set("foil",v?1:0).set("tableAlbedo",z(i.table)).set("cardHalf",G).set("cardLift",i.lift).set("cardRadius",He).set("pixelAngle",2*Math.tan(H/2)/n.height).set("pomSteps",i.pomSteps).set("debugView",i.debug).upload(),c.update();const W=t.createCommandEncoder({label:"embossed-card"}),x=W.beginRenderPass({colorAttachments:[{view:I.scene(n).view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});x.setPipeline(ve),x.setBindGroup(0,xe),x.setBindGroup(1,c.bindGroup),x.draw(3),x.end(),I.render(W,pe.currentTexture().createView(),{time:e,raw:i.debug!==0}),t.queue.submit([W.finish()])},dispose(){clearTimeout(E),f?.destroy(),u?.destroy(),D.destroy(),C.destroy(),_.destroy(),k.destroy(),c.destroy(),I.destroy()}}};export{je as default};
