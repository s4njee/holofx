#!/usr/bin/env node
// M4 story 4.7: install the packed @mk7s/hologpu packages into fresh consumer projects and build
// each one, so the published shape is tested the way users meet it — imports, exports maps, types
// and bundler resolution all have to work from a tarball, not from the workspace.
//
//   node scripts/test-install.mjs                 # every framework example
//   node scripts/test-install.mjs vanilla react   # a subset
//   node scripts/test-install.mjs --no-build      # reuse the existing hologpu dist
//
// Each example is copied to a scratch directory, its @mk7s dependencies are pointed at the freshly
// packed tarballs, and `npm install && npm run build` runs there. The committed examples keep
// normal `0.1.0` dependencies so they read as real consumer projects.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hologpu = path.join(root, 'hologpu');
const examplesDir = path.join(root, 'examples');
const PACKAGES = ['core', 'dom', 'effects', 'hologpu', 'react'];
// The CDN example loads from a registry URL and is handled separately (see the bottom).
const SKIP = new Set(['cdn']);

const argv = process.argv.slice(2);
const reuseBuild = argv.includes('--no-build');
const wanted = argv.filter((value) => !value.startsWith('-'));
const examples = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !SKIP.has(entry.name))
  .map((entry) => entry.name)
  .filter((name) => (wanted.length ? wanted.includes(name) : true))
  .sort();

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(' ')}  (${path.relative(root, cwd) || '.'})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`\`${command} ${args.join(' ')}\` failed (status ${result.status})`);
}

function packageMeta(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

// 1. Build and pack the library.
if (!reuseBuild) run('pnpm', ['build'], hologpu);
const packsDir = path.join(os.tmpdir(), 'holofx-install-packs');
rmSync(packsDir, { recursive: true, force: true });
mkdirSync(packsDir, { recursive: true });

const tarballs = {};
for (const name of PACKAGES) {
  const dir = path.join(hologpu, 'packages', name);
  const pkg = packageMeta(dir);
  run('pnpm', ['pack', '--pack-destination', packsDir], dir);
  tarballs[pkg.name] = path.join(packsDir, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
  if (!existsSync(tarballs[pkg.name])) throw new Error(`Missing tarball for ${pkg.name}`);
}
console.log(`\npacked ${Object.keys(tarballs).length} packages into ${packsDir}`);

// 2. Install each example from the tarballs and build it.
for (const name of examples) {
  const source = path.join(examplesDir, name);
  const work = path.join(os.tmpdir(), `holofx-install-${name}`);
  rmSync(work, { recursive: true, force: true });
  cpSync(source, work, {
    recursive: true,
    filter: (from) => !from.includes('node_modules') && !from.endsWith(`${path.sep}dist`),
  });

  const pkgPath = path.join(work, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies ??= {};
  // Point every @mk7s dependency (direct and transitive) at the packed tarball. Listing all five
  // as direct dependencies lets npm satisfy the internal `0.1.0` ranges without the registry.
  for (const [dep, tarball] of Object.entries(tarballs)) pkg.dependencies[dep] = `file:${tarball}`;
  delete pkg.overrides;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  console.log(`\n=== ${name} ===`);
  run('npm', ['install', '--no-audit', '--no-fund'], work);
  run('npm', ['run', 'build'], work);
}

console.log(`\ninstall tests passed for ${examples.length} examples: ${examples.join(', ')}`);

// 3. The CDN example loads the published packages from a registry, so it can only run once they
//    are on npm. When they are, serve the page and confirm the effect mounts in a real browser.
const wantsCdn = wanted.length === 0 || wanted.includes('cdn');
if (wantsCdn) {
  console.log('\n=== cdn ===');
  const published = spawnSync('npm', ['view', '@mk7s/hologpu', 'version'], { stdio: 'pipe' });
  if (published.status !== 0) {
    console.log(
      'skipped: @mk7s/hologpu is not published yet, so the CDN import map has nothing to load.',
    );
  } else {
    await testCdn();
  }
}

async function testCdn() {
  const { createServer } = await import('node:http');
  const { createRequire } = await import('node:module');
  const dir = path.dirname(path.join(examplesDir, 'cdn', 'x'));
  const server = createServer((request, response) => {
    const file = request.url === '/' || !request.url ? 'index.html' : request.url.replace(/^\//, '');
    try {
      const body = readFileSync(path.join(dir, file));
      response.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/plain' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const requireFromSite = createRequire(path.join(root, 'site', 'noop.cjs'));
  const { chromium } = requireFromSite('@playwright/test');
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--mute-audio'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.field, null, { timeout: 30000 });
    console.log('cdn: the effect mounted from the registry build.');
    if (errors.length) console.log(`cdn: page errors (informational): ${errors.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }
}
