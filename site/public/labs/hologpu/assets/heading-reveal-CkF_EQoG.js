import{n as e,t}from"./effect-DJnwN9gs.js";import{t as n}from"./hash-7TJvDAm4.js";import{n as r}from"./common-DDMx69ab.js";import{t as i}from"./common-BLsYxTJE.js";var a=`
fn effect(uv:vec2f)->vec4f {
  var progress=clamp(params.progress,0.0,1.0);
  if(params.progress<0.0) {progress=clamp(frame.time,0.0,1.0);}
  if(frame.reducedMotion>0.5) {progress=1.0;}
  if(progress>=1.0) {return vec4f(0);}
  let coverage=select(0.0,1.0,sample_image(uv).a>0.00001);
  if(coverage<=0.0) {return vec4f(0);}
  // Stable CSS-pixel noise erodes an opaque page-colour cover; real text remains below.
  let cell=vec2u(floor(uv*frame.resolution/max(frame.dpr,0.001)/params.scale));
  let grain=random(cell.x+cell.y*65537u+frame.seed);
  let threshold=clamp(uv.x+(grain-0.5)*params.intensity,0.0,1.0);
  var hidden=smoothstep(progress-params.feather,progress+params.feather,threshold);
  if(progress<=0.0) {hidden=1.0;}
  let alpha=coverage*hidden;
  return vec4f(params.page.rgb*alpha,alpha);
}`,o=e({id:`heading-reveal`,budget:{expectedMs:.5,referenceSize:[640,400]},title:`Noise-eroded heading reveal`,family:`dom`,tags:[`text`,`mask`,`noise`,`reveal`,`css`,`typography`],inputs:[`text`,`css`,`time`],features:[],params:{progress:{...r(1,-1,1,`Reveal progress; 1 shows the real heading, -1 selects the normalized timeline clock.`,`Motion`),css:!0},page:{type:`color`,default:`#11121b`,css:!0,group:`Palette`,description:`Opaque flat page colour used to cover unrevealed glyphs; must match the DOM background.`},intensity:{...r(.25,0,1,`Noise perturbation of the reveal boundary, not cover opacity.`,`Reveal`),css:!0},scale:{...r(3,1,16,`Noise cell pitch in CSS pixels.`,`Reveal`),unit:`px`},feather:r(.04,.005,.2,`Soft transition width in normalized heading coordinates.`,`Reveal`)},presets:{dark:{page:`#11121b`,intensity:.25},light:{page:`#f7f5f0`,intensity:.15},timeline:{progress:-1}},quality:{resolutionScale:[1,1]},reducedMotion:{time:1},fallback:`transparent`,poster:new URL(`/labs/hologpu/assets/poster-C0Bua_cR.png`,``+import.meta.url).href,textFallback:{kind:`none`},chunks:[n],wgsl:a}),s=t({...o,async create(e){let t=await i(e,a,`hgpu-heading-reveal`,[n]),r,o=t=>Math.max(0,Math.min(1,e.params.values.progress<0?t:e.params.values.progress));return{resize(){},update(){},reset(){r=void 0},shouldRender(e){return r===void 0||r!==o(e.time)},render(e,n,i){t.draw(n,i),r=o(e.time)},dispose:t.dispose,sources:{fragment:t.pass.source},diagnostics:t.pass.diagnostics,memory:t.memory,textureTaps:t.textureTaps}}});export{s as t};