import{n as e,t}from"./effect-DJnwN9gs.js";import{l as n,n as r}from"./common-DDMx69ab.js";var i=[[.05,.8],[.35,.8],[.35,.2],[.65,.2],[.65,.8],[.95,.8],[.95,.5],[.95,.2]],a=e=>({type:`vec2`,default:i[e],min:0,max:1,description:`Normalized path point ${e}.`,group:`Path`});function o(e,t,n={}){if(!Number.isFinite(e)||!Number.isFinite(t)||e<=0||t<=0)return``;let r=Number(n.pointCount??6),a=Math.max(2,Math.min(8,Number.isFinite(r)?Math.floor(r):6)),o=i.slice(0,a).map((r,i)=>{let a=n[`p${i}`],o=Array.isArray(a)?a:r,s=e=>{let t=Number(o[e]);return Math.max(0,Math.min(1,Number.isFinite(t)?t:r[e]))};return[s(0)*e,s(1)*t]});return o.every(e=>e[0]===o[0][0]&&e[1]===o[0][1])?``:o.map(([e,t],n)=>`${n?`L`:`M`}${e} ${t}`).join(` `)}var s=e({id:`progress-line`,budget:{expectedMs:.3,referenceSize:[640,400]},title:`Polyline progress rule`,core:!0,family:`dom`,tags:[`progress`,`polyline`,`divider`,`css`,`scroll`],inputs:[`css`],features:[],params:{pointCount:n(6,2,8,`Number of authored points, connected in order.`,`Path`),p0:a(0),p1:a(1),p2:a(2),p3:a(3),p4:a(4),p5:a(5),p6:a(6),p7:a(7),progress:{...r(1,0,1,`Fraction of actual CSS-pixel path length revealed.`,`Progress`),css:!0},tint:{type:`color`,default:`#91b6ee`,css:!0,description:`Stroke and head tint.`,group:`Palette`},intensity:{...r(.25,0,1,`Stroke and bounded head opacity.`,`Style`),css:!0},width:{...r(1.5,.25,8,`Stroke thickness in CSS pixels.`,`Style`),unit:`px`,css:!0},headGlow:{...r(6,0,24,`Bounded head glow radius in CSS pixels; zero disables it.`,`Style`),unit:`px`,css:!0}},presets:{steps:{progress:1},rule:{pointCount:2,p0:[.05,.5],p1:[.95,.5],headGlow:4},drawing:{progress:.5}},quality:{resolutionScale:[1,1]},reducedMotion:{time:0},fallback:`transparent`,poster:new URL(`data:image/png;base64,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`,``+import.meta.url).href,wgsl:`
fn effect(uv:vec2f)->vec4f {
  let progress=clamp(params.progress,0.0,1.0);
  if(progress<=0.0) {return vec4f(0);}
  let size=frame.resolution/max(frame.dpr,0.001);
  // These vertices come directly from the parameter uniform buffer.
  var points=array<vec2f,8>(params.p0,params.p1,params.p2,params.p3,params.p4,params.p5,params.p6,params.p7);
  let count=clamp(params.pointCount,2u,8u);
  var total=0.0;
  for(var i=1u;i<count;i++) {total+=length((points[i]-points[i-1u])*size);}
  if(total<=0.00001) {return vec4f(0);}
  let revealed=total*progress;
  let pixel=uv*size;
  var traveled=0.0;
  var squared=1e20;
  var head=points[0]*size;
  for(var i=1u;i<count;i++) {
    let a=points[i-1u]*size;
    let vector=(points[i]-points[i-1u])*size;
    let segment=length(vector);
    if(segment>0.00001 && traveled<revealed) {
      let fraction=clamp((revealed-traveled)/segment,0.0,1.0);
      let b=a+vector*fraction;
      let visible=b-a;
      let projection=clamp(dot(pixel-a,visible)/max(dot(visible,visible),0.0000001),0.0,1.0);
      let offset=pixel-(a+visible*projection);
      squared=min(squared,dot(offset,offset));
      head=b;
    }
    traveled+=segment;
  }
  let aa=0.5/max(frame.dpr,0.001);
  let stroke=1.0-smoothstep(max(0.0,params.width*0.5-aa),params.width*0.5+aa,sqrt(squared));
  var glow=0.0;
  if(progress<1.0 && params.headGlow>0.0) {
    let distance=length(pixel-head);
    let radius=params.headGlow;
    glow=0.2*exp(-2.0*distance*distance/(radius*radius))*(1.0-smoothstep(radius*0.8,radius,distance));
    glow*=4.0*progress*(1.0-progress);
  }
  let alpha=clamp(stroke+glow,0.0,1.0)*params.intensity*params.tint.a;
  return vec4f(params.tint.rgb,alpha);
}`}),c=t({...s,async create(e){return{...await s.create(e),shouldRender:()=>!1}}});export{c as n,o as t};