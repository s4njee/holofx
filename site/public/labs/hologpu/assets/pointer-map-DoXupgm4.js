import{n as e,t}from"./effect-DJnwN9gs.js";import{n,t as r}from"./common-DDMx69ab.js";var i=e({id:`pointer-map`,budget:{expectedMs:.5,referenceSize:[640,400]},title:`Gaussian pointer normal / flow map`,core:!0,family:`procedural`,tags:[`map`,`normal`,`flow`,`pointer`,`product`,`lcd`],inputs:[`pointer`,`css`],features:[],params:{center:{type:`vec2`,default:[-1,-1],min:-1,max:1,description:`Manual normalized lens centre; either negative component follows the pointer.`,group:`Lens`},encoding:r(`normal`,[`normal`,`flow`],`Normal RG is encoded 0…1; flow RG is signed.`,`Output`),radius:n(.09,.01,.5,`Gaussian standard deviation, normalized to the host height.`,`Lens`),intensity:{...n(.25,0,1,`Vector and height strength; zero is exactly neutral.`,`Lens`),css:!0}},presets:{lens:{encoding:`normal`,radius:.09,intensity:.25},flow:{encoding:`flow`,radius:.09,intensity:.25},neutral:{intensity:0}},quality:{resolutionScale:[.25,1]},reducedMotion:{time:0},fallback:`none`,poster:new URL(`/labs/hologpu/assets/poster-BHKRqrFL.png`,``+import.meta.url).href,wgsl:`
fn effect(uv:vec2f)->vec4f {
  var center=params.center;
  if(any(center<vec2f(0))) {center=frame.pointer;}
  let aspect=frame.resolution.x/max(frame.resolution.y,1.0);
  let q=(uv-center)*vec2f(aspect,1.0);
  let radius=max(params.radius,0.00001);
  let lens=exp(-0.5*dot(q,q)/(radius*radius));
  let strength=select(params.intensity,0.0,frame.reducedMotion>0.5);
  let slope=q/radius*lens*strength;
  let height=0.5+0.5*lens*strength;
  let vector=select(vec2f(0.5)+slope*0.5,slope,params.encoding==1u);
  return vec4f(vector,height,1.0);
}`}),a=t({...i,async create(e){return{...await i.create(e),shouldRender(){return!1}}}});export{a as t};