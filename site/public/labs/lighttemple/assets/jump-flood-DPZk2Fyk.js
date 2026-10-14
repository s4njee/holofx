const m=`// ---------------------------------------------------------------------------
// sdf.wgsl — signed distance primitives and operators (after Inigo Quilez).
// 2D primitives are \`sd_*\`, 3D ones \`sd_*3\`. Negative = inside.
// ---------------------------------------------------------------------------

// --- Transforms ------------------------------------------------------------------

fn rot2(a: f32) -> mat2x2f {
  let c = cos(a); let s = sin(a);
  return mat2x2f(c, s, -s, c);
}

// --- 2D primitives -----------------------------------------------------------------

fn sd_circle(p: vec2f, r: f32) -> f32 { return length(p) - r; }

fn sd_box(p: vec2f, half_size: vec2f) -> f32 {
  let d = abs(p) - half_size;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sd_round_box(p: vec2f, half_size: vec2f, r: f32) -> f32 {
  let q = abs(p) - half_size + r;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

/// Capsule / pill between a and b.
fn sd_capsule(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 { return sd_segment(p, a, b) - r; }

fn sd_ring(p: vec2f, r: f32, thickness: f32) -> f32 { return abs(length(p) - r) - thickness; }

fn sd_equilateral_triangle(p_in: vec2f, r: f32) -> f32 {
  let k = sqrt(3.0);
  var p = vec2f(abs(p_in.x) - r, p_in.y + r / k);
  if (p.x + k * p.y > 0.0) { p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0; }
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

// --- 3D primitives -----------------------------------------------------------------

fn sd_sphere3(p: vec3f, r: f32) -> f32 { return length(p) - r; }

fn sd_box3(p: vec3f, half_size: vec3f) -> f32 {
  let q = abs(p) - half_size;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sd_round_box3(p: vec3f, half_size: vec3f, r: f32) -> f32 {
  return sd_box3(p, half_size - r) - r;
}

/// Torus in the XZ plane: t.x = major radius, t.y = tube radius.
fn sd_torus3(p: vec3f, t: vec2f) -> f32 {
  return length(vec2f(length(p.xz) - t.x, p.y)) - t.y;
}

fn sd_capsule3(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

/// Vertical cylinder centred at the origin.
fn sd_cylinder3(p: vec3f, radius: f32, half_height: f32) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(radius, half_height);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sd_plane3(p: vec3f, n: vec3f, h: f32) -> f32 { return dot(p, n) + h; }

/// Extrudes a 2D distance \`d2\` along z to half-depth \`h\` (2D text/logos -> 3D).
fn op_extrude(d2: f32, z: f32, h: f32) -> f32 {
  let w = vec2f(d2, abs(z) - h);
  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));
}

// --- Operators (work for 2D and 3D) -------------------------------------------------

fn op_union(a: f32, b: f32) -> f32 { return min(a, b); }
fn op_subtract(a: f32, b: f32) -> f32 { return max(a, -b); }
fn op_intersect(a: f32, b: f32) -> f32 { return max(a, b); }
fn op_round(d: f32, r: f32) -> f32 { return d - r; }
fn op_onion(d: f32, thickness: f32) -> f32 { return abs(d) - thickness; }

/// Polynomial smooth minimum; \`k\` is the blend radius in distance units.
fn op_smooth_union(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / max(k, 1e-6);
  return min(a, b) - h * h * k * 0.25;
}

fn op_smooth_subtract(a: f32, b: f32, k: f32) -> f32 { return -op_smooth_union(-a, b, k); }
fn op_smooth_intersect(a: f32, b: f32, k: f32) -> f32 { return -op_smooth_union(-a, -b, k); }
`,h=`// ---------------------------------------------------------------------------
// jfa.wgsl — signed distance field from an anti-aliased coverage mask via the
// Jump Flooding Algorithm (Rong & Tan 2006).
//
//   cs_seed:  pixels on either side of the 0.5-coverage boundary become seeds.
//             Each stores the *sub-pixel* edge point, estimated from the
//             coverage value and its gradient, so the field is accurate to a
//             fraction of a pixel (plain JFA is only accurate to ~0.5 px).
//   cs_flood: log2(N) passes with halving step: adopt a neighbour's seed if closer.
//   cs_resolve: signed Euclidean distance in pixels (negative inside) -> rgba16float.
// ---------------------------------------------------------------------------

struct JfaParams { step: i32 };

@group(0) @binding(0) var mask: texture_2d<f32>;
@group(0) @binding(1) var seeds_in: texture_2d<f32>;
@group(0) @binding(2) var seeds_out: texture_storage_2d<rg32float, write>;
@group(0) @binding(3) var sdf_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> jfa: JfaParams;

const NO_SEED = vec2f(-1e6, -1e6);

fn coverage(p: vec2i) -> f32 {
  let dims = vec2i(textureDimensions(mask));
  if (any(p < vec2i(0)) || any(p >= dims)) { return 0.0; }
  return textureLoad(mask, p, 0).a;
}

@compute @workgroup_size(8, 8)
fn cs_seed(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec2i(textureDimensions(mask));
  let p = vec2i(id.xy);
  if (any(p >= dims)) { return; }
  let c = coverage(p);
  let inside = c >= 0.5;
  let boundary =
    (coverage(p + vec2i(1, 0)) >= 0.5) != inside || (coverage(p - vec2i(1, 0)) >= 0.5) != inside ||
    (coverage(p + vec2i(0, 1)) >= 0.5) != inside || (coverage(p - vec2i(0, 1)) >= 0.5) != inside;
  var seed = NO_SEED;
  if (boundary) {
    let g = vec2f(coverage(p + vec2i(1, 0)) - coverage(p - vec2i(1, 0)), coverage(p + vec2i(0, 1)) - coverage(p - vec2i(0, 1))) * 0.5;
    let center = vec2f(p) + 0.5;
    let gl = length(g);
    // Coverage changes by |g| per pixel along g; walk to where it equals 0.5.
    let offset = select(vec2f(0.0), -g / gl * clamp((c - 0.5) / gl, -1.0, 1.0), gl > 1e-4);
    seed = center + offset;
  }
  textureStore(seeds_out, p, vec4f(seed, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn cs_flood(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec2i(textureDimensions(seeds_in));
  let p = vec2i(id.xy);
  if (any(p >= dims)) { return; }
  let here = vec2f(p) + 0.5;
  var best = textureLoad(seeds_in, p, 0).xy;
  var best_d = select(1e12, dot(best - here, best - here), best.x > -1e5);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = p + vec2i(x, y) * jfa.step;
      if (any(q < vec2i(0)) || any(q >= dims)) { continue; }
      let s = textureLoad(seeds_in, q, 0).xy;
      if (s.x <= -1e5) { continue; }
      let d = dot(s - here, s - here);
      if (d < best_d) {
        best_d = d;
        best = s;
      }
    }
  }
  textureStore(seeds_out, p, vec4f(best, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn cs_resolve(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec2i(textureDimensions(seeds_in));
  let p = vec2i(id.xy);
  if (any(p >= dims)) { return; }
  let s = textureLoad(seeds_in, p, 0).xy;
  let here = vec2f(p) + 0.5;
  let dist = select(1e4, length(s - here), s.x > -1e5);
  let d = select(dist, -dist, coverage(p) >= 0.5);
  textureStore(sdf_out, p, vec4f(d, 0.0, 0.0, 1.0));
}
`;class x{constructor(e){this.device=e;const n=GPUShaderStage.COMPUTE;this.layout=e.createBindGroupLayout({label:"jfa",entries:[{binding:0,visibility:n,texture:{sampleType:"float"}},{binding:1,visibility:n,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:n,storageTexture:{access:"write-only",format:"rg32float"}},{binding:3,visibility:n,storageTexture:{access:"write-only",format:"rgba16float"}},{binding:4,visibility:n,buffer:{type:"uniform"}}]});const o=e.createShaderModule({label:"jfa",code:h}),r=e.createPipelineLayout({bindGroupLayouts:[this.layout]}),s=t=>e.createComputePipeline({label:`jfa:${t}`,layout:r,compute:{module:o,entryPoint:t}});this.seed=s("cs_seed"),this.flood=s("cs_flood"),this.resolve=s("cs_resolve")}device;layout;seed;flood;resolve;scratch=new Map;scratchFor(e,n){const o=`${e}x${n}`;let r=this.scratch.get(o);if(!r){const s=this.device,t=()=>s.createTexture({label:"jfa-seeds",size:[e,n],format:"rg32float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}),c=[0];for(let i=2**Math.floor(Math.log2(Math.max(e,n)));i>=1;i>>=1)c.push(i);c.push(1);const u=c.map(i=>{const l=s.createBuffer({label:"jfa-step",size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});return s.queue.writeBuffer(l,0,new Int32Array([i,0,0,0])),l});r={a:t(),b:t(),steps:u},this.scratch.set(o,r)}return r}encode(e,n,o){const{width:r,height:s}=n,t=this.scratchFor(r,s),c=n.createView(),u=o.createView(),i=(a,v,f)=>this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:c},{binding:1,resource:a.createView()},{binding:2,resource:v.createView()},{binding:3,resource:u},{binding:4,resource:{buffer:f}}]}),l=Math.ceil(r/8),b=Math.ceil(s/8),g=(a,v)=>{const f=e.beginComputePass({label:a.label});f.setPipeline(a),f.setBindGroup(0,v),f.dispatchWorkgroups(l,b),f.end()};g(this.seed,i(t.b,t.a,t.steps[0]));let d=t.a,p=t.b;for(let a=1;a<t.steps.length;a++)g(this.flood,i(d,p,t.steps[a])),[d,p]=[p,d];g(this.resolve,i(d,p,t.steps[0]))}trim(){for(const e of this.scratch.values()){e.a.destroy(),e.b.destroy();for(const n of e.steps)n.destroy()}this.scratch.clear()}destroy(){this.trim()}}export{x as J,m as s};
