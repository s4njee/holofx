import{P as Q,U as Z,f as ee,c as te,H as g}from"./post-YOyvqv1Z.js";import{n as ne}from"./noise-C55vzw-d.js";import{s as le}from"./jump-flood-DPZk2Fyk.js";import{g as re}from"./mipmaps-D2ImRwxg.js";import{c as oe,w as se}from"./surface-CPzQGKfE.js";import{T as ie}from"./text-sdf-HQH47OTV.js";import{h as G}from"./gallery-CAjxCs5g.js";const ae=`// ---------------------------------------------------------------------------
// Neon Sign — glass tubes, a buzzing flicker and light spilling over brick.
//
//   fs_emission: every tube's emitted light (text outline or fill, a frame, a
//                moon icon) into a half-res HDR map, then mip-mapped.
//   fs_composite: the wall is lit by the *blurred* emission. Summing several
//                mip levels approximates the ~1/r falloff of light from a
//                line source, and the gradient of a blurry level gives the
//                light's direction for bump-shading the bricks. Tubes are drawn
//                sharp on top: white-hot cores, coloured edges, glassy highlights
//                and a faint mounting shadow; unlit tubes stay visible as glass.
// Requires (prepended): common.wgsl, noise.wgsl, sdf.wgsl, fullscreen.wgsl, \`Neon\`.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> u: Neon;
@group(0) @binding(1) var text_sdf: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
@group(0) @binding(3) var emission_tex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> letters: array<vec4f>; // (x0, x1) in px, (phase, faulty)

// --- Tube shapes (px, y down) --------------------------------------------------------

fn sd_text(p: vec2f) -> f32 {
  let rel = p - u.textRect.xy;
  let half = u.textRect.zw;
  let box = sd_box(rel, half);
  let uv = clamp(rel / half * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let d = textureSampleLevel(text_sdf, lin, uv, 0.0).r * u.textScale;
  return select(d, max(box, d), box > 0.0);
}

/// Tube distance: outline mode follows the glyph contour, solid mode inflates it.
fn tube_text(p: vec2f) -> f32 {
  let d = sd_text(p);
  return select(abs(d) - u.tube, d - u.tube * 0.6, u.style == 1u);
}

fn tube_frame(p: vec2f) -> f32 {
  return abs(sd_round_box(p - u.frameRect.xy, u.frameRect.zw, u.tube * 6.0)) - u.tube;
}

fn tube_icon(p: vec2f) -> f32 {
  let c = u.iconPos.xy;
  let r = u.iconPos.z;
  let moon = op_subtract(sd_circle(p - c, r), sd_circle(p - c - vec2f(r * 0.45, -r * 0.3), r * 0.85));
  return abs(moon) - u.tube * 0.9;
}

// --- Flicker ----------------------------------------------------------------------

/// 0..1 brightness for a tube with a per-element phase; \`faulty\` tubes misbehave more.
fn flicker(phase: f32, faulty: f32) -> f32 {
  let t = u.time;
  let rate = mix(1.3, 6.0, faulty);
  let slot = floor(t * rate + phase * 17.0);
  let r = hash21(vec2f(slot, phase * 31.0));
  let chance = u.flicker * mix(0.06, 0.55, faulty);
  // Brief dropouts with fast buzzing during them.
  let buzz = step(0.5, hash21(vec2f(floor(t * 60.0), phase)));
  let off = select(0.0, mix(1.0, buzz, 0.6), r < chance); // strict: flicker = 0 never drops out
  // Constant subtle mains hum.
  let hum = 1.0 - 0.03 * u.flicker * sin(t * 314.0 + phase * 6.0);
  return (1.0 - off) * hum;
}

fn text_flicker(p: vec2f) -> f32 {
  var best = 0u;
  var best_d = 1e9;
  for (var i = 0u; i < u.letterCount; i++) {
    let l = letters[i];
    let d = max(l.x - p.x, p.x - l.y);
    if (d < best_d) {
      best_d = d;
      best = i;
    }
  }
  let l = letters[best];
  return flicker(l.z, l.w);
}

struct Tubes { d: vec3f, power: vec3f };

fn tubes(p: vec2f) -> Tubes {
  return Tubes(
    vec3f(tube_text(p), tube_frame(p), tube_icon(p)),
    vec3f(text_flicker(p), flicker(0.73, 0.0), flicker(0.21, 0.0)) * u.power);
}

// --- Emission map -------------------------------------------------------------------

fn tube_emission(d: f32) -> f32 { return smoothstep(0.5, -0.5, d); }

@fragment
fn fs_emission(v: FullscreenOut) -> @location(0) vec4f {
  let p = v.position.xy * u.emissionScale;
  let t = tubes(p);
  let e = u.colorText * t.power.x * tube_emission(t.d.x)
        + u.colorFrame * t.power.y * tube_emission(t.d.y)
        + u.colorIcon * t.power.z * tube_emission(t.d.z);
  return vec4f(e, 1.0);
}

// --- Wall -----------------------------------------------------------------------------

struct Wall { albedo: vec3f, height: f32 };

fn wall(p: vec2f) -> Wall {
  let s = u.resolution.y;
  if (u.wallType == 1u) {
    // Concrete: blotchy, pitted.
    let n = fbm(p / s * 6.0, 5);
    let pits = smoothstep(0.75, 0.9, value_noise(p / s * 90.0));
    return Wall(vec3f(0.33, 0.32, 0.31) * (0.8 + 0.3 * n), 0.5 + 0.2 * n - 0.4 * pits);
  }
  // Brick: running bond with mortar joints.
  let brick = vec2f(0.16, 0.055) * s;
  var q = p / brick;
  let row = floor(q.y);
  q.x += select(0.0, 0.5, (i32(row) & 1) == 1);
  let id = floor(q);
  let f = fract(q) * brick;
  let mortar = 0.006 * s;
  let edge = min(min(f.x, brick.x - f.x), min(f.y, brick.y - f.y));
  let joint = smoothstep(mortar * 0.4, mortar, edge);
  let tint = hash22(id);
  let albedo = mix(vec3f(0.18, 0.17, 0.16), mix(vec3f(0.42, 0.16, 0.11), vec3f(0.5, 0.25, 0.16), tint.x) * (0.8 + 0.3 * tint.y), joint);
  let rough = fbm(p / s * 40.0 + id, 3) * 0.15;
  return Wall(albedo, joint * (0.8 + rough));
}

fn wall_normal(p: vec2f) -> vec3f {
  let e = 1.0;
  let hx = wall(p + vec2f(e, 0.0)).height - wall(p - vec2f(e, 0.0)).height;
  let hy = wall(p + vec2f(0.0, e)).height - wall(p - vec2f(0.0, e)).height;
  return normalize(vec3f(-hx * u.bump, -hy * u.bump, 1.0));
}

@fragment
fn fs_composite(v: FullscreenOut) -> @location(0) vec4f {
  let p = v.position.xy;
  let uv = p / u.resolution;

  // Spill: sum of increasingly blurred emission ~ 1/r falloff from the tubes.
  var spill = vec3f(0.0);
  var w = 1.0;
  for (var lod = 1.0; lod <= 7.0; lod += 1.0) {
    spill += textureSampleLevel(emission_tex, lin, uv, lod).rgb * w;
    w *= 1.15;
  }
  spill *= u.spill;
  // Light direction from the slope of a very blurry level (points toward the tubes).
  let texel = 1.0 / u.resolution * 24.0;
  let lum = vec4f(
    luminance(textureSampleLevel(emission_tex, lin, uv + vec2f(texel.x, 0.0), 5.0).rgb),
    luminance(textureSampleLevel(emission_tex, lin, uv - vec2f(texel.x, 0.0), 5.0).rgb),
    luminance(textureSampleLevel(emission_tex, lin, uv + vec2f(0.0, texel.y), 5.0).rgb),
    luminance(textureSampleLevel(emission_tex, lin, uv - vec2f(0.0, texel.y), 5.0).rgb));
  let grad = vec2f(lum.x - lum.y, lum.z - lum.w);
  let l = normalize(vec3f(grad / max(length(grad), 1e-4) * 0.75, 0.6));

  let wl = wall(p);
  let n = wall_normal(p);
  // Ambient from a street light above (y is down, so -n.y faces up).
  var col = wl.albedo * (spill * (0.35 + 0.65 * saturate(dot(n, l))) + u.ambient * (0.85 - 0.3 * n.y));

  // Tubes: mounting shadow on the wall, then the glass itself.
  let t = tubes(p);
  let shadow_t = tubes(p - vec2f(0.0, -u.tube * 2.5));
  let sh = min(min(shadow_t.d.x, shadow_t.d.y), shadow_t.d.z);
  col *= mix(0.55, 1.0, smoothstep(-u.tube, u.tube * 2.0, sh));

  var colors = array<vec3f, 3>(u.colorText, u.colorFrame, u.colorIcon);
  for (var i = 0; i < 3; i++) {
    let d = t.d[i];
    let cover = smoothstep(0.75, -0.75, d);
    if (cover <= 0.0) { continue; }
    let x = saturate(-d / u.tube); // 0 at the glass wall, 1 at the core
    let on = t.power[i] / max(u.power, 1e-4);
    // White-hot core, saturated rim.
    let lit = colors[i] * t.power[i] * (0.7 + 2.5 * x * x) + vec3f(1.0) * t.power[i] * 0.6 * pow(x, 6.0);
    // Glass: dim tint plus a sharp specular stripe, visible even when unlit.
    let glass = colors[i] * 0.03 + vec3f(0.25) * smoothstep(0.75, 0.95, x) * (1.0 - 0.6 * on);
    col = mix(col, lit + glass, cover);
  }
  return vec4f(col, 1.0);
}
`,x=32,H={script:'"Snell Roundhand", "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive',sans:'"Avenir Next", "Helvetica Neue", Arial, ui-sans-serif, sans-serif'},he=async M=>{const{device:e,surface:q,params:w,reducedMotion:D}=M,t=w.add({text:{value:"open late",type:"text",maxLength:x},font:{value:"script",options:{Script:"script",Sans:"sans"}},style:{value:0,options:{"Outline tube":0,"Solid letters":1}},colorText:{value:"#ff3d8b",type:"color",label:"Text colour"},colorFrame:{value:"#38d6ff",type:"color",label:"Frame colour"},colorIcon:{value:"#ffd23d",type:"color",label:"Moon colour"},tube:{value:3.2,min:1,max:10,step:.1,label:"Tube (px)"},power:{value:4,min:0,max:16,step:.1}},"Sign"),a=w.add({flicker:{value:D?0:.6,min:0,max:1,step:.01,hint:'Random dropouts and hum. One letter is "faulty" and misbehaves more.'},spill:{value:.22,min:0,max:1,step:.01,hint:"How much the tubes light the wall."},wall:{value:0,options:{Brick:0,Concrete:1}},bump:{value:6,min:0,max:20,step:.1},ambient:{value:.02,min:0,max:.3,step:.005}},"Street"),y=await Q.create(M,{bloom:.12,bloomRadius:1.3,vignette:.45,grain:.035}),z=new ie(e),F=()=>z.generate({text:t.text.trim()||" ",family:H[t.font]??H.script,weight:t.font==="script"?400:300,size:200});let n=await F();const m=new Z(e,"Neon",{textRect:"vec4f",frameRect:"vec4f",iconPos:"vec4f",colorText:"vec3f",textScale:"f32",colorFrame:"vec3f",tube:"f32",colorIcon:"vec3f",power:"f32",resolution:"vec2f",time:"f32",flicker:"f32",spill:"f32",bump:"f32",ambient:"f32",emissionScale:"f32",style:"u32",wallType:"u32",letterCount:"u32"}),_=e.createBuffer({size:x*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),U=new Float32Array(x*4),p=await oe(e,"neon-sign",se(te,ne,le,ee,m.wgslStruct,ae)),A=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}}]}),E=e.createPipelineLayout({bindGroupLayouts:[A]}),[V,j]=await Promise.all([e.createRenderPipelineAsync({label:"neon:emission",layout:E,vertex:{module:p,entryPoint:"vs_fullscreen"},fragment:{module:p,entryPoint:"fs_emission",targets:[{format:g}]}}),e.createRenderPipelineAsync({label:"neon:composite",layout:E,vertex:{module:p,entryPoint:"vs_fullscreen"},fragment:{module:p,entryPoint:"fs_composite",targets:[{format:g}]}})]),$=e.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"linear"}),N=e.createTexture({size:[1,1],format:g,usage:GPUTextureUsage.TEXTURE_BINDING});let r=null,T=null;const L=()=>{if(!r)return;const o=i=>e.createBindGroup({layout:A,entries:[{binding:0,resource:{buffer:m.buffer}},{binding:1,resource:n.texture.createView()},{binding:2,resource:$},{binding:3,resource:i},{binding:4,resource:{buffer:_}}]});T={emission:o(N.createView()),composite:o(r.createView())}};let B=`${t.text}|${t.font}`,S=0;return w.onChange(()=>{clearTimeout(S),S=window.setTimeout(async()=>{const o=`${t.text}|${t.font}`;if(o===B)return;B=o;const i=await F();n.destroy(),n=i,L()},200)}),{frame({time:o,size:i}){const{width:c,height:l}=i,P=Math.max(1,Math.ceil(c/2)),C=Math.max(1,Math.ceil(l/2));(r?.width!==P||r.height!==C)&&(r?.destroy(),r=e.createTexture({label:"neon-emission",size:[P,C],format:g,mipLevelCount:8,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),L());const O=n.width-2*n.padding,W=n.height-2*n.padding,s=Math.min(.62*c/Math.max(O,1),.3*l/Math.max(W,1)),u=c*.5,R=l*.5,d=[O*s/2+.07*l,W*s/2+.07*l],X=t.tube*Math.max(1,l/800),b=n.letters.slice(0,x),K=b.length>2?Math.floor(b.length*.6):-1;b.forEach((I,k)=>{const Y=u+(I.start-n.width/2)*s,J=u+(I.end-n.width/2)*s;U.set([Y,J,(.13+k*.618)%1,k===K?1:0],k*4)}),e.queue.writeBuffer(_,0,U),m.set("textRect",[u,R,n.width*s/2,n.height*s/2]).set("textScale",s).set("frameRect",[u,R,d[0],d[1]]).set("iconPos",[u+d[0]-.02*l,R-d[1]-.005*l,.05*l,0]).set("colorText",G(t.colorText)).set("colorFrame",G(t.colorFrame)).set("colorIcon",G(t.colorIcon)).set("tube",X).set("power",t.power).set("resolution",[c,l]).set("time",o).set("flicker",a.flicker).set("spill",a.spill).set("bump",a.bump).set("ambient",a.ambient).set("emissionScale",c/P).set("style",t.style).set("wallType",a.wall).set("letterCount",b.length).upload();const f=e.createCommandEncoder({label:"neon-sign"}),h=f.beginRenderPass({colorAttachments:[{view:r.createView({baseMipLevel:0,mipLevelCount:1}),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});h.setPipeline(V),h.setBindGroup(0,T.emission),h.draw(3),h.end(),re(e,r,f);const v=f.beginRenderPass({colorAttachments:[{view:y.scene(i).view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});v.setPipeline(j),v.setBindGroup(0,T.composite),v.draw(3),v.end(),y.render(f,q.currentTexture().createView(),{time:o}),e.queue.submit([f.finish()])},dispose(){clearTimeout(S),n.destroy(),z.destroy(),r?.destroy(),N.destroy(),_.destroy(),m.destroy(),y.destroy()}}};export{he as default};
