import{n as e}from"./profiler-Bi27xYp-.js";import{t}from"./depth-DtG5nS6F.js";import{s as n,t as r}from"./camera-BT6VSIZb.js";import{n as i,r as a,t as o}from"./uniforms-BE1XSnDx.js";import{t as s}from"./shader-Cd_FDUy8.js";var c=65535,l=new WeakMap,u=new WeakMap;function d(e){return`${e.label}\u0000${e.code}\u0000${JSON.stringify(e.chunks??{})}`}function f(e,t){let n=u.get(e);n||u.set(e,n=new Map);let r=d(t),i=n.get(r);return i||(i=s(e,t),n.set(r,i),n.size>128&&n.delete(n.keys().next().value)),i}function p(e,t,n){let r=l.get(e);r||l.set(e,r=new Map);let i=`${d(t)}\u0000${n}`,a=r.get(i);return a||(a=e.createComputePipeline({label:`${t.label}:${n}`,layout:`auto`,compute:{module:f(e,t),entryPoint:n}}),r.set(i,a),r.size>128&&r.delete(r.keys().next().value)),a}var m=new WeakMap,h=1,g=e=>{let t=m.get(e);return t===void 0&&m.set(e,t=h++),t};function _(e){return e===void 0?`-`:`buffer`in e?`${g(e.buffer)}:${e.offset??0}:${e.size??`all`}`:String(g(e))}function v(e,t){return`buffer`in e?{binding:t,resource:e}:e instanceof GPUBuffer?{binding:t,resource:{buffer:e}}:{binding:t,resource:e}}var y=24;function b(t,n){let{label:r,entryPoint:i=`main`,workgroupSize:a=64,profiler:o=e}=n,s=n.timestamp??r,l=p(t,{label:r,code:n.code,chunks:n.chunks},i),u=new Map;function d(e){let n=e.map(_).join(`|`),a=u.get(n);if(!a){u.size>=y&&u.clear();let o=[];e.forEach((e,t)=>{e!==void 0&&o.push(v(e,t))}),a=t.createBindGroup({label:`${r}:${i}`,layout:l.getBindGroupLayout(0),entries:o}),u.set(n,a)}return a}function f(e,t,n){let r=e.beginComputePass({label:s,timestampWrites:o.pass(s)});r.setPipeline(l),r.setBindGroup(0,d(t)),r.dispatchWorkgroups(n[0],n[1],n[2]),r.end()}return{workgroupSize:a,pipeline:l,runCount(e,t,n){if(!(n>=0)||!Number.isFinite(n))throw RangeError(`${r}: count must be a finite number of at least 0, got ${n}`);let i=Math.ceil(n/a);if(i>65535)throw RangeError(`${r}: ${n} items need ${i} workgroups of ${a}; one dispatch allows ${c}. Use a larger workgroup size.`);i!==0&&f(e,t,[i,1,1])},runGroups(e,t,n){let[r,i=1,a=1]=typeof n==`number`?[n]:n;r*i*a!==0&&f(e,t,[r,i,a])},clearBindGroups(){u.clear()},destroy(){u.clear()}}}var x=`// Instanced billboard particles: one camera-facing quad per particle (4 vertices, a triangle strip), the
// particle position and scalar arriving as per-instance vertex attributes. See billboards.ts.
//
// Sizes are in world units with a floor in pixels; the same code serves perspective and orthographic
// cameras because it works from the projection's y scale and the centre's clip w (1 when orthographic).
// The fragment stage draws a round sprite whose edge goes from a one-pixel antialiased rim (softness 0) to a
// smooth falloff over the whole radius (softness 1). In the opaque mode the sprite is a sphere impostor: it
// shades as a lit ball and writes the depth of the sphere's surface, so spheres intersect each other correctly.

#include "camera.wgsl"
#include "particles.wgsl"
#include "color.wgsl"

#include "billboard_params.wgsl"

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> params: BillboardParams;

struct Varying {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  // Palette colour in rgb, energy-conserving alpha factor in a.
  @location(1) color: vec4f,
  // View-space centre and radius actually drawn: the fragment stage rebuilds the sphere from them.
  @location(2) view_center: vec3f,
  @location(3) radius: f32,
  // One pixel in sprite units (uv spans the radius), for the antialiased edge.
  @location(4) pixel: f32,
}

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) particle: vec4f,
  @location(1) scalar: f32,
) -> Varying {
  var out: Varying;
  let center = (cam.view * vec4f(particle.xyz, 1.0)).xyz;
  let clip = cam.proj * vec4f(center, 1.0);
  // Behind the camera, or not a number: park the quad outside the clip volume.
  if (!(clip.w > 0.0)) {
    out.position = vec4f(2.0, 2.0, 2.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec4f(0.0);
    out.view_center = vec3f(0.0);
    out.radius = 1.0;
    out.pixel = 1.0;
    return out;
  }
  let size = particle_size(params.radius, clip.w, cam.proj[1][1], cam.viewport.y, params.min_pixels);
  let corner = particle_corner(vertex);
  // One pixel in sprite units (uv spans the radius): pixels per radius = r * proj_scale / w * viewport_h / 2.
  let pixel = 2.0 * clip.w / max(size.x * cam.proj[1][1] * cam.viewport.y, 1e-9);
  // The quad reaches one pixel past the rim so the antialiased edge is not cut off.
  let reach = 1.0 + pixel;
  out.position = cam.proj * vec4f(center + vec3f(corner * size.x * reach, 0.0), 1.0);
  out.uv = corner * reach;
  let t = (scalar - params.scalar_min) / max(params.scalar_max - params.scalar_min, 1e-9);
  out.color = vec4f(particle_palette(params.palette, params.palette_count, t), size.y);
  out.view_center = center;
  out.radius = size.x;
  out.pixel = pixel;
  return out;
}

struct Fragment {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

fn encode(rgb: vec3f) -> vec3f {
  return select(rgb, linear_to_srgb(rgb), params.encode_srgb != 0u);
}

@fragment
fn fs(in: Varying) -> @location(0) vec4f {
  let d2 = dot(in.uv, in.uv);
  let alpha = particle_disc_alpha(sqrt(d2), params.softness, in.pixel);
  if (alpha <= 0.0) { discard; }
  var rgb = in.color.rgb;
  if (params.shading > 0.0) {
    let z = particle_sphere_z(d2);
    let normal = vec3f(in.uv, z);
    let light = normalize(vec3f(-0.4, 0.6, 0.7));
    let diffuse = max(dot(normal, light), 0.0);
    let rim = pow(1.0 - z, 3.0) * 0.25;
    rgb = rgb * mix(1.0, 0.25 + 0.85 * diffuse, params.shading) + vec3f(rim * params.shading);
  }
  let a = alpha * in.color.a * params.intensity;
  return vec4f(encode(rgb) * a, a);
}

// The opaque mode: an opaque sphere with the depth of its surface.
@fragment
fn fs_opaque(in: Varying) -> Fragment {
  let d2 = dot(in.uv, in.uv);
  if (d2 >= 1.0) { discard; }
  let z = particle_sphere_z(d2);
  let normal = vec3f(in.uv, z);
  let light = normalize(vec3f(-0.4, 0.6, 0.7));
  let diffuse = max(dot(normal, light), 0.0);
  let rim = pow(1.0 - z, 3.0) * 0.25;
  let rgb = in.color.rgb * mix(1.0, 0.25 + 0.85 * diffuse, params.shading) + vec3f(rim * params.shading);
  var out: Fragment;
  out.color = vec4f(encode(rgb), 1.0);
  // The point of the sphere facing the camera, projected: view space looks down -z, so it is nearer by r * z.
  let surface = in.view_center + vec3f(in.uv * in.radius, z * in.radius);
  let clip = cam.proj * vec4f(surface, 1.0);
  out.depth = clamp(clip.z / clip.w, 0.0, 1.0);
  return out;
}
`,S={mode:`additive`,sizeScale:1,minPixels:.75,softness:.35,intensity:1,shading:1,scalarRange:[0,1],palette:[[.02,.12,.32],[.05,.45,.75],[.55,.9,1],[1,1,1]]},C=i(`BillboardParams`,{radius:`f32`,min_pixels:`f32`,softness:`f32`,intensity:`f32`,scalar_min:`f32`,scalar_max:`f32`,palette_count:`u32`,encode_srgb:`u32`,mode:`u32`,shading:`f32`,palette:a(`vec4f`,8)}),w={additive:0,alpha:1,opaque:2},T={additive:{color:{srcFactor:`one`,dstFactor:`one`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one`,operation:`add`}},alpha:{color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}};function E(i){let{device:a,format:s,depthFormat:c=`depth24plus`,profiler:l=e,label:u=`billboards`}=i,d={...S,...i.style,palette:i.style?.palette??S.palette},p=o(a,r,`${u} camera`),m=o(a,C,`${u} params`),h=i.encodeSrgb===!1||s.endsWith(`-srgb`)?0:1,g=1,_=1,v,y=new Map;function b(e,t,n){let r=`${e}|${t}|${n}`,i=y.get(r);if(!i){let o=f(a,{label:`particles/billboards.wgsl`,code:x,chunks:{"billboard_params.wgsl":C.wgsl}}),l=e===`opaque`,d=a.createRenderPipeline({label:`${u} ${e}`,layout:`auto`,vertex:{module:o,entryPoint:`vs`,buffers:[{arrayStride:16,stepMode:`instance`,attributes:[{shaderLocation:0,offset:0,format:`float32x4`}]},{arrayStride:t?4:16,stepMode:`instance`,attributes:[{shaderLocation:1,offset:t?0:12,format:`float32`}]}]},fragment:{module:o,entryPoint:l?`fs_opaque`:`fs`,targets:[{format:s,blend:l?void 0:T[e]}]},primitive:{topology:`triangle-strip`,cullMode:`none`},depthStencil:l||n?{format:c,depthWriteEnabled:l,depthCompare:`less`}:void 0});i={pipeline:d,bindGroup:a.createBindGroup({label:`${u} ${e}`,layout:d.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:p.buffer}},{binding:1,resource:{buffer:m.buffer}}]})},y.set(r,i)}return i}return{style:d,resize(e,t){g=Math.max(1,Math.round(e)),_=Math.max(1,Math.round(t)),v&&v.resize(g,_)},draw(e,r,i,o,s={}){let f=s.width??g,y=s.height??_,x=d.mode,S=s.scalar!==void 0,C=s.depth;!C&&x===`opaque`&&(v??=t(a,{label:`${u} depth`,width:f,height:y,format:c,sampled:!1}),v.resize(f,y),C=v.view);let{pipeline:T,bindGroup:E}=b(x,S,C!==void 0);n(p,i,f,y),p.upload();let D=d.palette.slice(0,8);if(D.length<2)throw RangeError(`${u}: the palette needs at least 2 stops`);m.set({radius:r.radius*d.sizeScale,min_pixels:d.minPixels,softness:d.softness,intensity:d.intensity,scalar_min:d.scalarRange[0],scalar_max:d.scalarRange[1],palette_count:D.length,encode_srgb:h,mode:w[x],shading:x===`opaque`?d.shading:0,palette:D.flatMap(([e,t,n])=>[e,t,n,1])}),m.upload();let O=s.clear===void 0?{r:0,g:0,b:0,a:0}:s.clear,k=e.beginRenderPass({label:`${u} draw`,colorAttachments:[{view:o,loadOp:O?`clear`:`load`,storeOp:`store`,clearValue:O??void 0}],depthStencilAttachment:C?{view:C,depthLoadOp:s.clearDepth===!1?`load`:`clear`,depthStoreOp:`store`,depthClearValue:1}:void 0,timestampWrites:l.pass(s.timestamp??`particles draw`)});r.count>0&&(k.setPipeline(T),k.setBindGroup(0,E),k.setVertexBuffer(0,r.positions),k.setVertexBuffer(1,s.scalar??r.positions),k.draw(4,r.count)),k.end()},destroy(){p.destroy(),m.destroy(),v?.destroy(),y.clear()}}}export{b as n,E as t};