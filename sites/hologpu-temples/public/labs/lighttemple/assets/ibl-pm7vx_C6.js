import{U as P,u as L,c as C}from"./post-YOyvqv1Z.js";import{b as I}from"./brdf-DfmsPKoP.js";import{w as F,c as D}from"./surface-CPzQGKfE.js";const N=`// ---------------------------------------------------------------------------
// bake.wgsl — one-time image-based-lighting precomputation.
//
//   fs_equirect / fs_studio / fs_sky   source -> environment cubemap (mip 0)
//   fs_downsample                      environment mip chain (box filter)
//   fs_prefilter                       GGX-prefiltered specular cube, one mip per roughness
//   cs_sh                              9-coefficient spherical-harmonic irradiance
//   fs_brdf_lut                        split-sum DFG lookup table
//
// Cube faces are rendered one layer at a time; the instance index carries the
// face (and, for the prefilter, the mip) so no per-pass uniforms are needed.
// Requires (prepended): common.wgsl, brdf.wgsl, the \`Bake\` struct.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var src_equirect: texture_2d<f32>;
@group(0) @binding(1) var bake_sampler: sampler;
@group(0) @binding(2) var<uniform> bake: Bake;
@group(0) @binding(3) var src_cube: texture_cube<f32>;
@group(0) @binding(4) var<storage, read_write> sh_out: array<vec4f, 9>;

struct BakeOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) id: u32,
};

@vertex
fn vs_bake(@builtin(vertex_index) i: u32, @builtin(instance_index) id: u32) -> BakeOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: BakeOut;
  out.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  out.id = id;
  return out;
}

/// Direction through texel \`uv\` (origin top-left) of cube face \`face\`
/// (+X, -X, +Y, -Y, +Z, -Z), matching WebGPU cube sampling.
fn cube_dir(face: u32, uv: vec2f) -> vec3f {
  let s = uv.x * 2.0 - 1.0;
  let t = uv.y * 2.0 - 1.0;
  switch face {
    case 0u: { return normalize(vec3f(1.0, -t, -s)); }
    case 1u: { return normalize(vec3f(-1.0, -t, s)); }
    case 2u: { return normalize(vec3f(s, 1.0, t)); }
    case 3u: { return normalize(vec3f(s, -1.0, -t)); }
    case 4u: { return normalize(vec3f(s, -t, 1.0)); }
    default: { return normalize(vec3f(-s, -t, -1.0)); }
  }
}

// --- Sources -------------------------------------------------------------------

@fragment
fn fs_equirect(v: BakeOut) -> @location(0) vec4f {
  let d = cube_dir(v.id, v.uv);
  let uv = vec2f(atan2(d.x, -d.z) / TAU + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
  return vec4f(textureSampleLevel(src_equirect, bake_sampler, uv, 0.0).rgb, 1.0);
}

/// A rectangular softbox facing the origin: \`c\` = direction to its centre,
/// \`half_size\` = half extents on the plane at distance 1 (≈ tan of half-angles).
fn softbox(d: vec3f, c: vec3f, half_size: vec2f, radiance: vec3f) -> vec3f {
  let k = dot(d, c);
  if (k <= 0.0) { return vec3f(0.0); }
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), c) + vec3f(1e-5, 0.0, 0.0));
  let up = cross(c, right);
  let p = d / k - c;
  let q = abs(vec2f(dot(p, right), dot(p, up))) / half_size;
  let edge = 0.06;
  let mask = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, q.x)) * (1.0 - smoothstep(1.0 - edge, 1.0 + edge, q.y));
  // Real softboxes are brighter in the middle than at the diffuser's edges.
  let falloff = 1.0 - 0.35 * dot(q, q) * 0.5;
  return radiance * mask * falloff;
}

@fragment
fn fs_studio(v: BakeOut) -> @location(0) vec4f {
  let d = cube_dir(v.id, v.uv);
  // Dark seamless backdrop: slightly lighter towards the horizon, darker floor.
  var c = mix(vec3f(0.018, 0.017, 0.016), vec3f(0.05, 0.048, 0.045), 1.0 - abs(d.y));
  c = select(c, vec3f(0.03, 0.028, 0.026) * (1.0 + d.y), d.y < 0.0);
  c += softbox(d, normalize(vec3f(-0.55, 0.65, 0.55)), vec2f(0.55, 0.38), vec3f(9.0, 8.4, 7.6));   // key
  c += softbox(d, normalize(vec3f(0.85, 0.2, 0.35)), vec2f(0.22, 0.55), vec3f(1.6, 1.8, 2.1));    // fill
  c += softbox(d, normalize(vec3f(0.15, 0.55, -0.85)), vec2f(0.75, 0.08), vec3f(7.0, 7.0, 7.0));  // rim strip
  c += softbox(d, vec3f(0.0, 1.0, 0.0), vec2f(0.35, 0.35), vec3f(1.2, 1.2, 1.2));                // top bounce
  return vec4f(c * bake.exposure, 1.0);
}

@fragment
fn fs_sky(v: BakeOut) -> @location(0) vec4f {
  let d = cube_dir(v.id, v.uv);
  let sun = normalize(bake.sunDir);
  // Warmer, dimmer light as the sun approaches the horizon.
  let low = 1.0 - smoothstep(0.0, 0.45, sun.y);
  let zenith = mix(vec3f(0.18, 0.32, 0.65), vec3f(0.12, 0.14, 0.32), low);
  let horizon = mix(vec3f(0.75, 0.82, 0.92), vec3f(1.1, 0.55, 0.28), low);
  let sun_col = mix(vec3f(1.0, 0.95, 0.88), vec3f(1.0, 0.45, 0.18), low) * mix(1.0, 0.45, low);

  let h = max(d.y, 0.0);
  var c = mix(horizon, zenith, pow(h, 0.45));
  let mu = dot(d, sun);
  // Mie-ish forward glow around the sun, broad and tight lobes.
  c += sun_col * (0.35 * pow(saturate(mu), 8.0) + 1.2 * pow(saturate(mu), 120.0));
  // Sun disc (angular radius ~1.3°). Its total irradiance is ~3x the sky's, as
  // outdoors, so it dominates the SH band-1 vector and casts a real shadow;
  // filtered importance sampling keeps the prefiltered cube free of fireflies.
  c += sun_col * 2500.0 * smoothstep(cos(0.024), cos(0.020), mu) * step(0.0, d.y + 0.02);
  // Ground: dark warm albedo lit by the sky, with horizon haze.
  let ground = vec3f(0.11, 0.095, 0.08) * (0.3 + 0.7 * saturate(sun.y + 0.2));
  c = select(c, mix(horizon * 0.6, ground, saturate(-d.y * 6.0)), d.y < 0.0);
  return vec4f(c * bake.exposure, 1.0);
}

// --- Mip chain -----------------------------------------------------------------

@fragment
fn fs_downsample(v: BakeOut) -> @location(0) vec4f {
  // Destination texel centres sit between 4 source texels: one bilinear tap = 2x2 box.
  return vec4f(textureSampleLevel(src_cube, bake_sampler, cube_dir(v.id, v.uv), 0.0).rgb, 1.0);
}

// --- GGX importance sampling -----------------------------------------------------

fn hammersley(i: u32, n: u32) -> vec2f {
  return vec2f(f32(i) / f32(n), f32(reverseBits(i)) * 2.3283064365386963e-10);
}

fn importance_ggx(xi: vec2f, n: vec3f, a: f32) -> vec3f {
  let phi = TAU * xi.x;
  let cos_t = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  let sin_t = sqrt(1.0 - cos_t * cos_t);
  let h = vec3f(cos(phi) * sin_t, sin(phi) * sin_t, cos_t);
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.z) < 0.999);
  let tx = normalize(cross(up, n));
  let ty = cross(n, tx);
  return normalize(tx * h.x + ty * h.y + n * h.z);
}

// Filtered importance sampling (Křivánek & Colbert 2008): read a blurrier mip for
// low-probability samples, so 64 samples look like thousands.
@fragment
fn fs_prefilter(v: BakeOut) -> @location(0) vec4f {
  let face = v.id % 6u;
  let mip = f32(v.id / 6u);
  let roughness = mip / max(bake.mipCount - 1.0, 1.0);
  let n = cube_dir(face, v.uv);
  if (roughness == 0.0) {
    return vec4f(textureSampleLevel(src_cube, bake_sampler, n, 0.0).rgb, 1.0);
  }
  let a = roughness * roughness;
  let texel_solid_angle = 4.0 * PI / (6.0 * bake.envSize * bake.envSize);
  var sum = vec3f(0.0);
  var weight = 0.0;
  for (var i = 0u; i < bake.sampleCount; i++) {
    let h = importance_ggx(hammersley(i, bake.sampleCount), n, a);
    let l = normalize(2.0 * dot(n, h) * h - n);
    let nol = dot(n, l);
    if (nol > 0.0) {
      let noh = saturate(dot(n, h));
      // With N = V, pdf(L) = D(h) * NoH / (4 VoH) = D / 4.
      let pdf = d_ggx(noh, a) * 0.25;
      let sample_solid_angle = 1.0 / (f32(bake.sampleCount) * pdf + 1e-4);
      let lod = max(0.5 * log2(sample_solid_angle / texel_solid_angle) + 1.0, 0.0);
      sum += textureSampleLevel(src_cube, bake_sampler, l, lod).rgb * nol;
      weight += nol;
    }
  }
  return vec4f(sum / max(weight, 1e-4), 1.0);
}

// --- Spherical harmonics ----------------------------------------------------------

fn sh_basis(d: vec3f) -> array<f32, 9> {
  return array<f32, 9>(
    0.282095,
    0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x,
    1.092548 * d.x * d.y, 1.092548 * d.y * d.z, 0.315392 * (3.0 * d.z * d.z - 1.0),
    1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
}

var<workgroup> sh_acc: array<array<vec3f, 9>, 64>;

@compute @workgroup_size(64)
fn cs_sh(@builtin(local_invocation_index) li: u32) {
  let size = bake.shSize;
  let per_face = size * size;
  var acc: array<vec3f, 9>;
  for (var i = li; i < 6u * per_face; i += 64u) {
    let face = i / per_face;
    let rem = i % per_face;
    let uv = (vec2f(f32(rem % size), f32(rem / size)) + 0.5) / f32(size);
    let st = uv * 2.0 - 1.0;
    // Solid angle of this texel on the unit cube.
    let dw = (4.0 / f32(per_face)) / pow(1.0 + dot(st, st), 1.5);
    let d = cube_dir(face, uv);
    let c = textureSampleLevel(src_cube, bake_sampler, d, bake.shLod).rgb * dw;
    let y = sh_basis(d);
    for (var k = 0; k < 9; k++) { acc[k] += c * y[k]; }
  }
  sh_acc[li] = acc;
  workgroupBarrier();
  if (li == 0u) {
    // Fold in the clamped-cosine convolution (Ramamoorthi & Hanrahan) so shading
    // just evaluates sum(c_k * Y_k(n)) to get irradiance E(n).
    let band = array<f32, 9>(PI, 2.0 * PI / 3.0, 2.0 * PI / 3.0, 2.0 * PI / 3.0, PI / 4.0, PI / 4.0, PI / 4.0, PI / 4.0, PI / 4.0);
    for (var k = 0; k < 9; k++) {
      var total = vec3f(0.0);
      for (var t = 0; t < 64; t++) { total += sh_acc[t][k]; }
      sh_out[k] = vec4f(total * band[k], 0.0);
    }
  }
}

// --- Split-sum DFG lookup table -------------------------------------------------

@fragment
fn fs_brdf_lut(v: BakeOut) -> @location(0) vec4f {
  let nov = max(v.uv.x, 1e-3);
  let roughness = v.uv.y;
  let a = max(roughness * roughness, 1e-3);
  let vdir = vec3f(sqrt(1.0 - nov * nov), 0.0, nov);
  let n = vec3f(0.0, 0.0, 1.0);
  var r = vec2f(0.0);
  let count = 512u;
  for (var i = 0u; i < count; i++) {
    let h = importance_ggx(hammersley(i, count), n, a);
    let l = 2.0 * dot(vdir, h) * h - vdir;
    let nol = saturate(l.z);
    let noh = saturate(h.z);
    let voh = saturate(dot(vdir, h));
    if (nol > 0.0) {
      let g = v_smith_ggx_correlated(nov, nol, a) * voh * nol / max(noh, 1e-4);
      let fc = pow(1.0 - voh, 5.0);
      r += vec2f(g * (1.0 - fc), g * fc);
    }
  }
  return vec4f(r * 4.0 / f32(count), 0.0, 1.0);
}
`;function $(p){const e=new Uint8Array(p);let t=0;const n=()=>{let r="";for(;t<e.length&&e[t]!==10;)r+=String.fromCharCode(e[t++]);return t++,r};if(!n().startsWith("#?"))throw new Error("Not a Radiance .hdr file (missing #? header).");for(let r=n();r!=="";r=n()){if(r.startsWith("FORMAT=")&&r!=="FORMAT=32-bit_rle_rgbe")throw new Error(`Unsupported .hdr format: ${r}`);if(t>=e.length)throw new Error("Truncated .hdr header.")}const a=n().match(/^-Y (\d+) \+X (\d+)$/);if(!a)throw new Error('Unsupported .hdr orientation (expected "-Y h +X w").');const c=Number(a[1]),o=Number(a[2]),u=new Uint8Array(o*c*4),h=new Uint8Array(o*4);for(let r=0;r<c;r++){if(!(o>=8&&o<32768&&e[t]===2&&e[t+1]===2&&!(e[t+2]&128))){u.set(e.subarray(t,t+o*4),r*o*4),t+=o*4;continue}if((e[t+2]<<8|e[t+3])!==o)throw new Error("Corrupt .hdr scanline header.");t+=4;for(let l=0;l<4;l++){let m=0;for(;m<o;){let y=e[t++];if(y>128){y-=128;const g=e[t++];for(let _=0;_<y;_++)h[m++*4+l]=g}else for(let g=0;g<y;g++)h[m++*4+l]=e[t++]}}u.set(h,r*o*4)}const f=new Float32Array(o*c*4);for(let r=0;r<o*c;r++){const b=u[r*4+3],l=b===0?0:Math.pow(2,b-136);f[r*4]=u[r*4]*l,f[r*4+1]=u[r*4+1]*l,f[r*4+2]=u[r*4+2]*l,f[r*4+3]=1}return{width:o,height:c,data:f}}const M=new Float32Array(1),q=new Uint32Array(M.buffer);function O(p){M[0]=p;const e=q[0],t=e>>>16&32768,n=(e>>>23&255)-127+15,s=e&8388607;if(n>=31)return t|31743;if(n<=0){if(n<-10)return t;const c=(s|8388608)>>>1-n;return t|c+4096>>>13}const a=(n<<10)+(s+4096>>>13);return t|Math.min(a,31743)}function V(p,e,t="hdr"){const n=new Uint16Array(e.data.length);for(let a=0;a<n.length;a++)n[a]=O(e.data[a]);const s=p.createTexture({label:t,size:[e.width,e.height],format:"rgba16float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});return p.queue.writeTexture({texture:s},n,{bytesPerRow:e.width*8},[e.width,e.height]),s}const K=`// ---------------------------------------------------------------------------
// ibl.wgsl — shading with a baked environment (bind group 1).
//
//   ibl_shade(material, n, v)   diffuse (SH9) + specular (prefiltered cube +
//                               split-sum LUT) with multiple-scattering energy
//                               compensation (Fdez-Agüera 2019), so rough metals
//                               don't lose energy and go dark.
//   ibl_background(dir, blur)   the environment itself, for skyboxes/reflections.
//
// Requires (prepended): common.wgsl, brdf.wgsl, the \`IblParams\` struct.
// Pipelines must put Ibl.bindGroupLayout at group index 1.
// ---------------------------------------------------------------------------

@group(1) @binding(0) var ibl_env: texture_cube<f32>;
@group(1) @binding(1) var ibl_spec: texture_cube<f32>;
@group(1) @binding(2) var ibl_lut: texture_2d<f32>;
@group(1) @binding(3) var ibl_sampler: sampler;
@group(1) @binding(4) var<storage, read> ibl_sh: array<vec4f, 9>;
@group(1) @binding(5) var<uniform> ibl: IblParams;

/// World direction -> environment direction (yaw rotation of the environment).
fn ibl_rotate(d: vec3f) -> vec3f {
  let c = ibl.rotation.x;
  let s = ibl.rotation.y;
  return vec3f(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}

/// Cosine-convolved irradiance E(n) from 9 SH coefficients.
fn ibl_irradiance(n: vec3f) -> vec3f {
  let d = ibl_rotate(n);
  var e = ibl_sh[0].rgb * 0.282095;
  e += ibl_sh[1].rgb * (0.488603 * d.y) + ibl_sh[2].rgb * (0.488603 * d.z) + ibl_sh[3].rgb * (0.488603 * d.x);
  e += ibl_sh[4].rgb * (1.092548 * d.x * d.y) + ibl_sh[5].rgb * (1.092548 * d.y * d.z);
  e += ibl_sh[6].rgb * (0.315392 * (3.0 * d.z * d.z - 1.0));
  e += ibl_sh[7].rgb * (1.092548 * d.x * d.z) + ibl_sh[8].rgb * (0.546274 * (d.x * d.x - d.y * d.y));
  return max(e, vec3f(0.0)) * ibl.intensity;
}

fn ibl_specular_radiance(r: vec3f, roughness: f32) -> vec3f {
  return textureSampleLevel(ibl_spec, ibl_sampler, ibl_rotate(r), roughness * (ibl.specMips - 1.0)).rgb * ibl.intensity;
}

fn ibl_shade(m: Material, n: vec3f, v: vec3f) -> vec3f {
  let nov = max(dot(n, v), 1e-4);
  let r = reflect(-v, n);
  let dfg = textureSampleLevel(ibl_lut, ibl_sampler, vec2f(nov, m.roughness), 0.0).rg;
  let f0 = material_f0(m);

  // Roughness-dependent Fresnel, single- and multiple-scattering terms.
  let fr = max(vec3f(1.0 - m.roughness), f0) - f0;
  let ks = f0 + fr * pow(1.0 - nov, 5.0);
  let fss_ess = ks * dfg.x + dfg.y;
  let ess = dfg.x + dfg.y;
  let ems = 1.0 - ess;
  let f_avg = f0 + (vec3f(1.0) - f0) / 21.0;
  let fms = fss_ess * f_avg / (vec3f(1.0) - ems * f_avg);
  let diffuse_color = m.albedo * (1.0 - m.metallic);
  let kd = diffuse_color * (vec3f(1.0) - fss_ess - fms * ems);

  let irradiance = ibl_irradiance(n) / PI;
  return fss_ess * ibl_specular_radiance(r, m.roughness) + (fms * ems + kd) * irradiance;
}

/// The environment as seen in direction \`d\`; \`blur\` 0..1 walks down its mip chain.
fn ibl_background(d: vec3f, blur: f32) -> vec3f {
  return textureSampleLevel(ibl_env, ibl_sampler, ibl_rotate(d), blur * (ibl.envMips - 1.0)).rgb * ibl.intensity;
}
`,G="rgba16float",x=512,S=256,k=7,U=128,H=96,E=32,W={rotation:"vec2f",intensity:"f32",specMips:"f32",envMips:"f32"},T={sunDir:"vec3f",exposure:"f32",envSize:"f32",mipCount:"f32",sampleCount:"u32",shSize:"u32",shLod:"f32"},B=p=>Math.floor(Math.log2(p))+1;class A{constructor(e,t){this.device=e,this.pipelines=t,this.params=new P(e,"IblParams",W),this.bake=new P(e,"Bake",T),this.wgslStruct=this.params.wgslStruct,this.linear=e.createSampler({label:"ibl-linear",magFilter:"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.repeatU=e.createSampler({label:"ibl-equirect",magFilter:"linear",minFilter:"linear",addressModeU:"repeat"}),this.shBuffer=e.createBuffer({label:"ibl-sh",size:144,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.lut=e.createTexture({label:"ibl-dfg-lut",size:[U,U],format:"rg16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.bindGroupLayout=e.createBindGroupLayout({label:"ibl",entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{viewDimension:"cube"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{viewDimension:"cube"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const n=e.createCommandEncoder({label:"ibl-lut"}),s=n.beginRenderPass({colorAttachments:[{view:this.lut.createView(),loadOp:"clear",storeOp:"store"}]});s.setPipeline(t.lut),s.draw(3),s.end(),e.queue.submit([n.finish()])}device;pipelines;rotation=0;intensity=1;dominantDirection=[0,1,0];sh=new Float32Array(27);bindGroupLayout;wgslStruct;group=null;env=null;spec=null;lut;shBuffer;params;bake;linear;repeatU;version=0;static async create(e){const t=F(C,I,L("Bake",T),N),n=await D(e,"ibl-bake",t),s=(b,l=G)=>e.createRenderPipelineAsync({label:`ibl:${b}`,layout:"auto",vertex:{module:n,entryPoint:"vs_bake"},fragment:{module:n,entryPoint:b,targets:[{format:l}]}}),[a,c,o,u,h,f,r]=await Promise.all([s("fs_equirect"),s("fs_studio"),s("fs_sky"),s("fs_downsample"),s("fs_prefilter"),s("fs_brdf_lut","rg16float"),e.createComputePipelineAsync({label:"ibl:cs_sh",layout:"auto",compute:{module:n,entryPoint:"cs_sh"}})]);return new A(e,{equirect:a,studio:c,sky:o,down:u,prefilter:h,lut:f,sh:r})}get bindGroup(){if(!this.group)throw new Error("Ibl: no environment baked yet");return this.group}get environmentVersion(){return this.version}lightDirection(){const[e,t,n]=this.dominantDirection,s=Math.cos(this.rotation),a=Math.sin(this.rotation);return[s*e-a*n,t,a*e+s*n]}update(){this.params.set("rotation",[Math.cos(this.rotation),Math.sin(this.rotation)]).set("intensity",this.intensity).set("specMips",k).set("envMips",B(x)).upload()}async setEquirect(e){const t=V(this.device,e,"ibl-equirect"),n=this.device.createBindGroup({layout:this.pipelines.equirect.getBindGroupLayout(0),entries:[{binding:0,resource:t.createView()},{binding:1,resource:this.repeatU}]});try{await this.bakeFrom(this.pipelines.equirect,n)}finally{t.destroy()}}async setProcedural(e){const t=e.kind==="sky"?[Math.cos(e.sunElevation)*Math.sin(e.sunAzimuth),Math.sin(e.sunElevation),Math.cos(e.sunElevation)*Math.cos(e.sunAzimuth)]:[0,1,0];this.bake.set("sunDir",t).set("exposure",e.exposure??1).upload();const n=e.kind==="sky"?this.pipelines.sky:this.pipelines.studio,s=this.device.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:2,resource:{buffer:this.bake.buffer}}]});await this.bakeFrom(n,s)}async bakeFrom(e,t){const n=this.device,s=B(x),a=n.createTexture({label:"ibl-env",size:[x,x,6],mipLevelCount:s,format:G,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),c=n.createTexture({label:"ibl-specular",size:[S,S,6],mipLevelCount:k,format:G,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.bake.set("envSize",x).set("mipCount",k).set("sampleCount",H).set("shSize",E).set("shLod",Math.log2(x/E)).upload();const o=n.createCommandEncoder({label:"ibl-bake"}),u=(i,d,v)=>i.createView({dimension:"2d",baseArrayLayer:d,arrayLayerCount:1,baseMipLevel:v,mipLevelCount:1}),h=(i,d,v,R)=>{const w=o.beginRenderPass({colorAttachments:[{view:v,loadOp:"clear",storeOp:"store"}]});w.setPipeline(i),w.setBindGroup(0,d),w.draw(3,1,0,R),w.end()};for(let i=0;i<6;i++)h(e,t,u(a,i,0),i);for(let i=1;i<s;i++){const d=n.createBindGroup({layout:this.pipelines.down.getBindGroupLayout(0),entries:[{binding:1,resource:this.linear},{binding:3,resource:a.createView({dimension:"cube",baseMipLevel:i-1,mipLevelCount:1})}]});for(let v=0;v<6;v++)h(this.pipelines.down,d,u(a,v,i),v)}const f=a.createView({dimension:"cube"}),r=n.createBindGroup({layout:this.pipelines.prefilter.getBindGroupLayout(0),entries:[{binding:1,resource:this.linear},{binding:2,resource:{buffer:this.bake.buffer}},{binding:3,resource:f}]});for(let i=0;i<k;i++)for(let d=0;d<6;d++)h(this.pipelines.prefilter,r,u(c,d,i),i*6+d);const b=n.createBindGroup({layout:this.pipelines.sh.getBindGroupLayout(0),entries:[{binding:1,resource:this.linear},{binding:2,resource:{buffer:this.bake.buffer}},{binding:3,resource:f},{binding:4,resource:{buffer:this.shBuffer}}]}),l=o.beginComputePass({label:"ibl-sh"});l.setPipeline(this.pipelines.sh),l.setBindGroup(0,b),l.dispatchWorkgroups(1),l.end();const m=n.createBuffer({size:144,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});o.copyBufferToBuffer(this.shBuffer,0,m,0,144),n.queue.submit([o.finish()]),this.env?.destroy(),this.spec?.destroy(),this.env=a,this.spec=c,this.group=n.createBindGroup({label:"ibl",layout:this.bindGroupLayout,entries:[{binding:0,resource:f},{binding:1,resource:c.createView({dimension:"cube"})},{binding:2,resource:this.lut.createView()},{binding:3,resource:this.linear},{binding:4,resource:{buffer:this.shBuffer}},{binding:5,resource:{buffer:this.params.buffer}}]}),this.version++,await m.mapAsync(GPUMapMode.READ);const y=new Float32Array(m.getMappedRange().slice(0));m.destroy();for(let i=0;i<9;i++)this.sh.set(y.subarray(i*4,i*4+3),i*3);const g=i=>.2126*this.sh[i*3]+.7152*this.sh[i*3+1]+.0722*this.sh[i*3+2],_=[g(3),g(1),g(2)],z=Math.hypot(..._)||1;this.dominantDirection=[_[0]/z,_[1]/z,_[2]/z]}destroy(){this.env?.destroy(),this.spec?.destroy(),this.lut.destroy(),this.shBuffer.destroy(),this.params.destroy(),this.bake.destroy()}}export{A as I,K as i,$ as p};
