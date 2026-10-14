import{t as e}from"./meta-BGf3KVWb.js";import{n as t}from"./types-ci2WwWg0.js";import{n}from"./profiler-Bi27xYp-.js";import{n as r,t as i}from"./uniforms-BE1XSnDx.js";import{n as a}from"./pointer-BbHa9JHH.js";import{r as o,t as s}from"./fullscreen-Dq3Mq0Js.js";import{n as c,t as l}from"./mipmap-caehtsny.js";import{t as u}from"./fluid-Bv7YHznw.js";import{t as d}from"./fluid-stir-BpRr4raR.js";import{a as f,i as p,n as m,o as h,r as g,s as _,t as v}from"./sources-DDkPPMfK.js";import{t as y}from"./scene-DxcxLnCL.js";var b=`// fluid-warp-advect.wgsl -- one step of the displacement field: carry it with the flow, add the motion
// the flow gave the content during the step, let it relax, keep it bounded. A fullscreen fragment pass
// over the field texture; it reads the previous field and the solver's staggered velocity and writes
// the new field (every texel).
//
// THE EQUATION. Let D(x, t) be how far the content now at x has been moved from its rest position.
// A parcel of content moves with the fluid, and the content at the parcel was displaced by exactly the
// distance the parcel has travelled from rest, so along its path dD/dt = v. Written for the fixed point
// x (an Eulerian field):
//
//     dD/dt + (v . grad) D = v  -  r D
//
// the left side is the advection of D by the flow (semi-Lagrangian, below), the first term on the
// right is the accumulation of motion, and r (P.relaxation, 1 / s) is the rate at which the content
// springs back: 0 keeps every smear for ever (paint), a large r makes it a short-lived dent (jelly).
// Steady uniform flow v for time t gives D = v t exactly (tests/fluid-warp.test.ts checks it).
//
// THE STEP, in image-height units. Semi-Lagrangian with a midpoint trace, like the solver's own:
//     v1   = v(x - dt/2 v(x))                  velocity at the middle of the parcel's path
//     D'   = D(x - dt v1) + gain dt v1         what the parcel carried, plus what it just moved
//     D'  *= exp(-r dt)                        relaxation (exact for any dt)
//     D'   = D' limited to |D'| <= max_disp    the content cannot be dragged off to infinity
// Where the trace leaves the domain: clamped (walls), or zero displacement for \`open\` edges, where
// the picture's own content enters.
//
// PRECISION. D is rgba16float (the solver's format, filterable everywhere): about three decimal digits.
// A step adds v dt, e.g. 0.5 x 1/60 = 0.008 image heights, well above the half-float spacing of a
// displacement of a few tenths (2.4e-4 at 0.3), so accumulation works; a flow slower than about 0.02
// heights per second stops adding once |D| is above 0.3. The limit is far below a pixel.

#include "fullscreen.wgsl"
#include "fluid.wgsl"
#include "warp_params.wgsl"

@group(0) @binding(0) var<uniform> P: WarpParams;
@group(0) @binding(1) var field_tex: texture_2d<f32>;
@group(0) @binding(2) var velocity_tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

fn flow_at(uv: vec2f) -> vec2f {
  return fluid_velocity_at(velocity_tex, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), P.grid);
}

fn finite_vec(v: vec2f) -> vec2f {
  let bad = (bitcast<vec2u>(v) & vec2u(0x7f800000u)) == vec2u(0x7f800000u);
  return select(v, vec2f(0.0), bad);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  let to_uv = vec2f(1.0 / P.aspect, 1.0); // image heights -> uv
  let v0 = flow_at(uv);
  let v1 = flow_at(uv - 0.5 * P.dt * v0 * to_uv);
  let src = uv - P.dt * v1 * to_uv;
  var carried = textureSampleLevel(field_tex, samp, clamp(src, vec2f(0.0), vec2f(1.0)), 0.0).xy;
  if (P.open != 0u && (any(src < vec2f(0.0)) || any(src > vec2f(1.0)))) {
    carried = vec2f(0.0);
  }
  var d = (carried + P.gain * P.dt * v1) * P.decay;
  let m = length(d);
  if (m > P.max_disp) {
    d = d * (P.max_disp / m);
  }
  return vec4f(finite_vec(d), 0.0, 0.0);
}
`,x=`// fluid-warp-apply.wgsl -- draws content (an image, a video frame, a headline rendered to a texture)
// through a displacement field from src/gpu/sim/fluid-warp.ts, to the canvas. Pure shading: all the
// physics happened in the field.
//
//   colour(uv) = content(fit(uv - D(uv)))     see fluid-warp-core.wgsl for why it is a backward map
//
// REST. Where D is exactly 0 every extra term below is exactly 0 too (the stretch, the film slope and
// the channel split all vanish with D), the source uv is returned untouched, and the output is the
// content sampled at the pixel's own centre: pixel-identical to drawing the content (the test renders
// it and compares bytes), so type stays legible whenever the fluid is calm.
//
// LOOK.
//   chroma  splits the channels along the displacement in proportion to the local STRETCH (the norm of
//           the Jacobian of D): where the content is smeared the red and blue copies part, in a pure
//           translation they do not. 0 takes a single tap.
//   sheen   a liquid film: |D| is treated as a thickness, its gradient tilts a normal, and a soft
//           shade plus a small glint show where the content has been dragged, like wet paint.
//   fade    how far from a border the offset is faded out (uv): the border pixel never smears.
// DEBUG VIEWS (P.view): 0 content, 1 displacement (hue is direction, brightness magnitude), 2 grid (the
// content's own coordinates drawn as lines, so the fold of the map is visible), 3 velocity of the solver.

#include "fullscreen.wgsl"
#include "color.wgsl"
#include "media.wgsl"
#include "fluid.wgsl"
#include "fluid-warp-core.wgsl"
#include "warp_apply_params.wgsl"

@group(0) @binding(0) var<uniform> P: WarpApplyParams;
@group(0) @binding(1) var content: texture_2d<f32>;
@group(0) @binding(2) var content_samp: sampler;
@group(0) @binding(3) var field: texture_2d<f32>;
@group(0) @binding(4) var field_samp: sampler;
@group(0) @binding(5) var fields: texture_2d<f32>;

const VIEW_CONTENT: u32 = 0u;
const VIEW_DISPLACEMENT: u32 = 1u;
const VIEW_GRID: u32 = 2u;
const VIEW_VELOCITY: u32 = 3u;

const LIGHT: vec3f = vec3f(-0.45, -0.55, 0.7);

// The content at a point of the canvas (canvas uv), with the bars of a \`contain\` fit.
fn content_at(canvas_uv: vec2f, lod: f32) -> vec3f {
  let muv = media_fit_uv(canvas_uv, P.fit);
  let c = textureSampleLevel(content, content_samp, clamp(muv, vec2f(0.0), vec2f(1.0)), lod).rgb;
  return mix(P.bars, c, media_inside(muv, 0.0));
}

fn grid_lines(canvas_uv: vec2f) -> vec3f {
  let p = canvas_uv * vec2f(P.aspect, 1.0) * 10.0;
  let f = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2f(1e-4));
  let line = 1.0 - min(min(f.x, f.y), 1.0);
  let major = select(0.0, 1.0, all(abs(p - round(p / 5.0) * 5.0) < vec2f(0.5)));
  return mix(vec3f(0.02), vec3f(0.9, 0.95, 1.0), line) * (0.7 + 0.3 * major);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  var d = vec2f(0.0);
  if (P.cubic != 0u) {
    d = fwarp_fetch_cubic(field, field_samp, uv, P.field_size);
  } else {
    d = fwarp_fetch(field, field_samp, uv);
  }
  let lod = media_lod(P.media_px, P.fit, P.canvas_px);

  var colour = vec3f(0.0);
  let at_rest = d.x == 0.0 && d.y == 0.0;
  var g = mat2x2f(vec2f(0.0), vec2f(0.0));
  if (!at_rest) {
    g = fwarp_gradient(field, field_samp, uv, P.field_size, P.aspect);
  }
  let stretch = fwarp_stretch(g);

  if (P.view == VIEW_CONTENT || P.view == VIEW_GRID) {
    let split = P.chroma * min(stretch, 1.5);
    var src = fwarp_source_uv(uv, fwarp_to_uv(d, P.aspect), P.fade);
    if (P.view == VIEW_GRID) {
      colour = grid_lines(src);
    } else if (split > 0.0) {
      let r_uv = fwarp_source_uv(uv, fwarp_to_uv(d * (1.0 + split), P.aspect), P.fade);
      let b_uv = fwarp_source_uv(uv, fwarp_to_uv(d * (1.0 - split), P.aspect), P.fade);
      colour = vec3f(content_at(r_uv, lod).r, content_at(src, lod).g, content_at(b_uv, lod).b);
    } else {
      colour = content_at(src, lod);
    }

    if (P.sheen > 0.0 && !at_rest) {
      let slope = fwarp_film_slope(g, d) * P.sheen * 3.0;
      let n = normalize(vec3f(-slope, 1.0));
      let l = normalize(LIGHT);
      let h = normalize(l + vec3f(0.0, 0.0, 1.0));
      let gate = smoothstep(0.0, 0.05, length(slope));
      let glint = pow(max(dot(n, h), 0.0), 40.0) * gate;
      let shade = dot(n.xy, l.xy);
      colour = colour * (1.0 + 0.8 * shade) + vec3f(glint * 0.35);
    }
  } else if (P.view == VIEW_DISPLACEMENT) {
    colour = vec3f(0.012) + fluid_flow_color(d, P.debug_gain * 12.0);
  } else {
    let s = fluid_sample_fields(fields, field_samp, uv);
    colour = vec3f(0.012) + fluid_flow_color(fluid_velocity(s), 2.0 * P.debug_gain);
  }
  return vec4f(linear_to_srgb(clamp(colour, vec3f(0.0), vec3f(1.0))), 1.0);
}
`,S=`// fluid-warp-core.wgsl -- reading a DISPLACEMENT FIELD carried by the stable-fluids solver
// (src/gpu/sim/fluid-warp.ts), and turning it into the place to sample the content.
//
// THE FIELD. One rgba16float texel per sample, xy = D, the displacement of the content at that point
// from where it rests, in IMAGE HEIGHTS (canvas height = 1, x right, y DOWN, the unit of the fluid's
// velocity). The picture a visitor sees at uv shows the content that REST at  uv - D:
//
//     colour(uv) = content(uv - D(uv) / (aspect, 1))
//
// That is a BACKWARD map (every output pixel asks where its colour comes from), so there are no holes
// and no overlaps to resolve, and D = 0 returns the source unchanged. A forward map (push each source
// texel to uv + D) would leave gaps where the flow stretches the content and pile texels up where it
// compresses. The field itself is advected by the flow and accumulates it (fluid-warp-advect.wgsl).
//
// All of it assumes \`uv\` has its origin top-left, like fullscreen.wgsl. Functions are prefixed fwarp_.
//
//   fwarp_fetch(field, samp, uv) -> vec2f
//       D at uv by one bilinear tap (\`samp\` must be a clamp-to-edge linear sampler). Piecewise linear:
//       its slope jumps at texel boundaries, which shows as faint creases when the field is coarse.
//   fwarp_fetch_cubic(field, samp, uv, size: vec2f) -> vec2f
//       D at uv through a cubic B-spline in four bilinear taps (Sigg and Hadwiger, GPU Gems 2 ch. 20).
//       C2 smooth, exact for a constant field, and a little softer than bilinear. \`size\` is the field's
//       size in texels.
//   fwarp_to_uv(d: vec2f, aspect: f32) -> vec2f
//       a displacement in image heights as a uv offset (x / aspect).
//   fwarp_source_uv(uv, d_uv, fade: f32) -> vec2f
//       where to sample the content: uv - d_uv, with the part of the offset that points at a border faded
//       to nothing over \`fade\` (uv units, 0.02 to 0.08) before it gets there and the rest mirror-folded
//       back into [0, 1], so the picture neither smears the border pixel nor wraps. EXACTLY uv when d_uv
//       is zero or the result stays inside [0, 1] (no round trip through a fold).
//   fwarp_gradient(field, samp, uv, size: vec2f, aspect: f32) -> mat2x2f
//       the Jacobian of D by central differences over one texel (four bilinear taps), per image height:
//       column 0 is dD/dx, column 1 is dD/dy. Zero for a constant field. The measure of local stretch.
//   fwarp_stretch(g: mat2x2f) -> f32
//       the Frobenius norm of that Jacobian: 0 at rest or in a pure translation, about 1 where the
//       content has been stretched by a factor of two.
//   fwarp_film_slope(g: mat2x2f, d: vec2f) -> vec2f
//       the gradient of |D|, scaled to zero as |D| goes to zero: a film that is thick where the content
//       has been moved far. Feed it to a normal for a liquid sheen that is exactly nothing at rest.
//
// Cost: fetch 1 tap, fetch_cubic 4, gradient 4; a few dozen ALU.

#include "refraction.wgsl"

fn fwarp_fetch(field: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec2f {
  return textureSampleLevel(field, samp, uv, 0.0).xy;
}

fn fwarp_fetch_cubic(field: texture_2d<f32>, samp: sampler, uv: vec2f, size: vec2f) -> vec2f {
  let coord = uv * size - vec2f(0.5);
  let base = floor(coord);
  let f = coord - base;
  let f2 = f * f;
  let f3 = f2 * f;
  // Cubic B-spline weights of the texels base-1 .. base+2, merged pairwise into two bilinear taps.
  let w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  let w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  let w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1;
  let g1 = w2 + w3;
  let p0 = (base - vec2f(1.0) + w1 / g0 + vec2f(0.5)) / size;
  let p1 = (base + vec2f(1.0) + w3 / g1 + vec2f(0.5)) / size;
  let s00 = textureSampleLevel(field, samp, vec2f(p0.x, p0.y), 0.0).xy;
  let s10 = textureSampleLevel(field, samp, vec2f(p1.x, p0.y), 0.0).xy;
  let s01 = textureSampleLevel(field, samp, vec2f(p0.x, p1.y), 0.0).xy;
  let s11 = textureSampleLevel(field, samp, vec2f(p1.x, p1.y), 0.0).xy;
  return g0.y * (g0.x * s00 + g1.x * s10) + g1.y * (g0.x * s01 + g1.x * s11);
}

fn fwarp_to_uv(d: vec2f, aspect: f32) -> vec2f {
  return vec2f(d.x / max(aspect, 1e-4), d.y);
}

fn fwarp_source_uv(uv: vec2f, d_uv: vec2f, fade: f32) -> vec2f {
  // Sampling happens at uv - d_uv, so the offset that matters is -d_uv.
  let offset = refraction_fade_offset(uv, -d_uv, fade);
  let s = uv + offset;
  let inside = all(s >= vec2f(0.0)) && all(s <= vec2f(1.0));
  return select(refraction_mirror_uv(s), s, inside);
}

fn fwarp_gradient(
  field: texture_2d<f32>, samp: sampler, uv: vec2f, size: vec2f, aspect: f32,
) -> mat2x2f {
  let t = vec2f(1.0) / size;
  let r = textureSampleLevel(field, samp, uv + vec2f(t.x, 0.0), 0.0).xy;
  let l = textureSampleLevel(field, samp, uv - vec2f(t.x, 0.0), 0.0).xy;
  let d = textureSampleLevel(field, samp, uv + vec2f(0.0, t.y), 0.0).xy;
  let u = textureSampleLevel(field, samp, uv - vec2f(0.0, t.y), 0.0).xy;
  // d/dx in image heights = (d/du) / aspect; d/dy = d/dv.
  let ddx = (r - l) * (0.5 * size.x / max(aspect, 1e-4));
  let ddy = (d - u) * (0.5 * size.y);
  return mat2x2f(ddx, ddy);
}

fn fwarp_stretch(g: mat2x2f) -> f32 {
  return sqrt(dot(g[0], g[0]) + dot(g[1], g[1]));
}

fn fwarp_film_slope(g: mat2x2f, d: vec2f) -> vec2f {
  let m = length(d);
  let dir = d / max(m, 1e-6) * smoothstep(0.0, 0.01, m);
  return vec2f(dot(g[0], dir), dot(g[1], dir));
}
`,C=`rgba16float`,w={relaxation:1,maxDisplacement:.4,gain:1},T=r(`WarpParams`,{grid:`vec2f`,aspect:`f32`,dt:`f32`,decay:`f32`,gain:`f32`,max_disp:`f32`,open:`u32`}),E=r(`WarpApplyParams`,{bars:`vec3f`,aspect:`f32`,fit:`vec2f`,media_px:`vec2f`,canvas_px:`vec2f`,field_size:`vec2f`,fade:`f32`,chroma:`f32`,sheen:`f32`,debug_gain:`f32`,view:`u32`,cubic:`u32`}),D=(e,t,n)=>Math.min(n,Math.max(t,e)),O=(e,t)=>Number.isFinite(e)?e:t,k=1,A=new WeakMap;function j(e){let t=A.get(e);return t===void 0&&A.set(e,t=k++),t}function M(e,t,n=4096){let r=D(O(t,2),.5,8);return{width:D(Math.round(e.width*r),8,n),height:D(Math.round(e.height*r),8,n)}}function N(e){let{device:t,fluid:r,profiler:a=n,label:c=`fluid-warp`}=e,l={...w,...e.params},u=D(O(e.scale??2,2),.5,8),d=Math.min(t.limits.maxTextureDimension2D,4096),f=i(t,T,`${c} params`),p=t.createSampler({label:`${c} sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),m=s(t,{fragment:{label:`sim/fluid-warp-advect.wgsl`,code:b,chunks:{"warp_params.wgsl":T.wgsl}},format:C}),h=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC,g,_={width:0,height:0},v=0,y=0,x=-1,S=new Map,E=!1,k,A;function N(){if(g){for(let e of g)e.texture.destroy();g=void 0,S=new Map}}function P(){N(),_=M(r.grid,u,d),g=[0,1].map(e=>{let n=t.createTexture({label:`${c} field ${e}`,size:[_.width,_.height],format:C,usage:h});return{texture:n,view:n.createView({label:`${c} field ${e} view`})}}),v=0,x=r.generation,y++}P();function F(){let e=M(r.grid,u,d);(x!==r.generation||e.width!==_.width||e.height!==_.height)&&P()}function I(e){let t=r.grid;f.set({grid:[t.width,t.height],aspect:t.aspect,dt:e,decay:Math.exp(-Math.max(0,O(l.relaxation,0))*e),gain:O(l.gain,1),max_disp:Math.max(1e-4,O(l.maxDisplacement,.4)),open:+(r.params.boundary===`open`)}),f.upload()}let L={params:l,get field(){let e=g[v];return{texture:e.texture,view:e.view,slot:v,width:_.width,height:_.height}},get generation(){return y},get scale(){return u},attach(){k||(A=r.hooks.dye,k=e=>(L.step(e.encoder,e.dt,e.velocity),A?A(e):!1),r.hooks.dye=k)},detach(){k&&(r.hooks.dye===k&&(r.hooks.dye=A),k=void 0,A=void 0)},step(e,n,r){if(E||!(n>0))return;F(),I(n);let i=g[v],s=g[1-v],l=`${v}:${j(r)}`,u=S.get(l);u||(u=t.createBindGroup({label:`${c} step`,layout:m.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:f.buffer}},{binding:1,resource:i.view},{binding:2,resource:r},{binding:3,resource:p}]}),S.set(l,u)),o(e,s.view,m,[u],{label:`${c} step`,timestampWrites:a.pass(`warp field`)}),v=1-v},setScale(e){let t=D(O(e,u),.5,8);t!==u&&(u=t,P())},reset(e){F();for(let t of g)e.beginRenderPass({label:`${c} clear`,colorAttachments:[{view:t.view,loadOp:`clear`,storeOp:`store`}]}).end();v=0},destroy(){E||(L.detach(),E=!0,N(),f.destroy())}};return L}var P={content:0,displacement:1,grid:2,velocity:3};function F(e){let{device:t,format:n,label:r=`fluid-warp view`}=e,a=i(t,E,`${r} params`),c=s(t,{fragment:{label:`sim/fluid-warp-apply.wgsl`,code:x,chunks:{"warp_apply_params.wgsl":E.wgsl,"fluid-warp-core.wgsl":S}},format:n}),l=t.createSampler({label:`${r} content sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),u=t.createSampler({label:`${r} field sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),d=t.createTexture({label:`${r} blank`,size:[1,1],format:`rgba16float`,usage:GPUTextureUsage.TEXTURE_BINDING}),f=d.createView(),p=new Map,m=!1;return{draw(e,n,i){if(m)return;let[s,d]=[Math.max(1,i.canvasSize[0]),Math.max(1,i.canvasSize[1])],g=s/d,_=i.fit??`cover`,v=_===`stretch`?[1,1]:h(g,i.content.width/Math.max(1,i.content.height),_),y=i.warp.field;a.set({bars:i.bars??[0,0,0],aspect:g,fit:v,media_px:[i.content.width,i.content.height],canvas_px:[s,d],field_size:[y.width,y.height],fade:i.fade??.04,chroma:Math.max(0,i.chroma??0),sheen:Math.max(0,i.sheen??0),debug_gain:i.debugGain??1,view:P[i.view??`content`],cubic:i.cubic===!1?0:1}),a.upload();let b=i.fields??f,x=`${j(i.warp)}:${i.warp.generation}:${y.slot}:${j(i.content.view)}:${j(b)}`,S=p.get(x);S||(p.size>64&&(p=new Map),S=t.createBindGroup({label:r,layout:c.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:a.buffer}},{binding:1,resource:i.content.view},{binding:2,resource:l},{binding:3,resource:y.view},{binding:4,resource:u},{binding:5,resource:b}]}),p.set(x,S)),o(e,n,c,[S],{label:r,timestampWrites:i.timestampWrites})},destroy(){m||(m=!0,p=new Map,a.destroy(),d.destroy())}}}var I=[`Everything flows`,`Make some waves`,`Liquid type`],L=`"Inter", "Helvetica Neue", "Segoe UI", Helvetica, Arial, system-ui, sans-serif`,R={width:.88,height:.62},z=1.02,B=[`#0a2c4d`,`#14606f`,`#1f8a8a`],V=`#fff4de`,H=`#ff6a4d`;function U(e,t=3){let n=[[e.join(` `)]];if(e.length>=2&&t>=2)for(let t=1;t<e.length;t++)n.push([e.slice(0,t).join(` `),e.slice(t).join(` `)]);if(e.length>=3&&t>=3)for(let t=1;t<e.length-1;t++)for(let r=t+1;r<e.length;r++)n.push([e.slice(0,t).join(` `),e.slice(t,r).join(` `),e.slice(r).join(` `)]);return n}function W(e,t,n,r){let i=e.split(/\s+/).filter(Boolean),a={size:0,lines:[e]};for(let o of U(i.length>0?i:[e])){let e=Math.max(...o.map(r),1),i=R.width*t*100/e,s=R.height*n/(o.length*z),c=Math.min(i,s);c>a.size&&(a={size:c,lines:o})}return a}function ee(e,t,n){if(typeof document>`u`)return;let r=document.createElement(`canvas`);r.width=Math.max(2,Math.round(t)),r.height=Math.max(2,Math.round(n));let i=r.getContext(`2d`);if(!i)return;let a=r.width,o=r.height,s=i.createLinearGradient(0,0,a,o);s.addColorStop(0,B[0]),s.addColorStop(.55,B[1]),s.addColorStop(1,B[2]),i.fillStyle=s,i.fillRect(0,0,a,o);let c=Math.max(12,Math.round(o/14));i.strokeStyle=`rgba(255,255,255,0.09)`,i.lineWidth=Math.max(1,o/540),i.beginPath();for(let e=c/2;e<o;e+=c)i.moveTo(0,e),i.lineTo(a,e);i.stroke(),i.fillStyle=`rgba(255,255,255,0.14)`;let l=Math.max(1.2,o/380);for(let e=c/2;e<a;e+=c*2)for(let t=c/2;t<o;t+=c*2)i.fillRect(e-l/2,t-l/2,l,l);let u=e=>`800 ${e}px ${L}`;i.font=u(100);let d=W(e,a,o,e=>i.measureText(e).width);i.font=u(d.size),i.textAlign=`center`,i.textBaseline=`alphabetic`;let f=d.size*z,p=f*d.lines.length,m=(o-p)/2;i.fillStyle=V,d.lines.forEach((e,t)=>{i.fillText(e,a/2,m+f*(t+.8))}),i.fillStyle=H;let h=Math.min(o-d.size*.3,m+p+d.size*.12);return i.fillRect(a/2-d.size*.9,h,d.size*1.8,Math.max(3,d.size*.06)),i.font=`600 ${Math.max(11,d.size*.16)}px ${L}`,i.fillStyle=`rgba(255,244,222,0.85)`,i.fillText(`drag across the type`,a/2,h+Math.max(20,d.size*.3)),r}var G=[`image`,`video`,`headline`],K=[`cover`,`contain`],q=[`64`,`96`,`128`,`192`],te=[`wall`,`open`],J=[`hover and press`,`press only`,`hover only`,`off`],Y=[`scrolls the page`,`stirs the content`],X=[`content`,`displacement`,`grid`,`velocity`],ne={width:640,height:360},Z=16,re=.2,ie=r(`SceneParams`,{aspect:`f32`,aa:`f32`});function ae(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}var Q=t({meta:e,params:{source:{type:`select`,default:`image`,options:G,label:`Content (or drop a file on the canvas)`},headline:{type:`select`,default:I[0],options:I,label:`Headline`},fit:{type:`select`,default:`cover`,options:K,label:`Image fit`},relaxation:{type:`number`,default:1,min:0,max:8,step:.01,label:`Spring back (1 / s; 0 = a smear is permanent, like paint)`},maxDisplacement:{type:`number`,default:.4,min:.05,max:1,step:.01,label:`Largest displacement (canvas heights)`},radius:{type:`number`,default:.07,min:.015,max:.25,step:.001,label:`Stir radius (canvas heights)`},force:{type:`number`,default:.8,min:0,max:3,step:.01,label:`Push (fraction of pointer velocity)`},viscosity:{type:`number`,default:5e-4,min:0,max:.01,step:1e-4,label:`Viscosity (heights² / s; smooths the smear)`},velocityDissipation:{type:`number`,default:1.2,min:0,max:6,step:.01,label:`Flow dissipation (1 / s; how long a push keeps going)`},vorticity:{type:`number`,default:5,min:0,max:30,step:.5,label:`Vorticity confinement (swirl)`},boundary:{type:`select`,default:`wall`,options:te,label:`Edges`},chroma:{type:`number`,default:.25,min:0,max:1,step:.01,label:`Chromatic split (follows the stretch)`},sheen:{type:`number`,default:.35,min:0,max:1,step:.01,label:`Liquid sheen`},ambient:{type:`number`,default:.5,min:0,max:1,step:.01,label:`Idle stir (needs spring back > 0)`},calm:{type:`number`,default:.8,min:0,max:1,step:.01,label:`Quiet down while touched`},pointer:{type:`select`,default:`hover and press`,options:J},touch:{type:`select`,default:`scrolls the page`,options:Y,label:`Touch drags`},resolution:{type:`select`,default:`96`,options:q,label:`Fluid cells (short side; re-creates the fluid)`},view:{type:`select`,default:`content`,options:X,label:`View`},debugGain:{type:`number`,default:1,min:.1,max:10,step:.1,label:`Debug view gain`},stepsPerFrame:{type:`number`,default:0,min:0,max:32,step:1,label:`Steps per frame (0 = by clock; for benchmarks)`}},presets:{"wet paint":{source:`image`,relaxation:0,maxDisplacement:.6,radius:.06,force:.9,viscosity:8e-4,velocityDissipation:1.6,vorticity:4,chroma:.1,sheen:.55,ambient:0},jelly:{source:`image`,relaxation:4.5,maxDisplacement:.3,radius:.1,force:1.3,viscosity:3e-4,velocityDissipation:.4,vorticity:0,chroma:.15,sheen:.25,ambient:.35},"liquid headline":{source:`headline`,relaxation:1.1,maxDisplacement:.4,radius:.07,force:.85,viscosity:5e-4,velocityDissipation:1.2,vorticity:5,chroma:.3,sheen:.4,ambient:.5},"smeared video":{source:`video`,relaxation:.5,maxDisplacement:.5,radius:.08,force:1,viscosity:6e-4,velocityDissipation:1,vorticity:6,chroma:.35,sheen:.3,ambient:.3}},async create({device:e,format:t,canvas:n,params:r,profiler:h}){let b=a(n),x=d(),S=ae(14972),C=typeof matchMedia==`function`&&matchMedia(`(prefers-reduced-motion: reduce)`).matches,w=F({device:e,format:t,label:`fluid-warp view`}),T=Math.max(1,n.width||1),E=Math.max(1,n.height||1),D=T/E,O=(e,t)=>Math.round(e*Math.max(t,1/t)),k=u({device:e,resolution:O(Number(r.resolution),D),dyeResolution:Z,width:T,height:E,profiler:h,label:`fluid-warp`,params:{dyeScheme:`semi-lagrangian`,dyeDissipation:0,pressureIterations:24}}),A=N({device:e,fluid:k,scale:2,params:{relaxation:r.relaxation},profiler:h,label:`fluid-warp`});A.attach();let j=!1,M,P=``,I,L=!1,R=!1,z=`${r.source}:${r.headline}`,B=0,V=0;function H(){let{width:t,height:n}=ne,r=e.createTexture({label:`fluid-warp procedural picture`,size:[t,n],format:`rgba8unorm-srgb`,mipLevelCount:c(t,n),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),a=i(e,ie,`fluid-warp scene params`);a.set({aspect:t/n,aa:1/n}),a.upload();let u=s(e,{fragment:{label:`media-distortion/scene.wgsl`,code:y},format:`rgba8unorm-srgb`}),d=e.createBindGroup({layout:u.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:a.buffer}}]}),f=e.createCommandEncoder({label:`fluid-warp procedural picture`});return o(f,r.createView({baseMipLevel:0,mipLevelCount:1}),u,[d]),l(e,r,f),e.queue.submit([f.finish()]),_(r,()=>a.destroy())}let U=()=>`headline:${r.headline}:${T}x${E}`,W=()=>r.source===`headline`?U():r.source;async function G(t){if(t===`video`){let t=await v().catch(()=>void 0);if(t)try{let n=await f(e,t.video,{label:`fluid-warp live video`,onDestroy:()=>t.destroy()});return I=t,n}catch(e){t.destroy(),console.warn(`fluid-warp: the live video could not be used`,e)}}if(t.startsWith(`headline`)){let t=ee(r.headline,T,E);if(t)return f(e,t,{label:`fluid-warp headline`,mipmaps:!1})}else{let t=m();if(t)return f(e,t,{label:`fluid-warp harbour`})}return H()}function K(e,t){if(j){e.destroy();return}let n=M;M=e,P=t,t!==`video`&&(I=void 0),n?.destroy()}async function q(e){if(!L){L=!0;try{K(await G(e),e)}catch(t){console.warn(`fluid-warp: could not load the content`,t),P=e}finally{L=!1}}}async function te(t){if(!g(t))console.warn(`fluid-warp: ${t.name||`that file`} is not an image or a video`);else try{let n=await p(e,t);R=!0,K(n,`file:${t.name}`)}catch(e){console.warn(`fluid-warp: could not use the dropped file`,e)}}let J=e=>e.dataTransfer?.types.includes(`Files`)??!1,Y=new AbortController,{signal:X}=Y;n.addEventListener(`dragover`,e=>{J(e)&&e.preventDefault()},{signal:X}),n.addEventListener(`drop`,e=>{e.preventDefault();let t=e.dataTransfer?.files[0];t&&te(t)},{signal:X});{let e=W();K(await G(e),e)}let Q={phase:S()*100,last:void 0},$=0;function oe(e,t){let n=Math.min(1,r.relaxation/.6),i=r.ambient*n*(1-r.calm*$)*(C?.3:1);Q.phase+=Math.min(Math.max(e,1/240),.1);let a=[.5+.38*Math.sin(Q.phase*.43)*Math.cos(Q.phase*.11),.5+.34*Math.sin(Q.phase*.61+1.3)],o=Q.last;if(Q.last=a,!o||i<.01)return;let s=(a[0]-o[0])*t,c=a[1]-o[1],l=Math.hypot(s,c);if(l<1e-6)return;let u=.1*i,d=r.radius*.5;k.addForce(o,a,r.radius*1.3,[s/l*u,c/l*u],d)}function se(){let e=k.params;e.velocityScheme=`maccormack`,e.vorticity=r.vorticity,e.viscosity=r.viscosity,e.velocityDissipation=r.velocityDissipation,e.boundary=r.boundary,A.params.relaxation=r.relaxation,A.params.maxDisplacement=r.maxDisplacement}return{resize(e,t){T=Math.max(1,Math.round(e)),E=Math.max(1,Math.round(t)),B=V;let n=T/E;Math.abs(Math.log(n/D))>.06&&(D=n,k.resize(T,E))},frame({delta:e,time:t},n,i){V=t,se();let a=T/E;k.setResolution(O(Number(r.resolution),D),Z);let o=`${r.source}:${r.headline}`;o!==z&&(z=o,R=!1);let s=W(),c=t-B>re||!M;!R&&s!==P&&!L&&(r.source!==`headline`||c)&&q(s),I?.tick(t),M?.update(n),b.setCapture(r.touch===`stirs the content`);let l=x.stir(k,b.poll(),a,e,{mode:r.pointer,radius:r.radius,force:r.force,dyeAmount:0,colour:()=>null});$+=(+!!l.active-$)*(1-Math.exp(-e*(l.active?5:.7))),oe(e,a),r.stepsPerFrame>0?k.advance(n,r.stepsPerFrame):k.update(n,e),M&&w.draw(n,i,{warp:A,content:M,fit:P.startsWith(`headline`)?`stretch`:r.fit,canvasSize:[T,E],bars:[.003,.012,.025],chroma:r.chroma*.12,sheen:r.sheen,view:r.view,debugGain:r.debugGain,fields:k.fieldsView,timestampWrites:h.pass(`shade`)})},destroy(){j=!0,Y.abort(),b.destroy(),A.destroy(),k.destroy(),w.destroy(),M?.destroy(),M=void 0}}}});export{Q as effect};