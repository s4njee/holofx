// Capture real bundled demos and encode short looping AVIF card previews.
// node scripts/capture-animated-previews.cjs [project | project/id ...] [--recapture] [--text-only]
// By default every catalogue experiment without an animated preview is captured; --text-only keeps
// the original scope (cards with no image at all). The built site must be served at CAPTURE_ORIGIN
// (default http://127.0.0.1:5188) under CAPTURE_BASE (default /); scripts/update-site.mjs does this.
// Requires local ffmpeg/avifenc and the site's own Playwright.
const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');const {chromium}=require('@playwright/test');
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'src/catalogues.json')));
const manifestPath=path.join(root,'src/animated-previews.json');const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):{version:1,width:480,height:300,fps:8,frames:20,items:{}};
const selected=process.argv.slice(2);const forced=selected.includes('--recapture');const textOnly=selected.includes('--text-only');const requested=selected.filter(x=>!x.startsWith('--'));
const targets=Object.entries(catalogue).flatMap(([project,effects])=>effects.filter(e=>!textOnly||!e.image||manifest.items[`${project}/${e.id}`]).map(effect=>({project,effect})));
// Keys in manifest.posterPreferred keep their designed poster; capture them only when named outright.
const preferPoster=(key)=>Boolean(manifest.posterPreferred?.[key]);
const jobs=targets.filter(({project,effect})=>{const key=`${project}/${effect.id}`;return requested.length?requested.includes(key)||(requested.includes(project)&&!preferPoster(key)):!preferPoster(key);});
// A circular drag orbits these 3D cameras out of their framing; hover the same circle instead.
const hoverOnly=new Set(['lighttemple/ssil','lighttemple/area-lights-ltc']);
const origin=(process.env.CAPTURE_ORIGIN||'http://127.0.0.1:5188').replace(/\/$/,'');const base=('/'+(process.env.CAPTURE_BASE||'/')+'/').replace(/\/+/g,'/');
// The temples share one shell: ?effect=<id>, a .<prefix>-effect__stage holding the canvas, a .<prefix>-hud.
const shellPrefix={watertemple:'wt',firetemple:'ft',eightfoldpath:'efp'};
const pending=[];let encoding=0;let failed=0;
function exec(command,args){return new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('exit',c=>c===0?resolve(out):reject(new Error(`${command} ${c}: ${out.slice(-1500)}`)));});}
function saveManifest(){fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');}
async function encode(key,dir,settings){encoding++;try{
 const frames=Array.from({length:manifest.frames},(_,i)=>path.join(dir,`${String(i).padStart(3,'0')}.png`));
 const image=`/images/animated/${key}.avif`;const still=`/images/animated/${key}.jpg`;const out=path.join(root,'public',image);fs.mkdirSync(path.dirname(out),{recursive:true});
 await exec('avifenc',['--jobs','2','--speed','7','--qcolor','55','--yuv','420','--fps',String(manifest.fps),'--repetition-count','infinite',...frames,out]);
 await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',frames[0],'-frames:v','1','-q:v','3',path.join(root,'public',still)]);
 const info=JSON.parse(await exec('ffprobe',['-v','error','-count_frames','-select_streams','v:1','-show_entries','stream=width,height,nb_read_frames','-of','json',out]));
 if(Number(info.streams[0]?.nb_read_frames)!==manifest.frames)throw new Error('AVIF frame count mismatch');
 const analysis=await exec('ffmpeg',['-hide_banner','-loglevel','error','-i',out,'-map','0:v:1','-vf','scale=32:20,format=gray','-f','framemd5','-']);const hashes=analysis.split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>x.split(',').at(-1).trim());const unique=new Set(hashes).size;
 if(unique<2)throw new Error('Captured clip has no visible motion');
 manifest.items[key]={image,still,source:settings.url,frames:manifest.frames,fps:manifest.fps,width:manifest.width,height:manifest.height,uniqueFrames:unique,bytes:fs.statSync(out).size,settings:settings.state,capturedAt:new Date().toISOString()};saveManifest();console.log(`ENCODED ${key} ${Math.round(fs.statSync(out).size/1024)} KiB ${unique} distinct frames`);
 // CAPTURE_DISCARD_FRAMES=1 deletes the raw PNGs once encoded (no reuse on a rerun, but ~5 MB less per clip on disk).
 if(process.env.CAPTURE_DISCARD_FRAMES==='1')fs.rmSync(dir,{recursive:true,force:true});
 }catch(e){failed++;console.log(`ENCODE_FAIL ${key} ${e.message}`);}finally{encoding--;}}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:1});let errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.__captureSubmits=0;if(typeof GPUQueue!=='undefined'){const original=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(...args){window.__captureSubmits++;return original.apply(this,args);};}});
 try{for(const {project,effect} of jobs){
 const key=`${project}/${effect.id}`;if(!forced&&manifest.items[key]&&fs.existsSync(path.join(root,'public',manifest.items[key].image))){console.log(`SKIP ${key}`);continue;}
 while(encoding>=2)await new Promise(r=>setTimeout(r,100));
 const dir=path.join(root,'.site-runtime/capture',project,effect.id);try{fs.mkdirSync(dir,{recursive:true});}catch(e){failed++;console.log(`CAPTURE_FAIL ${key} ${e.message}`);continue;}errors=[];
 let url=`${origin}${base}labs/${project}/`+(project==='lighttemple'?`#/x/${effect.id}`:project==='hologpu'||project==='watertemple'?`?effect=${effect.id}&hud=0&resolution=0.5`:`?effect=${effect.id}`);
 console.log(`START ${key}`);
 const frameFiles=Array.from({length:manifest.frames},(_,i)=>path.join(dir,`${String(i).padStart(3,'0')}.png`));
 if(!forced && (project!=='hologpu'||effect.id==='gradient-oklch') && frameFiles.every(file=>fs.existsSync(file))){const saved=path.join(dir,'capture.json');const settings=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved)):{url,state:{pointer:'one circular drag',reusedCapturedFrames:true}};pending.push(encode(key,dir,settings));continue;}
 if(project==='watertemple'&&effect.id==='puddles')url+='&p.rain=1&p.rippleStrength=2.5&p.lamps=1&p.sunElevation=30&p.waterLevel=0.5';
 if(project==='hologpu'&&effect.id==='audio-spectrum')url+='&preset=scope';
 try{
 await page.goto('about:blank');await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 await page.addStyleTag({content:`#stage,.wt-effect__stage,.ft-effect__stage,.efp-effect__stage,.stage{position:fixed!important;left:0!important;top:0!important;width:480px!important;height:300px!important;min-height:0!important;max-height:none!important;margin:0!important;border:0!important;z-index:2147483646!important} #stage canvas,.wt-effect__stage canvas,.ft-effect__stage canvas,.efp-effect__stage canvas,.stage canvas{width:480px!important;height:300px!important;max-width:none!important} .stats,.stage-stats,.wt-hud,.wt-host__hud,.ft-hud,.efp-hud,.frame-stats{display:none!important} body{overflow:hidden!important}`});
 const canvas=project==='hologpu'?page.locator('#canvas'):shellPrefix[project]?page.locator(`.${shellPrefix[project]}-effect__stage canvas`).first():page.locator('.stage canvas');
 if(project==='hologpu'){await page.waitForFunction(()=>['ready','error','fallback'].includes(document.getElementById('status')?.dataset.state),null,{timeout:45000});const state=await page.locator('#status').getAttribute('data-state');if(state!=='ready')throw new Error(await page.locator('#status').innerText());
 if(await page.locator('#media-source').count()){const choices=await page.locator('#media-source option').evaluateAll(els=>els.map(e=>e.value));if(choices.includes('canvas'))await page.locator('#media-source').selectOption('canvas',{force:true});else if(choices.includes('text')){await page.locator('#media-source').selectOption('text',{force:true});await page.locator('#media-text-apply').evaluate(el=>el.click());}}
 if(['radiance-cascades','shadows-2d','jump-flood'].includes(effect.id)&&await page.locator('#param-channel').count())await page.locator('#param-channel').selectOption('luminance',{force:true});
 if(effect.id==='morph-particles')await page.locator('#morph-text-apply').evaluate(el=>el.click());
 if(effect.id==='audio-spectrum'&&await page.locator('#media-audio-sample').count())await page.locator('#media-audio-sample').evaluate(el=>el.click());
 }else if(project==='lighttemple'){await page.waitForFunction(()=>window.__lighttemple?.state==='error'||(window.__lighttemple?.state==='running'&&window.__lighttemple.frames>=15),null,{timeout:45000});const status=await page.evaluate(()=>window.__lighttemple);if(status.state==='error')throw new Error(status.error);}
 else{await canvas.waitFor({state:'visible',timeout:45000});await page.waitForFunction(()=>window.__captureSubmits>=8,null,{timeout:45000});if(effect.id==='puddles')await page.locator('.tp-lblv').first().waitFor({state:'attached',timeout:15000});}
 await page.waitForTimeout(800);const box=await canvas.boundingBox();if(!box||box.width<400)throw new Error('Canvas did not size correctly');
 await page.mouse.move(240,150);if(!hoverOnly.has(key))await page.mouse.down();await page.waitForTimeout(350);
 for(let i=0;i<manifest.frames;i++){const angle=i/manifest.frames*Math.PI*2;await page.mouse.move(240+Math.cos(angle)*115,150+Math.sin(angle)*68);
 // Press effects react to pointer-down, not to a held drag: press again every few frames.
 if(project==='hologpu'&&effect.id==='press-ripple'&&i%5===0){await page.mouse.up();await page.mouse.down();}
 if(project==='watertemple'&&effect.id==='puddles')await page.evaluate(angle=>{const url=new URL(location.href);url.searchParams.set('p.tilt',String(25+10*Math.sin(angle)));url.searchParams.set('p.sunAzimuth',String(35*Math.cos(angle)));history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));},angle);
 if(project==='hologpu')await page.evaluate(([id,angle,frame])=>{
 const set=(name,value)=>{const input=document.getElementById('param-'+name);if(input){input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));}};
 if(document.getElementById('param-progress'))set('progress',0.5-0.45*Math.cos(angle));
 if(id==='mipgen'){set('frequency',10);set('level',Math.round(3-3*Math.cos(angle)));document.getElementById('reset').click();}
 if(id==='path-tracer')set('angle',0.35*Math.sin(angle));
 if(id==='fractal'){set('zoom',1.7-0.65*Math.cos(angle));set('center-0',-0.6+0.13*Math.sin(angle));set('hue',1.2+0.7*Math.sin(angle));}
 if(id==='audio-spectrum'){set('lineWidth',3);set('gain',0.8+0.25*Math.sin(angle));}
 if(id==='spotlight'){set('pagePointer-0',256+140*Math.cos(angle));set('pagePointer-1',256+140*Math.sin(angle));}
 if(id==='shadows-2d'){set('light-0',0.5+0.3*Math.cos(angle));set('light-1',0.5+0.3*Math.sin(angle));}
 if(id==='radiance-cascades')set('exposure',1+0.55*Math.sin(angle));
 if(id==='hover-lift-shadow')set('elevation',0.4-0.35*Math.cos(angle));
 if(['prefix-sum','sort','spatial-hash'].includes(id)){set('threshold',0.5+0.35*Math.sin(angle));if(id==='spatial-hash'){const seed=document.getElementById('seed');seed.value=String(7+frame);seed.dispatchEvent(new Event('change',{bubbles:true}));}if(id==='sort'){const view=document.getElementById('param-view');view.value='indices';view.dispatchEvent(new Event('change',{bubbles:true}));}}
 },[effect.id,angle,i]);
 await page.waitForTimeout(1000/manifest.fps);await canvas.screenshot({path:path.join(dir,`${String(i).padStart(3,'0')}.png`),timeout:15000});}
 await page.mouse.up();
 if(errors.some(e=>/Validation|Error|failed|invalid/i.test(e)))throw new Error(errors.slice(0,3).join('\n'));
 const settings={url,state:{pointer:hoverOnly.has(key)?'one circular hover':'one circular drag',input:project==='hologpu'?'animated canvas or text where applicable':'demo default',errors,parameterScrub:project==='hologpu'?'progress, light position, or primitive workload where applicable':null}};
 fs.writeFileSync(path.join(dir,'capture.json'),JSON.stringify(settings,null,2));
 console.log(`CAPTURED ${key}`);const promise=encode(key,dir,settings);pending.push(promise);
 }catch(e){failed++;await page.mouse.up().catch(()=>{});if(page.isClosed())throw e;console.log(`CAPTURE_FAIL ${key} ${e.message.slice(0,900)}`);}
 }
 }finally{await page.close();await browser.close();await Promise.all(pending);}
 console.log(`DONE ${Object.keys(manifest.items).length} animated previews; ${failed} failures this run`);process.exitCode=failed?1:0;
})();
