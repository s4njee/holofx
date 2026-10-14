#!/usr/bin/env node
// Generate the API reference with TypeDoc and stage it for the site (M5 story 5.17).
//
//   node scripts/build-api.mjs
//
// Runs hologpu's `docs:api` script and copies the HTML into site/public/api, so the guide page can
// link to /api/. Both hologpu's dependencies and typedoc must be installed (`npm run bootstrap`).
import { cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hologpu = path.join(root, 'hologpu');
const output = path.join(root, 'site/public/api');

console.log('=== building API reference (typedoc) ===');
const result = spawnSync('pnpm', ['run', 'docs:api'], { cwd: hologpu, stdio: 'inherit' });
if (result.status !== 0) {
  throw new Error(`typedoc failed (status ${result.status})`);
}
rmSync(output, { recursive: true, force: true });
cpSync(path.join(hologpu, 'docs/api'), output, { recursive: true });
console.log('=== API reference -> site/public/api ===');
