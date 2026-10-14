import fs from 'node:fs';
const catalogue=JSON.parse(fs.readFileSync('src/catalogues.json'));
const manifest=JSON.parse(fs.readFileSync('src/animated-previews.json'));
let count=0;
for(const [project,effects] of Object.entries(catalogue))for(const effect of effects){const preview=manifest.items[`${project}/${effect.id}`];if(!preview)continue;
 if(preview.frames<2||preview.uniqueFrames<2)throw new Error('Not an animated preview: '+effect.id);
 for(const asset of [preview.image,preview.still])if(!fs.existsSync('public'+asset))throw new Error('Missing captured asset: '+asset);
 effect.image=preview.image;effect.imageStatic=preview.still;count++;
}
fs.writeFileSync('src/catalogues.json',JSON.stringify(catalogue,null,2)+'\n');console.log(`Applied ${count} captured animated previews`);
