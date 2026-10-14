#!/usr/bin/env node
// Build each project's gallery into site/public/labs/<project>/ with the base path the
// site expects. The output is git-ignored and regenerated; see the root README.
//
//   node scripts/build-labs.mjs                 # every project
//   node scripts/build-labs.mjs firetemple      # a subset
//
// Each project must have its dependencies installed first (`npm run bootstrap`).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const site = path.join(root, 'site');

// The deploy sub-path: GitHub Pages serves this repo at /holofx/. The labs are built with the same
// base so their root-absolute asset URLs resolve under it.
const siteBase = (process.env.SITE_BASE ?? '/').replace(/\/$/, '');
const labBase = (project) => `${siteBase}/labs/${project}/`;
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${path.relative(root, cwd)} (status ${result.status})`);
  }
}

const projects = {
  hologpu: () => {
    const out = path.join(site, 'public/labs/hologpu');
    run(
      'pnpm',
      ['--filter', '@mk7s/hologpu-playground', 'exec', 'vite', 'build', '--base', labBase('hologpu'), '--outDir', out, '--emptyOutDir'],
      path.join(root, 'hologpu'),
    );
  },
  firetemple: () => {
    const out = path.join(site, 'public/labs/firetemple');
    run('npm', ['exec', '--', 'vite', 'build', '--outDir', out, '--emptyOutDir'], path.join(root, 'firetemple'), {
      BASE_PATH: labBase('firetemple'),
    });
  },
  watertemple: () => {
    const out = path.join(site, 'public/labs/watertemple');
    run('npm', ['exec', '--', 'vite', 'build', '--outDir', out, '--emptyOutDir'], path.join(root, 'watertemple'), {
      BASE_PATH: labBase('watertemple'),
    });
  },
  eightfoldpath: () => {
    const out = path.join(site, 'public/labs/eightfoldpath');
    run('npm', ['exec', '--', 'vite', 'build', '--outDir', out, '--emptyOutDir'], path.join(root, 'eightfoldpath'), {
      BASE_PATH: labBase('eightfoldpath'),
    });
  },
  lighttemple: () => {
    const out = path.join(site, 'public/labs/lighttemple');
    // Light Temple's config uses a relative base, which resolves correctly under any sub-path.
    run('npm', ['exec', '--', 'vite', 'build', '--outDir', out, '--emptyOutDir'], path.join(root, 'lighttemple'));
  },
};

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(projects);
for (const name of names) {
  if (!projects[name]) throw new Error(`Unknown project "${name}". Expected one of: ${Object.keys(projects).join(', ')}`);
}
mkdirSync(path.join(site, 'public/labs'), { recursive: true });
for (const name of names) {
  console.log(`\n=== building lab: ${name} ===`);
  projects[name]();
  console.log(`=== built lab: ${name} -> site/public/labs/${name} ===`);
}
