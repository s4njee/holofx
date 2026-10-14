import{b as me}from"./brdf-DfmsPKoP.js";import{P as xe,U as ye,f as be,c as we,H as _e}from"./post-YOyvqv1Z.js";import{n as Se}from"./noise-C55vzw-d.js";import{s as Re}from"./jump-flood-DPZk2Fyk.js";import{c as ze,w as Ee}from"./surface-CPzQGKfE.js";import{I as Te,i as Me}from"./ibl-pm7vx_C6.js";import{T as Le}from"./text-sdf-HQH47OTV.js";import{h as ce}from"./gallery-CAjxCs5g.js";const qe=`// ---------------------------------------------------------------------------
// Lit Typography — real DOM text, rendered as lit, extruded 3D letters.
//
// Units are canvas pixels. The wall (the page) is the plane z = 0; letters are
// the text SDF extruded toward the viewer to z = depth, with rounded edges.
//
// Oblique projection: every pixel's ray is p + shift·(depth − z) at height z.
// The letters' FRONT faces (z = depth) therefore land exactly where the DOM
// draws its (transparent) glyphs, so selection and editing line up, while a
// non-zero \`shift\` (from the pointer) reveals the extruded sides like a 3D tilt.
//
// Per pixel: sphere-trace the extruded SDF + wall, shade with GGX from the
// cursor light (soft SDF shadows, SDF ambient occlusion) plus IBL reflections;
// each letter gets its own material.
// Requires (prepended): common.wgsl, noise.wgsl, sdf.wgsl, brdf.wgsl,
// fullscreen.wgsl, \`LitType\`, \`IblParams\`, ibl.wgsl.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> u: LitType;
@group(0) @binding(1) var text_sdf: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
@group(0) @binding(3) var<storage, read> letters: array<vec4f>; // DOM x0, x1 (px), x shift (px), hue

/// Index of the letter owning column x (letters are sorted by x): binary search
/// for the last letter starting at or before x, then pick the nearer neighbour.
fn letter_at(x: f32) -> u32 {
  let n = u.letterCount;
  if (n == 0u) { return 0u; }
  var lo = 0u;
  var hi = n - 1u;
  loop {
    if (lo >= hi) { break; }
    let mid = (lo + hi + 1u) / 2u;
    if (letters[mid].x <= x) { lo = mid; } else { hi = mid - 1u; }
  }
  if (lo + 1u < n) {
    let a = letters[lo];
    let b = letters[lo + 1u];
    if (x - a.y > b.x - x) { return lo + 1u; }
  }
  return lo;
}

fn sd_text2(p_in: vec2f) -> f32 {
  // Per-letter horizontal correction so each glyph sits exactly on its DOM glyph.
  let p = vec2f(p_in.x - letters[letter_at(p_in.x)].z, p_in.y);
  let rel = p - u.textRect.xy;
  let half = u.textRect.zw;
  let box = sd_box(rel, half);
  let uv = clamp(rel / half * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let d = textureSampleLevel(text_sdf, lin, uv, 0.0).r * u.textScale;
  return select(d, max(box, d), box > 0.0);
}

/// Extruded, edge-rounded letters occupying 0 <= z <= depth.
fn sd_letters(q: vec3f) -> f32 {
  let b = u.bevel;
  let half = 0.5 * u.depth;
  return op_extrude(sd_text2(q.xy) + b, q.z - half, half - b) - b;
}

fn sd_scene(q: vec3f) -> vec2f {
  let letters_d = sd_letters(q);
  let wall_d = q.z;
  return select(vec2f(wall_d, 0.0), vec2f(letters_d, 1.0), letters_d < wall_d);
}

fn scene_normal(q: vec3f) -> vec3f {
  let e = vec2f(0.5, -0.5);
  return normalize(
    e.xyy * sd_scene(q + e.xyy).x + e.yyx * sd_scene(q + e.yyx).x +
    e.yxy * sd_scene(q + e.yxy).x + e.xxx * sd_scene(q + e.xxx).x);
}

/// Soft shadow toward the light (Quilez, with the "improved" triangulation).
fn soft_shadow(q: vec3f, l: vec3f, max_t: f32) -> f32 {
  var res = 1.0;
  var t = 1.5;
  var ph = 1e10;
  for (var i = 0; i < 40; i++) {
    let p = q + l * t;
    if (p.z > u.depth + 1.0) { break; } // above every letter: nothing more can occlude
    let h = sd_letters(p);
    let y = h * h / (2.0 * ph);
    let d = sqrt(max(h * h - y * y, 0.0));
    res = min(res, d / (u.lightRadius * max(0.0, t - y)));
    ph = h;
    t += clamp(h, 0.75, 40.0);
    if (res < 0.001 || t > max_t) { break; }
  }
  return saturate(res);
}

fn ambient_occlusion(q: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var w = 1.0;
  for (var i = 1; i <= 5; i++) {
    let h = f32(i) * 0.25 * u.depth / 5.0 + 1.0;
    occ += (h - sd_scene(q + n * h).x) * w;
    w *= 0.6;
  }
  return saturate(1.0 - occ / (0.5 * u.depth + 2.0));
}

fn hue_rgb(h: f32) -> vec3f {
  return saturate3(abs(fract(h + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0);
}

fn letter_material(x: f32) -> Material {
  let index = letter_at(x);
  let l = letters[index];
  switch u.materialMode {
    // Alternating metals.
    case 0u: {
      let k = index % 4u;
      var albedo = vec3f(1.0, 0.78, 0.36);            // gold
      if (k == 1u) { albedo = vec3f(0.95, 0.95, 0.97); } // chrome
      if (k == 2u) { albedo = vec3f(0.96, 0.6, 0.45); }  // copper
      if (k == 3u) { albedo = vec3f(0.98, 0.75, 0.7); }  // rose gold
      return Material(albedo, mix(0.18, 0.32, f32(k % 2u)), 1.0);
    }
    // Glossy plastic, one hue per letter.
    case 1u: { return Material(srgb_to_linear(mix(vec3f(0.95), hue_rgb(l.w), 0.75)), 0.28, 0.0); }
    // Single brushed gold.
    default: { return Material(vec3f(1.0, 0.8, 0.42), 0.3, 1.0); }
  }
}

@fragment
fn fs_main(v: FullscreenOut) -> @location(0) vec4f {
  let p = v.position.xy;
  // Ray from above the letters, following the oblique projection.
  let dir = normalize(vec3f(u.shift, -1.0));
  let start_z = u.depth + 2.0;
  // p is where the front face (z = depth) lands; step back up the ray to z = start_z.
  let q = vec3f(p - u.shift * (start_z - u.depth), start_z);
  var hit = vec2f(0.0);
  var t = 0.0;
  for (var i = 0; i < 96; i++) {
    hit = sd_scene(q + dir * t);
    if (hit.x < 0.2) { break; }
    t += hit.x;
    if (t > 4.0 * u.depth + 400.0) { break; }
  }
  let pos = q + dir * t;
  let n = scene_normal(pos);
  let view = -dir;

  var m: Material;
  if (hit.y > 0.5) {
    m = letter_material(pos.x);
  } else {
    // Wall: warm paper with a little tooth.
    let grain = fbm(pos.xy / 9.0, 3) * 0.04;
    m = Material(u.wallColor * (1.0 + grain), 0.85, 0.0);
  }

  let lv = u.light - pos;
  let dist = length(lv);
  let l = lv / dist;
  let shadow = soft_shadow(pos + n * 0.5, l, dist);
  let ao = ambient_occlusion(pos, n);
  let falloff = u.lightColor / (1.0 + (dist * dist) / (u.lightRange * u.lightRange));
  var col = brdf_direct(m, n, view, l) * falloff * shadow * PI;
  col += ibl_shade(m, n, view) * u.envIntensity * ao;

  switch u.debugView {
    case 1u: { col = srgb_to_linear(n * 0.5 + 0.5); }
    case 2u: { col = vec3f(shadow * ao); }
    default: {}
  }
  return vec4f(col, 1.0);
}
`,z=48,ke=2,Ue=async O=>{const{device:r,surface:B,params:U,reducedMotion:de}=O,E=B.canvas,g=E.parentElement,v=U.add({material:{value:0,options:{"Alternating metals":0,"Glossy colours":1,"Brushed gold":2}},depth:{value:.18,min:.02,max:.6,step:.01,label:"Extrusion",hint:"Relative to the font size."},bevel:{value:.025,min:0,max:.08,step:.001,hint:"Edge rounding, relative to the font size."},tilt:{value:.35,min:0,max:1.2,step:.01,hint:"How far the pointer skews the oblique projection (front faces stay put)."}},"Type"),l=U.add({lightHeight:{value:.45,min:.05,max:2,step:.01,label:"Light height",hint:"Above the page, in canvas heights."},intensity:{value:2.4,min:0,max:10,step:.05},color:{value:"#fff0dc",type:"color"},softness:{value:.06,min:.005,max:.3,step:.005,hint:"Light size: wider penumbrae."},environment:{value:.5,min:0,max:2,step:.01},wall:{value:"#d8d0c4",type:"color"},view:{value:0,options:{Lit:0,Normals:1,"Shadow × AO":2}},showDom:{value:!1,label:"Show DOM text",hint:"Reveal the real (normally transparent) heading to check alignment."}},"Light"),T=await xe.create(O,{bloom:.04,vignette:.3,grain:.02,exposure:1.05}),e=document.createElement("h1");e.className="lit-type-dom",e.contentEditable="plaintext-only",e.contentEditable!=="plaintext-only"&&(e.contentEditable="true"),e.spellcheck=!1,e.textContent="Light Temple",e.setAttribute("aria-label","Editable headline, rendered as lit 3D letters"),e.addEventListener("keydown",n=>n.key==="Enter"&&n.preventDefault()),g.append(e);let o={x:.5,y:.3,inside:!1,idle:1/0};const I=n=>{const i=E.getBoundingClientRect();o={x:(n.clientX-i.left)/i.width,y:(n.clientY-i.top)/i.height,inside:!0,idle:0}},N=()=>o.inside=!1;g.addEventListener("pointermove",I),g.addEventListener("pointerleave",N);const u=await Te.create(r);await u.setProcedural({kind:"studio"});const W=new Le(r),S=new ye(r,"LitType",{textRect:"vec4f",light:"vec3f",textScale:"f32",lightColor:"vec3f",depth:"f32",wallColor:"vec3f",bevel:"f32",shift:"vec2f",lightRadius:"f32",lightRange:"f32",envIntensity:"f32",materialMode:"u32",letterCount:"u32",debugView:"u32"}),M=r.createBuffer({size:z*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),X=new Float32Array(z*4),V=await ze(r,"lit-type",Ee(we,Se,Re,me,be,S.wgslStruct,u.wgslStruct,Me,qe)),H=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}}]}),ue=await r.createRenderPipelineAsync({label:"lit-type",layout:r.createPipelineLayout({bindGroupLayouts:[H,u.bindGroupLayout]}),vertex:{module:V,entryPoint:"vs_fullscreen"},fragment:{module:V,entryPoint:"fs_main",targets:[{format:_e}]}}),fe=r.createSampler({magFilter:"linear",minFilter:"linear"});let t=null,L=null,q="",k=0,$=!1;const j=async()=>{const n=getComputedStyle(e),i=parseFloat(n.fontSize),x=(e.textContent??"").replace(/\s+/g," ").trim()||" ",h=`${x}|${n.fontFamily}|${n.fontWeight}|${i}`;if(h===q)return;q=h;const c=await W.generate({text:x,family:n.fontFamily,weight:n.fontWeight,size:Math.min(320,i*ke)});if($||h!==q)return c.destroy();t?.destroy(),t=c,k=i,L=r.createBindGroup({layout:H,entries:[{binding:0,resource:{buffer:S.buffer}},{binding:1,resource:c.texture.createView()},{binding:2,resource:fe},{binding:3,resource:{buffer:M}}]})};await j();let G=0;const Y=()=>{clearTimeout(G),G=window.setTimeout(()=>{j()},120)};e.addEventListener("input",Y);const K=new ResizeObserver(Y);K.observe(e);let s=[.5,.3],f=[0,0];const m=document.createRange();return{frame({time:n,dt:i,size:x}){if(!t||!L)return;o.idle+=i,e.classList.toggle("reveal",l.showDom);const{width:h,height:c}=x,y=E.getBoundingClientRect(),p=h/y.width;m.selectNodeContents(e);const Q=m.getBoundingClientRect(),J=t.size/k,P=(Q.left-y.left)*p,he=(Q.top-y.top+t.fontAscent/J)*p,d=p/J,pe=P+(t.width/2-t.originX)*d,ge=he+(t.height/2-t.baseline)*d,Z=k*p,b=e.firstChild,C=[];if(b&&b.nodeType===Node.TEXT_NODE){const _=b.textContent??"";for(let a=0;a<_.length&&C.length<z;a++)_[a].trim()&&(m.setStart(b,a),m.setEnd(b,a+1),C.push(m.getBoundingClientRect()))}const ee=t.letters.slice(0,z);ee.forEach((_,a)=>{const ae=P+(_.start-t.originX)*d,R=C[a],oe=R?(R.left-y.left)*p:ae,ve=R?(R.right-y.left)*p:P+(_.end-t.originX)*d;X.set([oe,ve,oe-ae,(a*.13+.02)%1],a*4)}),r.queue.writeBuffer(M,0,X);const te=!o.inside||o.idle>4,ne=te?[.5+.32*Math.sin(n*.33),.35+.2*Math.sin(n*.47)]:[o.x,o.y],re=1-Math.pow(2,-i/(te?.9:.08));s=[s[0]+(ne[0]-s[0])*re,s[1]+(ne[1]-s[1])*re];const ie=de?v.tilt*.3:v.tilt,le=[(.5-s[0])*ie,(.5-s[1])*ie],se=1-Math.pow(2,-i/.15);f=[f[0]+(le[0]-f[0])*se,f[1]+(le[1]-f[1])*se];const D=ce(l.color),F=l.intensity;S.set("textRect",[pe,ge,t.width*d/2,t.height*d/2]).set("textScale",d).set("light",[s[0]*h,s[1]*c,l.lightHeight*c]).set("lightColor",[D[0]*F,D[1]*F,D[2]*F]).set("lightRadius",l.softness).set("lightRange",c*.9).set("depth",v.depth*Z).set("bevel",v.bevel*Z).set("shift",f).set("wallColor",ce(l.wall)).set("envIntensity",l.environment).set("materialMode",v.material).set("letterCount",ee.length).set("debugView",l.view).upload(),u.update();const A=r.createCommandEncoder({label:"lit-type"}),w=A.beginRenderPass({colorAttachments:[{view:T.scene(x).view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});w.setPipeline(ue),w.setBindGroup(0,L),w.setBindGroup(1,u.bindGroup),w.draw(3),w.end(),T.render(A,B.currentTexture().createView(),{time:n,raw:l.view!==0}),r.queue.submit([A.finish()])},dispose(){$=!0,clearTimeout(G),K.disconnect(),e.remove(),g.removeEventListener("pointermove",I),g.removeEventListener("pointerleave",N),t?.destroy(),W.destroy(),M.destroy(),S.destroy(),u.destroy(),T.destroy()}}};export{Ue as default};
