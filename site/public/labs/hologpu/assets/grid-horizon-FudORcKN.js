import{n as e}from"./effect-DJnwN9gs.js";function t(){let e=1440,t=(t,n)=>[e/2+t*720/n,315+576/n],n=[];for(let e=-24;e<=24;e++){let r=t(e,36),i=t(e,.9846153846153847);n.push(`<path d="M${r[0]} ${r[1]}L${i[0]} ${i[1]}"/>`)}for(let r=1;r<=36;r++){let i=t(0,r)[1];n.push(`<path opacity="${Math.exp(-.13*r)}" d="M0 ${i}H${e}"/>`)}let r=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${e} 900" preserveAspectRatio="none"><defs><linearGradient id="fog" x2="0" y2="1"><stop offset="0.35" stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white"/></linearGradient><mask id="fade"><rect width="100%" height="100%" fill="url(#fog)"/></mask></defs><g mask="url(#fade)" stroke="#8d9db4" stroke-width="1" fill="none" opacity="0.18">${n.join(``)}</g></svg>`;return`url("data:image/svg+xml,${encodeURIComponent(r)}") center / 100% 100% no-repeat`}var n=e({id:`grid-horizon`,budget:{expectedMs:.5,referenceSize:[640,400]},title:`Soft perspective floor grid`,tags:[`background`,`launch-page`,`perspective`,`grid`],inputs:[`time`],params:{tint:{type:`color`,default:`#8d9db4`,css:!0,group:`Palette`,description:`Grid line colour, with transparent space between lines.`},intensity:{type:`f32`,default:.18,min:0,max:1,step:.01,css:!0,group:`Appearance`,description:`Near-field line opacity before distance fog.`},horizon:{type:`f32`,default:.35,min:.1,max:.75,step:.01,group:`Geometry`,description:`Horizon position as a fraction of field height from the top.`},spacing:{type:`f32`,default:1,min:.5,max:4,step:.05,group:`Geometry`,description:`Grid pitch in world units on the perspective plane.`},lineWeight:{type:`f32`,default:1,min:.5,max:3,step:.05,unit:`px`,group:`Appearance`,description:`Projected line weight in CSS pixels; independent of DPR and quality scale.`},fog:{type:`f32`,default:.13,min:.05,max:.5,step:.01,group:`Appearance`,description:`Exponential attenuation with distance to the camera.`},speed:{type:`f32`,default:0,min:0,max:.15,step:.01,group:`Motion`,description:`Optional slow forward travel in world units per second; zero keeps the grid stationary.`}},presets:{quiet:{tint:`#8d9db4`,intensity:.18,speed:0},dusk:{tint:`#b699cf`,intensity:.16,fog:.16,speed:.03},ember:{tint:`#d7996f`,intensity:.2,fog:.15,speed:.02}},quality:{resolutionScale:[.5,1]},reducedMotion:{time:0},poster:new URL(`/labs/hologpu/assets/poster-BuRo_5Gd.png`,``+import.meta.url).href,fallback:t(),wgsl:`
fn effect(uv: vec2f) -> vec4f {
  let dpr=max(frame.dpr,0.0001);
  let cssSize=frame.resolution/dpr;
  let p=uv*cssSize;
  let focal=cssSize.y*0.8;
  let screenDepth=p.y-cssSize.y*params.horizon;
  let z=0.8*focal/max(screenDepth,0.5);
  let world=vec2f((p.x-cssSize.x*0.5)*z/focal,z+frame.time*params.speed)/params.spacing;
  let footprint=max(fwidth(world),vec2f(0.00001));
  let dist=abs(fract(world+0.5)-0.5)/footprint;
  let halfWidth=params.lineWeight*dpr*0.5;
  let lines=vec2f(1.0)-smoothstep(vec2f(max(0.0,halfWidth-0.5)),vec2f(halfWidth+0.5),dist);
  let resolved=vec2f(1.0)-smoothstep(vec2f(0.15),vec2f(0.5),footprint);
  let coverage=max(lines.x*resolved.x,lines.y*resolved.y);
  let fade=exp(-params.fog*z)*smoothstep(0.0,6.0,screenDepth);
  return vec4f(params.tint.rgb,clamp(coverage*fade*params.intensity*params.tint.a,0.0,1.0));
}`});export{n as t};