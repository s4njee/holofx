#!/usr/bin/env node
// Build each temple's library entry (story 4.4) so the site can mount its effects through the same
// public API a consumer would use. The output is git-ignored and regenerated.
//
//   node scripts/build-libs.mjs                 # every temple
//   node scripts/build-libs.mjs firetemple      # a subset
//
// Each project must have its dependencies installed first (`npm run bootstrap`).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${path.relative(root, cwd)} (status ${result.status})`);
  }
}

const projects = ['firetemple', 'watertemple', 'lighttemple', 'eightfoldpath'];
const requested = process.argv.slice(2);
const names = requested.length ? requested : projects;
for (const name of names) {
  if (!projects.includes(name)) throw new Error(`Unknown project "${name}". Expected one of: ${projects.join(', ')}`);
}
for (const name of names) {
  console.log(`\n=== building library: ${name} ===`);
  run('npm', ['run', 'build:lib'], path.join(root, name));
  console.log(`=== built library: ${name} -> ${name}/lib ===`);
}
