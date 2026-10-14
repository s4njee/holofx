import{a as e,i as t,n}from"./filters-C6g91LiE.js";import{n as r}from"./common-DDMx69ab.js";import{n as i,t as a}from"./card-geometry-Nu_q2mLt.js";var o=`
fn panel_distance(p:vec2f, halfSize:vec2f)->f32 {
  return card_distance(p,halfSize,params.radius,params.radiiX,params.radiiY);
}
fn effect(uv:vec2f)->vec4f {
  let hostSize=frame.resolution/max(frame.dpr,0.001);
  let cardSize=max(params.rect.zw*hostSize,vec2f(0.001));
  let local=(uv-params.rect.xy)/max(params.rect.zw,vec2f(0.00001));
  let p=(local-0.5)*cardSize;
  let halfSize=cardSize*0.5;
  let distance=panel_distance(p,halfSize);
  let aa=max(fwidth(distance),0.5/max(frame.dpr,0.001));
  let mask=1.0-smoothstep(-aa,aa,distance);
  if(mask<=0.0) {return vec4f(0);}
  // A finite-difference SDF normal bends the hero near the card's rim.
  let epsilon=0.5;
  let gradient=vec2f(
    panel_distance(p+vec2f(epsilon,0),halfSize)-panel_distance(p-vec2f(epsilon,0),halfSize),
    panel_distance(p+vec2f(0,epsilon),halfSize)-panel_distance(p-vec2f(0,epsilon),halfSize));
  let normal=gradient/max(length(gradient),0.00001);
  let rim=exp(-abs(distance)/max(params.rim,0.001));
  let sourceScale=params.sourceRect.zw/cardSize;
  let sourceUV=params.sourceRect.xy+local*params.sourceRect.zw
    +normal*params.refraction*rim*sourceScale;
  var sampled=sample_image(sourceUV);
  if(params.blur>0.0) {
    let d=params.blur*sourceScale;
    sampled=(sampled*4.0+sample_image(sourceUV+vec2f(d.x,0))
      +sample_image(sourceUV-vec2f(d.x,0))+sample_image(sourceUV+vec2f(0,d.y))
      +sample_image(sourceUV-vec2f(0,d.y)))/8.0;
  }
  let tint=params.intensity*params.brand.a;
  let colour=mix(sampled.rgb,params.brand.rgb*sampled.a,tint*0.12);
  let specular=exp(-abs(distance)/max(params.edge,0.001))*tint*sampled.a;
  return vec4f((colour+params.brand.rgb*specular)*mask,sampled.a*mask);
}`,s=t({id:`panel-refraction`,budget:{expectedMs:.8,referenceSize:[640,400]},title:`Frosted hero refraction panel`,family:`dom`,core:!0,tags:[`card`,`glass`,`refraction`,`blur`,`hero`,`css`],inputs:[`image`,`css`,`element-rect`],fieldInputSampling:`base`,features:[],params:{...i,sourceRect:{type:`vec4`,default:[0,0,1,1],description:`Normalized hero xywh sampled by the card; bindBackdrop updates this from layout.`,group:`Source`},refraction:{...r(2,0,8,`Maximum rim displacement in CSS pixels.`,`Glass`),unit:`px`},blur:{...r(2,0,8,`Five-tap cross blur radius in CSS pixels.`,`Glass`),unit:`px`},rim:{...r(18,1,64,`Depth of the refracted rim in CSS pixels.`,`Glass`),unit:`px`},edge:{...r(.8,.25,3,`Thin specular edge width in CSS pixels.`,`Glass`),unit:`px`},intensity:{...r(.22,0,1,`Brand tint and specular edge strength.`,`Glass`),css:!0},brand:{type:`color`,default:`#e4edff`,css:!0,description:`Quiet brand tint and edge colour, parsed to linear RGB.`,group:`Palette`}},presets:{clear:{refraction:1.5,blur:.5,intensity:.15},frost:{refraction:2,blur:4,intensity:.25}},quality:{resolutionScale:[.25,1]},reducedMotion:{time:0},fallback:`transparent`,poster:new URL(`/labs/hologpu/assets/poster-zBNYr-LZ.png`,``+import.meta.url).href,cardFallback:{kind:`glass`},async setup({ctx:t,input:r}){let i=await n(t,a+o,`hgpu-panel-refraction`),s=r(),c=e(t,i,s);return{resize(){},update(){},shouldRender:()=>!1,reset(){},render(n,a,o){let l=r();(l.texture!==s.texture||l.mipLevel!==s.mipLevel||l.arrayLayer!==s.arrayLayer)&&(c=e(t,i,l)),s=l,i.draw(a,o,[c])},textureTaps(){return{hero:s}},memory(){return{textureBytes:0,bufferBytes:0}},sources:{refraction:i.source},diagnostics:i.diagnostics,dispose(){i.dispose()}}}});export{s as t};