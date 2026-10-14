import{t as e}from"./meta-wSTCTj8n.js";import{a as t}from"./dom-rects-B6I5q5gG.js";import{n}from"./types-ci2WwWg0.js";import{n as r}from"./profiler-Bi27xYp-.js";import{n as i,r as a,t as o}from"./uniforms-BE1XSnDx.js";import{n as s}from"./pointer-BbHa9JHH.js";import{r as c,t as l}from"./fullscreen-Dq3Mq0Js.js";import{t as u}from"./fluid-Bv7YHznw.js";import{t as d}from"./obstacles-CsV74c88.js";import{t as f}from"./fluid-stir-BpRr4raR.js";import{t as p}from"./demo-Bc3siY6S.js";import{t as m}from"./display-BU6xx9mF.js";import{t as h}from"./inlet-CPZhBfBE.js";var g=`// obstacle-drive.wgsl -- what the shapes and the tunnel do to the VELOCITY, as a custom pass for the
// solver's \`forces\` hook (it runs after the built-in forces and before the pressure projection, once per
// step). A fullscreen fragment pass over the staggered velocity texture ((W+1) x (H+1) texels, u in .x
// on the left face of a cell, v in .y on its top face; layout in fluid-core.wgsl) that writes every
// texel.
//
// MOVING SOLIDS. The solver's solids are static: a solid face has velocity zero and the projection
// keeps it so. A solid that MOVES therefore pushes nothing by itself: cells swept by its front are
// simply overwritten (their fluid and dye vanish) and the cells it leaves are born at rest. This pass
// supplies the missing boundary condition the standard way: in a thin band of fluid round each shape
// the NORMAL component of the velocity is relaxed to the normal component of the solid's own velocity
// (translation plus spin), the tangential part is left alone (the fluid slides along the surface).
// The projection that follows turns the discrepancy into a pressure, so the fluid ahead of a moving body
// is pushed round it and the fluid behind is drawn in after it. A static shape gets only "no flow into
// me" in the band, which the projection would enforce anyway.
//
// INFLOW. An optional band at the left edge pulls the velocity toward a target (the wind of the
// tunnel). With the solver's \`open\` boundary the cells outside are air at pressure 0, which cannot
// carry a velocity, so the inflow is a body-force band instead of a boundary condition: inside the band
// the velocity is blended toward the target by \`inlet.w\` every step, which the projection then makes
// consistent with the solids downstream.
//
// Bindings: 0 the shape table (ObstacleTable), 1 the velocity to read, 2 the parameters.

#include "fullscreen.wgsl"
#include "obstacle-shapes.wgsl"
#include "obstacle_table.wgsl"
#include "drive_params.wgsl"

@group(0) @binding(0) var<uniform> T: ObstacleTable;
@group(0) @binding(1) var vel: texture_2d<f32>;
@group(0) @binding(2) var<uniform> D: DriveParams;

// The nearest shape within the band of the point: (weight 0..1, shape index). Weight 1 is inside.
fn nearest(p: vec2f, band: f32) -> vec2f {
  var best = vec2f(0.0, -1.0);
  for (var i = 0u; i < T.count; i++) {
    let d = obstacle_sd(T.data[3u * i], T.data[3u * i + 1u], p);
    if (d < band) {
      let w = 1.0 - smoothstep(0.0, band, d);
      if (w > best.x) {
        best = vec2f(w, f32(i));
      }
    }
  }
  return best;
}

fn load_vel(t: vec2i) -> vec2f {
  let size = vec2i(D.grid) + vec2i(1);
  return textureLoad(vel, clamp(t, vec2i(0), size - vec2i(1)), 0).xy;
}

// The fluid velocity vector at a u face (axis 0) or v face (axis 1): the stored component and the
// average of the four surrounding faces of the other one.
fn fluid_at(axis: u32, t: vec2i) -> vec2f {
  if (axis == 0u) {
    let v = 0.25 * (load_vel(t + vec2i(-1, 0)).y + load_vel(t).y
                  + load_vel(t + vec2i(-1, 1)).y + load_vel(t + vec2i(0, 1)).y);
    return vec2f(load_vel(t).x, v);
  }
  let u = 0.25 * (load_vel(t + vec2i(0, -1)).x + load_vel(t + vec2i(1, -1)).x
                + load_vel(t).x + load_vel(t + vec2i(1, 0)).x);
  return vec2f(u, load_vel(t).y);
}

// The new value of one face component.
fn drive(axis: u32, t: vec2i) -> f32 {
  let g = vec2i(D.grid);
  // Position of the face in cells, then in image heights.
  var cells = vec2f(f32(t.x), f32(min(t.y, g.y - 1)) + 0.5);
  if (axis == 1u) {
    cells = vec2f(f32(min(t.x, g.x - 1)) + 0.5, f32(t.y));
  }
  let p = cells / D.grid.y;
  let own = fluid_at(axis, t);
  var value = select(own.y, own.x, axis == 0u);

  if (T.count > 0u && D.coupling > 0.0) {
    let hit = nearest(p, D.band / D.grid.y);
    if (hit.x > 0.0) {
      let i = u32(hit.y);
      let geo = T.data[3u * i];
      let size = T.data[3u * i + 1u];
      let motion = T.data[3u * i + 2u];
      let n = obstacle_normal(geo, size, p);
      let body = clamp_speed(obstacle_velocity(geo, motion, p));
      let along = dot(body, n) - dot(own, n);
      let slip_update = select(n.y, n.x, axis == 0u) * along;
      let stick_update = select(body.y, body.x, axis == 0u) - value;
      // A body that is standing still only gets free slip (the tunnel's pegs must not be sticky); one
      // that moves drags the fluid in the band along.
      let stick = D.stick * smoothstep(0.02, 0.2, length(body));
      value += D.coupling * hit.x * mix(slip_update, stick_update, stick);
    }
  }

  // The inlet: a smooth band at the left edge, in image heights.
  if (D.inlet.w > 0.0) {
    let w = D.inlet.w * (1.0 - smoothstep(D.inlet.z * 0.5, D.inlet.z, p.x));
    value = mix(value, select(D.inlet.y, D.inlet.x, axis == 0u), w);
  }
  return clamp(value, -D.vmax, D.vmax);
}

fn clamp_speed(v: vec2f) -> vec2f {
  let l = length(v);
  return select(v, v * (D.vmax / l), l > D.vmax);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let t = vec2i(in.position.xy);
  return vec4f(drive(0u, t), drive(1u, t), 0.0, 0.0);
}
`,_=`// obstacle-raster.wgsl -- draws the shape table into the fluid's obstacle mask: one r8unorm texel per
// solver cell, 1 where the CELL CENTRE is inside any shape (distance <= T.grow), else 0. The solver
// reads >= 0.5 as solid (src/gpu/sim/obstacles.ts). A plain fragment pass over the mask; uv origin is
// top-left, which is row 0 of the mask.
//
// The mask is binary and blocky (a staircase of cells); the shapes are drawn crisply by the shading
// pass from the same table, which is what hides the staircase.

#include "fullscreen.wgsl"
#include "obstacle-shapes.wgsl"
#include "obstacle_table.wgsl"

@group(0) @binding(0) var<uniform> T: ObstacleTable;

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let p = in.uv * vec2f(T.aspect, 1.0);
  var d = 1e9;
  for (var i = 0u; i < T.count; i++) {
    d = min(d, obstacle_sd(T.data[3u * i], T.data[3u * i + 1u], p));
  }
  return vec4f(select(0.0, 1.0, d <= T.grow), 0.0, 0.0, 1.0);
}
`,v=`// obstacle-shapes.wgsl -- analytic solid shapes for the fluid solver's obstacle mask
// (src/gpu/sim/obstacle-shapes.ts), as a library chunk: no bindings, only functions of a shape's
// three vec4f records. The rasteriser (obstacle-raster.wgsl), the moving-boundary pass
// (obstacle-drive.wgsl) and an effect's own shading pass all include this, so the cells the solver
// treats as solid and the outline the viewer sees come from the same numbers.
//
// COORDINATES. \`p\` is a point in IMAGE HEIGHTS with y down: (uv.x * aspect, uv.y). Distances are in
// the same unit. Negative is inside.
//
// THE RECORD (what \`T.data[3 * i + k]\` holds, see ObstacleTable in obstacle-shapes.ts):
//   geo     (cx, cy, cos a, sin a)    centre in image heights and the rotation a. A positive angle turns
//                                     the shape CLOCKWISE on the screen (y is down).
//   size    (hx, hy, radius, kind)    half extents in the shape's own frame (x along its long axis),
//                                     a corner radius, and the kind (the OBSTACLE_* constants below)
//   motion  (vx, vy, spin, 0)         velocity of the centre (image heights / s) and angular velocity
//                                     (rad / s, positive clockwise on screen)
//
//   obstacle_local(geo, p) -> vec2f                p in the shape's own frame (centre at the origin)
//   obstacle_sd(geo, size, p) -> f32               signed distance to the shape: exact for the circle, box,
//                                                  rounded box, capsule and the wing (a tapered
//                                                  capsule); a true distance outside, within a fraction
//                                                  of it inside
//   obstacle_sd_wing(q, half_chord, half_thickness) -> f32   the wing alone, in its own frame
//   obstacle_normal(geo, size, p) -> vec2f         unit outward normal (central differences of obstacle_sd)
//   obstacle_velocity(geo, motion, p) -> vec2f     velocity of the solid at p: v + spin x (p - centre)
//
// SHAPES. circle: radius hx. box: half extents (hx, hy). rounded-box: a box with corners of \`radius\`.
// capsule: a stadium, outer half extents (hx, hy), end caps of radius hy. wing: a symmetric teardrop
// with a round leading edge of radius hy at -x and a sharp trailing edge at +x, half chord hx. It is
// the convex hull of two circles (the leading edge and a tiny one at the tail), which is the
// "uneven capsule" distance of Inigo Quilez; rotate it for an angle of attack.
//
// Cost: a few dozen ALU per shape.

#include "sdf.wgsl"

const OBSTACLE_CIRCLE: f32 = 0.0;
const OBSTACLE_BOX: f32 = 1.0;
const OBSTACLE_ROUNDED_BOX: f32 = 2.0;
const OBSTACLE_CAPSULE: f32 = 3.0;
const OBSTACLE_WING: f32 = 4.0;

fn obstacle_local(geo: vec4f, p: vec2f) -> vec2f {
  let d = p - geo.xy;
  return vec2f(d.x * geo.z + d.y * geo.w, -d.x * geo.w + d.y * geo.z);
}

fn obstacle_sd_wing(q: vec2f, half_chord: f32, half_thickness: f32) -> f32 {
  let r1 = half_thickness;
  let r2 = max(half_thickness * 0.05, 1e-4);
  let c = max(half_chord, r1 * 1.5);
  // Circle 1 (leading edge) at x1, circle 2 (the tail) at x2: both on the axis.
  let x1 = -c + r1;
  let x2 = c - r2;
  let h = x2 - x1;
  let p = vec2f(abs(q.y), q.x - x1);
  let b = (r1 - r2) / h;
  let a = sqrt(max(1.0 - b * b, 0.0));
  let k = dot(p, vec2f(-b, a));
  if (k < 0.0) {
    return length(p) - r1;
  }
  if (k > a * h) {
    return length(p - vec2f(0.0, h)) - r2;
  }
  return dot(p, vec2f(a, b)) - r1;
}

fn obstacle_sd(geo: vec4f, size: vec4f, p: vec2f) -> f32 {
  let q = obstacle_local(geo, p);
  let kind = size.w;
  if (kind < 0.5) {
    return sd_circle(q, size.x);
  }
  if (kind < 1.5) {
    return sd_box_2d(q, size.xy);
  }
  if (kind < 2.5) {
    return sd_rounded_box_2d(q, size.xy, size.z);
  }
  if (kind < 3.5) {
    let r = min(size.x, size.y);
    let tail = max(size.x - r, 0.0);
    return sd_capsule_2d(q, vec2f(-tail, 0.0), vec2f(tail, 0.0), r);
  }
  return obstacle_sd_wing(q, size.x, size.y);
}

fn obstacle_normal(geo: vec4f, size: vec4f, p: vec2f) -> vec2f {
  let e = 0.0015;
  let g = vec2f(
    obstacle_sd(geo, size, p + vec2f(e, 0.0)) - obstacle_sd(geo, size, p - vec2f(e, 0.0)),
    obstacle_sd(geo, size, p + vec2f(0.0, e)) - obstacle_sd(geo, size, p - vec2f(0.0, e)),
  );
  let l = length(g);
  return select(vec2f(1.0, 0.0), g / l, l > 1e-9);
}

fn obstacle_velocity(geo: vec4f, motion: vec4f, p: vec2f) -> vec2f {
  let r = p - geo.xy;
  return motion.xy + motion.z * vec2f(-r.y, r.x);
}
`,y={circle:0,box:1,"rounded-box":2,capsule:3,wing:4},b=i(`ObstacleTable`,{count:`u32`,aspect:`f32`,grow:`f32`,pad:`f32`,data:a(`vec4f`,192)});b.wgsl;var x={"obstacle-shapes.wgsl":v,"obstacle_table.wgsl":b.wgsl};function S(e,t){let n=Math.min(e.length,64),r=new Float32Array(768);for(let i=0;i<n;i++){let n=e[i],a=n.rotation??0,o=Math.max(Math.abs(n.size[0]),1e-5),s=Math.max(Math.abs(n.size[1]),1e-5),c=n.radius??.25*Math.min(o,s),l=i*12;r[l]=n.x*t,r[l+1]=n.y,r[l+2]=Math.cos(a),r[l+3]=Math.sin(a),r[l+4]=o,r[l+5]=s,r[l+6]=Math.max(0,c),r[l+7]=y[n.kind],r[l+8]=n.velocity?.[0]??0,r[l+9]=n.velocity?.[1]??0,r[l+10]=n.spin??0;for(let e=0;e<12;e++)Number.isFinite(r[l+e])||(r[l+e]=0)}return{data:r,count:n}}function C(e,t,n,r){let i=r,a=Math.max(r*.05,1e-4),o=Math.max(n,i*1.5),s=-o+i,c=o-a-s,l=Math.abs(t),u=e-s,d=(i-a)/c,f=Math.sqrt(Math.max(1-d*d,0)),p=l*-d+u*f;return p<0?Math.hypot(l,u)-i:p>f*c?Math.hypot(l,u-c)-a:l*f+u*d-i}function w(e,t,n,r){let i=t*r-e.x*r,a=n-e.y,o=e.rotation??0,s=Math.cos(o),c=Math.sin(o),l=i*s+a*c,u=-i*c+a*s,d=Math.max(Math.abs(e.size[0]),1e-5),f=Math.max(Math.abs(e.size[1]),1e-5);switch(e.kind){case`circle`:return Math.hypot(l,u)-d;case`box`:return T(l,u,d,f);case`rounded-box`:{let t=Math.min(Math.max(e.radius??.25*Math.min(d,f),0),d,f);return T(l,u,d-t,f-t)-t}case`capsule`:{let e=Math.min(d,f),t=Math.max(d-e,0),n=Math.min(Math.max(l,-t),t);return Math.hypot(l-n,u)-e}case`wing`:return C(l,u,d,f)}}function T(e,t,n,r){let i=Math.abs(e)-n,a=Math.abs(t)-r;return Math.hypot(Math.max(i,0),Math.max(a,0))+Math.min(Math.max(i,a),0)}function E(e,t,n,r,i=0){for(let a=e.length-1;a>=0;a--)if(w(e[a],t,n,r)<=i)return a;return-1}function D(e,t,n){let r=e.width*t/2,i=e.height/2;return{kind:`rounded-box`,x:e.x+e.width/2,y:e.y+e.height/2,size:[r,i],radius:Math.min(Math.max(e.radius??0,0),r,i),velocity:n?[(n.left+n.right)/2*t,(n.top+n.bottom)/2]:void 0}}var O={coupling:1,band:3,inlet:{velocity:[0,0],width:.06,strength:0},stick:1,maxSpeed:6},k=i(`DriveParams`,{grid:`vec2f`,band:`f32`,coupling:`f32`,inlet:`vec4f`,vmax:`f32`,stick:`f32`});function A(e){let{device:t,fluid:n,profiler:i=r,label:a=`obstacles`}=e,s={...O,inlet:{...O.inlet}},u=e.grow??0,f=[],p=0,m=!0,h=0,v=-1,y=!1,C=o(t,b,`${a} shape table`),w=o(t,k,`${a} drive params`),T=l(t,{fragment:{label:`sim/obstacle-raster.wgsl`,code:_,chunks:x},format:d}),E=l(t,{fragment:{label:`sim/obstacle-drive.wgsl`,code:g,chunks:{...x,"drive_params.wgsl":k.wgsl}},format:`rgba16float`}),D=t.createBindGroup({label:`${a} raster`,layout:T.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:C.buffer}}]}),A=new Map,j,M;function N(){let e=n.grid.aspect,t=S(f,e);p=t.count,C.set({count:p,aspect:e,grow:u,pad:0,data:t.data}),C.upload(),h=e}N();function P(e){let n=e.grid;if(w.set({grid:[n.width,n.height],band:Math.max(.5,s.band),coupling:Math.min(1,Math.max(0,s.coupling)),inlet:[s.inlet.velocity[0],s.inlet.velocity[1],Math.max(.001,s.inlet.width),Math.min(1,Math.max(0,s.inlet.strength))],vmax:Math.max(.1,s.maxSpeed),stick:Math.min(1,Math.max(0,s.stick))}),w.upload(),!(p>0&&s.coupling>0)&&!(s.inlet.strength>0))return!1;let r=A.get(e.read);return r||(A.size>16&&A.clear(),r=t.createBindGroup({label:`${a} drive`,layout:E.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:C.buffer}},{binding:1,resource:e.read},{binding:2,resource:{buffer:w.buffer}}]}),A.set(e.read,r)),c(e.encoder,e.write,E,[r],{label:`${a} drive`,timestampWrites:i.pass(`obstacle drive`)}),!0}let F={get shapes(){return f},get count(){return p},get table(){return C.buffer},drive:s,set(e){f=e.slice(0,64).map(e=>({...e})),m=!0,N()},setGrow(e){u=Number.isFinite(e)?e:0,m=!0,N()},rasterize(e,t=!1){if(y||(n.grid.aspect!==h&&(N(),m=!0),!m&&!t&&v===n.generation))return!1;let r=n.obstacles;return c(e,r.view,T,[D],{label:`${a} mask`,timestampWrites:i.pass(`obstacle mask`)}),r.enabled=p>0,m=!1,v=n.generation,!0},attach(){j||(M=n.hooks.forces,j=P,n.hooks.forces=j)},detach(){j&&(n.hooks.forces===j&&(n.hooks.forces=M),j=void 0,M=void 0)},destroy(){y||(F.detach(),y=!0,C.destroy(),w.destroy())}};return F}var j=[`auto`,`cylinder`,`plates`,`wing`,`slalom`,`page elements`];function M(e,t){let{size:n,aspect:r}=t,i=e=>Math.min(e,.9);switch(e){case`cylinder`:return[{kind:`circle`,x:i(r>1.3?.3:.4),y:.5,size:[n/2,n/2]}];case`plates`:return[{kind:`box`,x:i(.28),y:.5,size:[.012,n*.6]},{kind:`box`,x:i(.62),y:.27,size:[n*.5,.012],rotation:.45},{kind:`box`,x:i(.62),y:.73,size:[n*.5,.012],rotation:-.45}];case`wing`:return[{kind:`wing`,x:i(.4),y:.5,size:[n*1.5,n*.3],rotation:t.angle*Math.PI/180}];case`slalom`:{let e=[],t=r>1.3?5:3;for(let r=0;r<t;r++)e.push({kind:`circle`,x:.2+.65*r/(t-1),y:r%2==0?.42:.6,size:[n*.22,n*.22]});return e}case`page elements`:return[]}}var N=i(`DisplayParams`,{ground:`vec3f`,aspect:`f32`,body_edge:`vec3f`,skin:`f32`,body_core:`vec3f`,pixel:`f32`,gain:`f32`,debug_gain:`f32`,vignette:`f32`,view:`u32`,mode:`u32`,dom_start:`u32`}),P=i(`InletParams`,{aspect:`f32`,width:`f32`,rows:`f32`,amount:`f32`,phase:`f32`,pulse:`f32`,kind:`u32`,mode:`u32`}),F=[`96`,`128`,`144`,`192`,`256`],I=[`rows`,`bands`,`timelines`,`none`],L=[`dark`,`light`],R=[`drag shapes, stir elsewhere`,`drag shapes only`,`stir only`,`off`],z=[`scrolls the page`,`grabs and stirs`],B=[`jacobi`,`sor`],V=[`dye`,`velocity`,`vorticity`,`pressure`,`mask`],ee=1.6,H=.025,U=.07,W=[`1`,`2`,`3`,`4`],te=.45,G=n({meta:e,params:{scene:{type:`select`,default:`auto`,options:j,label:`Scene (auto: the page's own elements if it has any, else the cylinder)`},size:{type:`number`,default:.2,min:.06,max:.45,step:.005,label:`Size (canvas heights: cylinder diameter, plate half-length)`},angle:{type:`number`,default:10,min:-35,max:35,step:.5,label:`Wing angle of attack (degrees)`},speed:{type:`number`,default:.9,min:0,max:2.5,step:.01,label:`Wind speed (canvas heights / s)`},viscosity:{type:`number`,default:2e-4,min:0,max:.01,step:5e-5,label:`Viscosity (heights² / s; lower = more turbulent)`},vorticity:{type:`number`,default:3,min:0,max:30,step:.5,label:`Vorticity confinement`},dissipation:{type:`number`,default:.05,min:0,max:2,step:.01,label:`Flow dissipation (1 / s)`},dye:{type:`select`,default:`rows`,options:I,label:`Dye released at the inlet`},dyeLife:{type:`number`,default:.12,min:0,max:1,step:.01,label:`Dye fade (1 / s)`},gain:{type:`number`,default:1.3,min:.2,max:4,step:.01,label:`Dye strength`},ground:{type:`select`,default:`dark`,options:L},dyeDetail:{type:`select`,default:`2`,options:W,label:`Dye texels per fluid cell (re-creates the fluid)`},resolution:{type:`select`,default:`144`,options:F,label:`Fluid cells (short side; re-creates the fluid)`},pressureSolver:{type:`select`,default:`jacobi`,options:B,label:`Pressure solver`},pressureIterations:{type:`number`,default:50,min:4,max:160,step:1,label:`Pressure iterations`},pointer:{type:`select`,default:`drag shapes, stir elsewhere`,options:R},touch:{type:`select`,default:`scrolls the page`,options:z,label:`Touch drags`},view:{type:`select`,default:`dye`,options:V,label:`View (mask: the solver's cells in red, the exact outlines in green)`},debugGain:{type:`number`,default:1,min:.1,max:10,step:.1,label:`Debug view gain`},stepsPerFrame:{type:`number`,default:0,min:0,max:32,step:1,label:`Steps per frame (0 = by clock; for benchmarks)`}},presets:{"vortex street":{scene:`cylinder`,size:.2,speed:.9,viscosity:2e-4,vorticity:3,dissipation:.05,dye:`rows`,view:`dye`,resolution:`144`},"vortex street (vorticity view)":{scene:`cylinder`,size:.2,speed:.9,viscosity:2e-4,vorticity:3,dye:`none`,view:`vorticity`,resolution:`144`,debugGain:1.4},"wing at an angle":{scene:`wing`,size:.18,angle:14,speed:1.1,viscosity:2e-4,vorticity:2,dye:`rows`,view:`dye`},"peg slalom":{scene:`slalom`,size:.2,speed:.8,viscosity:3e-4,vorticity:5,dye:`bands`,view:`dye`},"plates and funnel":{scene:`plates`,size:.2,speed:.9,viscosity:3e-4,vorticity:4,dye:`timelines`,view:`dye`},"around the page":{scene:`page elements`,speed:.5,viscosity:5e-4,vorticity:4,dye:`rows`,gain:1.1,resolution:`128`,view:`dye`}},async create({device:e,format:n,canvas:r,params:i,profiler:a}){let d=o(e,N,`fluid-obstacles display`),g=o(e,P,`fluid-obstacles inlet`),_=s(r),v=f(),y={outsetPx:2,epsilon:.001},b=t(r,y),S,C=e.createSampler({label:`fluid-obstacles sampler`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),w=l(e,{fragment:{label:`fluid-obstacles/display.wgsl`,code:m,chunks:{...x,"display_params.wgsl":N.wgsl}},format:n}),T=l(e,{fragment:{label:`fluid-obstacles/inlet.wgsl`,code:h,chunks:{"inlet_params.wgsl":P.wgsl}},format:`rgba16float`}),O=Math.max(1,r.width||1),k=Math.max(1,r.height||1),j=O/k,F=(e,t)=>Math.round(e*Math.max(t,1/t)),L=u({device:e,resolution:F(Number(i.resolution),j),dyeResolution:F(Number(i.resolution)*Number(i.dyeDetail),j),width:O,height:k,profiler:a,label:`fluid-obstacles`,params:{boundary:`open`,dyeScheme:`maccormack`,velocityScheme:`maccormack`}}),R=A({device:e,fluid:L,profiler:a,label:`fluid-obstacles`});R.attach();let z=new Map;L.hooks.dye=({encoder:t,read:n,write:r})=>{let i=z.get(n);return i||(z.size>8&&z.clear(),i=e.createBindGroup({label:`fluid-obstacles inlet`,layout:T.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:g.buffer}},{binding:1,resource:n}]}),z.set(n,i)),c(t,r,T,[i],{label:`fluid-obstacles inlet`,timestampWrites:a.pass(`dye inlet`)}),!0};let B=[],W=[],G=``,K=`cylinder`,q=!0,ne=``,J=0,Y=new Map,X=!1,Z=0,Q=0,re=0,$=new Map,ie=L.generation;function ae(){R.set([...B,...W])}function oe(e){B=M(K,{size:i.size,angle:i.angle,aspect:e}),Y.clear(),q=!0,J=+(B.length>0)}function se(e,t){y.epsilon=.25/Math.max(1,L.grid.width);let n=b.update(e),a=S&&b.root?.contains(S.container)?S.count:0,o=n.found-a,s=i.scene===`page elements`&&o<=0;s&&!S?(S=p(r),S&&b.invalidate()):!s&&S&&(S.destroy(),S=void 0,b.invalidate());let c=i.scene===`auto`?o>0?`page elements`:`cylinder`:i.scene;if(c!==K&&(K=c,G=``),K!==`page elements`){let e=W.length>0;return W=[],e}let l=!1,u=n.obstacles.map(e=>(e.motion&&(l=!0),D(e.rect,t,e.motion))),d=u.map(e=>`${e.x.toFixed(4)},${e.y.toFixed(4)},${e.size[0].toFixed(4)},${e.size[1].toFixed(4)}`).join(`|`);return d===ne&&!l&&!n.changed?!1:(ne=d,W=u,!0)}function ce(e,t,n){let r=i.pointer,a=r===`drag shapes, stir elsewhere`||r===`drag shapes only`,o=Math.min(Math.max(n,1/240),.1),s=[];X=!1;let c=new Set;for(let n of e){if(a&&n.justPressed){let e=E(B,n.x,n.y,t,H);if(e>=0){let t=B[e];Y.set(n.id,{index:e,dx:t.x-n.x,dy:t.y-n.y})}}let e=Y.get(n.id);if(e&&(n.down||n.justReleased)){if(n.down){let r=B[e.index],i=n.x+e.dx-r.x,a=n.y+e.dy-r.y,s=Math.hypot(i*t,a),l=Math.min(s,ee*o,s*14*o);if(s>1e-6){let n=l/s;r.x=Math.min(1.1,Math.max(-.1,r.x+i*n)),r.y=Math.min(1.1,Math.max(-.1,r.y+a*n)),r.velocity=[i*n/o*t,a*n/o],c.add(e.index)}q=!0}(n.justReleased||!n.down)&&Y.delete(n.id)}else e&&Y.delete(n.id),n.inside&&!n.down&&a&&E(B,n.x,n.y,t,H)>=0&&(X=!0),s.push(n)}return B.forEach((e,t)=>{!c.has(t)&&e.velocity&&(e.velocity[0]!==0||e.velocity[1]!==0)&&(e.velocity=[0,0],q=!0)}),s}function le(e){let t=L.params;t.boundary=`open`,t.pressureSolver=i.pressureSolver,t.pressureIterations=i.pressureIterations,t.velocityScheme=`maccormack`,t.vorticity=i.vorticity,t.viscosity=i.viscosity,t.velocityDissipation=i.dissipation,t.dyeDissipation=i.dyeLife,Z+=(1-Z)*Math.min(1,1.5*e),R.drive.inlet={velocity:[i.speed*Z,0],width:U,strength:.45},R.drive.band=3,R.drive.coupling=1}return{resize(e,t){O=Math.max(1,Math.round(e)),k=Math.max(1,Math.round(t));let n=O/k;Math.abs(Math.log(n/j))>.06&&(j=n,L.resize(O,k),G=``),b.invalidate()},frame({delta:t},n,o){let s=O/k,l=Number(i.resolution);L.setResolution(F(l,j),F(l*Number(i.dyeDetail),j)),le(t);let u=!1;i.scene===`auto`||i.scene===`page elements`?u=se(t,s):(S&&(S.destroy(),S=void 0,b.invalidate()),K!==i.scene&&(K=i.scene,G=``),W.length>0&&(W=[],u=!0));let f=`${K}:${i.size}:${i.angle}:${Math.round(s*10)}`;f!==G&&(G=f,oe(s)),_.setCapture(i.touch===`grabs and stirs`);let p=ce(_.poll(),s,t);if(v.stir(L,p,s,t,{mode:i.pointer===`drag shapes, stir elsewhere`||i.pointer===`stir only`?`press only`:`off`,radius:.045,force:.9,dyeAmount:0,colour:()=>null,puff:0}),r.style&&(r.style.cursor=X||Y.size>0?`grab`:``),(q||u)&&(ae(),q=!1),J>0&&Z>.5){let e=B[0];e&&L.addForce([e.x+.12,e.y],[e.x+.14,e.y+.015],.035,[0,.35]),J=0}Q+=t;let m=0;Q>=te&&(Q=0,m=1),re+=t*.04,g.set({aspect:s,width:U,rows:14,amount:1,phase:re,pulse:m,kind:Math.max(0,I.indexOf(i.dye)),mode:+(i.ground===`light`)}),g.upload(),R.rasterize(n),i.stepsPerFrame>0?L.advance(n,i.stepsPerFrame):L.update(n,t);let h=i.ground===`light`;d.set({ground:h?[.93,.92,.88]:[.012,.02,.034],aspect:s,body_edge:h?[.3,.32,.36]:[.62,.68,.74],skin:.45/L.grid.height,body_core:h?[.08,.09,.11]:[.2,.24,.3],pixel:1/k,gain:i.gain,debug_gain:i.debugGain,vignette:h?.1:.3,view:Math.max(0,V.indexOf(i.view)),mode:+!!h,dom_start:B.length}),d.upload();let y=`${L.generation}:${L.dye.slot}`,x=$.get(y);x||(ie!==L.generation&&($.clear(),ie=L.generation),x=e.createBindGroup({label:`fluid-obstacles display`,layout:w.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:d.buffer}},{binding:1,resource:L.dye.view},{binding:2,resource:C},{binding:3,resource:L.fieldsView},{binding:4,resource:L.obstacles.view},{binding:5,resource:{buffer:R.table}}]}),$.set(y,x)),c(n,o,w,[x],{timestampWrites:a.pass(`shade`)})},destroy(){S?.destroy(),S=void 0,b.destroy(),_.destroy(),r.style&&(r.style.cursor=``),R.destroy(),L.hooks.dye=void 0,L.destroy(),d.destroy(),g.destroy()}}}});export{G as effect};