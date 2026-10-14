// Astro config (M5 story 5.1): the site grew from one hand-written page to a page per effect plus
// guides, so it is generated now. The HoloGPU runtime is aliased to the submodule source.
//
// `SITE_BASE` sets the deploy sub-path (GitHub Pages serves this repo at /holofx/). The site's own
// markup uses root-absolute paths, so a build hook prefixes them; the labs are built with the same
// base and are skipped here (their asset URLs already include it).
import { defineConfig } from 'astro/config';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rawBase = process.env.SITE_BASE ?? '/';
const siteBase = rawBase.replace(/\/$/, ''); // '' or '/holofx'
const prefix = siteBase ? `${siteBase}/` : '';

function collectHtml(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** Prefix root-absolute href/src in the generated HTML, leaving the labs (which set their own). */
function prefixAbsoluteUrls() {
  return {
    name: 'holofx:prefix-absolute-urls',
    hooks: {
      'astro:build:done': ({ dir }) => {
        if (!prefix) return;
        const out = fileURLToPath(dir);
        const labs = path.join(out, 'labs') + path.sep;
        const base = siteBase.slice(1); // "holofx"
        const pattern = new RegExp(`(href|src)="/(?!/|${base}/)`, 'g');
        for (const file of collectHtml(out)) {
          if (file.startsWith(labs)) continue;
          const html = readFileSync(file, 'utf8');
          const next = html.replace(pattern, `$1="${prefix}`);
          if (next !== html) writeFileSync(file, next);
        }
      },
    },
  };
}

export default defineConfig({
  site: 'https://s4njee.github.io',
  base: siteBase || undefined,
  integrations: [prefixAbsoluteUrls()],
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  vite: {
    build: { target: 'es2022' },
    resolve: {
      alias: [
        {
          find: '@mk7s/hologpu-core',
          replacement: fileURLToPath(
            new URL('../hologpu/packages/core/src/index.ts', import.meta.url),
          ),
        },
      ],
    },
  },
});
