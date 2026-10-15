#!/usr/bin/env node
// Regenerate the holofx site from every project's experiments, in one command:
//
//   npm run site:update                       # libraries, labs, catalogues and site; capture an animated
//                                             # preview for every experiment that has none; rebuild
//   npm run site:update -- --base /holofx/    # the same under a sub-path (GitHub Pages, mk7s.dev/holofx)
//   npm run site:update -- --base /holofx/ --publish   # ...then stage it into ../../mk7s (--deploy also deploys)
//   npm run previews                          # capture only, against the existing site/dist
//
// Options:
//   --base <path>        deploy sub-path (default /, or SITE_BASE)
//   --skip-libs          reuse the built libraries (build:libs)
//   --skip-labs          reuse the built labs in site/public/labs
//   --skip-capture       don't capture missing previews
//   --capture-only       only capture (and verify) against the existing site/dist
//   --only <list>        limit capturing to these projects or project/id keys (comma separated)
//   --recapture <list>   capture these projects or project/id keys again, even if they have a preview
//   --publish, --deploy  stage the build into mk7s (needs --base /holofx/); --deploy also deploys it
//
// For capturing, site/dist is served under the base by a small static server in this script (Astro 7's
// `astro preview` is a per-project singleton, so it may already be serving some other build), on
// port 5188 or on a free port if that is taken.
// Every project's dependencies must be installed first (`npm run bootstrap`). Capturing needs
// ffmpeg, avifenc and avifdec on PATH and a GPU: it runs the real labs in headless Chromium with
// hardware WebGPU (see site/README.md).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const site = path.join(root, 'site');

const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    'skip-libs': { type: 'boolean', default: false },
    'skip-labs': { type: 'boolean', default: false },
    'skip-capture': { type: 'boolean', default: false },
    'capture-only': { type: 'boolean', default: false },
    only: { type: 'string' },
    recapture: { type: 'string' },
    publish: { type: 'boolean', default: false },
    deploy: { type: 'boolean', default: false },
  },
});
const base = `/${(args.base ?? process.env.SITE_BASE ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
const env = { ...process.env, SITE_BASE: base };
const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if ((args.publish || args.deploy) && base !== '/holofx/') throw new Error('--publish needs --base /holofx/ (mk7s serves it there)');

function step(title) {
  console.log(`\n=== ${title} ===`);
}
function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', env });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed (status ${result.status})`);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const cataloguePath = path.join(site, 'src/catalogues.json');
const manifestPath = path.join(site, 'src/animated-previews.json');

/**
 * Per project: how many experiments, how many have an animated preview, how many keep their poster
 * by choice (the manifest's `posterPreferred`), and the keys still missing a preview.
 */
function coverage() {
  const catalogue = readJson(cataloguePath);
  const { items = {}, posterPreferred = {} } = fs.existsSync(manifestPath) ? readJson(manifestPath) : {};
  const has = (key) => items[key] && fs.existsSync(path.join(site, 'public', items[key].image));
  return Object.entries(catalogue).map(([project, effects]) => {
    const keys = effects.map((e) => `${project}/${e.id}`);
    const poster = keys.filter((k) => posterPreferred[k]);
    return {
      project,
      total: keys.length,
      animated: keys.filter((k) => !posterPreferred[k] && has(k)).length,
      poster: poster.length,
      missing: keys.filter((k) => !posterPreferred[k] && !has(k)),
    };
  });
}

/** 5188 (the site's usual preview port) if it is free, else any free port. */
function freePort(preferred = 5188) {
  const listen = (port) =>
    new Promise((resolve) => {
      const probe = net.createServer().once('error', () => resolve(null));
      probe.listen(port, '127.0.0.1', () => {
        const { port: bound } = probe.address();
        probe.close(() => resolve(bound));
      });
    });
  return listen(preferred).then((port) => port ?? listen(0));
}

async function serving(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** Serve site/dist under the base, the way a static host would, for as long as `fn` runs. */
async function withPreview(fn) {
  const dist = path.join(site, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('site/dist has no build; run without --capture-only');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    let file = path.join(dist, pathname.slice(base.length));
    if (!file.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(308, { location: `${pathname}/${url.search}` }).end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${port}`;
  try {
    if (!(await serving(`${origin}${base}`))) throw new Error(`could not serve site/dist at ${origin}${base}`);
    console.log(`serving site/dist at ${origin}${base}`);
    return await fn(origin);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function buildSite() {
  // Each project's catalogue.json, then the site's snapshot of them (which also applies the
  // captured previews), then the Astro build.
  step('catalogues');
  run('node', ['scripts/build-catalogues.mjs']);
  run('npm', ['--prefix', 'site', 'run', 'catalogue']);
  step(`site (base ${base})`);
  run('npm', ['--prefix', 'site', 'run', 'build']);
}

let failed = false;
if (!args['capture-only']) {
  if (!args['skip-libs']) {
    step('libraries');
    run('npm', ['run', 'build:libs']);
  }
  if (!args['skip-labs']) {
    step(`labs (base ${base})`);
    run('node', ['scripts/build-labs.mjs']);
  }
  buildSite();
}

if (!args['skip-capture']) {
  const only = list(args.only);
  const recapture = list(args.recapture);
  const matches = (key, filters) => filters.some((f) => key === f || key.startsWith(`${f}/`));
  const missing = coverage()
    .flatMap((row) => row.missing)
    .filter((key) => !only.length || matches(key, only));
  step(`animated previews: ${missing.length} missing${recapture.length ? `, recapturing ${recapture.join(', ')}` : ''}`);
  const jobs = [
    missing.length ? { keys: missing, extra: [] } : null,
    recapture.length ? { keys: recapture, extra: ['--recapture'] } : null,
  ].filter(Boolean);
  if (jobs.length) {
    await withPreview(async (origin) => {
      for (const job of jobs) {
        // Asynchronously: this process is also the web server the capture loads pages from.
        const status = await new Promise((resolve) => {
          const capture = spawn('node', ['scripts/capture-animated-previews.cjs', ...job.keys, ...job.extra], {
            cwd: site,
            stdio: 'inherit',
            env: { ...env, CAPTURE_ORIGIN: origin, CAPTURE_BASE: base, CAPTURE_DISCARD_FRAMES: '1' },
          });
          capture.on('exit', (code) => resolve(code ?? 1));
        });
        // A failed capture keeps the card's poster (or text); report it and carry on.
        if (status !== 0) failed = true;
      }
    });
    // Pick the new previews up: refresh the snapshot and rebuild the site (the labs are unchanged).
    step('site with the new previews');
    run('npm', ['--prefix', 'site', 'run', 'catalogue']);
    run('npm', ['--prefix', 'site', 'run', 'build']);
  }
  step('verify animated previews');
  const verify = spawnSync('node', ['scripts/verify-animated-previews.cjs', '--partial'], { cwd: site, stdio: 'inherit', env });
  if (verify.status !== 0) console.log('(verification reported warnings or failures; see above)');
}

if (args.publish || args.deploy) {
  step('publish to mk7s');
  run('node', ['scripts/publish-site-mk7s.mjs', '--skip-build', ...(args.deploy ? ['--deploy'] : [])]);
}

step('summary');
const rows = coverage();
for (const row of rows) {
  const poster = row.poster ? `, ${row.poster} on their poster by choice` : '';
  console.log(`${row.project.padEnd(14)} ${String(row.total).padStart(3)} experiments, ${String(row.animated).padStart(3)} animated${poster}`);
  if (row.missing.length) console.log(`  without an animated preview: ${row.missing.map((k) => k.split('/')[1]).join(', ')}`);
}
console.log(`site/dist built under ${base}`);
if (failed) {
  console.error('Some captures failed; their cards keep their poster or text. Rerun with --only <keys> to retry.');
  process.exit(1);
}
