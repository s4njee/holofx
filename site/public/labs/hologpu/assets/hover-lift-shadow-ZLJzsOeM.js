import{n as e,t}from"./effect-DJnwN9gs.js";import{n}from"./common-DDMx69ab.js";import{n as r,t as i}from"./card-geometry-Nu_q2mLt.js";var a=e({id:`hover-lift-shadow`,budget:{expectedMs:.4,referenceSize:[640,400]},title:`Soft coloured card contact shadow`,tags:[`card`,`shadow`,`css`,`launch-page`],inputs:[`css`],params:{...r,elevation:{...n(.15,0,1,`Card lift; controls shadow spread and downward offset.`,`Appearance`),css:!0},intensity:{...n(.2,0,1,`Maximum exterior contact-shadow opacity.`,`Appearance`),css:!0},tint:{type:`color`,default:`#283b66`,css:!0,group:`Palette`,description:`Subtle shadow tint; alpha also scales opacity.`}},presets:{cool:{tint:`#283b66`,intensity:.2,elevation:.15},warm:{tint:`#664c3b`,intensity:.18,elevation:.15},lifted:{tint:`#253760`,intensity:.25,elevation:.65}},quality:{resolutionScale:[.5,1]},reducedMotion:{time:0},fallback:`transparent`,poster:new URL(`/labs/hologpu/assets/poster-BDnYqwiD.png`,``+import.meta.url).href,cardFallback:{kind:`shadow`},wgsl:`
${i}
fn effect(uv:vec2f)->vec4f {
  let dpr=max(frame.dpr,0.0001);
  let size=frame.resolution/dpr;
  let centre=(params.rect.xy+params.rect.zw*0.5)*size;
  let halfSize=params.rect.zw*size*0.5;
  let local=uv*size-centre;
  let elevation=clamp(params.elevation,0.0,1.0);
  let offset=vec2f(0.0,mix(3.0,15.0,elevation));
  let sigma=mix(4.0,11.0,elevation);
  let card=card_distance(local,halfSize,params.radius,params.radiiX,params.radiiY);
  let shadow=card_distance(local-offset,halfSize,params.radius,params.radiiX,params.radiiY);
  let aa=0.5/dpr;
  let exterior=smoothstep(-aa,aa,card);
  let distance=max(shadow,0.0);
  let halo=exp(-0.5*distance*distance/(sigma*sigma));
  let alpha=clamp(halo*exterior*params.intensity*mix(0.65,1.0,elevation)*params.tint.a,0.0,1.0);
  return vec4f(params.tint.rgb,alpha);
}`}),o=t({...a,async create(e){return{...await a.create(e),shouldRender:()=>!1}}});export{o as t};