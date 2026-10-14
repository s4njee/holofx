#!/usr/bin/env node
// One command from a fresh clone to installed dependencies: initialise the submodules,
// then install each project and the site with its own package manager. See CONTRIBUTING.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(' ')}  (${path.relative(root, cwd) || '.'})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (status ${result.status})`);
}

run('git', ['submodule', 'update', '--init', '--recursive'], root);

// Each project keeps its own lockfile and package manager.
run('pnpm', ['install'], path.join(root, 'hologpu'));
for (const project of ['firetemple', 'watertemple', 'lighttemple']) {
  run('npm', ['ci'], path.join(root, project));
}
run('npm', ['ci'], path.join(root, 'site'));

console.log('\nBootstrap complete. Next: npm run build, or npm run dev for the site.');
