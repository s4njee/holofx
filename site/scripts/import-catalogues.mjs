import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const research=process.argv[2] || path.resolve('../../..');
const ts=require(path.join(research,'hologpu/node_modules/typescript'));
const root=path.resolve('.');
function copyPoster(project,id,file){if(!fs.existsSync(file))return null;const dest=`/images/catalogues/${project}/${id}${path.extname(file)}`;fs.mkdirSync(path.dirname(root+'/public'+dest),{recursive:true});fs.copyFileSync(file,root+'/public'+dest);return dest;}
async function readData(file){const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
const catalogues={};
for(const project of ['watertemple','firetemple']){
 const dir=path.join(research,project,'src/effects');catalogues[project]=[];
 for(const name of fs.readdirSync(dir)){const f=path.join(dir,name,'meta.ts');if(!fs.existsSync(f)||!fs.existsSync(path.join(dir,name,'index.ts')))continue;const {meta}=await readData(f);catalogues[project].push({id:meta.id,title:meta.title,summary:meta.summary,tags:meta.tags,epic:meta.epic,tier:meta.tier,image:copyPoster(project,meta.id,path.join(dir,name,'poster.webp'))});}
 catalogues[project].sort((a,b)=>Number(a.epic)-Number(b.epic)||a.title.localeCompare(b.title));
}
const light=await readData(path.join(research,'lighttemple/src/gallery/registry.ts'));
catalogues.lighttemple=light.experiments.map(e=>({id:e.slug,title:e.title,summary:e.summary,tags:e.tags,category:light.EPIC_LABELS[e.epic],background:e.cardBackground,image:({'holo-card':'/images/holo-card.jpg','pointer-light-2d':'/images/pointer-light.jpg','neon-sign':'/images/neon-sign.jpg'})[e.slug]||null}));
catalogues.hologpu=[];
const dir=path.join(root,'vendor/hologpu/effects');
for(const name of fs.readdirSync(dir)){const f=path.join(dir,name,'index.ts');if(name.startsWith('_')||!fs.existsSync(f))continue;const sf=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);let meta;
 const literal=node=>!node?null:ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)?node.text:ts.isArrayLiteralExpression(node)?node.elements.map(literal):null;
 function visit(n){if(ts.isCallExpression(n)&&literal(n.arguments[0])===name&&typeof literal(n.arguments[1])==='string')meta={id:name,title:literal(n.arguments[1]),tags:['compute','primitives']};if(ts.isObjectLiteralExpression(n)){const fields=Object.fromEntries(n.properties.filter(ts.isPropertyAssignment).map(prop=>[prop.name.getText(sf).replace(/['"]/g,''),literal(prop.initializer)]));if(fields.id===name&&fields.title)meta=fields;}ts.forEachChild(n,visit);}visit(sf);
 if(!meta)throw new Error('Missing effect metadata: '+name);
 const poster=['poster.png','poster.webp'].map(file=>path.join(dir,name,file)).find(fs.existsSync);
 catalogues.hologpu.push({id:name,title:meta.title,tags:meta.tags||[],summary:`Explore ${(meta.tags||[]).slice(0,4).join(', ').replace(/-/g,' ')} with live parameters and shader source.`,image:poster?copyPoster('hologpu',name,poster):null});
}
catalogues.hologpu.sort((a,b)=>a.title.localeCompare(b.title));
const animationManifest='src/animated-previews.json';
if(fs.existsSync(animationManifest)){const {items}=JSON.parse(fs.readFileSync(animationManifest));for(const [project,effects] of Object.entries(catalogues))for(const effect of effects){const preview=items[`${project}/${effect.id}`];if(preview&&fs.existsSync(root+'/public'+preview.image)){effect.image=preview.image;effect.imageStatic=preview.still;}}}
fs.writeFileSync('src/catalogues.json',JSON.stringify(catalogues,null,2)+'\n');
console.log(Object.fromEntries(Object.entries(catalogues).map(([k,v])=>[k,v.length])));
