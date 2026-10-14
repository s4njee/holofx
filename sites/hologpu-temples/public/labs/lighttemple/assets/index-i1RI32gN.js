import{m as w,q as Ve,v as ne}from"./wgpu-matrix.module-hZiCFRr9.js";import{b as Ce}from"./brdf-DfmsPKoP.js";import{u as Le,U as _e,P as Ie,f as Be,c as ze,H as te,T as Ne}from"./post-YOyvqv1Z.js";import{s as De,M as je,a as $e,u as qe,p as Xe}from"./geometry-B-t91_OI.js";import{c as We,w as He}from"./surface-CPzQGKfE.js";import{m as Ye,g as Je}from"./mipmaps-D2ImRwxg.js";import{I as Ke,i as Qe,p as ve}from"./ibl-pm7vx_C6.js";import{O as Ze}from"./orbit-camera-COMcKYBF.js";import{h as et}from"./gallery-CAjxCs5g.js";const tt=`// ---------------------------------------------------------------------------
// gltf.wgsl — vertex input, node transforms and metal/roughness material
// sampling for meshes from src/gltf/gltf.ts. Materials live in bind group 2.
// Requires (prepended): common.wgsl, brdf.wgsl, \`GltfMaterialParams\` (added
// automatically when using the exported \`gltfWgsl\`).
// ---------------------------------------------------------------------------

struct GltfVertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  // xyz = tangent, w = bitangent sign; w == 0 means "no tangents supplied".
  @location(3) tangent: vec4f,
};

struct NodeTransform {
  model: mat4x4f,
  // Inverse-transpose of \`model\`, for normals under non-uniform scale.
  normal: mat4x4f,
};

@group(2) @binding(0) var<uniform> gltf_material: GltfMaterialParams;
@group(2) @binding(1) var gltf_sampler: sampler;
@group(2) @binding(2) var gltf_base_color: texture_2d<f32>;
@group(2) @binding(3) var gltf_metal_rough: texture_2d<f32>;
@group(2) @binding(4) var gltf_normal: texture_2d<f32>;
@group(2) @binding(5) var gltf_occlusion: texture_2d<f32>;
@group(2) @binding(6) var gltf_emissive: texture_2d<f32>;

struct Surface {
  material: Material,
  /// Shading normal (normal-mapped), world space.
  normal: vec3f,
  emissive: vec3f,
  occlusion: f32,
  alpha: f32,
};

/// Samples every material texture and builds the shading normal.
/// Call from uniform control flow (uses implicit-derivative texture sampling).
fn gltf_surface(uv: vec2f, world_pos: vec3f, geom_normal: vec3f, tangent: vec4f, front_facing: bool) -> Surface {
  let base = textureSample(gltf_base_color, gltf_sampler, uv) * gltf_material.baseColorFactor;
  let mr = textureSample(gltf_metal_rough, gltf_sampler, uv);
  let occ = textureSample(gltf_occlusion, gltf_sampler, uv).r;
  let emi = textureSample(gltf_emissive, gltf_sampler, uv).rgb * gltf_material.emissiveFactor;
  var tn = textureSample(gltf_normal, gltf_sampler, uv).xyz * 2.0 - 1.0;
  tn = vec3f(tn.xy * gltf_material.normalScale, tn.z);

  var n = normalize(geom_normal);
  if (!front_facing) { n = -n; } // double-sided back faces

  // Derivative-based cotangent frame (Schüler 2013) for meshes without tangents.
  let dp1 = dpdx(world_pos);
  let dp2 = dpdy(world_pos);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let dp2perp = cross(dp2, n);
  let dp1perp = cross(n, dp1);
  let dt = dp2perp * duv1.x + dp1perp * duv2.x;
  let db = dp2perp * duv1.y + dp1perp * duv2.y;
  let inv_max = inverseSqrt(max(max(dot(dt, dt), dot(db, db)), 1e-20));

  var t = dt * inv_max;
  var b = db * inv_max;
  if (tangent.w != 0.0) {
    t = normalize(tangent.xyz - n * dot(n, tangent.xyz));
    b = cross(n, t) * tangent.w;
  }
  let shading_n = normalize(t * tn.x + b * tn.y + n * tn.z);

  var s: Surface;
  s.material = Material(base.rgb, saturate(mr.g * gltf_material.roughnessFactor), saturate(mr.b * gltf_material.metallicFactor));
  s.normal = shading_n;
  s.emissive = emi;
  s.occlusion = mix(1.0, occ, gltf_material.occlusionStrength);
  s.alpha = base.a;
  return s;
}
`,nt=48,be={arrayStride:nt,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x2"},{shaderLocation:3,offset:32,format:"float32x4"}]},Se={baseColorFactor:"vec4f",emissiveFactor:"vec3f",normalScale:"f32",metallicFactor:"f32",roughnessFactor:"f32",occlusionStrength:"f32",alphaCutoff:"f32"},rt=`${Le("GltfMaterialParams",Se)}

${tt}`,ot={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},ye=10497,at=33648,st=33071;async function le(r,n,o){let e,a="";if(typeof n=="string"){const s=await fetch(n);if(!s.ok)throw new Error(`Failed to fetch ${n}: ${s.status}`);e=await s.arrayBuffer(),a=new URL(".",new URL(n,location.href)).href}else e=n;let t,d=null;if(new DataView(e).getUint32(0,!0)===1179937895?{json:t,bin:d}=it(e):t=JSON.parse(new TextDecoder().decode(e)),t.extensionsRequired?.length)throw new Error(`Unsupported required glTF extensions: ${t.extensionsRequired.join(", ")}`);const f=await Promise.all((t.buffers??[]).map(async(s,g)=>{if(s.uri===void 0){if(g===0&&d)return d;throw new Error(`glTF buffer ${g} has no data`)}return(await fetch(new URL(s.uri,a||location.href))).arrayBuffer()})),_=[],y=new ut(r,t,f,a,_),l=dt(r,_),M=Te(r),I=r.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:"repeat",addressModeV:"repeat",maxAnisotropy:8}),B=await Promise.all((t.materials??[{}]).map(async s=>{const g=s.pbrMetallicRoughness??{},v=new _e(r,"GltfMaterialParams",Se);_.push(v),v.set("baseColorFactor",g.baseColorFactor??[1,1,1,1]).set("emissiveFactor",s.emissiveFactor??[0,0,0]).set("normalScale",s.normalTexture?.scale??1).set("metallicFactor",g.metallicFactor??1).set("roughnessFactor",g.roughnessFactor??1).set("occlusionStrength",s.occlusionTexture?.strength??1).set("alphaCutoff",s.alphaMode==="MASK"?s.alphaCutoff??.5:-1).upload();const[x,E,S,b,T]=await Promise.all([y.get(g.baseColorTexture?.index,!0),y.get(g.metallicRoughnessTexture?.index,!1),y.get(s.normalTexture?.index,!1),y.get(s.occlusionTexture?.index,!1),y.get(s.emissiveTexture?.index,!0)]),F=y.sampler(g.baseColorTexture?.index)??I;return{name:s.name??"material",doubleSided:s.doubleSided??!1,alphaMode:s.alphaMode??"OPAQUE",bindGroup:r.createBindGroup({label:`gltf-material:${s.name??""}`,layout:M,entries:[{binding:0,resource:{buffer:v.buffer}},{binding:1,resource:F},{binding:2,resource:(x??l.white).createView()},{binding:3,resource:(E??l.white).createView()},{binding:4,resource:(S??l.normal).createView()},{binding:5,resource:(b??l.white).createView()},{binding:6,resource:(T??l.white).createView()}]})}})),G=s=>lt(t,f,s),j=new Map,z=[],u=[],p=[1/0,1/0,1/0],R=[-1/0,-1/0,-1/0],re=s=>{const g=j.get(s);if(g)return g;const v=[],x=[1/0,1/0,1/0],E=[-1/0,-1/0,-1/0];for(const b of t.meshes[s].primitives){if((b.mode??4)!==4)continue;const T=G(b.attributes.POSITION),F=T.count,O=b.indices!==void 0?G(b.indices).data:Uint32Array.from({length:F},(i,h)=>h),P=b.attributes.NORMAL!==void 0?G(b.attributes.NORMAL).data:ct(T.data,O),W=b.attributes.TEXCOORD_0!==void 0?G(b.attributes.TEXCOORD_0).data:null,H=b.attributes.TANGENT!==void 0?G(b.attributes.TANGENT).data:null,V=new Float32Array(F*12);for(let i=0;i<F;i++){const h=i*12;for(let m=0;m<3;m++){const A=T.data[i*3+m];V[h+m]=A,x[m]=Math.min(x[m],A),E[m]=Math.max(E[m],A),V[h+3+m]=P[i*3+m]}if(W&&(V[h+6]=W[i*2],V[h+7]=W[i*2+1]),H)for(let m=0;m<4;m++)V[h+8+m]=H[i*4+m]}const Y=r.createBuffer({label:"gltf-vertices",size:V.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});r.queue.writeBuffer(Y,0,V);const J=F>65535,D=J?Uint32Array.from(O):Uint16Array.from(O),U=r.createBuffer({label:"gltf-indices",size:Math.ceil(D.byteLength/4)*4,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}),K=new Uint8Array(U.size);K.set(new Uint8Array(D.buffer,D.byteOffset,D.byteLength)),r.queue.writeBuffer(U,0,K),_.push(Y,U),v.push({vertexBuffer:Y,indexBuffer:U,indexFormat:J?"uint32":"uint16",indexCount:D.length,material:B[b.material??0]??B[0]})}const S={primitives:v,localMin:x,localMax:E};return j.set(s,S),S},Z=(s,g)=>{const v=t.nodes[s];let x;if(v.matrix)x=new Float32Array(v.matrix);else{const S=w.translation(v.translation??[0,0,0]),b=w.fromQuat(Ve.fromValues(...v.rotation??[0,0,0,1])),T=w.scaling(v.scale??[1,1,1]);x=w.multiply(w.multiply(S,b),T)}const E=w.multiply(g,x);if(v.mesh!==void 0){const S=re(v.mesh),b=u.length;u.push(E);for(const T of S.primitives)z.push({...T,transformIndex:b});for(let T=0;T<8;T++){const F=[0,1,2].map(P=>T>>P&1?S.localMax[P]:S.localMin[P]),O=ne.transformMat4(F,E);for(let P=0;P<3;P++)p[P]=Math.min(p[P],O[P]),R[P]=Math.max(R[P],O[P])}}for(const S of v.children??[])Z(S,E)},oe=t.scenes?.[t.scene??0]?.nodes??(t.nodes??[]).map((s,g)=>g);for(const s of oe)Z(s,w.identity());if(z.length===0)throw new Error("glTF contains no triangle meshes");const X=new Float32Array(u.length*32);u.forEach((s,g)=>{X.set(s,g*32),X.set(w.transpose(w.inverse(s)),g*32+16)});const N=r.createBuffer({label:"gltf-transforms",size:X.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});return r.queue.writeBuffer(N,0,X),_.push(N),{items:z,transforms:N,bounds:{min:p,max:R},fit(s){const g=R[1]-p[1]||1,v=s/g,x=(p[0]+R[0])/2,E=(p[2]+R[2])/2;return w.multiply(w.scaling([v,v,v]),w.translation([-x,-p[1],-E]))},destroy(){for(const s of _)s.destroy()}}}function it(r){const n=new DataView(r);if(n.getUint32(4,!0)!==2)throw new Error("Only glTF 2.0 .glb files are supported");let o=12,e=null,a=null;for(;o<r.byteLength;){const t=n.getUint32(o,!0),d=n.getUint32(o+4,!0),c=r.slice(o+8,o+8+t);d===1313821514?e=JSON.parse(new TextDecoder().decode(c)):d===5130562&&(a=c),o+=8+t}if(!e)throw new Error(".glb has no JSON chunk");return{json:e,bin:a}}function lt(r,n,o){const e=r.accessors[o];if(e.sparse)throw new Error("Sparse accessors are not supported");const a=ot[e.type],t=e.componentType===5126||e.normalized?new Float32Array(e.count*a):new Uint32Array(e.count*a);if(e.bufferView===void 0)return{data:t,count:e.count};const d=r.bufferViews[e.bufferView],c=new DataView(n[d.buffer],(d.byteOffset??0)+(e.byteOffset??0)),f={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[e.componentType];if(!f)throw new Error(`Unsupported accessor componentType ${e.componentType}`);const _=d.byteStride??f*a,y=l=>{switch(e.componentType){case 5126:return c.getFloat32(l,!0);case 5125:return c.getUint32(l,!0);case 5123:return e.normalized?c.getUint16(l,!0)/65535:c.getUint16(l,!0);case 5122:return e.normalized?Math.max(c.getInt16(l,!0)/32767,-1):c.getInt16(l,!0);case 5121:return e.normalized?c.getUint8(l)/255:c.getUint8(l);default:return e.normalized?Math.max(c.getInt8(l)/127,-1):c.getInt8(l)}};for(let l=0;l<e.count;l++)for(let M=0;M<a;M++)t[l*a+M]=y(l*_+M*f);return{data:t,count:e.count}}function ct(r,n){const o=new Float32Array(r.length);for(let e=0;e+2<n.length;e+=3){const[a,t,d]=[n[e]*3,n[e+1]*3,n[e+2]*3],c=[r[t]-r[a],r[t+1]-r[a+1],r[t+2]-r[a+2]],f=[r[d]-r[a],r[d+1]-r[a+1],r[d+2]-r[a+2]],_=[c[1]*f[2]-c[2]*f[1],c[2]*f[0]-c[0]*f[2],c[0]*f[1]-c[1]*f[0]];for(const y of[a,t,d])for(let l=0;l<3;l++)o[y+l]+=_[l]}for(let e=0;e<o.length;e+=3){const a=Math.hypot(o[e],o[e+1],o[e+2])||1;o[e]/=a,o[e+1]/=a,o[e+2]/=a}return o}class ut{constructor(n,o,e,a,t){this.device=n,this.json=o,this.buffers=e,this.base=a,this.resources=t}device;json;buffers;base;resources;cache=new Map;samplers=new Map;get(n,o){if(n===void 0)return Promise.resolve(null);const e=this.json.textures?.[n]?.source;if(e===void 0)return Promise.resolve(null);const a=`${e}:${o}`;let t=this.cache.get(a);return t||(t=this.load(e,o),this.cache.set(a,t)),t}sampler(n){const o=n===void 0?void 0:this.json.textures?.[n]?.sampler;if(o===void 0)return null;let e=this.samplers.get(o);if(!e){const a=this.json.samplers[o],t=c=>c===st?"clamp-to-edge":c===at?"mirror-repeat":"repeat",d=a.magFilter===9728;e=this.device.createSampler({magFilter:d?"nearest":"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:t(a.wrapS),addressModeV:t(a.wrapT),maxAnisotropy:d?1:8}),this.samplers.set(o,e)}return e}async load(n,o){const e=this.json.images?.[n];if(!e)return null;let a;if(e.bufferView!==void 0){const c=this.json.bufferViews[e.bufferView],f=new Uint8Array(this.buffers[c.buffer],c.byteOffset??0,c.byteLength);a=new Blob([f.slice()],{type:e.mimeType??"image/png"})}else if(e.uri)a=await(await fetch(new URL(e.uri,this.base||location.href))).blob();else return null;const t=await createImageBitmap(a,{colorSpaceConversion:"none",premultiplyAlpha:"none"}),d=this.device.createTexture({label:`gltf-image-${n}${o?"-srgb":""}`,size:[t.width,t.height],format:o?"rgba8unorm-srgb":"rgba8unorm",mipLevelCount:Ye(t.width,t.height),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});return this.device.queue.copyExternalImageToTexture({source:t},{texture:d},[t.width,t.height]),t.close(),Je(this.device,d),this.resources.push(d),d}}function dt(r,n){const o=(e,a)=>{const t=r.createTexture({label:a,size:[1,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});return r.queue.writeTexture({texture:t},new Uint8Array(e),{bytesPerRow:4},[1,1]),n.push(t),t};return{white:o([255,255,255,255],"gltf-white"),normal:o([128,128,255,255],"gltf-flat-normal")}}const we=new WeakMap;function Te(r){let n=we.get(r);if(!n){const o=e=>({binding:e,visibility:GPUShaderStage.FRAGMENT,texture:{}});n=r.createBindGroupLayout({label:"gltf-material",entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},o(2),o(3),o(4),o(5),o(6)]}),we.set(r,n)}return n}const ce=6;function ft(){const r=De(.22,48,32),n=r.vertices.length/8,o=new Float32Array(n*3),e=new Float32Array(n*3),a=new Float32Array(n*2),t=[1/0,1/0,1/0],d=[-1/0,-1/0,-1/0];for(let u=0;u<n;u++){for(let p=0;p<3;p++){const R=r.vertices[u*8+p];o[u*3+p]=R,t[p]=Math.min(t[p],R),d[p]=Math.max(d[p],R),e[u*3+p]=r.vertices[u*8+3+p]}a[u*2]=r.vertices[u*8+6],a[u*2+1]=r.vertices[u*8+7]}const c=r.indices,f=[o,e,a,c],_=f.reduce((u,p)=>u+p.byteLength,0),y=new Uint8Array(_),l=[];let M=0;for(const u of f)y.set(new Uint8Array(u.buffer,u.byteOffset,u.byteLength),M),l.push({buffer:0,byteOffset:M,byteLength:u.byteLength}),M+=u.byteLength;const I=[],B=[],G=[];for(let u=0;u<2;u++)for(let p=0;p<ce;p++){const R=p/(ce-1);I.push({name:`${u?"metal":"dielectric"}-r${R.toFixed(2)}`,pbrMetallicRoughness:{baseColorFactor:u?[1,.78,.45,1]:[.8,.12,.08,1],metallicFactor:u,roughnessFactor:R}}),B.push({primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:I.length-1}]}),G.push({mesh:B.length-1,translation:[(p-(ce-1)/2)*.55,.26+u*.6,0]})}const j=btoa(Array.from(y,u=>String.fromCharCode(u)).join("")),z={asset:{version:"2.0",generator:"lighttemple material grid"},scene:0,scenes:[{nodes:G.map((u,p)=>p)}],nodes:G,meshes:B,materials:I,buffers:[{byteLength:_,uri:`data:application/octet-stream;base64,${j}`}],bufferViews:l,accessors:[{bufferView:0,componentType:5126,count:n,type:"VEC3",min:t,max:d},{bufferView:1,componentType:5126,count:n,type:"VEC3"},{bufferView:2,componentType:5126,count:n,type:"VEC2"},{bufferView:3,componentType:5125,count:c.length,type:"SCALAR"}]};return new TextEncoder().encode(JSON.stringify(z)).buffer}const mt=`// ---------------------------------------------------------------------------
// Studio Lighting — a product shot lit purely by an environment.
//
//   model:   glTF metal/roughness surface shaded with IBL (SH9 diffuse +
//            prefiltered specular + split-sum LUT + multi-scatter), plus emissive.
//   sky:     the environment itself (optionally blurred), or nothing ("page colour").
//   ground:  an invisible shadow catcher. It only *darkens* what is behind it:
//            - a soft shadow from the environment's dominant light direction
//              (estimated from the SH band-1 vector), via a Poisson-filtered
//              orthographic shadow map;
//            - contact occlusion from a depth map rendered looking *up* from
//              below the floor: each texel stores how high the model's
//              underside is, which maps directly to "how occluded is this
//              bit of floor".
//
// Requires (prepended): common.wgsl, fullscreen.wgsl, VertexIn, brdf.wgsl,
// \`Frame\`, \`IblParams\`, ibl.wgsl, gltfWgsl.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> nodes: array<NodeTransform>;
@group(0) @binding(2) var key_map: texture_depth_2d;
@group(0) @binding(3) var contact_map: texture_depth_2d;
@group(0) @binding(4) var shadow_cmp: sampler_comparison;

const POISSON = array<vec2f, 16>(
  vec2f(-0.94201624, -0.39906216), vec2f(0.94558609, -0.76890725),
  vec2f(-0.09418410, -0.92938870), vec2f(0.34495938, 0.29387760),
  vec2f(-0.91588581, 0.45771432), vec2f(-0.81544232, -0.87912464),
  vec2f(-0.38277543, 0.27676845), vec2f(0.97484398, 0.75648379),
  vec2f(0.44323325, -0.97511554), vec2f(0.53742981, -0.47373420),
  vec2f(-0.26496911, -0.41893023), vec2f(0.79197514, 0.19090188),
  vec2f(-0.24188840, 0.99706507), vec2f(-0.81409955, 0.91437590),
  vec2f(0.19984126, 0.78641367), vec2f(0.14383161, -0.14100790),
);

fn model_matrix(id: u32) -> mat4x4f { return frame.modelRoot * nodes[id].model; }

// --- Shadow passes (depth only) -----------------------------------------------

@vertex
fn vs_key(v: GltfVertex, @builtin(instance_index) id: u32) -> @builtin(position) vec4f {
  return frame.keyViewProj * model_matrix(id) * vec4f(v.position, 1.0);
}

@vertex
fn vs_contact(v: GltfVertex, @builtin(instance_index) id: u32) -> @builtin(position) vec4f {
  return frame.contactViewProj * model_matrix(id) * vec4f(v.position, 1.0);
}

// --- Model -------------------------------------------------------------------------

struct ModelOut {
  @builtin(position) position: vec4f,
  @location(0) world_pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) tangent: vec4f,
};

@vertex
fn vs_model(v: GltfVertex, @builtin(instance_index) id: u32) -> ModelOut {
  let m = model_matrix(id);
  let wp = m * vec4f(v.position, 1.0);
  // modelRoot is uniform scale + translation, so it commutes with the node's normal matrix.
  let n = (frame.modelRoot * nodes[id].normal * vec4f(v.normal, 0.0)).xyz;
  let t = (m * vec4f(v.tangent.xyz, 0.0)).xyz;
  var out: ModelOut;
  out.position = frame.viewProj * wp;
  out.world_pos = wp.xyz;
  out.normal = n;
  out.uv = v.uv;
  out.tangent = vec4f(t, v.tangent.w);
  return out;
}

@fragment
fn fs_model(v: ModelOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let s = gltf_surface(v.uv, v.world_pos, v.normal, v.tangent, front);
  if (s.alpha < gltf_material.alphaCutoff) { discard; }
  let vdir = normalize(frame.cameraPos - v.world_pos);
  let col = ibl_shade(s.material, s.normal, vdir) * s.occlusion + s.emissive * frame.emissiveStrength;
  return vec4f(col, 1.0);
}

// --- Environment background -------------------------------------------------------

@fragment
fn fs_sky(v: FullscreenOut) -> @location(0) vec4f {
  let ndc = vec2f(v.uv.x * 2.0 - 1.0, 1.0 - v.uv.y * 2.0);
  let far = frame.invViewProj * vec4f(ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - frame.cameraPos);
  return vec4f(ibl_background(dir, frame.backgroundBlur), 1.0);
}

// --- Ground shadow catcher -----------------------------------------------------------

struct GroundOut {
  @builtin(position) position: vec4f,
  @location(0) world_pos: vec3f,
};

@vertex
fn vs_ground(v: VertexIn) -> GroundOut {
  let wp = vec3f(v.position.x * frame.groundSize, 0.0, v.position.z * frame.groundSize);
  var out: GroundOut;
  out.position = frame.viewProj * vec4f(wp, 1.0);
  out.world_pos = wp;
  return out;
}

fn to_shadow_uv(m: mat4x4f, p: vec3f) -> vec3f {
  let c = m * vec4f(p, 1.0);
  let ndc = c.xyz / c.w;
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}

@fragment
fn fs_ground(g: GroundOut) -> @location(0) vec4f {
  let angle = ign(g.position.xy) * TAU;
  let rot = mat2x2f(cos(angle), sin(angle), -sin(angle), cos(angle));
  var disk = POISSON;

  // Key-light shadow: wide Poisson PCF = a big, soft studio shadow.
  let lp = to_shadow_uv(frame.keyViewProj, g.world_pos);
  var lit = 0.0;
  let key_radius = frame.shadowSoftness / (2.0 * frame.keyExtent);
  for (var i = 0; i < 16; i++) {
    lit += textureSampleCompareLevel(key_map, shadow_cmp, lp.xy + rot * disk[i] * key_radius, lp.z - 0.002);
  }
  lit /= 16.0;

  // Contact occlusion: how close is the model's underside above this point?
  let cp = to_shadow_uv(frame.contactViewProj, g.world_pos);
  let dims = vec2f(textureDimensions(contact_map));
  var occ = 0.0;
  let contact_radius = frame.contactRadius / (2.0 * frame.contactExtent);
  for (var i = 0; i < 16; i++) {
    let uv = cp.xy + rot * disk[i] * contact_radius;
    let px = clamp(vec2i(uv * dims), vec2i(0), vec2i(dims) - 1);
    let d = textureLoad(contact_map, px, 0);
    let height = d * frame.contactRange;
    occ += select(0.0, exp(-height / max(frame.contactFalloff, 1e-3)), d < 1.0);
  }
  occ /= 16.0;

  let key_dark = (1.0 - lit) * frame.shadowOpacity;
  let contact_dark = occ * frame.contactStrength;
  let darkness = 1.0 - (1.0 - key_dark) * (1.0 - contact_dark);
  let fade = 1.0 - smoothstep(frame.groundSize * 0.25, frame.groundSize * 0.5, length(g.world_pos.xz));
  // Premultiplied black with alpha = darkness: only darkens what's behind.
  return vec4f(0.0, 0.0, 0.0, saturate(darkness * fade));
}
`,Q=4,ue="depth24plus",pt=2048,gt=512,xe=r=>new URL(r,document.baseURI).href,ht={lantern:{height:2.4,distance:6.2},grid:{height:1.1,distance:4.6},dropped:{height:1.8,distance:5.2}},Et=async r=>{const{device:n,surface:o,params:e,reducedMotion:a}=r,t=e.add({model:{value:"lantern",options:{"Lantern (glTF)":"lantern","Material grid":"grid"}},environment:{value:"studio",options:{"Studio (procedural)":"studio","Sunset sky":"sunset","Day sky":"day","Studio HDRI":"hdri"},hint:"Drop your own .hdr (equirectangular) or .glb onto the canvas to try them."},rotation:{value:0,min:-180,max:180,step:1,label:"Env rotation"},intensity:{value:1,min:0,max:4,step:.01,label:"Env intensity"},emissive:{value:3,min:0,max:20,step:.1,label:"Emissive"},autoRotate:{value:!a,label:"Auto-rotate"}},"Scene"),d=e.add({background:{value:"env",options:{Environment:"env","Page colour":"page"}},blur:{value:.45,min:0,max:1,step:.01,label:"Background blur"},pageColor:{value:"#d9d3ca",type:"color",label:"Page colour"},shadowOpacity:{value:.55,min:0,max:1,step:.01,label:"Shadow"},shadowSoftness:{value:.35,min:.01,max:1.5,step:.01,label:"Softness",hint:"Filter radius in world units."},contact:{value:.75,min:0,max:1,step:.01,label:"Contact AO"}},"Backdrop & shadow"),c=await Ie.create(r,{bloom:.05,vignette:.2,grain:.02}),f=await Ke.create(n),_=new Ne(n),y=new _e(n,"Frame",{viewProj:"mat4x4f",invViewProj:"mat4x4f",modelRoot:"mat4x4f",keyViewProj:"mat4x4f",contactViewProj:"mat4x4f",cameraPos:"vec3f",backgroundBlur:"f32",emissiveStrength:"f32",groundSize:"f32",shadowOpacity:"f32",shadowSoftness:"f32",keyExtent:"f32",contactExtent:"f32",contactRange:"f32",contactRadius:"f32",contactFalloff:"f32",contactStrength:"f32"}),l=await We(n,"studio-ibl",He(ze,Be,je,Ce,y.wgslStruct,f.wgslStruct,Qe,rt,mt)),M=n.createBindGroupLayout({label:"studio-frame",entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"depth"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"depth"}},{binding:4,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"comparison"}}]}),I=n.createBindGroupLayout({label:"studio-shadow",entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}}]}),B=Te(n),G=(...i)=>n.createPipelineLayout({bindGroupLayouts:i}),j=i=>({format:ue,depthWriteEnabled:i,depthCompare:"less"}),z=i=>n.createRenderPipelineAsync({label:`studio:${i}`,layout:G(I),vertex:{module:l,entryPoint:i,buffers:[be]},primitive:{cullMode:"none"},depthStencil:{format:"depth32float",depthWriteEnabled:!0,depthCompare:"less"}}),u=i=>n.createRenderPipelineAsync({label:`studio:model-${i}`,layout:G(M,f.bindGroupLayout,B),vertex:{module:l,entryPoint:"vs_model",buffers:[be]},fragment:{module:l,entryPoint:"fs_model",targets:[{format:te}]},primitive:{cullMode:i},depthStencil:j(!0),multisample:{count:Q}}),p={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha"}},[R,re,Z,de,oe,X]=await Promise.all([z("vs_key"),z("vs_contact"),u("back"),u("none"),n.createRenderPipelineAsync({label:"studio:sky",layout:G(M,f.bindGroupLayout),vertex:{module:l,entryPoint:"vs_fullscreen"},fragment:{module:l,entryPoint:"fs_sky",targets:[{format:te}]},depthStencil:{format:ue,depthWriteEnabled:!1,depthCompare:"always"},multisample:{count:Q}}),n.createRenderPipelineAsync({label:"studio:ground",layout:G(M),vertex:{module:l,entryPoint:"vs_ground",buffers:[$e]},fragment:{module:l,entryPoint:"fs_ground",targets:[{format:te,blend:p}]},depthStencil:j(!1),multisample:{count:Q}})]),N=qe(n,Xe(1,1),"ground"),ae=(i,h)=>n.createTexture({label:h,size:[i,i],format:"depth32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),s=ae(pt,"key-shadow"),g=ae(gt,"contact-depth"),v=n.createSampler({compare:"less-equal",magFilter:"linear",minFilter:"linear"});let x=null,E="lantern",S=null;const b=(i,h)=>{x?.destroy(),x=i,E=h,S={main:n.createBindGroup({layout:M,entries:[{binding:0,resource:{buffer:y.buffer}},{binding:1,resource:{buffer:i.transforms}},{binding:2,resource:s.createView()},{binding:3,resource:g.createView()},{binding:4,resource:v}]}),shadow:n.createBindGroup({layout:I,entries:[{binding:0,resource:{buffer:y.buffer}},{binding:1,resource:{buffer:i.transforms}}]})}};let T=0;const F=async i=>{const h=++T,m=i==="grid"?await le(n,ft()):await le(n,xe("assets/models/lantern.glb"));if(h!==T||H)return m.destroy();b(m,i)};let O=0,P=null;const W=async i=>{const h=++O;if(i==="hdri"){if(P??=ve(await(await fetch(xe("assets/hdri/studio_small_09_1k.hdr"))).arrayBuffer()),h!==O||H)return;await f.setEquirect(P)}else if(i==="studio")await f.setProcedural({kind:"studio"});else{const m=i==="sunset";await f.setProcedural({kind:"sky",sunAzimuth:m?2.2:.9,sunElevation:m?.07:.85,exposure:m?1.6:1})}};let H=!1;await Promise.all([F(t.model),W(t.environment)]);let V=t.model,Y=t.environment;const J=i=>i.preventDefault(),D=async i=>{i.preventDefault();const h=i.dataTransfer?.files[0];if(!h)return;const m=await h.arrayBuffer();try{/\.hdr$/i.test(h.name)?(O++,await f.setEquirect(ve(m))):/\.(glb|gltf)$/i.test(h.name)&&(T++,b(await le(n,m),"dropped"))}catch(A){console.error(A),alert(`Could not load ${h.name}: ${A instanceof Error?A.message:A}`)}};o.canvas.addEventListener("dragover",J),o.canvas.addEventListener("drop",D);const U=new Ze(o.canvas,{target:[0,1.2,0],distance:6.2,yaw:.5,pitch:.18,minDistance:1.5,maxDistance:20});U.autoRotate=0;let K=null;return{frame({time:i,dt:h,size:m}){if(t.model!==V&&(V=t.model,F(t.model)),t.environment!==Y&&(Y=t.environment,W(t.environment)),!x||!S)return;const A=ht[E];K!==E&&(K=E,U.setView({target:[0,A.height*.45,0],distance:A.distance})),U.autoRotate=t.autoRotate?.15:0,U.update(h,m.width/m.height),f.rotation=t.rotation*Math.PI/180,f.intensity=t.intensity,f.update();const Pe=x.fit(A.height),$=A.height,C=$*1.6;let[Ee,se,Me]=f.lightDirection();se=Math.max(se,.26);const fe=ne.normalize([Ee,se,Me]),me=ne.fromValues(0,$*.5,0),Re=w.lookAt(ne.addScaled(me,fe,20),me,Math.abs(fe[1])>.99?[0,0,1]:[0,1,0]),Ge=w.multiply(w.ortho(-C,C,-C,C,1,40),Re),pe=$,Ue=w.lookAt([0,-1,0],[0,0,0],[0,0,1]),Ae=w.multiply(w.ortho(-C,C,-C,C,1,1+pe),Ue);y.set("viewProj",U.viewProjection).set("invViewProj",w.inverse(U.viewProjection)).set("modelRoot",Pe).set("keyViewProj",Ge).set("contactViewProj",Ae).set("cameraPos",U.position).set("backgroundBlur",d.blur).set("emissiveStrength",t.emissive).set("groundSize",$*6).set("shadowOpacity",d.shadowOpacity).set("shadowSoftness",d.shadowSoftness*$*.5).set("keyExtent",C).set("contactExtent",C).set("contactRange",pe).set("contactRadius",$*.06).set("contactFalloff",$*.08).set("contactStrength",d.contact).upload();const ee=n.createCommandEncoder({label:"studio-ibl"}),ge=(q,ie)=>{for(const k of x.items)ie&&(q.setPipeline(k.material.doubleSided?de:Z),q.setBindGroup(2,k.material.bindGroup)),q.setVertexBuffer(0,k.vertexBuffer),q.setIndexBuffer(k.indexBuffer,k.indexFormat),q.drawIndexed(k.indexCount,1,0,0,k.transformIndex)};for(const[q,ie]of[[s,R],[g,re]]){const k=ee.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:q.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});k.setPipeline(ie),k.setBindGroup(0,S.shadow),ge(k,!1),k.end()}const he=[m.width,m.height],ke=_.get("msaa",{size:he,format:te,sampleCount:Q}),Fe=_.get("depth",{size:he,format:ue,sampleCount:Q}),Oe=c.scene(m),L=ee.beginRenderPass({colorAttachments:[{view:ke.view,resolveTarget:Oe.view,loadOp:"clear",storeOp:"discard",clearValue:[0,0,0,0]}],depthStencilAttachment:{view:Fe.view,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});L.setBindGroup(0,S.main),L.setBindGroup(1,f.bindGroup),d.background==="env"&&(L.setPipeline(oe),L.draw(3)),ge(L,!0),L.setPipeline(X),L.setVertexBuffer(0,N.vertexBuffer),L.setIndexBuffer(N.indexBuffer,"uint32"),L.drawIndexed(N.indexCount),L.end(),c.render(ee,o.currentTexture().createView(),{time:i,background:et(d.pageColor)}),n.queue.submit([ee.finish()])},dispose(){H=!0,o.canvas.removeEventListener("dragover",J),o.canvas.removeEventListener("drop",D),U.destroy(),x?.destroy(),N.destroy(),s.destroy(),g.destroy(),_.destroy(),y.destroy(),f.destroy(),c.destroy()}}};export{Et as default};
