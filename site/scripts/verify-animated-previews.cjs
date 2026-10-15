const fs=require('node:fs');const {spawnSync}=require('node:child_process');
// Every catalogue experiment should have an animated preview; --partial only checks the ones that do.
const catalogue=JSON.parse(fs.readFileSync('src/catalogues.json'));
const preferred=JSON.parse(fs.readFileSync('src/animated-previews.json')).posterPreferred??{};
const targets=Object.entries(catalogue).flatMap(([project,effects])=>effects.map(e=>`${project}/${e.id}`)).filter(key=>!preferred[key]);
const manifest=JSON.parse(fs.readFileSync('src/animated-previews.json'));const partial=process.argv.includes('--partial');let failures=[];let warnings=[];const report={required:targets.length,verified:0,items:{}};
for(const key of targets){const m=manifest.items[key];if(!m){if(!partial)failures.push(`${key}: missing`);continue;}
 const file='public'+m.image;const still='public'+m.still;if(!fs.existsSync(file)||!fs.existsSync(still)){failures.push(`${key}: missing file`);continue;}
 const info=spawnSync('avifdec',['--jobs','2','--info',file],{encoding:'utf8'});if(info.status!==0||!info.stdout.includes('20 expected frames')||!info.stdout.includes('Repeat Count   : Infinite')||!info.stdout.includes('480x300')){failures.push(`${key}: invalid AVIF sequence`);continue;}
 const decoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-map','0:v:1','-vf','scale=48:30,format=rgb24','-f','rawvideo','-'],{maxBuffer:2*1024*1024});const bytes=decoded.stdout;const frameSize=48*30*3;if(decoded.status!==0||bytes.length!==frameSize*20){failures.push(`${key}: decoding mismatch`);continue;}
 let maxDifference=0,visibleChange=0,brightness=0;
 for(let j=0;j<frameSize;j++)brightness+=bytes[j]/frameSize;
 for(let frame=1;frame<20;frame++){let difference=0,changed=0;for(let j=0;j<frameSize;j++){const d=Math.abs(bytes[j]-bytes[frame*frameSize+j]);difference+=d/frameSize;if(d>=5)changed++;}maxDifference=Math.max(maxDifference,difference);visibleChange=Math.max(visibleChange,changed/frameSize);}
 report.items[key]={maxDifference,visibleChange,brightness,bytes:fs.statSync(file).size};report.verified++;
 if(maxDifference<0.6)warnings.push(`${key}: low motion ${maxDifference.toFixed(2)}`);if(brightness<1)warnings.push(`${key}: nearly black`);
}
fs.mkdirSync('.site-runtime',{recursive:true});fs.writeFileSync('.site-runtime/animated-preview-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({required:targets.length,verified:report.verified,failures,warnings},null,2));if(failures.length||warnings.length)process.exitCode=1;
