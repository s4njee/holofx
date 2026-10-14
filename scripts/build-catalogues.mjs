#!/usr/bin/env node
// Emit catalogue.json from each project (M3 stories 3.9/3.10), before the site reads them.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

for (const project of ['hologpu', 'firetemple', 'watertemple', 'lighttemple', 'eightfoldpath']) {
  const cwd = path.join(root, project);
  console.log(`\n=== catalogue: ${project} ===`);
  const result = spawnSync('node', ['scripts/catalogue.mjs'], { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${project} catalogue failed (status ${result.status})`);
}
