import{t as e}from"./meta-DMhH2kCL.js";import{n as t}from"./types-ci2WwWg0.js";import{t as n}from"./loop-_CGOOht2.js";import{n as r}from"./profiler-Bi27xYp-.js";import{n as i}from"./targets-Dcl181Ey.js";import{r as a}from"./camera-BT6VSIZb.js";import{n as o,r as s,t as c}from"./uniforms-BE1XSnDx.js";import{t as l}from"./shader-Cd_FDUy8.js";import{n as u,t as d}from"./billboards-BT_4dCEv.js";import{i as f}from"./particles-CwphI2WA.js";import{n as p,t as m}from"./system-Do33CVeV.js";import{n as h}from"./pointer-BbHa9JHH.js";import{r as g,t as _}from"./fullscreen-Dq3Mq0Js.js";import{n as v,r as y}from"./common-DyRXdhCv.js";import{t as b}from"./blur-DZ-nFY6j.js";import{t as x}from"./backdrop-BAS7aIFT.js";import{t as S}from"./overlay-4Q2OcyCg.js";var C=`// liquid-2d composite: threshold the particle field into a water body and shade it. Three entry points:
//
//   fs           the finished liquid (view 'final')
//   fs_field     the raw field as a grey ramp with the threshold iso-line marked (view 'field')
//   fs_backdrop  only the backdrop, or transparent without one (the first half of view 'discs')
//
// Everything is in target pixels. uv has its origin top-left, like the field texture (row 0 = top), so the
// field, the backdrop and the target all share one uv. Normals and slopes are in the SCREEN frame of
// refraction.wgsl (x right, y DOWN, z toward the viewer); lighting converts to y up.
//
// Coverage. F = field.r is a kernel-smoothed density; the half-density iso-line F = threshold is where a
// free surface sits. The edge is antialiased in SCREEN space: with g = |grad F| per pixel (central
// differences of the bilinear field) the first-order signed distance to the iso-line is (F - T) / g pixels,
// and coverage is a smoothstep of that distance over \`edge_softness\` pixels. So the edge is as sharp as a
// pixel allows wherever the field is steep and equally soft where it is shallow. No dpdx, so it is legal in
// non-uniform control flow.
//
// Thickness. The distance to the edge saturates quickly in a kernel-smoothed field, so the thickness proxy
// comes from a WIDE map: the field box-reduced to a quarter size and blurred with sigma ~24 px at the 560 px
// reference height (wide.wgsl plus a Blur). Its value W is the fraction of liquid within a few sigma: at
// depth d inside a straight edge it is Phi(d / sigma), 1/2 on the edge, so 2 W - 1 clamped to [0, 1] is 0 at
// the edge and saturates at about 2 sigma deep, and it is 0 for droplets and thin necks. A short ramp of the
// fine field itself (smoothstep(T, 1, F)) adds the first few pixels. The gradient of W, times sigma, is the
// slope of a broad dome that the fine field gradient lacks. Both are smooth: no tap pattern, no banding.

#include "fullscreen.wgsl"
#include "math.wgsl"
#include "color.wgsl"
#include "absorption.wgsl"
#include "refraction.wgsl"
#include "fresnel.wgsl"
#include "specular.wgsl"
#include "foam.wgsl"
#include "liquid2d_params.wgsl"

@group(0) @binding(0) var<uniform> P: Liquid2dParams;
@group(0) @binding(1) var field_tex: texture_2d<f32>;
@group(0) @binding(2) var backdrop_tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var wide_tex: texture_2d<f32>;

// Look constants (the params expose the ones worth tuning).
const K_FINE: f32 = 1.6;          // field gradient (per reference pixel) to normal slope
const K_BROAD: f32 = 2.5;         // wide-map gradient (times sigma) to normal slope
const LIGHT_ELEVATION: f32 = 0.8; // radians above the screen plane
const SPEC_ROUGHNESS: f32 = 0.3;
const SPEC_SUN_RADIUS: f32 = 0.1;
const NO_BACKDROP_BED: vec3f = vec3f(0.72, 0.86, 0.95);
const SKY: vec3f = vec3f(0.62, 0.78, 0.98);
const FOAM_COLOR: vec3f = vec3f(0.92, 0.96, 1.0);

fn encode(rgb: vec3f) -> vec3f {
  return select(rgb, linear_to_srgb(rgb), P.encode_srgb != 0u);
}

fn field(uv: vec2f) -> vec4f {
  return textureSampleLevel(field_tex, samp, uv, 0.0);
}

fn backdrop_at(uv: vec2f) -> vec3f {
  return select(vec3f(0.0), textureSampleLevel(backdrop_tex, samp, uv, 0.0).rgb, P.has_backdrop != 0u);
}

struct Shaded {
  // Antialiased coverage of the liquid body, 0 outside.
  cov: f32,
  // Liquid colour (linear) to blend over a backdrop with \`cov\`.
  over: vec3f,
  // Straight (unpremultiplied) colour and opacity before coverage, for the see-through case.
  straight: vec3f,
  opacity: f32,
}

fn shade(uv: vec2f) -> Shaded {
  var s: Shaded;
  s.cov = 0.0;
  s.over = vec3f(0.0);
  s.straight = vec3f(0.0);
  s.opacity = 0.0;

  let f0 = field(uv);
  let big_f = f0.r;
  if (big_f < P.threshold * 0.1) { return s; } // far outside: nothing here can be covered

  let px = 1.0 / P.out_size;
  let gx = field(uv + vec2f(px.x, 0.0)).r - field(uv - vec2f(px.x, 0.0)).r;
  let gy = field(uv + vec2f(0.0, px.y)).r - field(uv - vec2f(0.0, px.y)).r;
  let grad = 0.5 * vec2f(gx, gy); // per target pixel, y down, points into the liquid
  let g = max(length(grad), 1e-4);
  let dist = (big_f - P.threshold) / g; // signed distance to the iso-line in pixels, positive inside
  let t = clamp(dist / max(P.edge_softness, 0.2) + 0.5, 0.0, 1.0);
  let cov = t * t * (3.0 - 2.0 * t);
  if (cov <= 0.0) { return s; }

  // Thickness and the broad dome, from the wide map.
  let wide_px = 1.0 / P.wide_size;
  let w0 = textureSampleLevel(wide_tex, samp, uv, 0.0).r;
  let wgx = textureSampleLevel(wide_tex, samp, uv + vec2f(wide_px.x, 0.0), 0.0).r -
    textureSampleLevel(wide_tex, samp, uv - vec2f(wide_px.x, 0.0), 0.0).r;
  let wgy = textureSampleLevel(wide_tex, samp, uv + vec2f(0.0, wide_px.y), 0.0).r -
    textureSampleLevel(wide_tex, samp, uv - vec2f(0.0, wide_px.y), 0.0).r;
  // Per target pixel, times sigma in pixels: dimensionless, 0.4 at a straight edge, y down.
  let broad = vec2f(wgx, wgy) / (2.0 * wide_px * P.out_size) * P.wide_sigma;
  let thick = clamp(0.3 * smoothstep(P.threshold, 1.0, big_f) + 0.7 * clamp(2.0 * w0 - 1.0, 0.0, 1.0), 0.0, 1.0);

  // Normal: the surface height rises into the liquid, so the normal leans out of it.
  let slope = -(grad * (P.res * K_FINE) + broad * K_BROAD);
  let n = normalize(vec3f(slope, 1.0));
  let n_up = vec3f(n.x, -n.y, n.z);

  // Light.
  let la = radians(P.light_angle);
  let l = vec3f(cos(la) * cos(LIGHT_ELEVATION), sin(la) * cos(LIGHT_ELEVATION), sin(LIGHT_ELEVATION));
  let nl = max(dot(n_up, l), 0.0);

  // Refracted bed.
  var bed = NO_BACKDROP_BED;
  if (P.has_backdrop != 0u) {
    let aspect = P.out_size.x / P.out_size.y;
    let offset = refraction_offset_cheap(n, P.ior, P.refraction * (0.2 + 0.8 * thick));
    bed = refraction_sample(backdrop_tex, samp, uv, refraction_to_uv(offset, aspect), 0.0, 0.05);
  }

  // Body colour by thickness.
  let water = absorb_water(P.water_type);
  let path = P.depth_scale * thick;
  var body = absorb_composite(bed, water.sigma, water.turbidity, water.scatter, path);
  body = body * (0.82 + 0.3 * nl);

  // Foam: the mean foam weight around here, broken up by a cheap cellular pattern.
  var foam_amt = 0.0;
  if (P.foam > 0.0) {
    let ratio = clamp(f0.g / max(f0.r, 0.05), 0.0, 1.0);
    if (ratio > 0.02) {
      // Soft bubbles and a low-frequency patchiness, not the cell walls of foam_texture_lite (which read as cracks).
      let fp = uv * P.out_size / (5.0 * P.res);
      let bubbles = 1.0 - smoothstep(0.15, 0.7, voronoi_2d_anim(fp, 1.0, 0.0).f1);
      let patches = 0.5 + 0.5 * gnoise_2d(fp * 0.45 + vec2f(3.1, 7.7));
      let cells = clamp(0.55 * bubbles + 0.6 * patches, 0.0, 1.0);
      foam_amt = P.foam * smoothstep(0.25, 0.8, ratio * (0.45 + 0.9 * cells));
    }
  }

  // Light added on top: specular glint, fresnel reflection of the sky, a thin meniscus line.
  let spec = spec_sun(n_up, vec3f(0.0, 0.0, 1.0), l, SPEC_ROUGHNESS, SPEC_SUN_RADIUS) * P.highlight;
  let reflection = SKY * (fresnel_water(n.z) * P.rim * 2.5);
  let facing = 0.6 + 0.4 * clamp(dot(n_up.xy, l.xy) / max(length(n_up.xy), 1e-3), -1.0, 1.0);
  let line_d = (dist - 1.2) / 0.7;
  let line = exp(-0.5 * line_d * line_d) * facing * P.rim * 0.45;
  var extra = vec3f(spec) + reflection + vec3f(line);

  let lit_foam = FOAM_COLOR * (0.75 + 0.25 * nl);
  body = mix(body, lit_foam, foam_amt * 0.9);
  extra = extra * (1.0 - foam_amt * 0.6);

  s.cov = cov;
  s.over = body + extra;

  // See-through case: opacity higher in the deep body, lower at thin edges and droplets.
  let body_opacity = clamp(
    P.opacity * mix(P.thin_opacity, 1.0, smoothstep(0.0, 0.35, thick)) * (1.0 - foam_amt) + foam_amt,
    0.0, 1.0);
  let premul = body * body_opacity + extra;
  s.opacity = clamp(body_opacity + max(extra.x, max(extra.y, extra.z)) * (1.0 - body_opacity), 0.0, 1.0);
  s.straight = clamp(premul / max(s.opacity, 1e-4), vec3f(0.0), vec3f(1.0));
  return s;
}

@fragment
fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let s = shade(in.uv);
  if (P.has_backdrop != 0u) {
    let bd = backdrop_at(in.uv);
    return vec4f(encode(clamp(mix(bd, s.over, s.cov), vec3f(0.0), vec3f(1.0))), 1.0);
  }
  let a = clamp(s.cov * s.opacity, 0.0, 1.0);
  return vec4f(encode(s.straight) * a, a);
}

@fragment
fn fs_backdrop(in: FullscreenVarying) -> @location(0) vec4f {
  if (P.has_backdrop != 0u) {
    return vec4f(encode(clamp(backdrop_at(in.uv), vec3f(0.0), vec3f(1.0))), 1.0);
  }
  return vec4f(0.0);
}

@fragment
fn fs_field(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  let f = field(uv);
  let px = 1.0 / P.out_size;
  let gx = field(uv + vec2f(px.x, 0.0)).r - field(uv - vec2f(px.x, 0.0)).r;
  let gy = field(uv + vec2f(0.0, px.y)).r - field(uv - vec2f(0.0, px.y)).r;
  let g = max(0.5 * length(vec2f(gx, gy)), 1e-4);
  let dist = (f.r - P.threshold) / g;
  let foam_ratio = clamp(f.g / max(f.r, 0.05), 0.0, 1.0) * step(0.05, f.r);
  var c = vec3f(clamp(f.r, 0.0, 1.0));
  c = mix(c, vec3f(0.2, 0.3, 1.0), 0.5 * foam_ratio);
  let iso = 1.0 - smoothstep(0.3, 1.0, abs(dist));
  c = mix(c, vec3f(1.0, 0.2, 0.08), iso * 0.9);
  // Over-dense regions (more than 30% above rest density) get a green tint.
  c = mix(c, vec3f(0.2, 0.9, 0.3), 0.4 * clamp((f.r - 1.3) * 2.0, 0.0, 1.0));
  return vec4f(c, 1.0);
}
`,w=`// liquid-2d splat pass: one soft blob per live particle, added into the field texture.
//
// The kernel is w(q) = k (1 - q^2)^3 for q = distance / R < 1, with R = blobRadius * particle radius. It
// is smooth (C2 at the rim, so the iso-line has no corners), compact (the quad is exactly R plus one field
// texel) and cheap (two multiplies and a cube). \`kernel_k\` normalises it so that the field is 1 inside bulk
// liquid at rest density: see liquid-2d/index.ts for the derivation.
//
// Channels written: r = sum of w (density / thickness), g = sum of w * foam_i, with foam_i the per-particle
// scalar (positions.w) mapped through smoothstep(foam_low, foam_high, .). b and a stay free.
//
// The particle position arrives as an instance-step vertex buffer (stride 16), so a solver that ping-pongs
// or reorders its buffers needs no bind group here. A non-finite position parks the quad outside the clip
// volume, so one bad particle cannot put a NaN into the additive field.

#include "liquid2d_params.wgsl"

@group(0) @binding(0) var<uniform> P: Liquid2dParams;

struct SplatVarying {
  @builtin(position) position: vec4f,
  // Offset from the particle centre in units of the blob radius R.
  @location(0) q: vec2f,
  @location(1) @interpolate(flat) foam: f32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @location(0) particle: vec4f) -> SplatVarying {
  var out: SplatVarying;
  // Parked: outside the clip volume, so the rasteriser drops it.
  out.position = vec4f(2.0, 2.0, 2.0, 1.0);
  out.q = vec2f(0.0);
  out.foam = 0.0;

  let centre = (particle.xy - P.dom_center) / P.dom_half; // normalised device coordinates, y up
  // NaN and infinity fail this comparison; so does a particle absurdly far away.
  if (!(abs(centre.x) < 1e4 && abs(centre.y) < 1e4)) {
    return out;
  }
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u)) * 2.0 - 1.0;
  let texel = 2.0 * P.dom_half / P.field_size; // world size of one field texel
  let reach = P.blob_radius + max(texel.x, texel.y); // one texel beyond the rim
  let offset = corner * reach;
  out.position = vec4f(centre + offset / P.dom_half, 0.0, 1.0);
  out.q = offset / P.blob_radius;
  let foam = smoothstep(P.foam_low, P.foam_high, particle.w);
  out.foam = select(0.0, foam, foam >= 0.0 && foam <= 1.0); // a NaN scalar counts as no foam
  return out;
}

@fragment
fn fs(in: SplatVarying) -> @location(0) vec4f {
  let q2 = dot(in.q, in.q);
  if (q2 >= 1.0) { discard; }
  let a = 1.0 - q2;
  let w = P.kernel_k * a * a * a;
  return vec4f(w, w * in.foam, 0.0, 0.0);
}
`,T=`// liquid-2d wide pass: the field reduced to roughly a quarter of its size with a box filter, ready to be
// blurred into the thickness map. Four bilinear taps at the corners of each output texel's footprint cover
// it exactly (each tap averages a 2x2 block), so sparse particles cannot be skipped the way a single
// bilinear tap of a 4x reduction would skip them.

#include "fullscreen.wgsl"
#include "liquid2d_params.wgsl"

@group(0) @binding(0) var<uniform> P: Liquid2dParams;
@group(0) @binding(1) var field_tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

@fragment
fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let e = 0.25 / P.wide_size; // a quarter of an output texel, in uv
  var sum = textureSampleLevel(field_tex, samp, in.uv + vec2f(-e.x, -e.y), 0.0);
  sum += textureSampleLevel(field_tex, samp, in.uv + vec2f(e.x, -e.y), 0.0);
  sum += textureSampleLevel(field_tex, samp, in.uv + vec2f(-e.x, e.y), 0.0);
  sum += textureSampleLevel(field_tex, samp, in.uv + vec2f(e.x, e.y), 0.0);
  return sum * 0.25;
}
`,E={view:`final`,blobRadius:2.6,threshold:.5,edgeSoftness:1,smoothing:1.5,waterType:0,depthScale:8,ior:1.333,refraction:.12,rim:1,highlight:40,lightAngle:125,foam:.6,foamLow:.3,foamHigh:1,opacity:.9,thinOpacity:.6,discPalette:[[.02,.12,.32],[.05,.45,.75],[.55,.9,1],[1,1,1]],discRange:[0,1]},D=`rgba16float`,O=o(`Liquid2dParams`,{dom_center:`vec2f`,dom_half:`vec2f`,out_size:`vec2f`,field_size:`vec2f`,wide_size:`vec2f`,blob_radius:`f32`,kernel_k:`f32`,foam_low:`f32`,foam_high:`f32`,threshold:`f32`,edge_softness:`f32`,depth_scale:`f32`,ior:`f32`,refraction:`f32`,rim:`f32`,highlight:`f32`,light_angle:`f32`,foam:`f32`,opacity:`f32`,thin_opacity:`f32`,res:`f32`,wide_sigma:`f32`,water_type:`i32`,has_backdrop:`u32`,encode_srgb:`u32`});function k(e,t){return 4*e/(Math.PI*t*t)}var A={color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}},j={color:{srcFactor:`one`,dstFactor:`one`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one`,operation:`add`}},M=y(e=>{let t={"liquid2d_params.wgsl":O.wgsl},n=l(e,{label:`liquid-2d/splat.wgsl`,code:w,chunks:t});return{layout:e.createBindGroupLayout({label:`liquid-2d composite layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}}]}),splat:e.createRenderPipeline({label:`liquid-2d splat`,layout:`auto`,vertex:{module:n,entryPoint:`vs`,buffers:[{arrayStride:16,stepMode:`instance`,attributes:[{shaderLocation:0,offset:0,format:`float32x4`}]}]},fragment:{module:n,entryPoint:`fs`,targets:[{format:D,blend:j}]},primitive:{topology:`triangle-strip`,cullMode:`none`}}),wide:_(e,{label:`liquid-2d wide`,fragment:{label:`liquid-2d/wide.wgsl`,code:T,chunks:t},format:D}),composite:new Map}});function N(e,t,n){let r=t.composite.get(n);if(!r){let i=r=>_(e,{label:`liquid-2d ${r} ${n}`,fragment:{label:`liquid-2d/composite.wgsl`,code:C,chunks:{"liquid2d_params.wgsl":O.wgsl}},entryPoint:r,format:n,blend:A,layout:[t.layout]});r={final:i(`fs`),field:i(`fs_field`),backdrop:i(`fs_backdrop`)},t.composite.set(n,r)}return r}var P=Object.keys(E),F=24,I=4,L=560;function R(e){let{device:t,format:n,fieldScale:o=1,label:s=`liquid-2d`}=e;if(!(o>0))throw RangeError(`${s}: fieldScale must be positive`);let l=M(t),u=N(t,l,n),p=t.limits.maxTextureDimension2D,m=e=>Math.min(p,Math.max(1,Math.round(e))),h=m(e.width),_=m(e.height),y=!1,x=()=>[m(h*o),m(_*o)],[S,C]=x(),w=i(t,{label:`${s} field`,format:D,width:S,height:C,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}),T=()=>[Math.max(1,Math.ceil(w.width/I)),Math.max(1,Math.ceil(w.height/I))],A=i(t,{label:`${s} wide`,format:D,width:T()[0],height:T()[1]}),j=b(t,{label:`${s} wide blur`,format:D,width:A.width,height:A.height}),R,ee=()=>R??=b(t,{label:`${s} blur`,format:D,width:w.width,height:w.height}),z=c(t,O,`${s} params`),te=+!n.endsWith(`-srgb`),B=v(t),V=t.createTexture({label:`${s} no backdrop`,size:[1,1],format:D,usage:GPUTextureUsage.TEXTURE_BINDING}),H=V.createView(),U=new WeakMap,ne=(e,n,r)=>{let i=U.get(e);i||(i=new WeakMap,U.set(e,i));let a=i.get(r);return a||(a=t.createBindGroup({label:`${s} composite`,layout:l.layout,entries:[{binding:0,resource:{buffer:z.buffer}},{binding:1,resource:e},{binding:2,resource:r},{binding:3,resource:B},{binding:4,resource:n}]}),i.set(r,a)),a},re=new WeakMap,ie=e=>{let n=re.get(e);return n||(n=t.createBindGroup({label:`${s} wide`,layout:l.wide.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:z.buffer}},{binding:1,resource:e},{binding:3,resource:B}]}),re.set(e,n)),n},ae=t.createBindGroup({label:`${s} splat`,layout:l.splat.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:z.buffer}}]}),W,oe=a(),se=r,G={pass:e=>se.pass(e)},K={positions:void 0,count:0,capacity:0,radius:0,generation:0},ce={...E},le=ce,ue=E;function q(e){let t=e;for(let e of P){let n=t?.[e];le[e]=n===void 0?ue[e]:n}return ce}return{get field(){return{texture:w.texture,width:w.width,height:w.height,format:D}},resize(e,t){if(y)return;h=m(e),_=m(t);let[n,r]=x();if(w.resize(n,r)){R?.resize(n,r);let[e,t]=T();A.resize(e,t),j.resize(e,t)}W?.resize(h,_)},render(i,a){if(y)throw Error(`${s}: render after destroy`);let c=q(a.params),p=a.profiler??e.profiler??r;se=p;let{particles:m,domain:v}=a,b=h/_,x=Math.min(Math.max(0,Math.floor(m.count)),m.capacity,m.positions.size>>4),S=m.radius,C=Math.max(c.blobRadius*S,1e-9),T=m.restVolume??(2*S)**2,E=a.backdrop!==void 0;z.set({dom_center:v.center,dom_half:[v.halfHeight*b,v.halfHeight],out_size:[h,_],field_size:[w.width,w.height],wide_size:[A.width,A.height],blob_radius:C,kernel_k:k(T,C),foam_low:c.foamLow,foam_high:Math.max(c.foamHigh,c.foamLow+1e-6),threshold:c.threshold,edge_softness:c.edgeSoftness,depth_scale:c.depthScale,ior:c.ior,refraction:c.refraction,rim:c.rim,highlight:c.highlight,light_angle:c.lightAngle,foam:c.foam,opacity:c.opacity,thin_opacity:c.thinOpacity,res:_/L,wide_sigma:_/L*F,water_type:Math.round(c.waterType),has_backdrop:+!!E,encode_srgb:te}),z.upload();let D=a.backdrop??H,O=c.view;if(O!==`discs`){let e=i.beginRenderPass({label:`${s} splat`,colorAttachments:[{view:w.view,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}],timestampWrites:p.pass(`liquid splat`)});if(x>0&&S>0&&(e.setPipeline(l.splat),e.setBindGroup(0,ae),e.setVertexBuffer(0,m.positions),e.draw(4,x)),e.end(),c.smoothing>0){let e=Math.min(64,Math.max(1,Math.ceil(2.5*c.smoothing)));ee().encode(i,w.view,w.view,{radius:e,sigma:c.smoothing})}if(O===`final`){g(i,A.view,l.wide,[ie(w.view)],{label:`${s} wide`,timestampWrites:p.pass(`liquid wide`)});let e=_/L*F*o/I;j.encode(i,A.view,A.view,{radius:Math.min(64,Math.max(1,Math.ceil(2.5*e))),sigma:e})}}let M=O===`final`?u.final:O===`field`?u.field:u.backdrop;g(i,a.target,M,[ne(w.view,A.view,D)],{label:`${s} composite`,load:a.load,timestampWrites:p.pass(`liquid composite`)}),O===`discs`&&(W??=d({device:t,format:n,label:`${s} discs`,profiler:G,style:{mode:`alpha`,softness:0,minPixels:.75,intensity:1}}),W.style.palette=c.discPalette,W.style.scalarRange=c.discRange,f({center:v.center,halfHeight:v.halfHeight,aspect:b},oe),K.positions=m.positions,K.count=x,K.capacity=m.capacity,K.radius=m.radius,K.generation=m.generation,W.draw(i,K,oe,a.target,{width:h,height:_,clear:null,timestamp:`liquid discs`}))},destroy(){y||(y=!0,w.destroy(),R?.destroy(),A.destroy(),j.destroy(),W?.destroy(),z.destroy(),V.destroy())}}}var ee=`// sph-core.wgsl -- the parts of the SPH solver that the density pass and the force pass share: the walls (box sides
// and SDF obstacles), the tables that stand in for a continuum of fluid behind them, and the equation of state.
// Included by sph-density.wgsl and sph-force.wgsl AFTER they declare \`var<uniform> params: SphParams\`
// (src/gpu/sim/sph.ts generates the struct; see the header of sph.ts for what every field means).
//
// WALLS ARE A CONTINUUM, NOT A LAYER OF PARTICLES. A particle near a wall is missing the neighbours that would be
// behind it, so its summed density is too low and the pressure that should hold it off the wall vanishes: the usual
// SPH artefacts of particles crushed against the floor in a dense crust, or a gap. Instead of ghost or boundary
// particles, the wall is treated as fluid at rest density rho0 filling the half-plane behind it, and the two
// quantities the missing neighbours would have contributed are integrated analytically over that half-plane:
//   - density:  rho_i += rho0 * G(d / h),  G(q) = integral over the half-plane beyond distance d of W_poly6.
//               G(0) = 1/2 (half the kernel is behind a wall you touch), G(1) = 0.
//   - pressure: a_i += 2 rho0 p_i / rho_i^2 * F(d / h) / h * n,  F(q) / h = the integral along a line at distance d of
//               W_spiky (by the divergence theorem the half-plane integral of grad W is exactly that line integral
//               times the normal n, pointing from the wall into the fluid). The factor 2 is the pressure of the
//               mirrored fluid behind the wall taken equal to p_i.
// G and F are tabulated on the CPU (33 samples, linear interpolation) by numerical quadrature: tests/sph.test.ts
// checks them against an independent quadrature. d is the distance from the particle to the wall surface, from
// the box sides or from an obstacle's SDF; the SDF is used as if the wall were locally flat, which is accurate
// while the obstacle's radius of curvature is several kernel radii.

#include "sdf.wgsl"

// Obstacles are two vec4f each: (kind, cx, cy, 0) then (a, b, c, 0). kind 1 = circle of radius a; kind 2 = rounded
// box of half size (a, b) and corner radius c.
fn sph_obstacle_sd(k: u32, p: vec2f) -> f32 {
  let head = params.obstacles[2u * k];
  let tail = params.obstacles[2u * k + 1u];
  let q = p - head.yz;
  if (head.x < 1.5) {
    return sd_circle(q, tail.x);
  }
  return sd_rounded_box_2d(q, tail.xy, tail.z);
}

fn sph_obstacle_normal(k: u32, p: vec2f) -> vec2f {
  let e = 0.05 * params.h;
  let g = vec2f(
    sph_obstacle_sd(k, p + vec2f(e, 0.0)) - sph_obstacle_sd(k, p - vec2f(e, 0.0)),
    sph_obstacle_sd(k, p + vec2f(0.0, e)) - sph_obstacle_sd(k, p - vec2f(0.0, e)),
  );
  let l = length(g);
  return select(vec2f(0.0, 1.0), g / l, l > 1e-12);
}

fn sph_table_gamma(q: f32) -> f32 {
  let x = clamp(q, 0.0, 1.0) * 32.0;
  let k = min(u32(floor(x)), 31u);
  let f = x - f32(k);
  let k1 = k + 1u;
  return mix(params.wall_gamma[k >> 2u][k & 3u], params.wall_gamma[k1 >> 2u][k1 & 3u], f);
}

fn sph_table_force(q: f32) -> f32 {
  let x = clamp(q, 0.0, 1.0) * 32.0;
  let k = min(u32(floor(x)), 31u);
  let f = x - f32(k);
  let k1 = k + 1u;
  return mix(params.wall_force[k >> 2u][k & 3u], params.wall_force[k1 >> 2u][k1 & 3u], f);
}

// Density the walls add at p: rho0 * sum of G over every wall within h.
fn sph_wall_density(p: vec2f) -> f32 {
  let h = params.h;
  let inv_h = 1.0 / h;
  let sides = vec4f(
    p.x - params.box_min.x,
    params.box_max.x - p.x,
    p.y - params.box_min.y,
    params.box_max.y - p.y,
  );
  var g = 0.0;
  for (var w = 0u; w < 4u; w++) {
    if (sides[w] < h) {
      g += sph_table_gamma(max(sides[w], 0.0) * inv_h);
    }
  }
  for (var k = 0u; k < params.obstacle_count; k++) {
    let d = sph_obstacle_sd(k, p);
    if (d < h) {
      g += sph_table_gamma(max(d, 0.0) * inv_h);
    }
  }
  return g * params.rest_density;
}

// The wall term of the pressure force without its pre-factor 2 rho0 p_i / rho_i^2: sum of F(d / h) / h * n.
fn sph_wall_gradient(p: vec2f) -> vec2f {
  let h = params.h;
  let inv_h = 1.0 / h;
  let sides = vec4f(
    p.x - params.box_min.x,
    params.box_max.x - p.x,
    p.y - params.box_min.y,
    params.box_max.y - p.y,
  );
  var a = vec2f(0.0);
  if (sides.x < h) { a.x += sph_table_force(max(sides.x, 0.0) * inv_h); }
  if (sides.y < h) { a.x -= sph_table_force(max(sides.y, 0.0) * inv_h); }
  if (sides.z < h) { a.y += sph_table_force(max(sides.z, 0.0) * inv_h); }
  if (sides.w < h) { a.y -= sph_table_force(max(sides.w, 0.0) * inv_h); }
  for (var k = 0u; k < params.obstacle_count; k++) {
    let d = sph_obstacle_sd(k, p);
    if (d < h) {
      a += sph_obstacle_normal(k, p) * sph_table_force(max(d, 0.0) * inv_h);
    }
  }
  return a * inv_h;
}

// Equation of state (Tait): p = B ((rho / rho0)^gamma - 1), B = rho0 c^2 / gamma, so that the speed of sound at rest
// is c. Negative pressure is clamped to 0: below rest density the fluid has no tensile strength, which is what stops
// particles at a free surface from clumping into pairs. The density ratio is capped at \`pressure_cap\` so a block
// injected on top of water, or any overlap, pushes hard but not infinitely.
fn sph_pressure(rho: f32) -> f32 {
  let ratio = min(rho / params.rest_density, params.pressure_cap);
  if (ratio <= 1.0) {
    return 0.0;
  }
  return params.tait_b * (pow(ratio, params.gamma) - 1.0);
}
`,z=`// SPH pass 1: the density of every particle by kernel summation, and the pressure from the equation of state.
//     rho_i = m * (W(0) + sum over neighbours W_poly6(|x_i - x_j|)) + the wall term of sph-core.wgsl
// Output: state[i] = (rho_i, p_i). Reads only positions, so it can run right after the neighbour grid reorders them.

#include "sph_params.wgsl"
#include "sph-kernels.wgsl"
#include "neighbor_bindings.wgsl"

@group(0) @binding(0) var<uniform> params: SphParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> state: array<vec2f>;
// The grid's bindings (neighbor_bindings.wgsl) start at binding 3.

#include "sph-core.wgsl"

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let p = positions[i].xy;
  let h = params.h;
  let h2 = h * h;
  let c = neighbor_cell_of(neighbor_grid, vec3f(p, 0.0));
  var sum = sph_poly6_2d(0.0, h);
  for (var row = 0u; row < neighbor_grid.rows; row++) {
    let span = neighbor_row_span(c, row);
    for (var k = span.x; k < span.y; k++) {
      let j = neighbor_particle(k);
      let d = p - positions[j].xy;
      let r2 = dot(d, d);
      if (j != i && r2 < h2) {
        sum += sph_poly6_2d(r2, h);
      }
    }
  }
  let rho = max(params.mass * sum + sph_wall_density(p), 1e-6 * params.rest_density);
  state[i] = vec2f(rho, sph_pressure(rho));
}
`,te=`// SPH pass 2: forces, integration and boundaries, fused. Every particle reads the CURRENT positions, velocities and
// (rho, p) of its neighbours and writes its new position and velocity to separate output buffers (the host swaps
// them), so the result does not depend on the order in which particles are processed.
//
// Acceleration of particle i, summed over neighbours j within h (m is the particle mass, d = x_i - x_j, r = |d|):
//   pressure      a -= m (p_i / rho_i^2 + p_j / rho_j^2) grad_i W_spiky                  symmetric: conserves momentum
//   viscosity     a += nu m 2 / (rho_i + rho_j) (v_j - v_i) Laplacian W_visc(r)         laminar, equal and opposite
//   artificial    a -= m Pi_ij grad_i W_spiky, Pi_ij = alpha c h_s |v.d| / (rho_ij (r^2 + 0.01 h_s^2)) for approaching
//                 pairs only (Monaghan): damps the sound waves of the weakly compressible fluid, equal and opposite
//   cohesion      a -= kappa (m / rho0) / h^2 phi(r / h) d / r                            attraction, equal and opposite
//   walls         a += 2 rho0 p_i / rho_i^2 sum F(d / h) / h n                            see sph-core.wgsl
//   gravity, a pointer drag or attractor, and a linear damping.
// Then semi-implicit (symplectic) Euler:  v += a dt;  v /= 1 + damping dt;  |v| <= speed_max;  x += v dt, and a
// hard projection back into the box and out of the obstacles with restitution and friction, which is the safety net
// that guarantees no particle ever leaves the domain whatever the forces did.

#include "sph_params.wgsl"
#include "sph-kernels.wgsl"
#include "neighbor_bindings.wgsl"

@group(0) @binding(0) var<uniform> params: SphParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4f>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4f>;
@group(0) @binding(3) var<storage, read> state: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> positions_out: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> velocities_out: array<vec4f>;
// The grid's bindings (neighbor_bindings.wgsl) start at binding 6.

#include "sph-core.wgsl"

fn finite2(v: vec2f) -> bool {
  return all(abs(v) < vec2f(1e18));
}

// A pointer is two vec4f: (x, y, vx, vy) then (radius, strength, mode, 0). Mode 0 drags the fluid along with the
// pointer (strength is a rate in 1/s: the fluid is pulled toward the pointer's velocity, with an outward share that
// grows with the pointer's speed so a fast poke parts the water); mode 1 attracts (strength in m/s^2).
fn pointer_accel(p: vec2f, v: vec2f) -> vec2f {
  var a = vec2f(0.0);
  for (var k = 0u; k < params.pointer_count; k++) {
    let head = params.pointers[2u * k];
    let tail = params.pointers[2u * k + 1u];
    let d = p - head.xy;
    let r = length(d);
    let radius = tail.x;
    if (r >= radius || radius <= 0.0) { continue; }
    let q = 1.0 - r / radius;
    let w = q * q;
    if (tail.z < 0.5) {
      let speed = length(head.zw);
      let away = select(vec2f(0.0), d / max(r, 1e-6), r > 1e-6);
      let target_velocity = head.zw + away * (0.5 * speed);
      a += tail.y * w * (target_velocity - v);
    } else {
      let toward = select(vec2f(0.0), -d / max(r, 1e-6), r > 1e-6);
      a += toward * tail.y * w - v * (4.0 * w);
    }
  }
  return a;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let p = positions[i].xy;
  let v = velocities[i].xy;
  let st = state[i];
  let rho_i = st.x;
  let p_i = st.y;
  let pr_i = p_i / (rho_i * rho_i);
  let h = params.h;
  let h2 = h * h;
  let m = params.mass;
  let h_sml = 0.5 * h;

  var acc = params.gravity;
  let c = neighbor_cell_of(neighbor_grid, vec3f(p, 0.0));
  for (var row = 0u; row < neighbor_grid.rows; row++) {
    let span = neighbor_row_span(c, row);
    for (var k = span.x; k < span.y; k++) {
      let j = neighbor_particle(k);
      if (j == i) { continue; }
      var d = p - positions[j].xy;
      let r2 = dot(d, d);
      if (r2 >= h2) { continue; }
      var r = sqrt(r2);
      if (r < 1e-5 * h) {
        r = 1e-5 * h;
        d = sph_coincident_direction(i, j) * r;
      }
      let dir = d / r;
      let sj = state[j];
      let rho_j = sj.x;
      let vj = velocities[j].xy;
      let grad = sph_spiky_grad_2d(d, h);

      acc -= m * (pr_i + sj.y / (rho_j * rho_j)) * grad;

      let rho_mean = 0.5 * (rho_i + rho_j);
      acc += (params.viscosity * m / rho_mean) * (vj - v) * sph_viscosity_laplacian_2d(r, h);

      let approach = dot(v - vj, d);
      if (approach < 0.0) {
        let pi_ij = params.artificial_viscosity * params.sound_speed * h_sml * (-approach)
          / (rho_mean * (r2 + 0.01 * h_sml * h_sml));
        acc -= m * pi_ij * grad;
      }

      acc -= dir * (params.cohesion * sph_cohesion(r, h));
    }
  }
  acc += (2.0 * params.rest_density * pr_i) * sph_wall_gradient(p);
  acc += pointer_accel(p, v);

  // Integrate.
  let dt = params.dt;
  var vel = (v + acc * dt) / (1.0 + params.damping * dt);
  let speed_before = length(vel);
  if (speed_before > params.speed_max) {
    vel *= params.speed_max / speed_before;
  }
  var pos = p + vel * dt;

  // The hard boundary: the box, then the obstacles.
  let lo = params.box_min + vec2f(params.margin);
  let hi = params.box_max - vec2f(params.margin);
  if (pos.x < lo.x) { pos.x = lo.x; if (vel.x < 0.0) { vel.x *= -params.restitution; } vel.y *= 1.0 - params.friction; }
  if (pos.x > hi.x) { pos.x = hi.x; if (vel.x > 0.0) { vel.x *= -params.restitution; } vel.y *= 1.0 - params.friction; }
  if (pos.y < lo.y) { pos.y = lo.y; if (vel.y < 0.0) { vel.y *= -params.restitution; } vel.x *= 1.0 - params.friction; }
  if (pos.y > hi.y) { pos.y = hi.y; if (vel.y > 0.0) { vel.y *= -params.restitution; } vel.x *= 1.0 - params.friction; }
  for (var k = 0u; k < params.obstacle_count; k++) {
    let sd = sph_obstacle_sd(k, pos) - params.margin;
    if (sd < 0.0) {
      let n = sph_obstacle_normal(k, pos);
      pos -= n * sd;
      let vn = dot(vel, n);
      if (vn < 0.0) { vel -= (1.0 + params.restitution) * vn * n; }
      let vt = vel - dot(vel, n) * n;
      vel -= params.friction * vt;
    }
  }
  // Whatever happened above, never hand back a number that is not one.
  if (!finite2(pos) || !finite2(vel)) {
    pos = clamp(p, lo, hi);
    vel = vec2f(0.0);
  }
  pos = clamp(pos, lo, hi);

  let speed = length(vel);
  var scalar = rho_i / params.rest_density;
  if (params.scalar_mode == 1u) {
    scalar = p_i / params.pressure_ref;
  } else if (params.scalar_mode == 2u) {
    scalar = speed;
  }
  positions_out[i] = vec4f(pos, 0.0, scalar);
  velocities_out[i] = vec4f(vel, 0.0, speed);
}
`,B=(e,t)=>e>=t?0:4/(Math.PI*t**8)*(t*t-e*e)**3;function V(e){let t=e*Math.sqrt(2/Math.sqrt(3));return{dx:t,dy:t*Math.sqrt(3)/2}}function H(e,t,n=1e3,r=`hex`){let i=n*e*e,a=Math.ceil(t/e)+3,{dx:o,dy:s}=V(e),c=0;if(r===`square`)for(let n=-a;n<=a;n++)for(let r=-a;r<=a;r++)c+=B(Math.hypot(n,r)*e,t);else{let e=Math.ceil(t/s)+3,n=Math.ceil(t/o)+3;for(let r=-e;r<=e;r++)for(let e=-n;e<=n;e++){let n=(e+(r&1?.5:0))*o;c+=B(Math.hypot(n,r*s),t)}}return i*c}function U(e,t,n,r=1024){let i=(n-t)/r,a=e(t)+e(n);for(let n=1;n<r;n++)a+=e(t+n*i)*(n%2?4:2);return a*i/3}function ne(){let e=new Float64Array(33),t=new Float64Array(33),n=e=>4/Math.PI*(32/35)*Math.max(1-e*e,0)**3.5;for(let r=0;r<33;r++){let i=r/32;e[r]=i>=1?0:U(n,i,1);let a=Math.sqrt(Math.max(1-i*i,0));t[r]=a<=0?0:2*U(e=>10/Math.PI*Math.max(1-Math.hypot(i,e),0)**3,0,a,1024)}return{gamma:e,force:t}}var re=o(`SphParams`,{gravity:`vec2f`,dt:`f32`,h:`f32`,box_min:`vec2f`,box_max:`vec2f`,mass:`f32`,rest_density:`f32`,tait_b:`f32`,gamma:`f32`,viscosity:`f32`,artificial_viscosity:`f32`,cohesion:`f32`,damping:`f32`,speed_max:`f32`,margin:`f32`,restitution:`f32`,friction:`f32`,sound_speed:`f32`,pressure_cap:`f32`,pressure_ref:`f32`,count:`u32`,scalar_mode:`u32`,obstacle_count:`u32`,pointer_count:`u32`,obstacles:s(`vec4f`,8),pointers:s(`vec4f`,8),wall_gamma:s(`vec4f`,9),wall_force:s(`vec4f`,9)}),ie=4,ae=4,W=4,oe={density:0,pressure:1,speed:2},se=1.25,G=.35,K=8,ce={gravity:[0,-9.81],gravityRamp:0,stiffness:4,viscosity:.05,artificialViscosity:.2,surfaceTension:0,damping:.3,restitution:.1,friction:.05,stepRate:60,subSteps:0,maxSubSteps:128,courant:.5,rebuildEvery:0,scalar:`density`};function le(e,t,n,r,i){let a=t*e,o=n*e*e,s=H(e,a,n),c=r.max[1]-r.min[1],l=Math.hypot(i.gravity[0],i.gravity[1]),u=Math.max(Math.sqrt(l*c),2),d=Math.max(i.stiffness,1)*u,f=i.courant*a/d;l>0&&(f=Math.min(f,.25*Math.sqrt(a/l))),i.surfaceTension>0&&(f=Math.min(f,.25*Math.sqrt(a/i.surfaceTension)));let p=1/i.stepRate,m=i.subSteps>0?Math.round(i.subSteps):Math.ceil(p/f),h=Math.max(1,Math.min(Math.round(i.maxSubSteps),m)),g=p/h,_=Math.min(i.viscosity,.12*a*a/g),v=Math.min(.4*d,.5*a/g),y=v*g,b=1+Math.floor(G*a/y),x=i.rebuildEvery>0?Math.floor(i.rebuildEvery):Math.max(1,Math.min(K,b)),S=(x-1)*y;return{spacing:e,h:a,mass:o,nominalDensity:n,restDensity:s,soundSpeed:d,referenceSpeed:u,dt:g,dtLimit:f,subSteps:h,viscosity:_,speedMax:v,skin:S,rebuildEvery:x,pressureRef:s*Math.max(l,1)*c,hydrostaticCompression:l*c/(d*d)}}function ue(e,t,n=[]){let{dx:r,dy:i}=V(t),a=`radius`in e?[e.center[0]-e.radius,e.center[1]-e.radius]:e.min,o=`radius`in e?[e.center[0]+e.radius,e.center[1]+e.radius]:e.max,s=[];for(let c=0;;c++){let l=a[1]+i*(c+.5);if(l>o[1]-.25*i)break;for(let i=0;;i++){let u=a[0]+r*(i+.5+(c&1?.5:0));if(u>o[0]-.25*r)break;`radius`in e&&Math.hypot(u-e.center[0],l-e.center[1])>e.radius||n.some(e=>q(e,u,l)<.5*t)||s.push([u,l])}}return s}function q(e,t,n){let r=t-e.center[0],i=n-e.center[1];if(e.shape===`circle`)return Math.hypot(r,i)-e.radius;let a=Math.min(e.cornerRadius??0,e.halfSize[0],e.halfSize[1]),o=Math.abs(r)-(e.halfSize[0]-a),s=Math.abs(i)-(e.halfSize[1]-a);return Math.hypot(Math.max(o,0),Math.max(s,0))+Math.min(Math.max(o,s),0)-a}function de(e){let{device:t,profiler:i=r,label:a=`sph`}=e;if(!(e.spacing>0))throw RangeError(`${a}: spacing must be positive`);let o=e.smoothingRatio??2.4,s=e.density??1e3,l=Math.max(1,Math.floor(e.capacity)),d=e.spacing,f={min:[...e.bounds.min],max:[...e.bounds.max]},h={...ce,gravity:[...ce.gravity],pointers:[],obstacles:[],...e.params};h.gravity=[...h.gravity];let g=!0,_={pass:e=>g?i.pass(e):void 0},v=m({device:t,capacity:l,radius:.5*d,dimension:2,profiler:_,label:`${a} particles`}),y=p({device:t,dimension:2,mode:`reorder`,capacity:l,profiler:_,label:`${a} grid`}),b=Array.from({length:W},(e,n)=>c(t,re,`${a} params ${n}`)),x=0,S={"sph_params.wgsl":re.wgsl,"sph-core.wgsl":ee,...y.chunks({group:0,binding:3})},C={...S,...y.chunks({group:0,binding:6})},w=u(t,{label:`sim/sph-density.wgsl`,code:z,chunks:S,profiler:_,timestamp:`sph density`}),T=u(t,{label:`sim/sph-force.wgsl`,code:te,chunks:C,profiler:_,timestamp:`sph forces`}),E=t.createBuffer({label:`${a} state`,size:l*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),D=ne(),O=e=>{let t=Array(36).fill(0);return e.forEach((e,n)=>t[n]=e),t},k=O(D.gamma),A=O(D.force),j=0,M=0,N=1/0,P={steps:0,builds:0},F=!1,I={},L=null,R=0,B=[],H=le(d,o,s,f,h),U,G=``,K={get positions(){return v.positions},get velocities(){return v.velocities},get count(){return v.count},get capacity(){return v.capacity},get radius(){return v.radius},get restVolume(){return d*d},get generation(){return v.generation}};function q(){return H=le(d,o,s,f,h),H}function de(e){let t=h.gravityRamp>0?Math.min(1,e/h.gravityRamp):1,n=t*t*(3-2*t);return[h.gravity[0]*n,h.gravity[1]*n]}function J(){let e=[],t=h.obstacles.slice(0,ie);for(let n of t)n.shape===`circle`?e.push(1,n.center[0],n.center[1],0,n.radius,0,0,0):e.push(2,n.center[0],n.center[1],0,n.halfSize[0],n.halfSize[1],n.cornerRadius??0,0);return e}function Y(){let e=[];for(let t of h.pointers.slice(0,ae))e.push(t.x,t.y,t.vx,t.vy,t.radius,t.strength,+(t.mode===`pull`),0);return e}function X(e){let t=H,n=b[x];x=(x+1)%W;let r=h.obstacles.slice(0,ie),i=h.pointers.slice(0,ae);return n.set({gravity:de(M),dt:e,h:t.h,box_min:[f.min[0],f.min[1]],box_max:[f.max[0],f.max[1]],mass:t.mass,rest_density:t.restDensity,tait_b:t.restDensity*t.soundSpeed*t.soundSpeed/7,gamma:7,viscosity:t.viscosity,artificial_viscosity:h.artificialViscosity,cohesion:h.surfaceTension*(d*d)/(t.h*t.h),damping:h.damping,speed_max:t.speedMax,margin:.12*d,restitution:h.restitution,friction:h.friction,sound_speed:t.soundSpeed,pressure_cap:se,pressure_ref:t.pressureRef,count:v.count,scalar_mode:oe[h.scalar],obstacle_count:r.length,pointer_count:i.length,obstacles:J(),pointers:Y(),wall_gamma:k,wall_force:A}),n.upload(),n.buffer}function fe(e,t,n,r={}){let i=v.count;if(i<=0||t<=0)return;let a=H,o=X(n);y.configure({min:[f.min[0],f.min[1],0],max:[f.max[0],f.max[1],0],radius:a.h+a.skin});for(let n=0;n<t;n++){g=n===0||n===t-1,(r.grid??N>=a.rebuildEvery)&&(y.build(e,v),N=0,P.builds++);let s=y.resources();r.density!==!1&&w.runCount(e,[o,v.positions,E,...s],i),r.forces!==!1&&(T.runCount(e,[o,v.positions,v.velocities,E,v.back(`position`),v.back(`velocity`),...s],i),v.swap(`position`),v.swap(`velocity`)),N++,P.steps++}g=!0,M+=t*n}function Z(e){let t=h.obstacles,n=[],r=[];for(let i of e)for(let[e,a]of ue(i,d,t)){if(n.length/4>=l)break;n.push(e,a,0,1),r.push(i.velocity?.[0]??0,i.velocity?.[1]??0,0,0)}return{positions:new Float32Array(n),velocities:new Float32Array(r)}}function Q(e,n){let r=Math.min(e.length/4,l-v.count);if(r<=0)return;let i=v.count;v.setCount(i+r),t.queue.writeBuffer(v.attribute(`position`),i*16,e,0,r*4),t.queue.writeBuffer(v.attribute(`velocity`),i*16,n,0,r*4),N=1/0}function pe(e){I={...I,...e},e.bounds&&(f={min:[...e.bounds.min],max:[...e.bounds.max]}),e.spacing!==void 0&&e.spacing>0&&(d=e.spacing,v.radius=.5*d),e.obstacles&&(h.obstacles=e.obstacles.slice(0,ie)),e.gravity&&(h.gravity=[...e.gravity]),L=e.emitter===void 0?L:e.emitter,R=0,q();let{positions:t,velocities:n}=Z(I.blocks??[]);if(I.particles){let e=I.particles,r=Math.max(0,l-t.length/4),i=Math.min(e.positions.length/4,r),a=new Float32Array(t.length+i*4),o=new Float32Array(t.length+i*4);a.set(t),o.set(n),a.set(e.positions.subarray(0,i*4),t.length),e.velocities&&o.set(e.velocities.subarray(0,i*4),t.length),t=a,n=o}v.set({positions:t,velocities:n}),M=0,N=1/0}function me(e){if(!L||L.speed<=0||L.width<=0)return;let{dx:t,dy:n}=V(d),r=Math.hypot(L.direction[0],L.direction[1])||1,i=L.direction[0]/r,a=L.direction[1]/r,o=-a,s=i;R+=L.speed*e/n;let c=Math.floor(R);if(c<=0)return;R-=c;let l=Math.max(1,Math.floor(L.width/t)),u=[],f=[];for(let e=0;e<c;e++){let r=(c-1-e+R)*n;for(let n=0;n<l;n++){let c=(n-(l-1)/2+(e&1?.5:0))*t;u.push(L.position[0]+o*c+i*r,L.position[1]+s*c+a*r,0,1),f.push(i*L.speed,a*L.speed,0,0)}}Q(new Float32Array(u),new Float32Array(f))}function $(e){for(;B.length>0;)B.shift()();me(e)}function he(){E.destroy(),E=t.createBuffer({label:`${a} state`,size:l*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC})}function ge(e){let t=`${e}|${H.subSteps}`;return(!U||t!==G)&&(U=n(e,{maxSteps:Math.max(2*H.subSteps,4)}),G=t),U}return q(),{system:v,particles:K,params:h,grid:y,get derived(){return H},get bounds(){return f},get count(){return v.count},get capacity(){return l},get time(){return M},stats:P,get generation(){return j+v.generation},update(e,t){$(Math.min(Math.max(t,0),.1));let n=q(),{steps:r}=ge(n.dt).advance(Math.min(Math.max(t,0),.1));return fe(e,r,n.dt),r},step(e,t=1,n,r){$(0);let i=q();fe(e,t,n??i.dt,r)},reset(e={}){B.push(()=>pe(e))},addBlock(e){B.push(()=>{let{positions:t,velocities:n}=Z([e]);Q(t,n)})},setEmitter(e){L=e,R=0},setCapacity(e){e=Math.max(1,Math.floor(e)),e!==l&&B.push(()=>{l=e,v.resize(e),he(),j++,N=1/0})},async read(){for(;B.length>0;)B.shift()();let e=v.count,n=await v.read(`position`,e),r=await v.read(`velocity`,e),i=t.createBuffer({size:Math.max(8,e*8),usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),a=t.createCommandEncoder();e>0&&a.copyBufferToBuffer(E,0,i,0,e*8),t.queue.submit([a.finish()]),await i.mapAsync(GPUMapMode.READ);let o=new Float32Array(i.getMappedRange().slice(0,e*8));i.unmap(),i.destroy();let s={count:e,x:new Float32Array(e),y:new Float32Array(e),vx:new Float32Array(e),vy:new Float32Array(e),density:new Float32Array(e),pressure:new Float32Array(e),scalar:new Float32Array(e)};for(let t=0;t<e;t++)s.x[t]=n[t*4],s.y[t]=n[t*4+1],s.scalar[t]=n[t*4+3],s.vx[t]=r[t*4],s.vy[t]=r[t*4+1],s.density[t]=o[t*2],s.pressure[t]=o[t*2+1];return s},destroy(){if(!F){F=!0,w.destroy(),T.destroy(),y.destroy(),v.destroy(),E.destroy();for(let e of b)e.destroy()}}}}var J=[`dam break`,`pour`,`two blobs`],Y=[`liquid`,`discs`,`density`,`pressure`,`velocity`],X=[`clear tropical`,`coastal`,`murky green`,`tea`,`glacial milk`,`swimming pool`,`open ocean`],fe=[`push`,`pull`],Z={min:[0,0],max:[2,1.2]},Q=6e4,pe=1.3,me=o(`BackdropParams`,{center:`vec2f`,half_height:`f32`,aspect:`f32`,box_min:`vec2f`,box_max:`vec2f`,height_px:`f32`}),$=o(`OverlayParams`,{center:`vec2f`,half_height:`f32`,aspect:`f32`,box_min:`vec2f`,box_max:`vec2f`,height_px:`f32`,obstacle_count:`u32`,pointer_count:`u32`,encode_srgb:`u32`,obstacles:s(`vec4f`,8),pointers:s(`vec4f`,4)}),he=(e,t,n)=>Math.min(n,Math.max(t,e));function ge(e,t){if(e===`pour`){let e={shape:`box`,center:[.62,.6],halfSize:[.3,.025],cornerRadius:.02},n={shape:`circle`,center:[1.4,.28],radius:.2},r=.8;return{area:r,scene:{bounds:Z,spacing:Math.sqrt(r/t),blocks:[],obstacles:[e,n],emitter:{position:[.5,1.13],direction:[0,-1],width:.1,speed:2.4}}}}if(e===`two blobs`){let e=2*Math.PI*.22*.22;return{area:e,scene:{bounds:Z,spacing:Math.sqrt(e/t),blocks:[{center:[.62,.6],radius:.22,velocity:[.4,0]},{center:[1.38,.62],radius:.22,velocity:[-.4,0]}],obstacles:[],emitter:null}}}let n=.5225;return{area:n,scene:{bounds:Z,spacing:Math.sqrt(n/t),blocks:[{min:[0,0],max:[.55,.95]}],obstacles:[],emitter:null}}}var _e=t({meta:e,params:{scene:{type:`select`,default:J[0],options:J,label:`Scene (restarts)`},restart:{type:`boolean`,default:!1,label:`Restart the scene (flip this switch)`},count:{type:`number`,default:3e3,min:1e3,max:Q,step:500,label:`Particles (restarts; sub-steps grow with their square root)`},view:{type:`select`,default:Y[0],options:Y,label:`View`},gravity:{type:`number`,default:9.81,min:0,max:30,step:.1,label:`Gravity (m/s²)`},tilt:{type:`number`,default:0,min:-90,max:90,step:1,label:`Gravity tilt (degrees: the tank rolls)`},stiffness:{type:`number`,default:4,min:2,max:10,step:.1,label:`Stiffness (speed of sound / free-fall speed; more is stiffer and slower)`},viscosity:{type:`number`,default:.05,min:0,max:1,step:.005,label:`Viscosity (m²/s)`},surfaceTension:{type:`number`,default:0,min:0,max:200,step:1,label:`Surface tension (m/s²)`},subSteps:{type:`number`,default:0,min:0,max:128,step:1,label:`Sub-steps per 1/60 s (0: as many as the time-step rule asks)`},pointerMode:{type:`select`,default:fe[0],options:fe,label:`Drag does`},pointerSize:{type:`number`,default:.16,min:.05,max:.5,step:.01,label:`Pointer radius (m)`},pointerStrength:{type:`number`,default:30,min:0,max:100,step:1,label:`Pointer strength`},captureTouch:{type:`boolean`,default:!1,label:`Touch drags push the water (and stop the page scrolling over the canvas)`},blob:{type:`number`,default:2.6,min:1.4,max:4,step:.05,label:`Blob radius (in particle radii)`},threshold:{type:`number`,default:.5,min:.15,max:.9,step:.01,label:`Surface threshold`},water:{type:`select`,default:X[0],options:X,label:`Water type`},refraction:{type:`number`,default:1,min:0,max:3,step:.05,label:`Refraction`},depth:{type:`number`,default:3,min:.5,max:16,step:.1,label:`Water depth (how fast it darkens)`},foam:{type:`number`,default:.6,min:0,max:1,step:.01,label:`Foam (fast water)`}},presets:{"dam break":{},pour:{scene:J[1],count:1e4,surfaceTension:6},"zero-g blobs":{scene:J[2],gravity:0,surfaceTension:200,viscosity:.02,count:6e3,foam:0},honey:{viscosity:.6,stiffness:5,foam:0,water:X[3]},"many particles":{count:4e4},"plain discs":{view:Y[1]},pressure:{view:Y[3]}},async create({device:e,format:t,canvas:n,params:r,profiler:a}){let o=c(e,me,`sph-2d backdrop`),s=c(e,$,`sph-2d overlay`),l=_(e,{label:`sph-2d backdrop`,fragment:{label:`sph-2d/backdrop.wgsl`,code:x,chunks:{"backdrop_params.wgsl":me.wgsl}},format:`rgba16float`}),u=_(e,{label:`sph-2d overlay`,fragment:{label:`sph-2d/overlay.wgsl`,code:S,chunks:{"overlay_params.wgsl":$.wgsl}},format:t,blend:{color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}}),d=e.createBindGroup({layout:l.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:o.buffer}}]}),f=e.createBindGroup({layout:u.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:s.buffer}}]}),p=1,m=1,v,y=!1,b,C=1,w=h(n,{capture:r.captureTouch}),T=new Map,E=0,D,O=``,k=r.restart;function A(){let e=r.tilt*Math.PI/180;return[r.gravity*Math.sin(e),-r.gravity*Math.cos(e)]}function j(){let t=Math.round(he(r.count,500,Q)),n=r.scene,i=`${n}|${t}`,o=r.restart!==k;if(k=r.restart,i===O&&!o&&D)return D;O=i;let s=ge(n,t),c=Math.min(Q*pe,Math.ceil(t*pe));return D?D.setCapacity(c):D=de({device:e,capacity:c,bounds:Z,spacing:s.scene.spacing,params:{gravity:A()},profiler:a,label:`sph-2d`}),D.reset(s.scene),D}function M(e){let t=e.params;t.gravity=A(),t.stiffness=r.stiffness,t.viscosity=r.viscosity,t.surfaceTension=r.surfaceTension,t.subSteps=Math.round(r.subSteps);let n=r.view;t.scalar=n===`density`?`density`:n===`pressure`?`pressure`:`speed`,t.gravityRamp=0}function N(){let e=p/m,t=(Z.max[0]-Z.min[0])/2,n=(Z.max[1]-Z.min[1])/2;return{center:[(Z.min[0]+Z.max[0])/2,(Z.min[1]+Z.max[1])/2],halfHeight:Math.max(n,t/e)*1.06}}let P=(e,t,n)=>{let r=p/m;return[n.center[0]+(2*e-1)*n.halfHeight*r,n.center[1]+(1-2*t)*n.halfHeight]};function F(e,t){let n=p/m,i=w.poll(),a=[],o=[],s=e=>{let[i,a]=P(e.x,e.y,t),o=e.vx*2*t.halfHeight*n,s=-e.vy*2*t.halfHeight,c=Math.hypot(o,s),l=r.pointerMode===`push`,u=l?r.pointerStrength*he(c/.5,0,1):r.pointerStrength*.6;return{x:i,y:a,vx:o,vy:s,radius:r.pointerSize,strength:u,mode:l?`push`:`pull`}};for(let c of i){c.justPressed&&T.set(c.id,{x:c.x,y:c.y,time:E});let i=T.get(c.id);if(i&&Math.hypot((c.x-i.x)*n,c.y-i.y)>.03&&T.delete(c.id),c.justReleased){if(i&&!c.cancelled&&E-i.time<.35){let[n,r]=P(i.x,i.y,t);e.addBlock({center:[n,r],radius:.09,velocity:[0,-1.5]})}T.delete(c.id)}if(c.down&&o.length<4&&o.push(s(c)),(c.down||c.inside)&&a.length<16){let[e,n]=P(c.x,c.y,t);a.push(e,n,r.pointerSize,c.down?.9:.35)}}return e.params.pointers=o,a}function I(){let n=p*m>13e5?.5:1;return(!b||n!==C)&&(b?.destroy(),C=n,b=R({device:e,format:t,width:p,height:m,fieldScale:n,profiler:a,label:`sph-2d liquid`})),b}let L={};function ee(e,t,n){let i=t*m/(2*n);return L.smoothing=he(.9*i*C,1,4),L.rim=.6,L.view=e===`liquid`?`final`:`discs`,L.blobRadius=r.blob,L.threshold=r.threshold,L.waterType=Math.max(0,X.indexOf(r.water)),L.refraction=.12*r.refraction,L.depthScale=r.depth,L.foam=r.foam,L.foamLow=2.2,L.foamHigh=4.6,e===`density`?(L.discRange=[.75,1.05],L.discPalette=ye):e===`pressure`?(L.discRange=[0,.35],L.discPalette=ye):e===`velocity`?(L.discRange=[0,4],L.discPalette=ve):(L.discRange=[0,3],L.discPalette=ve),L}return{resize(t,n){p=Math.max(1,Math.round(t)),m=Math.max(1,Math.round(n)),v?v.resize(p,m):v=i(e,{label:`sph-2d backdrop`,format:`rgba16float`,width:p,height:m}),y=!1,I().resize(p,m)},frame({delta:e},n,i){let c=Math.min(e,.05);E+=c,w.setCapture(r.captureTouch);let h=j();M(h);let _=N(),b=F(h,_);h.update(n,c);let x=p/m,S={center:[_.center[0],_.center[1]],half_height:_.halfHeight,aspect:x,box_min:[Z.min[0],Z.min[1]],box_max:[Z.max[0],Z.max[1]],height_px:m};!y&&v&&(y=!0,o.set(S),o.upload(),g(n,v.view,l,[d],{label:`sph-2d backdrop`,timestampWrites:a.pass(`backdrop (on resize)`)})),I().render(n,{particles:h.particles,domain:_,backdrop:v.view,target:i,params:ee(r.view,h.derived.spacing,_.halfHeight),profiler:a});let C=[];for(let e of h.params.obstacles)e.shape===`circle`?C.push(1,e.center[0],e.center[1],0,e.radius,0,0,0):C.push(2,e.center[0],e.center[1],0,e.halfSize[0],e.halfSize[1],e.cornerRadius??0,0);s.set({...S,obstacle_count:h.params.obstacles.length,pointer_count:Math.floor(b.length/4),encode_srgb:+!t.endsWith(`-srgb`),obstacles:C,pointers:b}),s.upload(),g(n,i,u,[f],{label:`sph-2d overlay`,load:!0,timestampWrites:a.pass(`obstacles and glass`)})},destroy(){D?.destroy(),b?.destroy(),v?.destroy(),w.destroy(),o.destroy(),s.destroy()}}}}),ve=[[.02,.1,.35],[.05,.45,.8],[.5,.9,1],[1,1,1]],ye=[[.03,.05,.3],[.05,.4,.75],[.1,.75,.5],[.95,.85,.2],[.95,.2,.1]];export{_e as effect};