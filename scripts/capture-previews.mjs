#!/usr/bin/env node
// Capture animated card previews from the built site (M5 story 5.10), from the superproject:
//
//   npm run previews                 # every effect that needs a capture
//   npm run previews firetemple/candle --recapture
//
// It builds nothing itself: run `npm run build` first so `site/dist` (and its labs) exist. It
// starts the site's own preview, runs the capture, and stops the preview again — no absolute paths
// and no tools to point at, beyond ffmpeg/avifenc (see site/README.md).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const site = path.join(root, 'site');
const run = (command, args, options = {}) =>
  spawnSync(command, args, { cwd: site, stdio: 'inherit', ...options });

const up = async () => {
  try {
    await fetch('http://127.0.0.1:5188/', { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
};

let started = false;
if (!(await up())) {
  console.log('previews: starting the site preview…');
  run('npx', ['astro', 'preview']);
  started = true;
  for (let attempt = 0; attempt < 40 && !(await up()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!(await up())) throw new Error('the site preview did not come up on port 5188');
}

let status = 0;
try {
  const capture = run('node', ['scripts/capture-animated-previews.cjs', ...process.argv.slice(2)]);
  status = capture.status ?? 1;
} finally {
  if (started) run('npx', ['astro', 'preview', 'stop']);
}
process.exit(status);
