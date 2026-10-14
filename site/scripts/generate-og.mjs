// Generate Open Graph images (M5 story 5.10) from each effect's still frame.
//
//   node scripts/generate-og.mjs            # every effect with a preview, plus a default
//   node scripts/generate-og.mjs firetemple # a subset
//
// Writes public/images/og/<project>/<id>.jpg at 1200×630 (git-ignored) using ffmpeg. It is
// incremental and best-effort: without ffmpeg it prints a note and leaves the pages pointing at
// their existing preview, so a build never fails over a social image.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogues = JSON.parse(fs.readFileSync(path.join(root, 'src/catalogues.json'), 'utf8'));
const outRoot = path.join(root, 'public/images/og');
const requested = process.argv.slice(2).filter((value) => !value.startsWith('-'));

const has = (command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
if (!has('ffmpeg')) {
  console.log('generate-og: ffmpeg not found; skipping (pages keep their existing preview).');
  process.exit(0);
}

/** Map a public URL like /images/animated/hologpu/x.jpg to a file in public/. */
function publicFile(url) {
  if (!url || !url.startsWith('/')) return null;
  const bare = url.replace(/^\/holofx\//, '/');
  const file = path.join(root, 'public', bare);
  return fs.existsSync(file) ? file : null;
}

let made = 0;
let skipped = 0;

function convert(source, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(source).mtimeMs) {
    skipped += 1;
    return true;
  }
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-vf',
      'scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630',
      '-q:v',
      '4',
      out,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.warn(`generate-og: could not convert ${path.relative(root, source)}`);
    return false;
  }
  made += 1;
  return true;
}

let defaultSource = null;
for (const [project, effects] of Object.entries(catalogues)) {
  if (requested.length && !requested.includes(project)) continue;
  for (const effect of effects) {
    const source = publicFile(effect.imageStatic || effect.image);
    if (!source) continue;
    if (!defaultSource) defaultSource = source;
    convert(source, path.join(outRoot, project, `${effect.id}.jpg`));
  }
}
if (!requested.length && defaultSource) {
  convert(defaultSource, path.join(outRoot, 'default.jpg'));
}

console.log(`generate-og: ${made} written, ${skipped} up to date.`);
