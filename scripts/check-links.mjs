#!/usr/bin/env node
// Check that every local href/src in the built site resolves to a file (or a directory
// index) under site/dist. External URLs, anchors and data: URIs are ignored.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'site/dist');

if (!existsSync(dist)) {
  console.error(`No build at ${path.relative(root, dist)}. Run "npm run build:site" first.`);
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Each lab is a project's own build with its own base assumptions; check the site's pages.
    if (entry.isDirectory() && entry.name === 'labs') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

const attribute = /(?:href|src)\s*=\s*"([^"]+)"/g;
const problems = [];
let checked = 0;

for (const file of walk(dist)) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(attribute)) {
    let target = match[1];
    if (target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [pathPart] = target.split(/[?#]/);
    if (!pathPart) continue;
    const resolved = pathPart.startsWith('/')
      ? path.join(dist, pathPart)
      : path.resolve(path.dirname(file), pathPart);
    checked += 1;
    const candidate = pathPart.endsWith('/') ? path.join(resolved, 'index.html') : resolved;
    if (!existsSync(candidate) && !(existsSync(resolved) && statSync(resolved).isDirectory() && existsSync(path.join(resolved, 'index.html')))) {
      problems.push(`${path.relative(dist, file)} -> ${target}`);
    }
  }
}

if (problems.length) {
  console.error(`Broken local links (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Link check passed: ${checked} local references across the built site.`);
