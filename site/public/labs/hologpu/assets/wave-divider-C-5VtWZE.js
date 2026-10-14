import{n as e}from"./effect-DJnwN9gs.js";import{t}from"./sdf-DK6WxqMj.js";var n={amplitude:18,baseline:.5,cycles:1.15,phase:0,speed:.12,fill:`#11191c`},r=.35,i=2,a=1.3,o=Math.PI*2,s=.01,c={amplitude:[0,64],baseline:[.25,.75],cycles:[.25,4],phase:[-Math.PI,Math.PI]},l=e=>e.toFixed(10),u=e=>Number(e.toPrecision(12)).toString();function d(e,t,l={}){if(!Number.isFinite(e)||!Number.isFinite(t)||e<=0||t<=0)throw RangeError(`Wave divider dimensions must be finite positive CSS pixels`);let d={...n};for(let e of Object.keys(c)){let t=l[e]??n[e];if(!Number.isFinite(t))throw TypeError(`Wave divider ${e} must be finite`);let[r,i]=c[e];d[e]=Math.max(r,Math.min(i,t))}let f=t*d.baseline,p=Math.min(2,t*.25),m=Math.min(d.amplitude,Math.max(0,Math.min(f,t-f)-p)/1.35),h=Math.max(16,Math.ceil(o*d.cycles*Math.sqrt(m*2.4/(8*s)))),g=[];for(let t=0;t<=h;t++){let n=t/h,s=n*o*d.cycles+d.phase,c=f+m*(Math.sin(s)+r*Math.sin(s*i+a));g.push(`${t?`L`:`M`}${u(e*n)} ${u(c)}`)}return`${g.join(``)}L${u(e)} ${u(t)}L0 ${u(t)}Z`}var f=e({id:`wave-divider`,budget:{expectedMs:.3,referenceSize:[640,400]},title:`Gentle section wave divider`,tags:[`divider`,`section`,`wave`,`css`,`launch-page`],inputs:[`time`,`css`],params:{fill:{type:`color`,default:n.fill,css:!0,group:`Palette`,description:`Use the next section’s opaque background colour for a seamless join.`},amplitude:{type:`f32`,default:n.amplitude,min:c.amplitude[0],max:c.amplitude[1],step:1,css:!0,unit:`px`,group:`Geometry`,description:`Wave height in CSS pixels; limited to fit the host without clipping.`},baseline:{type:`f32`,default:n.baseline,min:c.baseline[0],max:c.baseline[1],step:.01,css:!0,group:`Geometry`,description:`Resting edge position as a fraction of divider height.`},cycles:{type:`f32`,default:n.cycles,min:c.cycles[0],max:c.cycles[1],step:.05,css:!0,group:`Geometry`,description:`Primary sine cycles across the divider width.`},phase:{type:`f32`,default:n.phase,min:c.phase[0],max:c.phase[1],step:.05,css:!0,unit:`rad`,group:`Geometry`,description:`Phase offset shared with the static SVG path.`},speed:{type:`f32`,default:n.speed,min:0,max:.4,step:.01,css:!0,unit:`rad/s`,group:`Motion`,description:`Gentle phase travel; zero holds the time-zero shape.`}},presets:{gentle:{},shallow:{amplitude:10,cycles:.75,speed:.08},still:{speed:0}},quality:{resolutionScale:[.5,1]},reducedMotion:{time:0},fallback:`transparent`,poster:new URL(`/labs/hologpu/assets/poster-CVHQKKgf.png`,``+import.meta.url).href,chunks:[t],wgsl:`
fn effect(uv:vec2f)->vec4f {
  let dpr=max(frame.dpr,0.0001);
  let size=frame.resolution/dpr;
  let p=uv*size;
  let baseline=size.y*params.baseline;
  let clearance=min(2.0,size.y*0.25);
  let amplitude=min(params.amplitude,max(0.0,min(baseline,size.y-baseline)-clearance)/${l(1.35)});
  let time=select(frame.time,0.0,frame.reducedMotion>0.5);
  let angle=p.x/size.x*${l(o)}*params.cycles+params.phase+time*params.speed;
  let secondary=angle*${l(i)}+${l(a)};
  let edge=baseline+amplitude*(sin(angle)+${l(r)}*sin(secondary));
  let slope=amplitude*${l(o)}*params.cycles/size.x*(cos(angle)+${l(r*i)}*cos(secondary));
  // The box extends beyond the canvas sides/bottom; its warped top is the wave.
  let distance=sd_box(p-vec2f(size.x*0.5,edge+size.y),vec2f(size.x*0.5+size.y,size.y))/sqrt(1.0+slope*slope);
  let aa=max(0.5/dpr,0.5*fwidth(distance));
  let coverage=max(1.0-smoothstep(-aa,aa,distance),step(size.y-1.0/dpr,p.y));
  return vec4f(params.fill.rgb,coverage*params.fill.a);
}`});export{d as n,f as r,n as t};