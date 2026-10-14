import './style.css';
import catalogues from './catalogues.json';
import { createGallery, watchPreview, suspendPreviews } from './gallery.js';
import { createEffect, fragmentEffect } from '../vendor/hologpu/core/index.ts';
const $ = (id) => document.getElementById(id);
const projects = {
  hologpu: {name:'HoloGPU',mode:0,kicker:'NATIVE WEBGPU. ENDLESS POSSIBILITIES.',headline:'Give the web<br>a little <em>wonder.</em>',description:'An expressive toolkit for the browser. Explore shaders, particles, fluid simulations, and the quiet details that make an interface feel alive.',note:'Small details. Extraordinary experiences.',art:'PRISMATIC FIELD',collection:'One toolkit.<br>Three elemental worlds.',collectionDescription:'A broad effects library, with focused experiments in the things that make a screen feel alive. Pick a temple. Follow your curiosity.',bottom:'Different directions. A shared love for the details.',cards:[
    {title:'Light Temple',description:'Sculpt with light. Explore soft shadows, holographic surfaces, and illuminated typography.',tag:'LIGHT & MATERIAL',meta:'SHADOWS / OPTICS / GLOW',image:'pointer-light.jpg',project:'lighttemple'},
    {title:'Water Temple',description:'Let the interface flow. From refracted light to rippling oceans and interactive fluid worlds.',tag:'FLUID & REFRACTION',meta:'CAUSTICS / FLUIDS / WAVES',image:'water.webp',project:'watertemple'},
    {title:'Fire Temple',description:'Bring a little energy. Procedural flames, drifting embers, and light that feels warm.',tag:'FIRE & ATMOSPHERE',meta:'FLAMES / EMBERS / HEAT',image:'fire.webp',project:'firetemple'}]},
  lighttemple:{name:'Light Temple',mode:1,kicker:'LIGHT, SHADOW, AND EVERYTHING BETWEEN.',headline:'Everything looks<br>better in <em>the light.</em>',description:'An experimental gallery of WebGPU lighting and shadow effects. Shape a surface, follow a reflection, and give ordinary interfaces another dimension.',note:'A study in illumination and material.',art:'LUMINOUS FORM',collection:'A different light.<br>A whole new dimension.',collectionDescription:'Play with the way light lands on a surface. Each experiment reveals another way to make a simple interface feel tactile.',bottom:'Live experiments. Real parameters. Plenty to discover.',cards:[
    {title:'Holographic Card',description:'A tilting foil surface with diffraction, thin-film interference, and shifting iridescent color.',tag:'OPTICS',meta:'DIFFRACTION / THIN FILM',image:'holo-card.jpg',fallback:'holo.svg',effect:'holo-card'},
    {title:'Pointer Light',description:'A cursor-following area light that casts soft, finite shadows from an extruded scene.',tag:'INTERACTION',meta:'AREA LIGHT / SDF SHADOWS',image:'pointer-light.jpg',fallback:'light.svg',effect:'pointer-light-2d'},
    {title:'Neon Sign',description:'Make your own glowing lettering, with flickering tubes and light spilling onto brick.',tag:'TYPOGRAPHY',meta:'EMISSION / LIGHT SPILL',image:'neon-sign.jpg',fallback:'neon.svg',effect:'neon-sign'}]},
  watertemple:{name:'Water Temple',mode:2,kicker:'A LITTLE MOVEMENT. A DEEPER EXPERIENCE.',headline:'Go with<br>the <em>flow.</em>',description:'A collection of water-inspired WebGPU experiments. Discover liquid surfaces, fluid simulations, and oceans that move beyond the edge of the screen.',note:'An exploration of fluid, depth, and refraction.',art:'LIQUID FIELD',collection:'From a quiet ripple<br>to an open ocean.',collectionDescription:'Water takes many forms. Explore reflective surfaces, simulated currents, and waves built for interactive web experiences.',bottom:'Move a parameter. Make a wave.',cards:[
    {title:'Liquid Chrome',description:'Black and silver fluid ribbons reflecting moving studio lights, with tiny spectral glints.',tag:'FLUID MATERIAL',meta:'COMPUTE / REFLECTION',image:'liquid-chrome.jpg',effect:'liquid-chrome'},
    {title:'Gerstner Ocean',description:'A layered ocean surface with rolling waves. Explore the scene and adjust its parameters.',tag:'OCEAN',meta:'WAVES / OPTICS',image:'ocean.webp',effect:'gerstner-ocean'},
    {title:'Ink Orbit',description:'Color in motion. Stir an interactive fluid field and watch its ink curl around the page.',tag:'INTERACTIVE FLUID',meta:'DYE / FLOW / COLOR',image:'ink-orbit.jpg',effect:'ink-orbit'}]},
  firetemple:{name:'Fire Temple',mode:3,kicker:'WARMTH, ENERGY, AND A LITTLE DRAMA.',headline:'Set your next<br>idea <em>alight.</em>',description:'Fire-looking WebGPU effects for expressive websites. Explore dancing flames, glowing rings, drifting sparks, and the atmosphere that ties them together.',note:'A study in emission and atmosphere.',art:'EMBER FORM',collection:'Keep the glow.<br>Turn up the feeling.',collectionDescription:'From a warm accent to a vivid focal point. Every experiment has a live demo, readable source, and notes on how it might fit a real website.',bottom:'A spark of inspiration. An experiment worth opening.',cards:[
    {title:'Fire Ring',description:'A seamless ring of flame, with a transparent center and a controllable progress arc.',tag:'ELEMENTAL UI',meta:'POLAR FLAME / PROGRESS',image:'fire.webp',effect:'fire-ring'},
    {title:'Sparks',description:'Explore glowing particles, animated trails, and the small details that make fire feel alive.',tag:'PARTICLES',meta:'EMBERS / MOTION',image:'sparks.webp',effect:'sparks'},
    {title:'Candle',description:'A quieter kind of fire. A small flame brings focus and warmth to a scene.',tag:'ATMOSPHERE',meta:'FLAME / FLICKER',image:'candle.webp',effect:'candle'}]}
};
let current = 'hologpu';
let field;
let heroVisible = false;
let heroPending = false;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sculpture = fragmentEffect({
  id:'temple-sculpture',title:'Elemental sculpture',params:{mode:{type:'f32',default:0,min:0,max:3},speed:{type:'f32',default:0.18,min:0,max:1}},inputs:['time','pointer'],quality:{resolutionScale:[0.25,1]},
  wgsl:`
fn rotate2(p: vec2f, a: f32) -> vec2f {let c=cos(a); let s=sin(a); return vec2f(c*p.x-s*p.y,s*p.x+c*p.y);}
fn shape(pos: vec3f) -> f32 {
 var p=pos;
 p.xz=rotate2(p.xz,0.32+frame.time*params.speed*0.22+(frame.pointer.x-0.5)*0.12);
 p.yz=rotate2(p.yz,0.87+(frame.pointer.y-0.5)*0.12);
 let ang=atan2(p.z,p.x);
 var q=vec2f(length(p.xz)-0.79,p.y);
 q=rotate2(q,ang*2.0+frame.time*params.speed*0.3);
 let wave=sin(ang*9.0+q.y*14.0+frame.time*params.speed)*0.009;
 let tube=0.27+0.035*sin(ang*3.0+frame.time*params.speed);
 return length(q)-tube+wave;
}
fn norm(p: vec3f) -> vec3f {let e=0.001;return normalize(vec3f(shape(p+vec3f(e,0,0))-shape(p-vec3f(e,0,0)),shape(p+vec3f(0,e,0))-shape(p-vec3f(0,e,0)),shape(p+vec3f(0,0,e))-shape(p-vec3f(0,0,e))));}
fn effect(uv: vec2f) -> vec4f {
 let xy=(uv-0.5)*vec2f(frame.resolution.x/frame.resolution.y,1.0);
 let ro=vec3f(0.0,0.0,3.0);
 let rd=normalize(vec3f(xy*2.65,-2.7));
 var distance=0.0;var hit=false;
 for(var i=0;i<76;i++){let d=shape(ro+rd*distance);if(d<0.001){hit=true;break;}distance+=d*0.8;if(distance>5.0){break;}}
 let radius=length(xy);
 var col=vec3f(0.005,0.007,0.007)+vec3f(0.004,0.006,0.004)*max(0.0,1.0-radius);
 if(hit){
 let p=ro+rd*distance; let n=norm(p); let v=-rd;
 let fres=pow(1.0-max(dot(n,v),0.0),2.5);
 let l=normalize(vec3f(-1.0,1.5,2.8));
 let dif=max(dot(n,l),0.0); let spec=pow(max(dot(n,normalize(l+v)),0.0),48.0);
 let theta=atan2(p.y,p.x);
 var base=0.5+0.5*cos(6.28318*(vec3f(0.08,0.38,0.68)+theta*0.13+p.z*0.32+fres*0.65+frame.time*params.speed*0.06));
 if(params.mode>0.5 && params.mode<1.5){base=mix(vec3f(0.25,0.13,0.035),vec3f(0.96,0.73,0.33),0.45+0.4*sin(p.y*3.0+fres*2.0));}
 if(params.mode>1.5 && params.mode<2.5){let waves=0.5+0.5*sin(p.x*20.0+sin(p.y*17.0+frame.time*0.4)*2.0+frame.time*0.5);base=mix(vec3f(0.018,0.09,0.15),vec3f(0.22,0.68,0.69),waves);}
 if(params.mode>2.5){let burn=0.5+0.5*sin(theta*24.0+p.z*15.0-frame.time*0.6);base=mix(vec3f(0.3,0.012,0.003),vec3f(1.0,0.45,0.025),burn);}
 let env=pow(max(0.0,0.5+0.5*sin(n.y*10.0+n.x*2.0)),14.0);
 col=base*(0.18+dif*0.6)+base*fres*0.52+vec3f(0.85,0.94,1.0)*spec*0.72+base*env*0.33;
 if(params.mode>2.5){col+=base*(fres*0.8+0.15);}
 col=col*0.85;
 }
 return vec4f(col,1.0);
}`
});
function labUrl(project=current,effect='',tab='') {
 let url=`/labs/${project}/`;
 if(effect){url+=project==='lighttemple'?`#/x/${encodeURIComponent(effect)}`:`?effect=${encodeURIComponent(effect)}`;}
 if(tab && project!=='lighttemple')url+=(url.includes('?')?'&':'?')+`tab=${tab}`;
 return url;
}
function motionState(){
 $('motion').textContent=paused?'▶':'Ⅱ';$('motion').setAttribute('aria-pressed',String(paused));$('motion').setAttribute('aria-label',paused?'Play animation':'Pause animation');
 if(field){field.setReducedMotion(paused);if(paused || $('lab-dialog').open || !heroVisible || document.hidden)field.pause();else field.play();}
}
function selectSite(key, push=true){
 if(!projects[key])key='hologpu';current=key;const p=projects[key];
 document.body.dataset.site=key;$('site-select').value=key;
 document.title=`${p.name} — Effects for an expressive web`;
 $('hero-kicker').textContent=p.kicker;$('headline').innerHTML=p.headline;$('hero-description').textContent=p.description;$('hero-note').textContent=p.note;$('figure-no').textContent=String(p.mode+1).padStart(3,'0');$('art-name').textContent=p.art;
 $('collection-title').innerHTML=p.collection;$('collection-description').textContent=p.collectionDescription;$('collection-note').textContent=p.bottom;
 $('collection').hidden=key!=='hologpu';
 $('cards').replaceChildren(...projects.hologpu.cards.map(card=>{
 const el=document.createElement('a');el.className='effect-card temple-card';el.href=`?site=${card.project}`;
 el.innerHTML=`<div class="card-image"><img alt="${card.title} effect preview"><span class="image-tag">${card.tag}</span></div><div class="card-body"><div class="card-title"><h3>${card.title}</h3><span aria-hidden="true">↗</span></div><p>${card.description}</p><div class="card-bottom"><span>${card.meta}</span><span class="card-action">Enter temple ↗</span></div></div>`;
 watchPreview(el.querySelector('img'),`/images/${card.image}`);
 el.addEventListener('click',event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();selectSite(card.project);window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
 return el;
 }));
 $('experiments-title').textContent=`All ${p.name} experiments`;
 $('experiments-description').textContent=`The complete collection: ${catalogues[key].length} experiments. Scroll to explore every experiment. Previews load as they come into view; open any card to try its live demo.`;
 gallery.reset();
 $('hero-art').querySelector('.hero-fallback').src=`/images/${['holo.svg','light.svg','water.webp','fire.webp'][p.mode]}`;
 $('hero-art').querySelector('.hero-fallback').alt=`${p.name} elemental effect preview`;
 $('source-button').textContent=key==='hologpu'?'Explore the implementation ↗':'Explore source & notes ↗';
 if(field){field.params.mode=p.mode;field.invalidate();}
 if(push){const url=new URL(location.href);if(key==='hologpu')url.searchParams.delete('site');else url.searchParams.set('site',key);history.pushState({site:key},'',url);}
}
function openLab(project=current,effect='',tab=''){
 if(project==='hologpu' && tab==='source')$('lab-frame').addEventListener('load',()=>{$('lab-frame').contentDocument?.querySelector('[data-drawer="source-panel"]')?.click();},{once:true});
 const url=labUrl(project,effect,tab);$('lab-title').textContent=`${projects[project].name} lab`;$('lab-frame').contentWindow.location.replace(url);$('lab-full').href=url;
 if(!$('lab-dialog').open)$('lab-dialog').showModal();
 suspendPreviews(true);
 field?.pause();
}
function closeLab(){ $('lab-dialog').close(); }
const gallery = createGallery({ catalogues, getProject:()=>current, labUrl, openLab });
$('site-select').addEventListener('change',event=>selectSite(event.target.value));
addEventListener('popstate',()=>selectSite(new URLSearchParams(location.search).get('site'),false));
document.querySelectorAll('.open-lab').forEach(button=>button.addEventListener('click',()=>openLab()));
$('source-button').addEventListener('click',()=>openLab(current,current==='lighttemple'?'pointer-light-2d':current==='watertemple'?'liquid-chrome':current==='firetemple'?'fire-ring':'gradient-oklch','source'));
$('lab-close').addEventListener('click',closeLab);
$('lab-dialog').addEventListener('click',event=>{if(event.target===$('lab-dialog')){const r=$('lab-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeLab();}});
$('lab-dialog').addEventListener('close',()=>{ $('lab-frame').contentWindow.location.replace('about:blank');suspendPreviews(false);gallery.resume();motionState(); });
$('motion').addEventListener('click',()=>{paused=!paused;motionState();});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{paused=event.matches;motionState();});
selectSite(new URLSearchParams(location.search).get('site'),false);motionState();
async function bootHero(){
 if(field || heroPending || document.hidden || !heroVisible)return;
 heroPending=true;
 try{
 if(new URLSearchParams(location.search).has('fallback'))throw new Error('Requested fallback');
 field=await createEffect($('hero-canvas'),sculpture,{params:{mode:projects[current].mode},playing:!paused,reducedMotion:paused,dprCap:1.5,resolutionScale:0.85,adaptiveQuality:false,seed:7});
 $('hero-art').classList.add('ready');$('gpu-status').innerHTML='<span class="status-dot"></span> LIVE WEBGPU / INTERACTIVE SCULPTURE';motionState();
 }catch(error){$('gpu-status').innerHTML='<span class="status-dot"></span> STATIC PREVIEW / WEBGPU UNAVAILABLE';$('motion').hidden=true;console.info('Using static effect preview:',error.message);
} finally { heroPending=false; }
}
const heroObserver = new IntersectionObserver(entries=>{heroVisible=entries[0].isIntersecting;motionState();if(heroVisible)void bootHero();},{threshold:0});
heroObserver.observe($('hero-art'));
document.addEventListener('visibilitychange',()=>{suspendPreviews(document.hidden || $('lab-dialog').open);if(!document.hidden){gallery.resume();if(heroVisible)void bootHero();}motionState();});
addEventListener('pagehide',()=>{field?.destroy();heroObserver.disconnect();gallery.destroy();});
