// Build-time helpers for effect pages (M5 story 5.7).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const siteRoot =
  [process.cwd(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')].find(
    (dir) => existsSync(path.join(dir, 'astro.config.mjs')),
  ) ?? process.cwd();
const workspace = path.resolve(siteRoot, '..');
const at = (...parts: string[]) => path.join(workspace, ...parts);

const NOTES: Record<string, (id: string) => string> = {
  hologpu: (id) => `hologpu/docs/notes/${id}.md`,
  firetemple: (id) => `firetemple/src/effects/${id}/notes.md`,
  watertemple: (id) => `watertemple/src/effects/${id}/notes.md`,
};

const SOURCE: Record<string, (id: string) => string> = {
  hologpu: (id) => `https://github.com/s4njee/hologpu/blob/main/packages/effects/src/${id}/index.ts`,
  firetemple: (id) => `https://github.com/s4njee/firetemple/blob/main/src/effects/${id}/index.ts`,
  watertemple: (id) =>
    `https://github.com/s4njee/watertemple/blob/main/src/effects/${id}/index.ts`,
  lighttemple: (id) =>
    `https://github.com/s4njee/lighttemple/blob/main/src/experiments/${id}/index.ts`,
};

/** The effect's research notes, rendered to HTML, or an empty string. */
export function notesHtml(project: string, id: string): string {
  const rel = NOTES[project]?.(id);
  if (!rel) return '';
  const file = at(rel);
  if (!existsSync(file)) return '';
  const markdown = readFileSync(file, 'utf8');
  // Drop a leading H1 so the page's own heading is the only title.
  return marked.parse(markdown.replace(/^#\s+.*\n/, ''), { async: false });
}

/** A link to the effect's source file on GitHub. */
export function sourceUrl(project: string, id: string): string {
  return SOURCE[project]?.(id) ?? '';
}

/** The npm package each project publishes, for the snippets. */
export const PACKAGES: Record<string, { package: string; api: string }> = {
  hologpu: { package: '@mk7s/hologpu', api: 'createEffect' },
  firetemple: { package: '@mk7s/firetemple', api: 'mount' },
  watertemple: { package: '@mk7s/watertemple', api: 'mount' },
  lighttemple: { package: '@mk7s/lighttemple', api: 'mountExperiment' },
};
