import{c as y,w as _}from"./surface-CPzQGKfE.js";const k=`// ---------------------------------------------------------------------------
// common.wgsl — constants, colour pipeline and noise shared by experiments.
// ---------------------------------------------------------------------------

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn saturate3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.0), vec3f(1.0)); }

// --- Colour ----------------------------------------------------------------
// Canvas formats (bgra8unorm / rgba8unorm) are not sRGB, so we encode by hand.

fn linear_to_srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn srgb_to_linear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + 0.055) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// Narkowicz 2015 ACES fit. Punchy, slightly saturated highlights.
fn tonemap_aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return saturate3((x * (a * x + b)) / (x * (c * x + d) + e));
}

// AgX-style approximation (Benjamin Wrensch's fit). Softer, desaturates gracefully
// towards white — tends to look more "photographic" for bright lights.
fn agx_contrast(x: vec3f) -> vec3f {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn tonemap_agx(c: vec3f) -> vec3f {
  let m_in = mat3x3f(
    vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let m_out = mat3x3f(
    vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
    vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  let min_ev = -12.47393; let max_ev = 4.026069;
  var v = m_in * max(c, vec3f(1e-10));
  v = clamp(log2(v), vec3f(min_ev), vec3f(max_ev));
  v = (v - min_ev) / (max_ev - min_ev);
  v = agx_contrast(v);
  v = m_out * v;
  // agx_contrast outputs display-encoded values; return linear so callers can encode uniformly.
  return srgb_to_linear(saturate3(v));
}

// mode: 0 = none (clamp), 1 = ACES, 2 = AgX
fn tonemap(c: vec3f, mode: u32) -> vec3f {
  switch mode {
    case 1u: { return tonemap_aces(c); }
    case 2u: { return tonemap_agx(c); }
    default: { return saturate3(c); }
  }
}

// --- Noise -----------------------------------------------------------------

// Jimenez 2014 interleaved gradient noise: cheap, well-distributed per-pixel jitter.
fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Final display encode: tonemapped linear -> sRGB, plus +-0.5 LSB triangular dither
// so smooth light falloffs don't band on 8-bit swapchains.
fn display_encode(linear_rgb: vec3f, frag: vec2f) -> vec3f {
  let srgb = linear_to_srgb(saturate3(linear_rgb));
  let n = hash12(frag) + hash12(frag + vec2f(17.13, 3.71)) - 1.0;
  return srgb + n / 255.0;
}
`,S=`// ---------------------------------------------------------------------------
// fullscreen.wgsl — a single oversized triangle covering the viewport.
// Draw with \`pass.draw(3)\`; no vertex buffers needed.
// ---------------------------------------------------------------------------

struct FullscreenOut {
  @builtin(position) position: vec4f,
  // uv in [0,1], origin top-left (matches texture coordinates).
  @location(0) uv: vec2f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) i: u32) -> FullscreenOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: FullscreenOut;
  out.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
`,T={f32:[4,4],u32:[4,4],i32:[4,4],vec2f:[8,8],vec2u:[8,8],vec3f:[16,12],vec4f:[16,16],vec4u:[16,16],mat3x3f:[16,48],mat4x4f:[16,64]};function d(u,e){let t=0,n=16;const s={},r=[];for(const[a,o]of Object.entries(e)){const[l,i]=T[o];n=Math.max(n,l),t=Math.ceil(t/l)*l,s[a]={type:o,offset:t/4,count:i/4,kind:o.endsWith("u")||o==="u32"?"u":o==="i32"?"i":"f"},r.push(`  ${a}: ${o},`),t+=i}return{fields:s,byteSize:Math.max(16,Math.ceil(t/n)*n),wgslStruct:`struct ${u} {
${r.join(`
`)}
};`}}function z(u,e){return d(u,e).wgslStruct}class M{constructor(e,t,n){this.device=e,this.name=t;const s=d(t,n);this.byteSize=s.byteSize,this.fields=s.fields,this.wgslStruct=s.wgslStruct,this.data=new ArrayBuffer(this.byteSize),this.f32=new Float32Array(this.data),this.u32=new Uint32Array(this.data),this.i32=new Int32Array(this.data),this.buffer=e.createBuffer({label:`uniforms:${t}`,size:this.byteSize,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}device;name;buffer;byteSize;wgslStruct;fields;data;f32;u32;i32;dirty=!0;set(e,t){const n=this.fields[e],s=n.kind==="u"?this.u32:n.kind==="i"?this.i32:this.f32;if(typeof t=="number")s[n.offset]=t;else if(n.type==="mat3x3f"&&t.length===9)for(let r=0;r<3;r++)for(let a=0;a<3;a++)s[n.offset+r*4+a]=t[r*3+a];else{const r=Math.min(n.count,t.length);for(let a=0;a<r;a++)s[n.offset+a]=t[a]}return this.dirty=!0,this}upload(){this.dirty&&(this.device.queue.writeBuffer(this.buffer,0,this.data),this.dirty=!1)}destroy(){this.buffer.destroy()}}class A{constructor(e){this.device=e}device;targets=new Map;get(e,t){const n=t.scale??1,s=Math.max(1,Math.round(t.size[0]*n)),r=Math.max(1,Math.round(t.size[1]*n)),a=t.sampleCount??1,o=t.usage??(a>1?GPUTextureUsage.RENDER_ATTACHMENT:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING),l=`${s}x${r}:${t.format}:${a}:${o}`,i=this.targets.get(e);if(i?.key===l)return i.target;i?.target.texture.destroy();const c=this.device.createTexture({label:`target:${e}`,size:[s,r],format:t.format,sampleCount:a,usage:o}),f={texture:c,view:c.createView({label:`target:${e}`}),width:s,height:r};return this.targets.set(e,{key:l,target:f}),f}release(e){this.targets.get(e)?.target.texture.destroy(),this.targets.delete(e)}destroy(){for(const{target:e}of this.targets.values())e.texture.destroy();this.targets.clear()}}const P=`// ---------------------------------------------------------------------------
// post.wgsl — bloom chain + final composite.
// Requires (prepended): common.wgsl, fullscreen.wgsl, the \`Post\` struct.
//
// Scene input is premultiplied linear HDR (rgba16float); alpha is coverage,
// letting experiments composite over a display-space background colour.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var bloom_tex: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
@group(0) @binding(3) var<uniform> post: Post;

fn tap(uv: vec2f, offset: vec2f, texel: vec2f) -> vec3f {
  return textureSampleLevel(src_tex, lin, uv + offset * texel, 0.0).rgb;
}

// --- Downsample: 13-tap "Call of Duty: Advanced Warfare" filter (Jimenez 2014) ---

struct Taps13 { a: vec3f, b: vec3f, c: vec3f, d: vec3f, e: vec3f, f: vec3f, g: vec3f, h: vec3f, i: vec3f, j: vec3f, k: vec3f, l: vec3f, m: vec3f };

fn taps13(uv: vec2f) -> Taps13 {
  let t = 1.0 / vec2f(textureDimensions(src_tex));
  return Taps13(
    tap(uv, vec2f(-2.0, 2.0), t), tap(uv, vec2f(0.0, 2.0), t), tap(uv, vec2f(2.0, 2.0), t),
    tap(uv, vec2f(-2.0, 0.0), t), tap(uv, vec2f(0.0, 0.0), t), tap(uv, vec2f(2.0, 0.0), t),
    tap(uv, vec2f(-2.0, -2.0), t), tap(uv, vec2f(0.0, -2.0), t), tap(uv, vec2f(2.0, -2.0), t),
    tap(uv, vec2f(-1.0, 1.0), t), tap(uv, vec2f(1.0, 1.0), t), tap(uv, vec2f(-1.0, -1.0), t), tap(uv, vec2f(1.0, -1.0), t));
}

@fragment
fn fs_down(v: FullscreenOut) -> @location(0) vec4f {
  let s = taps13(v.uv);
  let c = s.e * 0.125 + (s.a + s.c + s.g + s.i) * 0.03125 + (s.b + s.d + s.f + s.h) * 0.0625 + (s.j + s.k + s.l + s.m) * 0.125;
  return vec4f(c, 1.0);
}

fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + luminance(c)); }

// First downsample only: weight each 2x2 group by 1/(1+luma) (Karis average)
// so single very bright pixels can't produce flickering "firefly" blooms.
@fragment
fn fs_down_karis(v: FullscreenOut) -> @location(0) vec4f {
  let s = taps13(v.uv);
  let g0 = (s.j + s.k + s.l + s.m) * 0.25;
  let g1 = (s.a + s.b + s.d + s.e) * 0.25;
  let g2 = (s.b + s.c + s.e + s.f) * 0.25;
  let g3 = (s.d + s.e + s.g + s.h) * 0.25;
  let g4 = (s.e + s.f + s.h + s.i) * 0.25;
  let w0 = 0.5 * karis(g0);
  let w1 = 0.125 * karis(g1);
  let w2 = 0.125 * karis(g2);
  let w3 = 0.125 * karis(g3);
  let w4 = 0.125 * karis(g4);
  let c = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  return vec4f(max(c, vec3f(0.0)), 1.0);
}

// --- Upsample: 3x3 tent, additively blended into the next larger level -------

@fragment
fn fs_up(v: FullscreenOut) -> @location(0) vec4f {
  let t = post.bloomRadius / vec2f(textureDimensions(src_tex));
  let uv = v.uv;
  var c = tap(uv, vec2f(0.0, 0.0), t) * 4.0;
  c += (tap(uv, vec2f(0.0, 1.0), t) + tap(uv, vec2f(-1.0, 0.0), t) + tap(uv, vec2f(1.0, 0.0), t) + tap(uv, vec2f(0.0, -1.0), t)) * 2.0;
  c += tap(uv, vec2f(-1.0, 1.0), t) + tap(uv, vec2f(1.0, 1.0), t) + tap(uv, vec2f(-1.0, -1.0), t) + tap(uv, vec2f(1.0, -1.0), t);
  return vec4f(c / 16.0, 1.0);
}

// --- Composite ---------------------------------------------------------------

@fragment
fn fs_composite(v: FullscreenOut) -> @location(0) vec4f {
  let frag = v.position.xy;
  let hdr = textureLoad(src_tex, vec2i(frag), 0);
  let a = saturate(hdr.a);
  var c = select(vec3f(0.0), hdr.rgb / max(hdr.a, 1e-5), hdr.a > 1e-5);

  if (post.raw == 0u) {
    if (post.bloomStrength > 0.0) {
      // Each level was summed once on the way up; normalise by the level count.
      let bloom = textureSampleLevel(bloom_tex, lin, v.uv, 0.0).rgb / post.bloomLevels;
      c = mix(c, bloom, post.bloomStrength);
    }
    c = tonemap(c * post.exposure, post.tonemap);
    // Vignette in display-linear space: a gentle, round falloff.
    let q = (v.uv - 0.5) * vec2f(post.aspect, 1.0);
    c *= mix(1.0, smoothstep(1.2, 0.2, length(q)), post.vignette);
    // Film grain scaled by luminance so blacks stay clean.
    let g = hash12(frag + fract(post.time) * 1000.0) - 0.5;
    c += g * post.grain * sqrt(luminance(c) + 1e-4);
  }

  let out = mix(post.background, c, a);
  // Flat background stays undithered so its colour is exact (e.g. #FF0000).
  let encoded = mix(linear_to_srgb(saturate3(out)), display_encode(out, frag), a);
  return vec4f(encoded, 1.0);
}
`,v="rgba16float",R=6,F=8,p={None:0,ACES:1,AgX:2};class h{constructor(e,t,n,s){this.device=e,this.settings=t,this.pipelines=s,this.targets=new A(e),this.uniforms=n,this.sampler=e.createSampler({label:"post-linear",magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.black=e.createTexture({label:"post-black",size:[1,1],format:v,usage:GPUTextureUsage.TEXTURE_BINDING})}device;settings;pipelines;targets;uniforms;sampler;black;bindGroups=new WeakMap;sceneTarget=null;static async create(e,t={}){const{device:n,format:s}=e,r=E(e,t),a=new M(n,"Post",U),o=await y(n,"post",_(k,S,a.wgslStruct,P)),l=(m,b,w)=>n.createRenderPipelineAsync({label:`post:${m}`,layout:"auto",vertex:{module:o,entryPoint:"vs_fullscreen"},fragment:{module:o,entryPoint:m,targets:[{format:b,blend:w}]}}),i={color:{operation:"add",srcFactor:"one",dstFactor:"one"},alpha:{operation:"add",srcFactor:"one",dstFactor:"one"}},[c,f,g,x]=await Promise.all([l("fs_down",v),l("fs_down_karis",v),l("fs_up",v,i),l("fs_composite",s)]);return new h(n,r,a,{down:c,downKaris:f,up:g,composite:x})}scene(e){return this.sceneTarget=this.targets.get("scene",{size:[e.width,e.height],format:v}),this.sceneTarget}render(e,t,n){const s=this.sceneTarget;if(!s)throw new Error("PostProcess.render() called before scene()");const r=this.settings,a=n.raw??!1,o=n.source??s.texture,l=!a&&r.bloom>0,i=[];if(l)for(let c=0;c<R;c++){const f=1/2**(c+1);if(Math.min(s.width,s.height)*f<F)break;i.push(this.targets.get(`bloom${c}`,{size:[s.width,s.height],scale:f,format:v}))}if(this.uniforms.set("exposure",r.exposure).set("tonemap",r.tonemap).set("bloomStrength",i.length>0?r.bloom:0).set("bloomRadius",r.bloomRadius).set("bloomLevels",Math.max(1,i.length)).set("vignette",r.vignette).set("grain",r.grain).set("time",n.time).set("aspect",s.width/s.height).set("raw",a?1:0).set("background",n.background??[0,0,0]).upload(),i.length>0){i.forEach((c,f)=>{const g=f===0?o:i[f-1].texture;this.fullscreen(e,f===0?this.pipelines.downKaris:this.pipelines.down,g,c.view,"clear")});for(let c=i.length-1;c>0;c--)this.fullscreen(e,this.pipelines.up,i[c].texture,i[c-1].view,"load")}this.fullscreen(e,this.pipelines.composite,o,t,"clear",i[0]?.texture??this.black)}fullscreen(e,t,n,s,r,a){const o=e.beginRenderPass({label:t.label,colorAttachments:[{view:s,loadOp:r,storeOp:"store",clearValue:[0,0,0,0]}]});o.setPipeline(t),o.setBindGroup(0,this.bindGroup(t,n,a)),o.draw(3),o.end()}bindGroup(e,t,n){let s=this.bindGroups.get(e);s||this.bindGroups.set(e,s=new WeakMap);const r=s.get(t);if(r&&r.bloom===n)return r.group;const a=[{binding:0,resource:t.createView()},{binding:2,resource:this.sampler}];e!==this.pipelines.down&&e!==this.pipelines.downKaris&&a.push({binding:3,resource:{buffer:this.uniforms.buffer}}),n&&a.push({binding:1,resource:n.createView()});const o=this.device.createBindGroup({label:e.label,layout:e.getBindGroupLayout(0),entries:a});return s.set(t,{bloom:n,group:o}),o}destroy(){this.targets.destroy(),this.uniforms.destroy(),this.black.destroy()}}const U={exposure:"f32",tonemap:"u32",bloomStrength:"f32",bloomRadius:"f32",bloomLevels:"f32",vignette:"f32",grain:"f32",time:"f32",aspect:"f32",raw:"u32",background:"vec3f"};function E(u,e){return u.params?u.params.add({exposure:{value:e.exposure??1,min:.05,max:4,step:.01},tonemap:{value:e.tonemap??p.AgX,options:p},bloom:{value:e.bloom??.04,min:0,max:.4,step:.005,hint:"Energy-conserving mix of a 6-level blur pyramid. No threshold, so only genuinely bright pixels glow noticeably."},bloomRadius:{value:e.bloomRadius??1,min:.25,max:3,step:.05,label:"Bloom radius"},vignette:{value:e.vignette??.25,min:0,max:1,step:.01},grain:{value:e.grain??.03,min:0,max:.2,step:.005}},"Post"):{exposure:e.exposure??1,tonemap:e.tonemap??p.AgX,bloom:e.bloom??.04,bloomRadius:e.bloomRadius??1,vignette:e.vignette??.25,grain:e.grain??.03}}export{v as H,h as P,A as T,M as U,p as a,k as c,S as f,z as u};
