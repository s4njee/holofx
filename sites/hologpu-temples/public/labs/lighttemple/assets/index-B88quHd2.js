import{P as ee,a as te,U as ne,f as se,c as ie,H as ae}from"./post-YOyvqv1Z.js";import{s as oe}from"./jump-flood-DPZk2Fyk.js";import{c as le,w as re}from"./surface-CPzQGKfE.js";import{T as ce}from"./text-sdf-HQH47OTV.js";import{h as M}from"./gallery-CAjxCs5g.js";const de=`// ---------------------------------------------------------------------------
// Long Shadows — flat-design "long shadow" icons, done with SDF sweeps.
//
// A long shadow is the shape swept along the light direction: a point p is in
// shadow if some p - dir·t (0 <= t <= L) lies inside the shape. We sphere-trace
// that backwards: d = sdf(p - dir·t) is a safe step, so a handful of steps
// cover hundreds of pixels. The hit distance t also gives a fade-out, and the
// clearance gives a little anti-aliasing at the shadow's edges.
//
// Two levels, like classic flat icons: tiles cast shadows onto the page, and
// each tile's glyph casts a shadow that stays inside its tile.
// Requires (prepended): common.wgsl, sdf.wgsl, fullscreen.wgsl, \`Flat\`.
// ---------------------------------------------------------------------------

struct Tile {
  // centre.xy, half size.zw (px)
  rect: vec4f,
  // glyph region in the text SDF texture (u0, v0, u1, v1)
  glyph_uv: vec4f,
  // rgb colour, a = corner radius (px)
  color: vec4f,
  // x = px per text texel, yz = offset (texels) from the region centre to the glyph's visual centre
  glyph: vec4f,
};

@group(0) @binding(0) var<uniform> u: Flat;
@group(0) @binding(1) var<storage, read> tiles: array<Tile>;
@group(0) @binding(2) var text_sdf: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;

fn sd_tile(p: vec2f, i: u32) -> f32 {
  let t = tiles[i];
  let r = t.color.a;
  return mix(sd_round_box(p - t.rect.xy, t.rect.zw, r), length(p - t.rect.xy) - t.rect.z, u.circles);
}

fn sd_tiles(p: vec2f) -> f32 {
  var d = 1e9;
  for (var i = 0u; i < u.count; i++) { d = min(d, sd_tile(p, i)); }
  return d;
}

/// Glyph of tile i, from its slice of the text SDF (px).
fn sd_glyph(p: vec2f, i: u32) -> f32 {
  let t = tiles[i];
  let dims = vec2f(textureDimensions(text_sdf));
  let texel = (p - t.rect.xy) / t.glyph.x; // texels from the tile centre
  let centre = vec2f(0.5 * (t.glyph_uv.x + t.glyph_uv.z), 0.5 * (t.glyph_uv.y + t.glyph_uv.w)) * dims;
  let tp = centre + texel + t.glyph.yz;
  let lo = t.glyph_uv.xy * dims;
  let hi = t.glyph_uv.zw * dims;
  let box = sd_box(tp - 0.5 * (lo + hi), 0.5 * (hi - lo));
  let d = textureSampleLevel(text_sdf, lin, clamp(tp, lo, hi) / dims, 0.0).r;
  return max(d, box) * t.glyph.x;
}

/// Exact long shadow of a convex tile: distance from p to the tile swept along
/// dir over [0, L]. The distance from points on a line to a convex set is a
/// convex function, so a ternary search finds the minimum in a few steps.
/// Returns (swept distance, t at the minimum).
fn sweep_tile(p: vec2f, i: u32) -> vec2f {
  var lo = 0.0;
  var hi = u.length;
  for (var k = 0; k < 22; k++) {
    let m1 = lo + (hi - lo) / 3.0;
    let m2 = hi - (hi - lo) / 3.0;
    if (sd_tile(p - u.dir * m1, i) < sd_tile(p - u.dir * m2, i)) { hi = m2; } else { lo = m1; }
  }
  let t = 0.5 * (lo + hi);
  return vec2f(sd_tile(p - u.dir * t, i), t);
}

/// Long-shadow coverage of the page at p, 0 (lit) .. 1 (full shadow).
fn sweep_tiles(p: vec2f) -> f32 {
  var best = 1e9;
  var best_t = 0.0;
  for (var i = 0u; i < u.count; i++) {
    let r = tiles[i].rect;
    // Cheap reject: outside the capsule bounding the whole sweep.
    if (sd_capsule(p, r.xy, r.xy + u.dir * u.length, length(r.zw)) > 1.0) { continue; }
    let s = sweep_tile(p, i);
    if (s.x < best) {
      best = s.x;
      best_t = s.y;
    }
  }
  return smoothstep(0.75, -0.75, best) * (1.0 - u.fade * best_t / u.length);
}

/// Glyph shadows (non-convex, short): dense uniform samples along the sweep.
/// Each sample's coverage is softened by half a step, so the union of samples
/// is continuous and anti-aliased (sphere tracing streaks at grazing angles here).
fn sweep_glyph(p: vec2f, i: u32) -> f32 {
  let limit = 2.0 * length(tiles[i].rect.zw); // never longer than the tile
  let n = 48.0;
  let step = limit / n;
  var cover = 0.0;
  for (var k = 1.0; k <= n; k += 1.0) {
    let t = k * step;
    let c = smoothstep(0.6 * step, -0.6 * step, sd_glyph(p - u.dir * t, i)) * (1.0 - u.fade * t / u.length);
    cover = max(cover, c);
  }
  return cover;
}

@fragment
fn fs_main(v: FullscreenOut) -> @location(0) vec4f {
  let p = v.position.xy;
  // Page with its long shadows (multiplied, like a darker flat tint).
  var col = u.background;
  col = mix(col, col * u.shadowTint, sweep_tiles(p) * u.shadowStrength);

  for (var i = 0u; i < u.count; i++) {
    let d = sd_tile(p, i);
    let cover = smoothstep(0.75, -0.75, d);
    if (cover <= 0.0) { continue; }
    var c = tiles[i].color.rgb;
    c = mix(c, c * u.shadowTint, sweep_glyph(p, i) * u.shadowStrength);
    let g = smoothstep(0.75, -0.75, sd_glyph(p, i));
    c = mix(c, u.glyphColor, g);
    col = mix(col, c, cover);
  }
  return vec4f(col, 1.0);
}
`,y=10,P=16,W={sunset:{background:"#f4a259",tiles:["#e76f51","#2a9d8f","#264653","#e9c46a","#8ab17d"],glyph:"#fdf6ec"},mint:{background:"#2ec4b6",tiles:["#ff9f1c","#e71d36","#011627","#fdfffc","#ffbf69"],glyph:"#fdfffc"},midnight:{background:"#1d2440",tiles:["#5e60ce","#48bfe3","#ff6b6b","#ffd166","#06d6a0"],glyph:"#fdfdfd"}},me=async z=>{const{device:n,surface:H,params:A,pointer:f}=z,t=A.add({word:{value:"SHADOW",type:"text",maxLength:y},palette:{value:"sunset",options:{Sunset:"sunset",Mint:"mint",Midnight:"midnight"}},shape:{value:0,options:{"Rounded square":0,Circle:1}},angle:{value:45,min:-180,max:180,step:1,label:"Angle (°)",hint:"Used when the pointer is away; otherwise the light sits at the pointer."},length:{value:.9,min:.05,max:3,step:.01,label:"Length",hint:'In canvas heights; large values feel "infinite".'},fade:{value:.65,min:0,max:1,step:.01,hint:"0 = solid flat shadow, 1 = fades to nothing at full length."},strength:{value:.7,min:0,max:1,step:.01,label:"Darkness"}},"Design"),x=await ee.create(z,{tonemap:te.None,bloom:0,vignette:0,grain:.015}),b=new ce(n),F='"Helvetica Neue", Arial, ui-sans-serif, system-ui, sans-serif',L=d=>[...d.trim()||" "].join("  ");let e=await b.generate({text:L(t.word),family:F,weight:800,size:220});const u=new ne(n,"Flat",{background:"vec3f",count:"u32",shadowTint:"vec3f",length:"f32",glyphColor:"vec3f",fade:"f32",dir:"vec2f",circles:"f32",shadowStrength:"f32"}),_=n.createBuffer({label:"tiles",size:y*P*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),c=new Float32Array(y*P),G=await le(n,"long-shadows",re(ie,oe,se,u.wgslStruct,de)),D=await n.createRenderPipelineAsync({label:"long-shadows",layout:"auto",vertex:{module:G,entryPoint:"vs_fullscreen"},fragment:{module:G,entryPoint:"fs_main",targets:[{format:ae}]}}),q=n.createSampler({magFilter:"linear",minFilter:"linear"}),E=()=>n.createBindGroup({layout:D.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:u.buffer}},{binding:1,resource:{buffer:_}},{binding:2,resource:e.texture.createView()},{binding:3,resource:q}]});let O=E(),R=t.word,T=0;A.onChange(()=>{clearTimeout(T),T=window.setTimeout(async()=>{if(t.word===R)return;R=t.word;const d=await b.generate({text:L(t.word),family:F,weight:800,size:220});e.destroy(),e=d,O=E()},200)});let a=[Math.SQRT1_2,Math.SQRT1_2];return{frame({time:d,dt:I,size:B}){const{width:p,height:h}=B,g=W[t.palette]??W.sunset,r=e.letters.slice(0,y),m=Math.max(1,r.length),k=.22,o=Math.min(.86*p/(m+(m-1)*k),.34*h),N=m*o+(m-1)*k*o,V=e.baseline-e.padding,j=o*.52/Math.max(V,1);r.forEach((s,i)=>{const l=i*P,Q=(p-N)/2+o/2+i*o*(1+k),Y=h*.5,K=i>0?(s.start-r[i-1].end)/2:e.padding,X=i<r.length-1?(r[i+1].start-s.end)/2:e.padding,J=(s.start-K)/e.width,Z=(s.end+X)/e.width,$=(e.padding+e.baseline)/2;c.set([Q,Y,o/2,o/2],l),c.set([J,0,Z,1],l+4),c.set([...M(g.tiles[i%g.tiles.length]),o*.22],l+8),c.set([j,0,$-e.height/2,0],l+12)}),n.queue.writeBuffer(_,0,c);let v;if(f.inside&&f.idle<4){const s=p/2-f.uv[0]*p,i=h/2-f.uv[1]*h,l=Math.hypot(s,i)||1;v=[s/l,i/l]}else{const s=t.angle*Math.PI/180;v=[Math.cos(s),Math.sin(s)]}const C=1-Math.pow(2,-I/.12);a=[a[0]+(v[0]-a[0])*C,a[1]+(v[1]-a[1])*C];const U=Math.hypot(a[0],a[1])||1;u.set("background",M(g.background)).set("count",r.length).set("shadowTint",[.5,.46,.55]).set("length",t.length*h).set("glyphColor",M(g.glyph)).set("fade",t.fade).set("dir",[a[0]/U,a[1]/U]).set("circles",t.shape).set("shadowStrength",t.strength).upload();const S=n.createCommandEncoder({label:"long-shadows"}),w=S.beginRenderPass({colorAttachments:[{view:x.scene(B).view,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});w.setPipeline(D),w.setBindGroup(0,O),w.draw(3),w.end(),x.render(S,H.currentTexture().createView(),{time:d}),n.queue.submit([S.finish()])},dispose(){clearTimeout(T),e.destroy(),b.destroy(),_.destroy(),u.destroy(),x.destroy()}}};export{me as default};
