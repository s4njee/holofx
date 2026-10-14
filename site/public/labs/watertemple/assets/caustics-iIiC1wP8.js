import{n as e}from"./profiler-Bi27xYp-.js";import{n as t,t as n}from"./uniforms-BE1XSnDx.js";import{t as r}from"./shader-Cd_FDUy8.js";import{r as i}from"./fullscreen-Dq3Mq0Js.js";import{t as a}from"./blur-DZ-nFY6j.js";import{t as o}from"./heightfield-vgiSDUqb.js";var s=`// caustics-core.wgsl -- the shared optics of the heightfield caustics solver (src/gpu/sim/caustics.ts):
// what a ray of sunlight does at the water surface and whether a ball is in its way. Included (as an
// effect-local chunk) by caustics-mesh.wgsl and caustics-jacobian.wgsl, after the generated
// \`caustics_params.wgsl\` (struct CausticsParams). Bindings, group 0:
//   0  P         uniform CausticsParams
//   1  hf_tex    rgba16float, filterable   the heightfield solver's output (height, velocity, slope x, slope y)
//   2  hf_samp   filtering sampler, clamp-to-edge
//
// FRAME. The frame of the heightfield (src/wgsl/heightfield.wgsl): x to the right and y DOWN in units
// of the IMAGE HEIGHT (so a point at uv has x = uv.x * aspect, y = uv.y), z UP out of the water, zero at
// the mean surface. The floor is the plane z = -depth. \`P.light\` is the unit vector TOWARD the light.
// Displacements and landing points are returned in uv (x already divided by the aspect).
//
// The surface at a point is the single filtered texel \`s\` of hf_tex: s.x is the height in cells (times
// P.cell_size = image heights), s.zw the slope. The normal is normalize(-strength * slope, 1).

#include "caustics_params.wgsl"
#include "fresnel.wgsl"

@group(0) @binding(0) var<uniform> P: CausticsParams;
@group(0) @binding(1) var hf_tex: texture_2d<f32>;
@group(0) @binding(2) var hf_samp: sampler;

// A surface tilted so far that the sun grazes it (cosine of the incidence below this) transmits
// nothing: the light is reflected instead. Such texels contribute no energy.
const CAUSTICS_MIN_COS: f32 = 0.05;
// Most one texel's radiometric factor may reach.
const CAUSTICS_MAX_WEIGHT: f32 = 4.0;

fn caustics_surface(uv: vec2f) -> vec4f {
  return textureSampleLevel(hf_tex, hf_samp, uv, 0.0);
}

struct CausticsTransmit {
  // Unit direction of the refracted ray, z < 0.
  dir: vec3f,
  // Power per unit of horizontal surface area, relative to a flat surface (1 = the same as flat).
  weight: f32,
}

// Refracts the sun through the surface texel \`s\` at index of refraction \`ior\`.
//
// \`weight\` is the radiometry of a tilted patch: a patch of horizontal area dA with normal n catches
// l.n / n.z times the light a flat one does (it faces the sun more or less), and passes the fraction
// 1 - F(l.n) of it (Fresnel), both relative to the flat surface so that a flat surface weighs exactly
// 1. It is 1 when radiometry is off. A texel the sun cannot enter weighs 0 and refracts as if flat,
// so that a mesh built from such texels stays connected.
fn caustics_transmit(s: vec4f, ior: f32) -> CausticsTransmit {
  let l = P.light;
  var n = normalize(vec3f(-s.zw * P.strength, 1.0));
  var cos_i = dot(l, n);
  var weight = 1.0;
  if (cos_i <= CAUSTICS_MIN_COS) {
    n = vec3f(0.0, 0.0, 1.0);
    cos_i = l.z;
    weight = 0.0;
  }
  var r = refract(-l, n, 1.0 / ior);
  if (r.z > -0.05) {
    r = refract(-l, vec3f(0.0, 0.0, 1.0), 1.0 / ior);
    weight = 0.0;
  }
  if (weight > 0.0 && P.radiometry > 0.5) {
    let f0 = fresnel_f0(1.0, ior);
    let through = (1.0 - fresnel_schlick(cos_i, f0)) / (1.0 - fresnel_schlick(l.z, f0));
    weight = clamp(cos_i / (n.z * l.z) * through, 0.0, CAUSTICS_MAX_WEIGHT);
  }
  return CausticsTransmit(normalize(r), weight);
}

// How far, in uv, a ray refracted by texel \`s\` lands from the point where it entered, on a floor
// \`P.depth\` below the mean surface. The surface height is ignored (it is a cell or two).
fn caustics_displacement(s: vec4f, ior: f32) -> vec2f {
  let t = caustics_transmit(s, ior);
  return t.dir.xy / (-t.dir.z) * P.depth / vec2f(P.aspect, 1.0);
}

// Fraction of the light that reaches the floor along the ray \`origin + dir * t\`, t in [0, t_floor],
// after the occluding sphere P.occluder (centre xyz, radius w; w <= 0 disables it) has had its say.
// Two segments matter: the refracted ray under the surface, and the ray from the surface point up
// toward the sun (a ball floating above the water shades it too). Distance to the sphere is turned
// into a soft edge P.soft wide (a smoothstep centred on the sphere's silhouette), which is also what
// keeps a mesh with one value per vertex from showing its triangles in the shadow's rim.
fn caustics_lit(origin: vec3f, dir: vec3f, t_floor: f32) -> f32 {
  let radius = P.occluder.w;
  if (radius <= 0.0) {
    return 1.0;
  }
  let c = P.occluder.xyz;
  let rel = c - origin;
  let below = length(rel - dir * clamp(dot(rel, dir), 0.0, t_floor));
  let above = length(rel - P.light * max(dot(rel, P.light), 0.0));
  let d = min(below, above);
  let half_soft = max(0.5 * P.soft, 1e-5);
  return smoothstep(radius - half_soft, radius + half_soft, d);
}
`,c=`// caustics-jacobian.wgsl -- caustics without a mesh: a per-pixel BACKWARD estimate from the
// slope field's Jacobian. One fullscreen pass over the floor texture.
//
// The surface -> floor map is q(p) = p + D(p), where D is how far the refracted ray travels sideways
// before it reaches the floor (caustics_displacement). Light from a patch of surface of area dA lands
// on a patch of floor of area |det J| dA, J = I + dD/dp, so the floor is brighter by 1 / |det J|.
// For each floor pixel q we need the surface point p that sends light there (a short fixed-point
// iteration p <- q - D(p), exact to first order; D is small compared with the features, so two or
// three rounds do) and the Jacobian there (central differences of D, four more taps). About 8 taps
// and 8 refractions per pixel, and nothing else: no vertices, no blending, no derivatives.
//
// What it cannot do: the formula sees ONE ray per floor point. Past the first focus the map folds and
// several surface points land on the same floor point; the mesh method adds them all, this one counts
// only the one it found. Where det J reaches 0 (a caustic) the intensity is capped by the smooth
// regulariser 1 / sqrt(det^2 + eps^2), normalised so that a flat surface (det = 1) is exactly 1.
// Measured against the mesh on a rain-stirred surface (see src/effects/ripple-caustics/notes.md): they
// agree well (correlation 0.84, mean within 1%) on gentle waves and drift apart as the surface steepens
// and folds the light, where this one adds energy (mean 1.06 at the demo's default steepness, 1.16 at
// twice that). For a wave field strong enough to fold the light the mesh is the more faithful one.
#include "fullscreen.wgsl"
#include "caustics_core.wgsl"

fn jacobian_intensity(q: vec2f, ior: f32) -> f32 {
  var p = q;
  for (var k = 0u; k < P.iterations; k++) {
    p = q - caustics_displacement(caustics_surface(p), ior);
  }
  let inside = all(p >= vec2f(0.0)) && all(p <= vec2f(1.0));
  if (P.extend < 0.5 && !inside) {
    return 0.0;
  }

  let e = P.texel;
  let s = caustics_surface(p);
  let d_xp = caustics_displacement(caustics_surface(p + vec2f(e.x, 0.0)), ior);
  let d_xm = caustics_displacement(caustics_surface(p - vec2f(e.x, 0.0)), ior);
  let d_yp = caustics_displacement(caustics_surface(p + vec2f(0.0, e.y)), ior);
  let d_ym = caustics_displacement(caustics_surface(p - vec2f(0.0, e.y)), ior);
  let ddu = (d_xp - d_xm) / (2.0 * e.x);
  let ddv = (d_yp - d_ym) / (2.0 * e.y);
  let det = (1.0 + ddu.x) * (1.0 + ddv.y) - ddv.x * ddu.y;

  let t = caustics_transmit(s, ior);
  let z = s.x * P.cell_size * P.height_scale;
  let travel = max(z + P.depth, 0.0) / (-t.dir.z);
  let lit = caustics_lit(vec3f(p.x * P.aspect, p.y, z), t.dir, travel);

  let regular = sqrt(det * det + P.eps * P.eps);
  let value = t.weight * lit * sqrt(1.0 + P.eps * P.eps) / regular;
  return min(value, P.max_intensity);
}

@fragment fn caustics_jacobian_fs(in: FullscreenVarying) -> @location(0) vec4f {
  let q = in.uv;
  if (P.dispersive == 0u) {
    return vec4f(vec3f(jacobian_intensity(q, P.ior_rgb.y)), 1.0);
  }
  return vec4f(
    jacobian_intensity(q, P.ior_rgb.x),
    jacobian_intensity(q, P.ior_rgb.y),
    jacobian_intensity(q, P.ior_rgb.z),
    1.0,
  );
}
`,l=`// caustics-mesh.wgsl -- the projected light mesh (the method popularised by Evan Wallace's WebGL Water),
// written from the idea: draw a regular grid of triangles over the water surface, move every vertex to
// where a refracted ray of sunlight from it lands on the floor, and let each triangle's brightness be
// the ratio of its original area to its projected area (light squeezed into a smaller area is
// brighter). Draws are added together in a floor-sized texture.
//
// No vertex buffer: the draw is indexed and the vertex index IS the grid position (column = index %
// (cells.x + 1), row = index / (cells.x + 1)), so the GPU's post-transform cache shares each vertex
// between its six triangles. The vertex stage fetches the surface (one filtered texel), refracts, and
// writes the landing point as the clip position. The fragment stage needs no area arithmetic of its
// own: \`old_uv\` is the vertex's position on the SURFACE, interpolated across the triangle, and the
// screen-space derivatives of it give the exact area ratio. A pixel of the floor texture covers
// 1 / (size.x * size.y) of uv area; the surface area that maps into it is |det(d old_uv / d pixel)|, so
//     intensity = |det(dpdx(old_uv), dpdy(old_uv))| * size.x * size.y.
// A flat surface translates the mesh without changing a triangle, which makes the ratio exactly 1.
// Energy is conserved by construction: a triangle of projected area A covers A / pixel pixels, each of
// intensity A_old / A, so it deposits A_old of light whatever its shape; folded triangles (the surface
// focused past a caustic) deposit it twice over, which is the extra brightness of a real caustic.
//
// Output: P.channel * intensity, added (blend one + one) onto a texture cleared to (0, 0, 0, 1).
// Three draws with channel = (1,0,0), (0,1,0), (0,0,1) and a different \`mesh_ior\` give a chromatic
// caustic; one draw with channel = (1,1,1) gives the grey one.
#include "caustics_core.wgsl"

struct MeshVarying {
  @builtin(position) position: vec4f,
  // Where the vertex sits on the surface, uv. Linear in screen space, so its derivatives are the
  // inverse of the surface -> floor map.
  @location(0) old_uv: vec2f,
  // Radiometry (tilt, Fresnel) times the occluder's light factor.
  @location(1) weight: f32,
}

@vertex fn caustics_mesh_vs(@builtin(vertex_index) index: u32) -> MeshVarying {
  let row = P.mesh_cells.x + 1u;
  let cell = vec2f(f32(index % row), f32(index / row));
  let uv = mix(P.mesh_lo, P.mesh_hi, cell / vec2f(P.mesh_cells));

  let s = caustics_surface(uv);
  let t = caustics_transmit(s, P.mesh_ior);
  let z = s.x * P.cell_size * P.height_scale;
  let origin = vec3f(uv.x * P.aspect, uv.y, z);
  let travel = max(z + P.depth, 0.0) / (-t.dir.z);
  let landing = origin.xy + t.dir.xy * travel;
  let landing_uv = vec2f(landing.x / P.aspect, landing.y);

  var out: MeshVarying;
  out.position = vec4f(landing_uv.x * 2.0 - 1.0, 1.0 - landing_uv.y * 2.0, 0.0, 1.0);
  out.old_uv = uv;
  out.weight = t.weight * caustics_lit(origin, t.dir, travel);
  return out;
}

@fragment fn caustics_mesh_fs(in: MeshVarying) -> @location(0) vec4f {
  let dx = dpdx(in.old_uv);
  let dy = dpdy(in.old_uv);
  let ratio = abs(dx.x * dy.y - dx.y * dy.x) * P.size.x * P.size.y;
  let intensity = min(ratio * in.weight, P.max_intensity);
  return vec4f(P.channel * intensity, 0.0);
}
`,u=`rgba16float`,d=.05,f=(e,t,n)=>Math.min(n,Math.max(t,e));function p(e,t){let n=Math.cos(e);return[n*Math.cos(t),-n*Math.sin(t),Math.sin(e)]}function m(e,t,n){let r=e[0]*t[0]+e[1]*t[1]+e[2]*t[2],i=1-n*n*(1-r*r);if(i<0)return[0,0,0];let a=n*r+Math.sqrt(i);return[n*e[0]-a*t[0],n*e[1]-a*t[1],n*e[2]-a*t[2]]}function h(e,t,n=1.333){let r=g(e),i=m([-r[0],-r[1],-r[2]],[0,0,1],1/n);return[i[0]/-i[2]*t,i[1]/-i[2]*t]}function g(e){let[t,n,r]=e;[t,n,r].every(Number.isFinite)||([t,n,r]=[0,0,1]);let i=Math.hypot(t,n,r)||1;if([t,n,r]=[t/i,n/i,r/i],r<d){let e=Math.hypot(t,n),i=e>0?Math.sqrt(1-d*d)/e:0;t=e>0?t*i:0,n=e>0?n*i:0,r=d}return[t,n,r]}function _(e,t){let n=e+1,r=new Uint32Array(e*t*6),i=0;for(let a=0;a<t;a++)for(let t=0;t<e;t++){let e=a*n+t;r[i++]=e,r[i++]=e+n,r[i++]=e+1,r[i++]=e+1,r[i++]=e+n,r[i++]=e+n+1}return r}var v=t(`CausticsParams`,{size:`vec2f`,aspect:`f32`,depth:`f32`,light:`vec3f`,strength:`f32`,channel:`vec3f`,max_intensity:`f32`,occluder:`vec4f`,ior_rgb:`vec3f`,mesh_ior:`f32`,mesh_lo:`vec2f`,mesh_hi:`vec2f`,mesh_cells:`vec2u`,texel:`vec2f`,cell_size:`f32`,soft:`f32`,eps:`f32`,radiometry:`f32`,extend:`f32`,height_scale:`f32`,iterations:`u32`,dispersive:`u32`}),y=new WeakMap;function b(e){let t=y.get(e);if(t)return t;let n=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,i=e.createBindGroupLayout({label:`caustics layout`,entries:[{binding:0,visibility:n,buffer:{type:`uniform`}},{binding:1,visibility:n,texture:{sampleType:`float`}},{binding:2,visibility:n,sampler:{type:`filtering`}}]}),a=e.createPipelineLayout({label:`caustics pipeline layout`,bindGroupLayouts:[i]}),o={"caustics_params.wgsl":v.wgsl,"caustics_core.wgsl":s},d=r(e,{label:`sim/caustics-mesh.wgsl`,code:l,chunks:o}),f=r(e,{label:`sim/caustics-jacobian.wgsl`,code:c,chunks:o}),p={srcFactor:`one`,dstFactor:`one`,operation:`add`},m={layout:i,mesh:e.createRenderPipeline({label:`caustics mesh`,layout:a,vertex:{module:d,entryPoint:`caustics_mesh_vs`},fragment:{module:d,entryPoint:`caustics_mesh_fs`,targets:[{format:u,blend:{color:p,alpha:p}}]},primitive:{topology:`triangle-list`,cullMode:`none`}}),jacobian:e.createRenderPipeline({label:`caustics jacobian`,layout:a,vertex:{module:f,entryPoint:`fullscreen_vs`},fragment:{module:f,entryPoint:`caustics_jacobian_fs`,targets:[{format:u}]}})};return y.set(e,m),m}function x(t){let{device:r,heightfield:s,profiler:c=e,label:l=`caustics`}=t,d=t.resolution??512,p=t.meshScale??1,m,y=b(r),x=Math.min(r.limits.maxTextureDimension2D,4096),S=r.createSampler({label:`${l} sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),C=[0,1,2].map(e=>n(r,v,`${l} params ${e}`)),w,T=0,E=!1;function D(){let e=s.grid,t=m??e.aspect,n=o(d,t,x),r=Math.max(e.width,e.height),i=f(Math.round(r*p),16,768);return{texture:n,mesh:o(i,e.aspect,768)}}function O(e){e.texture.destroy(),e.indices.destroy(),e.blur.destroy()}function k(){let{texture:e,mesh:t}=D(),n=w,i=n&&n.width===e.width&&n.height===e.height,o=n&&n.meshX===t.width&&n.meshY===t.height;if(n&&i&&o&&n.heightfieldGeneration===s.generation)return;let c=n?.texture,d=n?.view,f=n?.blur;(!n||!i)&&(c=r.createTexture({label:`${l} texture`,size:[e.width,e.height],format:u,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}),d=c.createView({label:`${l} view`}),f=a(r,{label:`${l} blur`,format:u,width:e.width,height:e.height}),n?.texture.destroy(),n?.blur.destroy(),T++);let p=n?.indices;if(!n||!o){let e=_(t.width,t.height);p=r.createBuffer({label:`${l} mesh indices`,size:e.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}),r.queue.writeBuffer(p,0,e),n?.indices.destroy()}let m=C.map((e,t)=>r.createBindGroup({label:`${l} bind group ${t}`,layout:y.layout,entries:[{binding:0,resource:{buffer:e.buffer}},{binding:1,resource:s.view},{binding:2,resource:S}]}));w={texture:c,view:d,width:e.width,height:e.height,meshX:t.width,meshY:t.height,indices:p,groups:m,blur:f,heightfieldGeneration:s.generation}}k();function A(e,t,n,r,i,a,o){let c=w,l=s.grid,u=t.occluder,d=j.method===`mesh`?Math.max(l.aspect/c.meshX,1/c.meshY):Math.max(l.aspect/c.width,1/c.height),f=u?u.softness??Math.max(u.radius*.1,1.5*d):0;e.set({size:[c.width,c.height],aspect:l.aspect,depth:t.depth,light:n,strength:t.strength,channel:i,max_intensity:t.maxIntensity,occluder:u?[u.center[0],u.center[1],u.center[2],Math.max(0,u.radius)]:[0,0,0,0],ior_rgb:r,mesh_ior:a,mesh_lo:o.lo,mesh_hi:o.hi,mesh_cells:[c.meshX,c.meshY],texel:[l.texelSize[0],l.texelSize[1]],cell_size:l.cellSize,soft:f,eps:Math.max(t.epsilon,.001),radiometry:+!!t.radiometry,extend:+!!t.extend,height_scale:+!!t.useHeight,iterations:Math.max(0,Math.round(t.iterations)),dispersive:+(t.dispersion>0)}),e.upload()}let j={method:t.method??`mesh`,get texture(){return w.texture},get view(){return w.view},get width(){return w.width},get height(){return w.height},get meshCells(){return{x:w.meshX,y:w.meshY}},get generation(){return T},update(e,t){if(E)return;k();let n=w,r=(e,t)=>e!==void 0&&Number.isFinite(e)?e:t,a={depth:f(r(t.depth,.35),.001,16),ior:f(r(t.ior,1.333),1.0001,3),dispersion:f(r(t.dispersion,0),0,.5),strength:f(r(t.strength,1),0,32),occluder:t.occluder??null,extend:t.extend??!0,maxIntensity:f(r(t.maxIntensity,12),1,1e3),useHeight:t.useHeight??!0,radiometry:t.radiometry??!0,smooth:f(r(t.smooth,0),0,8),epsilon:r(t.epsilon,.15),iterations:f(r(t.iterations,3),0,6)},o=g(t.lightDir),u=[Math.max(1.0001,a.ior-a.dispersion),a.ior,a.ior+a.dispersion],d=s.grid,p={lo:[0,0],hi:[1,1]};if(a.extend){let e=.05,t=0,n=0;for(let e of u){let[r,i]=h(o,a.depth,e);Math.abs(r)>Math.abs(t)&&(t=r),Math.abs(i)>Math.abs(n)&&(n=i)}let r=t/d.aspect;p={lo:[-r-e,-n-e],hi:[1-r+e,1-n+e]}}if(j.method===`jacobian`)A(C[0],a,o,u,[1,1,1],a.ior,p),i(e,n.view,y.jacobian,[n.groups[0]],{label:`${l} jacobian`,timestampWrites:c.pass(`${l} jacobian`)});else{let t=a.dispersion>0?[{channel:[1,0,0],ior:u[0]},{channel:[0,1,0],ior:u[1]},{channel:[0,0,1],ior:u[2]}]:[{channel:[1,1,1],ior:a.ior}];t.forEach((e,t)=>{A(C[t],a,o,u,e.channel,e.ior,p)});let r=e.beginRenderPass({label:`${l} mesh`,colorAttachments:[{view:n.view,loadOp:`clear`,storeOp:`store`,clearValue:[0,0,0,1]}],timestampWrites:c.pass(`${l} mesh`)});r.setPipeline(y.mesh),r.setIndexBuffer(n.indices,`uint32`),t.forEach((e,t)=>{r.setBindGroup(0,n.groups[t]),r.drawIndexed(n.meshX*n.meshY*6)}),r.end()}if(a.smooth>.05){let t=Math.min(16,Math.ceil(a.smooth*2.5));n.blur.encode(e,n.view,n.view,{radius:t,sigma:a.smooth})}},resize(e,t){if(!(e>0&&t>0))return!1;m=e/t;let n=T;return k(),T!==n},setResolution(e){if(!Number.isFinite(e))return!1;d=e;let t=T;return k(),T!==t},setMeshScale(e){return Number.isFinite(e)&&(p=e,k()),!1},destroy(){if(!E){E=!0,w&&O(w);for(let e of C)e.destroy()}}};return j}export{_ as n,p as r,x as t};