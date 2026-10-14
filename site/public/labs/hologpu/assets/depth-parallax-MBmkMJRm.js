import{i as e,n as t}from"./filters-C6g91LiE.js";import{n,t as r}from"./common-DDMx69ab.js";var i=`
fn effect(uv:vec2f)->vec4f {
  let amount=clamp(params.amount,0.0,0.02)*clamp(params.intensity,0.0,1.0);
  if(frame.reducedMotion>.5||amount<=0.0){return sample_image(uv);}
  var direction=vec2f(0);
  if(params.mode!=1u){direction=(clamp(frame.pointer,vec2f(0),vec2f(1))-.5)*2.0;}
  if(params.mode!=0u){direction+=vec2f(0,(clamp(params.progress,0.0,1.0)-.5)*2.0);}
  direction/=max(length(direction),1.0);
  let depth=clamp(sample_depthSource(uv).r,0.0,1.0);
  let aspect=frame.resolution.x/max(frame.resolution.y,1.0);
  let offset=direction*vec2f(1,aspect)*amount*depth;
  if(dot(offset,offset)<1e-16){return sample_image(uv);}
  let warped=uv+offset;
  let texel=1.0/vec2f(textureDimensions(image));
  let clamped=clamp(warped,texel*.5,vec2f(1)-texel*.5);
  let centre=sample_image(clamped);
  // Upsampling can already clamp the original UV beyond source texel centres.
  // Only additional outward spill from displacement represents a disocclusion.
  let original=clamp(uv,texel*.5,vec2f(1)-texel*.5);
  let extraSpill=max(abs(warped-clamped)-abs(uv-original),vec2f(0))/texel;
  let spill=max(extraSpill.x,extraSpill.y);
  if(spill<=0.0||params.edgeBlur<=0.0){return centre;}
  // Only disoccluded boundary pixels use this small premultiplied cross blur.
  let stepUV=params.edgeBlur*frame.dpr/max(frame.resolution,vec2f(1));
  let filled=(centre*4.0+sample_image(clamped+vec2f(stepUV.x,0))
    +sample_image(clamped-vec2f(stepUV.x,0))+sample_image(clamped+vec2f(0,stepUV.y))
    +sample_image(clamped-vec2f(0,stepUV.y)))/8.0;
  return mix(centre,filled,clamp(spill,0.0,1.0));
}`,a=e({id:`depth-parallax`,budget:{expectedMs:.7,referenceSize:[640,400]},title:`Subtle product image depth parallax`,family:`dom`,core:!0,tags:[`image`,`depth`,`parallax`,`pointer`,`progress`,`css`],inputs:[`image`,`depth`,`pointer`,`css`],features:[],params:{depthSource:{type:`texture`,default:`depth`,description:`Linear grayscale depth binding: white moves near content, black keeps far content fixed.`,group:`Source`},mode:r(`pointer`,[`pointer`,`progress`,`combined`],`Pointer, vertical progress or their bounded combination.`,`Motion`),amount:{...n(.015,0,.02,`Maximum displacement as a fraction of CSS image width, before intensity.`,`Motion`),step:.001,css:!0},intensity:{...n(.25,0,1,`Fraction of the bounded parallax displacement to apply; zero preserves the image.`,`Motion`),css:!0},progress:{...n(.5,0,1,`Vertical displacement position; 0.5 is neutral, used in progress and combined modes.`,`Motion`),css:!0},edgeBlur:{...n(.75,0,2,`Small CSS-pixel blur of clamp-filled disoccluded edges only.`,`Edges`),unit:`px`}},presets:{subtle:{mode:`pointer`,amount:.015,intensity:.25},scroll:{mode:`progress`,amount:.012,intensity:.25,progress:.5},layered:{mode:`combined`,amount:.018,intensity:.3,edgeBlur:1}},quality:{resolutionScale:[.5,1]},reducedMotion:{time:0},fallback:`transparent`,imageFallback:!0,poster:new URL(`/labs/hologpu/assets/poster-BEKVsfRq.png`,``+import.meta.url).href,async setup({ctx:e,input:n}){let r=e.device.createTexture({label:`depth-parallax-neutral-depth`,size:[1,1],format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});e.device.queue.writeTexture({texture:r},new Uint8Array([0]),{bytesPerRow:1},[1,1]);let a={texture:r,width:1,height:1,format:`r8unorm`,kind:`float`,label:`neutral-depth`};try{let o=await t(e,i,`hgpu-depth-parallax`),s,c,l,u=e=>e.texture.createView({baseMipLevel:e.mipLevel??0,mipLevelCount:1,baseArrayLayer:e.arrayLayer??0,arrayLayerCount:1,dimension:`2d`}),d=(e,t)=>!e||e.texture!==t.texture||e.mipLevel!==t.mipLevel||e.arrayLayer!==t.arrayLayer,f=!1;return{resize(){},update(){},reset(){},shouldRender:()=>!1,render(t,r,i){let f=n(),p=e.inputs?.get(`depthSource`)??a;(!l||d(s,f)||d(c,p))&&(l=e.device.createBindGroup({label:`depth-parallax-inputs`,layout:o.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.frameBuffer}},{binding:1,resource:{buffer:e.paramsBuffer}},{binding:2,resource:u(f)},{binding:16,resource:u(p)}]})),s=f,c=p,o.draw(r,i,[l])},dispose(){f||(f=!0,o.dispose(),r.destroy())},sources:{fragment:o.source},diagnostics:o.diagnostics,textureTaps(){return f?{}:{depth:c??a}},memory:()=>({textureBytes:+!f,bufferBytes:0})}}catch(e){throw r.destroy(),e}}});export{a as t};