import{t as e}from"./noise-Cg4SSfI6.js";import{a as t,i as n,n as r}from"./filters-C6g91LiE.js";import{n as i,t as a}from"./common-DDMx69ab.js";import{r as o}from"./common-DrxnLO2g.js";var s=`
fn effect(uv:vec2f)->vec4f {
  let a=sample_image(uv);
  let t=clamp(params.progress,0.0,1.0);
  if(t<=0.0){return a;}
  let b=sample_next(uv);
  if(t>=1.0){return b;}
  if(frame.reducedMotion>.5){return select(a,b,t>=.5);}
  var rank=uv.x;
  if(params.direction==1u){rank=uv.y;}
  if(params.direction==2u){rank=1.0-uv.x;}
  if(params.direction==3u){rank=1.0-uv.y;}
  if(params.mode==1u){
    let aspect=frame.resolution.x/max(frame.resolution.y,1.0);
    rank=value_noise(uv*vec2f(aspect,1)*params.noiseScale,frame.seed);
  }
  if(params.mode==2u){
    // Bright straight-linear destination content appears before darker content.
    let luminance=dot(b.rgb/max(b.a,.00001),vec3f(.2126,.7152,.0722));
    rank=1.0-clamp(luminance,0.0,1.0);
  }
  let feather=max(max(params.feather,.000001),fwidth(rank));
  let edge=mix(-feather,1.0+feather,t);
  let weight=1.0-smoothstep(edge-feather,edge+feather,rank);
  if(all(a==b)){return a;}
  return mix(a,b,weight);
}`,c=n({id:`section-wipe`,budget:{expectedMs:.4,referenceSize:[640,400]},title:`Authored image section wipe`,family:`dom`,core:!0,tags:[`image`,`transition`,`scroll`,`css`,`launch-page`],inputs:[`image`,`next`,`css`],features:[],params:{next:{type:`texture`,default:`next`,group:`Images`,description:`Destination image binding; an absent destination preserves the source.`},progress:{...o,description:`Image transition progress: zero is source, one is destination.`},mode:a(`directional`,[`directional`,`noise`,`luminance`],`Directional soft wipe, deterministic noise threshold, or bright-first destination reveal.`,`Transition`),direction:a(`right`,[`right`,`down`,`left`,`up`],`Direction of the advancing front in directional mode.`,`Transition`),feather:i(.06,0,.25,`Reveal feather half-width in normalized threshold units.`,`Transition`),noiseScale:i(8,1,24,`Noise cells across host height; noise stays still as progress changes.`,`Noise`)},presets:{editorial:{mode:`directional`,direction:`right`,feather:.06},dissolve:{mode:`noise`,noiseScale:8,feather:.08},highlights:{mode:`luminance`,feather:.06}},quality:{resolutionScale:[.5,1]},reducedMotion:{time:0},fallback:`transparent`,imageFallback:!0,poster:new URL(`/labs/hologpu/assets/poster-BEKVsfRq.png`,``+import.meta.url).href,async setup({ctx:n,input:i}){let a=await r(n,s,`hgpu-section-wipe`,[],[e]),o,c,l,u=e=>({texture:e.texture,mipLevel:e.mipLevel??0,arrayLayer:e.arrayLayer??0}),d=(e,t)=>!e||e.texture!==t.texture||e.mipLevel!==(t.mipLevel??0)||e.arrayLayer!==(t.arrayLayer??0);return{resize(){o=void 0},update(){},reset(){},shouldRender:()=>!1,render(e,r,s){let f=i(),p=n.inputs?.get(`next`)??f;(!o||d(c,f)||d(l,p))&&(o=t(n,a,f),c=u(f),l=u(p)),a.draw(r,s,[o])},dispose(){o=c=l=void 0,a.dispose()},sources:{fragment:a.source},diagnostics:a.diagnostics,memory:()=>({textureBytes:0,bufferBytes:0})}}});export{c as t};