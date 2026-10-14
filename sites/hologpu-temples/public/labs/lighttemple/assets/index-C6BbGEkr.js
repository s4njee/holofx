import{P as re,U as X,u as te,f as ae,c as se,H as ce}from"./post-YOyvqv1Z.js";import{s as oe,J as ie}from"./jump-flood-DPZk2Fyk.js";import{c as le,w as ue}from"./surface-CPzQGKfE.js";import{h as U}from"./gallery-CAjxCs5g.js";const fe=`// ---------------------------------------------------------------------------
// Radiance Cascades (2D) — global illumination from painted lights and walls.
//
// Scene texture: rgb = emitted radiance, a = solid (walls and emitters).
// A jump-flood SDF of the solids makes ray marching cheap.
//
// Cascade n (probe spacing 2^n, 4^(n+1) directions, ray interval
// [l0(4^n-1)/3, l0(4^(n+1)-1)/3]) is stored "probe-major": each probe owns a
// 2^(n+1) × 2^(n+1) block of texels, one per direction, so every cascade
// texture is the same size (2W × 2H). Cascades are traced and merged top-down:
// each texel marches its short interval, and if nothing is hit it continues
// with the 4-direction average of the 4 nearest probes of cascade n+1, using
// the "bilinear fix" so ray segments connect exactly between cascades.
// Cascade 0 then holds full-sphere radiance for every probe; averaging its 4
// directions gives the fluence that lights the floor.
// Requires (prepended): common.wgsl, sdf.wgsl, fullscreen.wgsl, \`Rc\`, \`RcPass\`, \`Brush\`.
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> rc: Rc;
@group(0) @binding(1) var scene_tex: texture_2d<f32>;
@group(0) @binding(2) var sdf_tex: texture_2d<f32>;
@group(0) @binding(3) var upper: texture_2d<f32>;
@group(0) @binding(4) var<uniform> pass_info: RcPass;
@group(0) @binding(5) var<uniform> brush: Brush;

fn in_bounds(q: vec2f) -> bool {
  return all(q >= vec2f(0.0)) && all(q < rc.giSize);
}

fn orb_dist(q: vec2f) -> f32 {
  return select(1e9, length(q - rc.orb.xy) - rc.orb.z, rc.orb.w > 0.5);
}

fn scene_dist(q: vec2f) -> f32 {
  let d = textureLoad(sdf_tex, vec2i(q), 0).r;
  return min(d, orb_dist(q));
}

fn scene_emission(q: vec2f) -> vec3f {
  if (orb_dist(q) < 1.0) { return rc.orbColor; }
  return textureLoad(scene_tex, vec2i(q), 0).rgb;
}

/// Sphere-traces the segment p0 -> p1. Returns (radiance, transmittance).
fn march(p0: vec2f, p1: vec2f) -> vec4f {
  let delta = p1 - p0;
  let len = length(delta);
  if (len < 1e-3) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let dir = delta / len;
  var t = 0.0;
  for (var i = 0; i < 64; i++) {
    let q = p0 + dir * t;
    if (!in_bounds(q)) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    let d = scene_dist(q);
    // Hit: the march stops just *outside* the surface, so read the emission one
    // texel further in (reading at q itself would see empty space, i.e. black).
    if (d < 0.75) { return vec4f(scene_emission(q + dir * (max(d, 0.0) + 1.0)), 0.0); }
    t += max(d, 0.5);
    if (t >= len) { break; }
  }
  return vec4f(0.0, 0.0, 0.0, 1.0);
}

fn pow4(n: u32) -> f32 { return f32(1u << (2u * n)); }

@fragment
fn fs_cascade(v: FullscreenOut) -> @location(0) vec4f {
  let n = pass_info.index;
  let texel = vec2u(v.position.xy);
  let b = 1u << (n + 1u);          // block side = sqrt(direction count)
  let count = b * b;
  let spacing = f32(1u << n);
  let probe = texel / b;
  let dxy = texel % b;
  let di = dxy.y * b + dxy.x;
  let angle = (f32(di) + 0.5) * TAU / f32(count);
  let dir = vec2f(cos(angle), sin(angle));
  let c = (vec2f(probe) + 0.5) * spacing;

  let start = rc.interval0 * (pow4(n) - 1.0) / 3.0;
  let end = rc.interval0 * (pow4(n + 1u) - 1.0) / 3.0;
  let p0 = c + dir * start;

  if (n + 1u >= rc.cascadeCount) {
    // Top cascade: rays that escape everything see the ambient "sky".
    let r = march(p0, c + dir * end);
    return vec4f(r.rgb + r.a * rc.sky, r.a);
  }

  // Merge with cascade n+1 using the "bilinear fix": for each of the 4 nearest
  // upper probes, march from this probe's interval start to where *that* probe's
  // interval starts, then continue with its 4 child directions. The segments
  // connect exactly, so there are no gaps or double counting between bands.
  let b1 = b * 2u;
  let spacing1 = spacing * 2.0;
  let probes1 = vec2i(ceil(rc.giSize / spacing1));
  let f = c / spacing1 - 0.5;
  let q0 = vec2i(floor(f));
  let w = fract(f);
  var out = vec4f(0.0);
  for (var j = 0; j < 4; j++) {
    let o = vec2i(j & 1, j >> 1);
    let q = clamp(q0 + o, vec2i(0), probes1 - 1);
    let bw = select(1.0 - w.x, w.x, o.x == 1) * select(1.0 - w.y, w.y, o.y == 1);
    let c1 = (vec2f(q) + 0.5) * spacing1;
    let seg = march(p0, c1 + dir * end);
    var far = vec4f(0.0);
    for (var k = 0u; k < 4u; k++) {
      let d1 = di * 4u + k;
      far += textureLoad(upper, vec2i(vec2u(q) * b1 + vec2u(d1 % b1, d1 / b1)), 0);
    }
    far *= 0.25;
    out += vec4f(seg.rgb + seg.a * far.rgb, seg.a * far.a) * bw;
  }
  return out;
}

// --- Display ---------------------------------------------------------------------

/// Average radiance over all directions at a cascade-0 probe.
fn probe_fluence(q: vec2i) -> vec3f {
  let base = q * 2;
  return (textureLoad(upper, base, 0).rgb + textureLoad(upper, base + vec2i(1, 0), 0).rgb +
          textureLoad(upper, base + vec2i(0, 1), 0).rgb + textureLoad(upper, base + vec2i(1, 1), 0).rgb) * 0.25;
}

@fragment
fn fs_display(v: FullscreenOut) -> @location(0) vec4f {
  let g = v.position.xy * rc.displayScale;
  let f = g - 0.5;
  let q0 = vec2i(floor(f));
  let w = fract(f);
  let maxq = vec2i(rc.giSize) - 1;
  let fl =
    mix(mix(probe_fluence(clamp(q0, vec2i(0), maxq)), probe_fluence(clamp(q0 + vec2i(1, 0), vec2i(0), maxq)), w.x),
        mix(probe_fluence(clamp(q0 + vec2i(0, 1), vec2i(0), maxq)), probe_fluence(clamp(q0 + vec2i(1, 1), vec2i(0), maxq)), w.x), w.y);

  // Floor: diffuse surface lit by the fluence (plus a little texture).
  let checker = select(1.0, 0.92, ((i32(floor(g.x / 24.0)) + i32(floor(g.y / 24.0))) & 1) == 1);
  var col = fl * rc.floorAlbedo * checker * rc.giStrength;

  let s = textureLoad(scene_tex, vec2i(g), 0);
  let d = scene_dist(g);
  // Solids: emitters show their emission, walls are dark matte blocks.
  let solid = smoothstep(0.5, -0.5, d);
  let emissive = max(s.r, max(s.g, s.b)) > 1e-3 || orb_dist(g) < 0.5;
  let surface = select(rc.wallColor, scene_emission(g), emissive);
  col = mix(col, surface, solid);
  if (rc.debugView == 2u) { col = fl; } // raw fluence (no albedo/texture), for measurement
  if (rc.debugView == 3u) {
    // Brute-force reference: 64 full-length rays from this pixel (slow; for validation).
    var acc = vec3f(0.0);
    for (var i = 0; i < 64; i++) {
      let a = (f32(i) + 0.5) * TAU / 64.0;
      let r = march(g, g + vec2f(cos(a), sin(a)) * 4096.0);
      acc += r.rgb + r.a * rc.sky;
    }
    col = acc / 64.0;
  }
  if (rc.debugView == 1u) { col = vec3f(abs(d) / 40.0) * select(vec3f(1.0, 0.6, 0.3), vec3f(0.3, 0.6, 1.0), d < 0.0); }
  return vec4f(col, 1.0);
}

// --- Scene authoring -------------------------------------------------------------------

/// Paints a capsule from brush.a to brush.b into the scene texture.
@fragment
fn fs_brush(v: FullscreenOut) -> @location(0) vec4f {
  let d = sd_capsule(v.position.xy, brush.a, brush.b, brush.radius);
  if (d > 0.0) { discard; }
  return brush.value;
}

/// A starter scene in normalised coordinates: coloured lamps, walls and a lantern.
@fragment
fn fs_seed(v: FullscreenOut) -> @location(0) vec4f {
  let p = v.position.xy / rc.giSize.y; // y in [0,1], x in [0, aspect]
  let a = rc.giSize.x / rc.giSize.y;
  var out = vec4f(0.0);
  var wall = 1e9;
  wall = min(wall, sd_box(p - vec2f(a * 0.42, 0.45), vec2f(a * 0.12, 0.012)));
  wall = min(wall, sd_box(p - vec2f(a * 0.72, 0.58), vec2f(0.012, 0.17)));
  wall = min(wall, sd_box(p - vec2f(a * 0.2, 0.72), vec2f(0.012, 0.12)));
  wall = min(wall, sd_box(p - vec2f(a * 0.5, 0.2), vec2f(0.03, 0.03)));
  // A ring with a gap around a lamp: light escapes through the opening.
  let ring = op_subtract(sd_ring(p - vec2f(a * 0.82, 0.25), 0.09, 0.008), sd_box(p - vec2f(a * 0.82, 0.32), vec2f(0.03, 0.05)));
  wall = min(wall, ring);
  if (wall < 0.0) { out = vec4f(0.0, 0.0, 0.0, 1.0); }

  var lamps = array<vec4f, 4>(
    vec4f(a * 0.15, 0.3, 0.035, 0.0), vec4f(a * 0.82, 0.25, 0.025, 1.0),
    vec4f(a * 0.5, 0.82, 0.03, 2.0), vec4f(a * 0.35, 0.62, 0.018, 3.0));
  var colors = array<vec3f, 4>(vec3f(2.4, 1.2, 0.35), vec3f(0.3, 1.6, 2.4), vec3f(2.2, 0.35, 1.6), vec3f(1.6, 1.6, 1.5));
  for (var i = 0; i < 4; i++) {
    if (length(p - lamps[i].xy) < lamps[i].z) { out = vec4f(colors[i] * rc.seedIntensity, 1.0); }
  }
  return out;
}
`,J="rgba16float",de={index:"u32",pad0:"u32",pad1:"u32",pad2:"u32"},he=async V=>{const{device:a,surface:K,params:G,pointer:u}=V,Q=window.matchMedia("(pointer: coarse)").matches,o=G.add({tool:{value:"light",options:{"Paint light":"light","Paint wall":"wall",Erase:"erase"},hint:"Drag on the canvas to paint."},brushColor:{value:"#ffb36b",type:"color",label:"Light colour"},brushIntensity:{value:2.5,min:.1,max:10,step:.1,label:"Brightness"},brushSize:{value:10,min:2,max:60,step:1,label:"Brush (px)"},cursorLight:{value:!0,label:"Cursor light",hint:"A lamp that follows the pointer (while not painting)."},cursorColor:{value:"#fff1d6",type:"color",label:"Cursor colour"}},"Paint"),s=G.add({scale:{value:Q?.25:.5,options:{"Quarter res":.25,"Half res":.5,"Full res":1},label:"GI resolution"},interval:{value:1.5,min:.5,max:8,step:.1,label:"Base interval",hint:"Ray length of cascade 0 in probe texels; each cascade is 4× longer."},sky:{value:"#0d1424",type:"color",label:"Ambient sky"},floor:{value:.85,min:0,max:1,step:.01,label:"Floor albedo"},wall:{value:"#1b1b20",type:"color"},view:{value:0,options:{Lit:0,"Distance field":1,"Raw fluence":2,"Reference (64 rays)":3}}},"Cascades");G.button("Reset scene",()=>R=!0),G.button("Clear",()=>B=!0);const M=await re.create(V,{bloom:.08,vignette:.25,grain:.02}),x=new X(a,"Rc",{orb:"vec4f",giSize:"vec2f",cascadeCount:"u32",interval0:"f32",orbColor:"vec3f",displayScale:"f32",sky:"vec3f",floorAlbedo:"f32",wallColor:"vec3f",giStrength:"f32",seedIntensity:"f32",debugView:"u32"}),P=new X(a,"Brush",{value:"vec4f",a:"vec2f",b:"vec2f",radius:"f32"}),E=await le(a,"radiance-cascades",ue(se,oe,ae,x.wgslStruct,te("RcPass",de),P.wgslStruct,fe)),A=(r,i)=>a.createRenderPipelineAsync({label:`rc:${r}`,layout:"auto",vertex:{module:E,entryPoint:"vs_fullscreen"},fragment:{module:E,entryPoint:r,targets:[{format:i}]}}),[I,O,D,F]=await Promise.all([A("fs_cascade","rgba16float"),A("fs_display",ce),A("fs_brush",J),A("fs_seed",J)]),H=new ie(a),N=8,j=Array.from({length:N},(r,i)=>{const t=a.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});return a.queue.writeBuffer(t,0,new Uint32Array([i,0,0,0])),t});let C=null,R=!0,B=!1,k=!0;const Y=(r,i,t)=>{const _=Math.max(16,Math.round(r*t)),e=Math.max(16,Math.round(i*t)),l=s.interval,f=Math.hypot(_,e);let c=1;for(;c<N&&l*(4**c-1)/3<f;)c++;const v=2**(c-1),d=Math.ceil(_/v)*v,p=Math.ceil(e/v)*v,h=($,T,ee,ne)=>a.createTexture({label:ee,size:[$,T],format:"rgba16float",usage:ne}),q=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING,g=h(d,p,"rc-scene",q),n=h(d,p,"rc-sdf",GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING),m=[h(d*2,p*2,"rc-cascade-a",q),h(d*2,p*2,"rc-cascade-b",q)],w=Array.from({length:c},($,T)=>a.createBindGroup({layout:I.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:x.buffer}},{binding:1,resource:g.createView()},{binding:2,resource:n.createView()},{binding:3,resource:m[(T+1)%2].createView()},{binding:4,resource:{buffer:j[T]}}]})),S=a.createBindGroup({layout:O.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:x.buffer}},{binding:1,resource:g.createView()},{binding:2,resource:n.createView()},{binding:3,resource:m[0].createView()}]}),y=a.createBindGroup({layout:F.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:x.buffer}}]}),Z=a.createBindGroup({layout:D.getBindGroupLayout(0),entries:[{binding:5,resource:{buffer:P.buffer}}]});return{giW:d,giH:p,cascades:c,scene:g,sdf:n,tex:m,cascadeGroups:w,displayGroup:S,seedGroup:y,brushGroup:Z}},W=r=>{r?.scene.destroy(),r?.sdf.destroy(),r?.tex.forEach(i=>i.destroy())};let L=null,b=[.5,.5],z="";return{frame({time:r,dt:i,size:t}){const _=`${t.width}x${t.height}@${s.scale}:${s.interval}`;_!==z&&(z=_,W(C),C=Y(t.width,t.height,s.scale),R=!0);const e=C,l=s.scale,f=a.createCommandEncoder({label:"radiance-cascades"}),c=(n,m,w,S)=>{const y=f.beginRenderPass({colorAttachments:[{view:w.createView(),loadOp:S,storeOp:"store",clearValue:[0,0,0,0]}]});y.setPipeline(n),y.setBindGroup(0,m),y.draw(3),y.end()},v=u.down&&u.inside,d=!u.inside||u.idle>4,p=d?[e.giW*(.5+.3*Math.sin(r*.35)),e.giH*(.55+.25*Math.sin(r*.5))]:[u.uv[0]*t.width*l,u.uv[1]*t.height*l],h=1-Math.pow(2,-i/(d?.6:.04));b=[b[0]+(p[0]-b[0])*h,b[1]+(p[1]-b[1])*h];const q=U(o.cursorColor);if(x.set("orb",[b[0],b[1],7*l*2,o.cursorLight&&!v?1:0]).set("giSize",[e.giW,e.giH]).set("cascadeCount",e.cascades).set("interval0",s.interval).set("orbColor",q.map(n=>n*3)).set("displayScale",l).set("sky",U(s.sky)).set("floorAlbedo",s.floor).set("wallColor",U(s.wall)).set("giStrength",1).set("seedIntensity",1).set("debugView",s.view).upload(),(R||B)&&(B?f.beginRenderPass({colorAttachments:[{view:e.scene.createView(),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,0]}]}).end():c(F,e.seedGroup,e.scene,"clear"),R=B=!1,k=!0),v){const n=[u.uv[0]*t.width*l,u.uv[1]*t.height*l],m=L??n,w=U(o.brushColor),S=o.tool==="light"?[w[0]*o.brushIntensity,w[1]*o.brushIntensity,w[2]*o.brushIntensity,1]:o.tool==="wall"?[0,0,0,1]:[0,0,0,0];P.set("value",S).set("a",m).set("b",n).set("radius",o.brushSize*l).upload(),c(D,e.brushGroup,e.scene,"load"),L=n,k=!0}else L=null;k&&(H.encode(f,e.scene,e.sdf),k=!1);for(let n=e.cascades-1;n>=0;n--)c(I,e.cascadeGroups[n],e.tex[n%2],"clear");const g=f.beginRenderPass({colorAttachments:[{view:M.scene(t).view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});g.setPipeline(O),g.setBindGroup(0,e.displayGroup),g.draw(3),g.end(),M.render(f,K.currentTexture().createView(),{time:r,raw:s.view!==0}),a.queue.submit([f.finish()])},dispose(){W(C),H.destroy(),j.forEach(r=>r.destroy()),x.destroy(),P.destroy(),M.destroy()}}};export{he as default};
