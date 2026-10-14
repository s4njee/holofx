import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The submodules live one level up, inside the holofx superproject.
const superproject = path.resolve(root, '..');

function readCatalogue(project) {
  return JSON.parse(fs.readFileSync(path.join(superproject, project, 'catalogue.json'), 'utf8'));
}

function copyPoster(project, id, poster) {
  if (!poster) return null;
  const source = path.join(superproject, project, poster);
  if (!fs.existsSync(source)) return null;
  const dest = `/images/catalogues/${project}/${id}${path.extname(source)}`;
  fs.mkdirSync(path.dirname(root + '/public' + dest), { recursive: true });
  fs.copyFileSync(source, root + '/public' + dest);
  return dest;
}

const lightImages = {
  'holo-card': '/images/holo-card.jpg',
  'pointer-light-2d': '/images/pointer-light.jpg',
  'neon-sign': '/images/neon-sign.jpg',
};

const catalogues = {};

catalogues.firetemple = readCatalogue('firetemple').effects.map((e) => ({
  id: e.id,
  title: e.title,
  summary: e.summary,
  tags: e.tags,
  epic: e.epic,
  tier: e.tier,
  status: e.status,
  image: copyPoster('firetemple', e.id, e.poster),
  scorecard: e.scorecard ?? null,
}));

catalogues.watertemple = readCatalogue('watertemple').effects.map((e) => ({
  id: e.id,
  title: e.title,
  summary: e.summary,
  tags: e.tags,
  epic: e.epic,
  tier: e.tier,
  status: e.status,
  image: copyPoster('watertemple', e.id, e.poster),
  scorecard: e.scorecard ?? null,
}));

catalogues.lighttemple = readCatalogue('lighttemple').experiments.map((e) => ({
  id: e.id,
  title: e.title,
  summary: e.summary,
  tags: e.tags,
  category: e.category,
  background: e.background,
  status: e.status,
  image: lightImages[e.id] ?? null,
}));

catalogues.hologpu = readCatalogue('hologpu').effects.map((e) => ({
  id: e.id,
  title: e.title,
  summary: e.summary,
  tags: e.tags,
  family: e.family,
  tier: e.tier,
  status: e.status,
  image: copyPoster('hologpu', e.id, e.poster),
}));

const animationManifest = 'src/animated-previews.json';
if (fs.existsSync(animationManifest)) {
  const { items } = JSON.parse(fs.readFileSync(animationManifest));
  for (const [project, effects] of Object.entries(catalogues))
    for (const effect of effects) {
      const preview = items[`${project}/${effect.id}`];
      if (preview && fs.existsSync(root + '/public' + preview.image)) {
        effect.image = preview.image;
        effect.imageStatic = preview.still;
      }
    }
}

fs.writeFileSync('src/catalogues.json', JSON.stringify(catalogues, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(catalogues).map(([k, v]) => [k, v.length])));
