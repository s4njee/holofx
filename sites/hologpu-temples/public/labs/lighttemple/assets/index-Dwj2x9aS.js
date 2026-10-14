import{m as o,v as A}from"./wgpu-matrix.module-hZiCFRr9.js";import{T as pe,U as ue,f as me,c as he,H as y,P as Ce}from"./post-YOyvqv1Z.js";import{b as Ge}from"./brdf-DfmsPKoP.js";import{u as C,b as Le,M as Be,a as se,t as De,s as ze,p as Ue}from"./geometry-B-t91_OI.js";import{c as ve,w as ge}from"./surface-CPzQGKfE.js";import{O as Ie}from"./orbit-camera-COMcKYBF.js";import{h as j}from"./gallery-CAjxCs5g.js";const Ne=`// ---------------------------------------------------------------------------
// shadow.wgsl — shadow-map filtering for an orthographic (directional) light.
//
// Bind a depth texture + comparison sampler and call one of the filters with a
// light-space position \`lp\` = (uv.xy, depth). All taps use the *Level variant
// so they are legal in non-uniform control flow.
//
// Requires these bindings to be declared by the including shader:
//   var shadow_map: texture_depth_2d;
//   var shadow_cmp: sampler_comparison;
// ---------------------------------------------------------------------------

const POISSON_16 = array<vec2f, 16>(
  vec2f(-0.94201624, -0.39906216), vec2f(0.94558609, -0.76890725),
  vec2f(-0.09418410, -0.92938870), vec2f(0.34495938, 0.29387760),
  vec2f(-0.91588581, 0.45771432), vec2f(-0.81544232, -0.87912464),
  vec2f(-0.38277543, 0.27676845), vec2f(0.97484398, 0.75648379),
  vec2f(0.44323325, -0.97511554), vec2f(0.53742981, -0.47373420),
  vec2f(-0.26496911, -0.41893023), vec2f(0.79197514, 0.19090188),
  vec2f(-0.24188840, 0.99706507), vec2f(-0.81409955, 0.91437590),
  vec2f(0.19984126, 0.78641367), vec2f(0.14383161, -0.14100790),
);

fn shadow_in_bounds(lp: vec3f) -> bool {
  return all(lp.xy >= vec2f(0.0)) && all(lp.xy <= vec2f(1.0)) && lp.z <= 1.0;
}

/// Single hardware comparison (with linear comparison sampler this is 2x2 bilinear PCF).
fn shadow_hard(lp: vec3f) -> f32 {
  return textureSampleCompareLevel(shadow_map, shadow_cmp, lp.xy, lp.z);
}

/// (2r+1)^2 grid of bilinear comparison taps, spaced one texel apart.
fn shadow_pcf_grid(lp: vec3f, texel: f32, r: i32) -> f32 {
  var sum = 0.0;
  for (var y = -r; y <= r; y++) {
    for (var x = -r; x <= r; x++) {
      sum += textureSampleCompareLevel(shadow_map, shadow_cmp, lp.xy + vec2f(f32(x), f32(y)) * texel, lp.z);
    }
  }
  let n = f32(2 * r + 1);
  return sum / (n * n);
}

/// 16 Poisson taps in a disc of \`radius_uv\`, rotated per pixel by \`angle\`.
/// Trades banding for fine noise (which grain/TAA hide well).
fn shadow_poisson(lp: vec3f, radius_uv: f32, angle: f32) -> f32 {
  let c = cos(angle); let s = sin(angle);
  let rot = mat2x2f(c, s, -s, c);
  var disk = POISSON_16;
  var sum = 0.0;
  for (var i = 0; i < 16; i++) {
    sum += textureSampleCompareLevel(shadow_map, shadow_cmp, lp.xy + rot * disk[i] * radius_uv, lp.z);
  }
  return sum / 16.0;
}

/// Percentage-closer soft shadows (Fernando 2005) for an orthographic light.
///   light_tan:    tangent of the light's angular radius (sun ≈ 0.0046)
///   depth_range:  world-space distance covered by depth 0..1
///   world_to_uv:  1 / (world width of the shadow frustum)
fn shadow_pcss(lp: vec3f, texel: f32, light_tan: f32, depth_range: f32, world_to_uv: f32, angle: f32) -> f32 {
  let c = cos(angle); let s = sin(angle);
  let rot = mat2x2f(c, s, -s, c);
  var disk = POISSON_16;
  let dims = vec2f(textureDimensions(shadow_map));

  // 1. Blocker search: the region of the map that could hold occluders for this receiver.
  let search_uv = clamp(light_tan * lp.z * depth_range * world_to_uv, 2.0 * texel, 48.0 * texel);
  var blocker_sum = 0.0;
  var blockers = 0.0;
  for (var i = 0; i < 16; i++) {
    let uv = lp.xy + rot * disk[i] * search_uv;
    let px = clamp(vec2i(uv * dims), vec2i(0), vec2i(dims) - 1);
    let d = textureLoad(shadow_map, px, 0);
    if (d < lp.z) {
      blocker_sum += d;
      blockers += 1.0;
    }
  }
  if (blockers == 0.0) { return 1.0; }
  let avg_blocker = blocker_sum / blockers;

  // 2. Penumbra width from similar triangles; for a directional light it is
  //    proportional to the receiver–blocker distance only.
  let penumbra_uv = light_tan * (lp.z - avg_blocker) * depth_range * world_to_uv;
  let radius = clamp(penumbra_uv, texel, 64.0 * texel);

  // 3. Filter with that radius.
  return shadow_poisson(lp, radius, angle);
}
`,Fe=`// ---------------------------------------------------------------------------
// taa.wgsl — temporal anti-aliasing / accumulation resolve.
//
//  1. Reproject: reconstruct each pixel's world position from depth (using the
//     closest depth in a 3x3 block, so edges of near objects win) and project
//     it with last frame's view-projection. Handles camera motion; object
//     motion is left to the neighbourhood clip (no velocity buffer yet).
//  2. Sample history with a 9-tap Catmull-Rom filter (sharper than bilinear,
//     so repeated resampling doesn't blur the image).
//  3. Clip history toward the current 3x3 neighbourhood's colour distribution
//     (variance clipping in YCoCg) to reject stale or disoccluded history.
//  4. Blend in a Karis "luma-weighted" space so bright HDR pixels don't flicker.
//
// Requires (prepended): common.wgsl, fullscreen.wgsl, the \`Taa\` struct.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var cur_tex: texture_2d<f32>;
@group(0) @binding(1) var hist_tex: texture_2d<f32>;
@group(0) @binding(2) var depth_tex: texture_depth_2d;
@group(0) @binding(3) var lin: sampler;
@group(0) @binding(4) var<uniform> taa: Taa;

fn rgb_to_ycocg(c: vec3f) -> vec3f {
  return vec3f(
    dot(c, vec3f(0.25, 0.5, 0.25)),
    dot(c, vec3f(0.5, 0.0, -0.5)),
    dot(c, vec3f(-0.25, 0.5, -0.25)));
}

fn ycocg_to_rgb(c: vec3f) -> vec3f {
  return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

// Reversible luma weighting (Karis 2014): compresses HDR before blending.
fn karis_fwd(c: vec3f) -> vec3f { return c / (1.0 + luminance(c)); }
fn karis_inv(c: vec3f) -> vec3f { return c / max(1.0 - luminance(c), 1e-4); }

fn sample_catmull_rom(uv: vec2f, size: vec2f) -> vec4f {
  let sample_pos = uv * size;
  let tex_pos1 = floor(sample_pos - 0.5) + 0.5;
  let f = sample_pos - tex_pos1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let offset12 = w2 / w12;
  let p0 = (tex_pos1 - 1.0) / size;
  let p3 = (tex_pos1 + 2.0) / size;
  let p12 = (tex_pos1 + offset12) / size;

  var r = vec4f(0.0);
  r += textureSampleLevel(hist_tex, lin, vec2f(p0.x, p0.y), 0.0) * w0.x * w0.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p12.x, p0.y), 0.0) * w12.x * w0.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p3.x, p0.y), 0.0) * w3.x * w0.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p0.x, p12.y), 0.0) * w0.x * w12.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p12.x, p12.y), 0.0) * w12.x * w12.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p3.x, p12.y), 0.0) * w3.x * w12.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p0.x, p3.y), 0.0) * w0.x * w3.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p12.x, p3.y), 0.0) * w12.x * w3.y;
  r += textureSampleLevel(hist_tex, lin, vec2f(p3.x, p3.y), 0.0) * w3.x * w3.y;
  return max(r, vec4f(0.0));
}

// Clip \`h\` toward the centre of the AABB [lo, hi] (cheaper and less "boxy"
// than a per-channel clamp; Playdead/INSIDE style).
fn clip_aabb(lo: vec3f, hi: vec3f, h: vec3f) -> vec3f {
  let center = 0.5 * (hi + lo);
  let extents = 0.5 * (hi - lo) + 1e-5;
  let v = h - center;
  let unit = abs(v / extents);
  let m = max(unit.x, max(unit.y, unit.z));
  return select(h, center + v / m, m > 1.0);
}

@fragment
fn fs_resolve(v: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(cur_tex));
  let px = vec2i(v.position.xy);
  let cur = textureLoad(cur_tex, px, 0);
  let c = rgb_to_ycocg(karis_fwd(cur.rgb));

  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var closest = 1.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(px + vec2i(x, y), vec2i(0), dims - 1);
      let s = rgb_to_ycocg(karis_fwd(textureLoad(cur_tex, q, 0).rgb));
      m1 += s;
      m2 += s * s;
      closest = min(closest, textureLoad(depth_tex, q, 0));
    }
  }
  let mean = m1 / 9.0;
  let sigma = sqrt(abs(m2 / 9.0 - mean * mean));

  if (taa.historyValid == 0u) { return cur; }

  // Reproject with the (unjittered) matrices.
  let uv = v.position.xy / vec2f(dims);
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, closest, 1.0);
  let world = taa.invViewProj * ndc;
  let prev_clip = taa.prevViewProj * vec4f(world.xyz / world.w, 1.0);
  let prev_uv = vec2f(prev_clip.x / prev_clip.w * 0.5 + 0.5, 0.5 - prev_clip.y / prev_clip.w * 0.5);
  if (any(prev_uv < vec2f(0.0)) || any(prev_uv > vec2f(1.0))) { return cur; }

  let hist = sample_catmull_rom(prev_uv, vec2f(dims));
  let h = clip_aabb(mean - taa.gamma * sigma, mean + taa.gamma * sigma, rgb_to_ycocg(karis_fwd(hist.rgb)));

  // Trust history less while things move fast (less smearing, slightly more aliasing).
  let motion_px = length((prev_uv - uv) * vec2f(dims));
  let feedback = mix(taa.feedback, taa.feedback * 0.8, saturate(motion_px / 4.0));
  let rgb = karis_inv(ycocg_to_rgb(mix(c, h, feedback)));
  let a = mix(cur.a, hist.a, feedback);
  return vec4f(max(rgb, vec3f(0.0)), a);
}
`,He={invViewProj:"mat4x4f",prevViewProj:"mat4x4f",feedback:"f32",gamma:"f32",historyValid:"u32"};function ie(k,e){let n=1,t=0;for(let a=k;a>0;a=Math.floor(a/e))n/=e,t+=n*(a%e);return t}const We=16;class H{constructor(e,n,t){this.device=e,this.pipeline=n,this.targets=new pe(e),this.uniforms=t,this.sampler=e.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})}device;pipeline;feedback=.9;gamma=1.25;frame=0;prevViewProj=null;historyIndex=0;historyKey="";targets;uniforms;sampler;bindGroups=new WeakMap;static async create(e){const n=new ue(e,"Taa",He),t=await ve(e,"taa",ge(he,me,n.wgslStruct,Fe)),a=await e.createRenderPipelineAsync({label:"taa-resolve",layout:"auto",vertex:{module:t,entryPoint:"vs_fullscreen"},fragment:{module:t,entryPoint:"fs_resolve",targets:[{format:y}]}});return new H(e,a,n)}get jitterPixels(){const e=this.frame%We+1;return[ie(e,2)-.5,ie(e,3)-.5]}get frameNoiseOffset(){return this.frame%64*5.588238}jitter(e,n){const[t,a]=this.jitterPixels,i=o.translation([2*t/n.width,-2*a/n.height,0]);return o.multiply(i,e)}reset(){this.prevViewProj=null}resolve(e,n){const{color:t,depth:a,viewProj:i}=n,c=[t.width,t.height],s=`${t.width}x${t.height}`;s!==this.historyKey&&(this.historyKey=s,this.prevViewProj=null);const _=this.targets.get(`history${this.historyIndex}`,{size:c,format:y}),p=this.targets.get(`history${1-this.historyIndex}`,{size:c,format:y});this.uniforms.set("invViewProj",o.inverse(i)).set("prevViewProj",this.prevViewProj??i).set("feedback",this.feedback).set("gamma",this.gamma).set("historyValid",this.prevViewProj?1:0).upload();const l=e.beginRenderPass({label:"taa-resolve",colorAttachments:[{view:p.view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,0]}]});return l.setPipeline(this.pipeline),l.setBindGroup(0,this.bindGroup(t,_.texture,a)),l.draw(3),l.end(),this.prevViewProj=o.clone(i),this.historyIndex=1-this.historyIndex,this.frame++,p.texture}bindGroup(e,n,t){let a=this.bindGroups.get(e);a||this.bindGroups.set(e,a=new Map);const i=a.get(n);if(i?.depth===t)return i.group;const c=this.device.createBindGroup({label:"taa-resolve",layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:e.createView()},{binding:1,resource:n.createView()},{binding:2,resource:t.createView()},{binding:3,resource:this.sampler},{binding:4,resource:{buffer:this.uniforms.buffer}}]});return a.set(n,{depth:t,group:c}),c}destroy(){this.targets.destroy(),this.uniforms.destroy()}}const qe=`// ---------------------------------------------------------------------------
// Directional-light shadow mapping with switchable filters.
// Outputs premultiplied linear HDR (alpha = coverage) into the post chain.
// Requires (prepended): common.wgsl, fullscreen.wgsl, VertexIn, the \`Frame\`
// struct, shadow.wgsl and brdf.wgsl.
// ---------------------------------------------------------------------------

struct Object {
  model: mat4x4f,
  // rgb = albedo (linear), a = perceptual roughness
  color: vec4f,
  // x = metallic
  material: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> objects: array<Object>;
@group(0) @binding(2) var shadow_map: texture_depth_2d;
@group(0) @binding(3) var shadow_cmp: sampler_comparison;

// --- Shadow (depth-only) pass ----------------------------------------------

@vertex
fn vs_shadow(v: VertexIn, @builtin(instance_index) id: u32) -> @builtin(position) vec4f {
  return frame.lightViewProj * objects[id].model * vec4f(v.position, 1.0);
}

// --- Main pass ---------------------------------------------------------------

struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) world_pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) id: u32,
};

@vertex
fn vs_main(v: VertexIn, @builtin(instance_index) id: u32) -> VsOut {
  let m = objects[id].model;
  let wp = m * vec4f(v.position, 1.0);
  var out: VsOut;
  out.position = frame.viewProj * wp;
  out.world_pos = wp.xyz;
  // Objects use uniform scale, so the upper 3x3 is fine for normals.
  out.normal = normalize((m * vec4f(v.normal, 0.0)).xyz);
  out.id = id;
  return out;
}

fn light_space(world_pos: vec3f, n: vec3f, ndl: f32) -> vec3f {
  // Normal-offset bias: push the lookup along the normal, more at grazing angles.
  let offset = n * frame.normalOffset * frame.shadowTexelWorld * (1.0 - ndl * 0.5);
  let clip = frame.lightViewProj * vec4f(world_pos + offset, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z - frame.depthBias);
}

fn sample_shadow(lp: vec3f, frag: vec2f) -> f32 {
  if (!shadow_in_bounds(lp)) { return 1.0; }
  let texel = 1.0 / f32(textureDimensions(shadow_map).x);
  // Rotating the noise per frame lets TAA integrate it into a smooth result.
  let angle = ign(frag + frame.noiseOffset) * TAU;
  let world_to_uv = 1.0 / (2.0 * frame.shadowExtent);
  switch frame.shadowMode {
    case 0u: { return 1.0; }
    case 1u: { return shadow_hard(lp); }
    case 2u: { return shadow_pcf_grid(lp, texel, i32(frame.pcfRadius)); }
    case 3u: { return shadow_poisson(lp, frame.pcfRadius * texel * 1.5, angle); }
    default: { return shadow_pcss(lp, texel, frame.lightTan, frame.shadowDepthRange, world_to_uv, angle); }
  }
}

@fragment
fn fs_main(v: VsOut) -> @location(0) vec4f {
  let obj = objects[v.id];
  let n = normalize(v.normal);
  let l = -frame.lightDir;
  let vdir = normalize(frame.cameraPos - v.world_pos);
  let ndl = saturate(dot(n, l));

  let lp = light_space(v.world_pos, n, ndl);
  var vis = sample_shadow(lp, v.position.xy);
  // Terminator fix: fade shadow lookups on surfaces facing away from the light
  // (they are already dark from N·L, and filtering there only adds acne).
  vis *= smoothstep(0.0, 0.08, ndl);

  let m = Material(obj.color.rgb, obj.color.a, obj.material.x);

  // Hemisphere "environment": sky from above, bounce from the ground below.
  // Diffuse uses the normal; specular uses the reflection vector, softened
  // with roughness, through the split-sum approximation.
  let irradiance = mix(frame.groundColor.rgb, frame.skyColor.rgb, n.y * 0.5 + 0.5);
  let r = reflect(-vdir, n);
  let edge = mix(0.05, 0.8, m.roughness);
  let env = mix(frame.groundColor.rgb, frame.skyColor.rgb, smoothstep(-edge, edge, r.y));
  var col = brdf_ambient(m, n, vdir, irradiance, env) + frame.lightColor.rgb * vis * brdf_direct(m, n, vdir, l);

  if (frame.debugView == 1u) { col = vec3f(vis); }
  if (frame.debugView == 2u) {
    // Light-space depth & out-of-frustum regions.
    col = select(vec3f(0.6, 0.1, 0.1), vec3f(lp.z), shadow_in_bounds(lp));
  }

  // Coverage alpha: the floor fades out radially, and the post chain composites
  // it over the page background *after* tonemapping, so the two match exactly
  // and the floor melts away with no seam. Props in the middle stay opaque.
  let fade = select(0.0, smoothstep(frame.fadeStart, frame.fadeEnd, length(v.world_pos.xz)), frame.debugView == 0u);
  let coverage = 1.0 - fade;
  return vec4f(col * coverage, coverage);
}

// --- Debug overlay: the raw shadow map in a corner ------------------------

@fragment
fn fs_overlay(v: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(shadow_map));
  let d = textureLoad(shadow_map, vec2i(v.uv * dims), 0);
  // Stretch contrast: most of the scene lives in a narrow depth band.
  return vec4f(vec3f(pow(saturate(d), 6.0)), 1.0);
}
`,le=4,F="depth24plus",ce="depth32float",x=5.5,de=20,fe=96,et=async k=>{const{device:e,surface:n,params:t,reducedMotion:a}=k,i=t.add({azimuth:{value:35,min:-180,max:180,step:1},elevation:{value:42,min:5,max:89,step:1},intensity:{value:3.2,min:0,max:10,step:.05},color:{value:"#fff1de",type:"color"},orbitLight:{value:!a,label:"Orbit light"}},"Sun"),c=t.add({mode:{value:4,options:{Off:0,"Hard (2×2 HW)":1,"PCF grid":2,"Poisson disc":3,PCSS:4}},mapSize:{value:2048,options:{512:512,1024:1024,2048:2048,4096:4096},label:"Map size"},pcfRadius:{value:2,min:0,max:6,step:1,label:"PCF radius",hint:"Kernel radius in texels (PCF grid & Poisson)."},lightSize:{value:2.5,min:.1,max:12,step:.1,label:"Sun size (°)",hint:"Angular diameter used by PCSS. The real sun is ~0.53°."},depthBias:{value:6e-4,min:0,max:.01,step:1e-4,label:"Depth bias"},normalOffset:{value:1.5,min:0,max:6,step:.1,label:"Normal offset",hint:"In shadow-map texels."}},"Shadows"),s=t.add({background:{value:"#c9c5bf",type:"color",hint:"Page colour the floor fades into (display space, matched exactly)."},sky:{value:"#a9bcd6",type:"color"},ground:{value:"#6b5d52",type:"color"},ambient:{value:.28,min:0,max:1.5,step:.01},antialiasing:{value:"msaa",options:{"MSAA 4×":"msaa",TAA:"taa",Off:"off"},hint:"TAA also accumulates the per-pixel Poisson/PCSS noise over frames, so soft shadows come out smooth."},view:{value:0,options:{Lit:0,Visibility:1,"Light depth":2}},showMap:{value:!1,label:"Show shadow map"},animate:{value:!a}},"Look & debug"),_=await Ce.create(k,{bloom:.02,vignette:.12,grain:.02}),p=await H.create(e),l={ground:C(e,Ue(60,1),"ground"),box:C(e,Le(1,1,1),"box"),sphere:C(e,ze(1,64,40),"sphere"),torus:C(e,De(.8,.26,40,128),"torus")},m=(r,T,d)=>o.translation([r,T,d]),G=[{mesh:l.ground,color:"#d8cfc4",roughness:.9,transform:()=>o.identity()},{mesh:l.torus,color:"#f2b08a",roughness:.32,metallic:1,transform:r=>o.rotateX(o.rotateY(m(0,1.15,0),r*.35),Math.PI/2)},{mesh:l.sphere,color:"#c95f4b",roughness:.45,transform:()=>o.scale(m(-1.9,.6,.9),[.6,.6,.6])},{mesh:l.sphere,color:"#e8e2d6",roughness:.65,transform:()=>o.scale(m(-.7,.35,2.1),[.35,.35,.35])},{mesh:l.sphere,color:"#7e9cc4",roughness:.15,transform:r=>o.scale(m(.4,2.4+.25*Math.sin(r*.8),-1.9),[.38,.38,.38])},{mesh:l.box,color:"#a9b49f",roughness:.8,transform:()=>o.scale(m(1.9,1.1,-.8),[.6,2.2,.6])},{mesh:l.box,color:"#3f4a5c",roughness:.5,transform:()=>o.scale(o.rotateY(m(1.7,.2,1.5),.6),[1.2,.4,1.2])},{mesh:l.box,color:"#9a9ca3",roughness:.35,metallic:1,transform:()=>o.scale(m(-1.7,1.5,-1.6),[.07,3,.07])}],E=new Float32Array(G.length*fe/4),M=e.createBuffer({label:"objects",size:E.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),P=new ue(e,"Frame",{viewProj:"mat4x4f",lightViewProj:"mat4x4f",cameraPos:"vec3f",fadeStart:"f32",lightDir:"vec3f",shadowMode:"u32",lightColor:"vec4f",skyColor:"vec4f",groundColor:"vec4f",fadeEnd:"f32",pcfRadius:"f32",lightTan:"f32",shadowExtent:"f32",shadowDepthRange:"f32",shadowTexelWorld:"f32",depthBias:"f32",normalOffset:"f32",debugView:"u32",noiseOffset:"f32"}),S=await ve(e,"shadow-map-pcf",ge(he,me,Be,P.wgslStruct,Ne,Ge,qe)),W=e.createBindGroupLayout({label:"shadow-map-pcf",entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"depth"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"comparison"}}]}),q=e.createPipelineLayout({bindGroupLayouts:[W]}),X=e.createBindGroupLayout({label:"shadow-pass",entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}}]}),$=r=>Promise.all([e.createRenderPipelineAsync({label:`main-pass-x${r}`,layout:q,vertex:{module:S,entryPoint:"vs_main",buffers:[se]},fragment:{module:S,entryPoint:"fs_main",targets:[{format:y}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:F,depthWriteEnabled:!0,depthCompare:"less"},multisample:{count:r}}),e.createRenderPipelineAsync({label:`shadow-overlay-x${r}`,layout:q,vertex:{module:S,entryPoint:"vs_fullscreen"},fragment:{module:S,entryPoint:"fs_overlay",targets:[{format:y}]},depthStencil:{format:F,depthWriteEnabled:!1,depthCompare:"always"},multisample:{count:r}})]),[we,be,xe]=await Promise.all([e.createRenderPipelineAsync({label:"shadow-pass",layout:e.createPipelineLayout({bindGroupLayouts:[X]}),vertex:{module:S,entryPoint:"vs_shadow",buffers:[se]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:ce,depthWriteEnabled:!0,depthCompare:"less"}}),$(le),$(1)]),ye=e.createSampler({label:"shadow-compare",compare:"less-equal",magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),_e=e.createBindGroup({layout:X,entries:[{binding:0,resource:{buffer:P.buffer}},{binding:1,resource:{buffer:M}}]});let v=null,K=null;const Pe=r=>{v?.width!==r&&(v?.destroy(),v=e.createTexture({label:"shadow-map",size:[r,r],format:ce,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),K=e.createBindGroup({layout:W,entries:[{binding:0,resource:{buffer:P.buffer}},{binding:1,resource:{buffer:M}},{binding:2,resource:v.createView()},{binding:3,resource:ye}]}))},L=new pe(e),g=new Ie(n.canvas,{target:[0,.9,0],distance:9.5,yaw:.75,pitch:.42,maxDistance:25});let Y=0,J=0;return{frame({time:r,dt:T,size:d}){s.animate&&(Y+=T),i.orbitLight&&(J+=T*.15),g.update(T,d.width/d.height),Pe(c.mapSize);const Q=[d.width,d.height],w=s.antialiasing,b=w==="msaa"?le:1,[Se,Te]=b>1?be:xe,B=_.scene(d),Z=b>1?L.get("msaa",{size:Q,format:y,sampleCount:b}):null,ee=L.get(`depth-x${b}`,{size:Q,format:F,sampleCount:b,usage:b>1?GPUTextureUsage.RENDER_ATTACHMENT:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});w!=="taa"&&p.reset();const Ve=w==="taa"?p.jitter(g.viewProjection,d):g.viewProjection;G.forEach((f,u)=>{const O=u*fe/4;E.set(f.transform(Y),O),E.set([...j(f.color),f.roughness,f.metallic??0,0,0,0],O+16)}),e.queue.writeBuffer(M,0,E);const te=i.azimuth*Math.PI/180+J,D=i.elevation*Math.PI/180,z=A.fromValues(Math.cos(D)*Math.sin(te),Math.sin(D),Math.cos(D)*Math.cos(te)),ne=A.fromValues(0,1,0),je=A.addScaled(ne,z,de),ke=Math.abs(z[1])>.99?[0,0,1]:[0,1,0],Ee=o.lookAt(je,ne,ke),ae=1,re=de*2,Me=o.ortho(-x,x,-x,x,ae,re),Re=o.multiply(Me,Ee),U=j(i.color),I=j(s.sky),N=j(s.ground),Oe=j(s.background);P.set("viewProj",Ve).set("lightViewProj",Re).set("cameraPos",g.position).set("lightDir",A.negate(z)).set("shadowMode",c.mode).set("lightColor",[U[0]*i.intensity,U[1]*i.intensity,U[2]*i.intensity,0]).set("skyColor",[I[0]*s.ambient,I[1]*s.ambient,I[2]*s.ambient,0]).set("groundColor",[N[0]*s.ambient,N[1]*s.ambient,N[2]*s.ambient,0]).set("fadeStart",6).set("fadeEnd",22).set("pcfRadius",c.pcfRadius).set("lightTan",Math.tan(c.lightSize/2*Math.PI/180)).set("shadowExtent",x).set("shadowDepthRange",re-ae).set("shadowTexelWorld",2*x/c.mapSize).set("depthBias",c.depthBias).set("normalOffset",c.normalOffset).set("debugView",s.view).set("noiseOffset",w==="taa"?p.frameNoiseOffset:0).upload();const V=e.createCommandEncoder({label:"shadow-map-pcf"}),oe=f=>{G.forEach((u,O)=>{f.setVertexBuffer(0,u.mesh.vertexBuffer),f.setIndexBuffer(u.mesh.indexBuffer,"uint32"),f.drawIndexed(u.mesh.indexCount,1,0,0,O)})},R=V.beginRenderPass({label:"shadow-pass",colorAttachments:[],depthStencilAttachment:{view:v.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});R.setPipeline(we),R.setBindGroup(0,_e),oe(R),R.end();const h=V.beginRenderPass({label:"main-pass",colorAttachments:[Z?{view:Z.view,resolveTarget:B.view,loadOp:"clear",storeOp:"discard",clearValue:[0,0,0,0]}:{view:B.view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,0]}],depthStencilAttachment:{view:ee.view,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:w==="taa"?"store":"discard"}});if(h.setPipeline(Se),h.setBindGroup(0,K),oe(h),s.showMap){const f=Math.round(Math.min(d.width,d.height)*.3),u=Math.round(16*d.pixelRatio);h.setViewport(u,d.height-f-u,f,f,0,1),h.setPipeline(Te),h.draw(3)}h.end();const Ae=w==="taa"?p.resolve(V,{color:B.texture,depth:ee.texture,viewProj:g.viewProjection}):void 0;_.render(V,n.currentTexture().createView(),{time:r,raw:s.view!==0,background:Oe,source:Ae}),e.queue.submit([V.finish()])},dispose(){g.destroy(),v?.destroy(),L.destroy(),_.destroy(),p.destroy(),M.destroy(),P.destroy(),Object.values(l).forEach(r=>r.destroy())}}};export{et as default};
