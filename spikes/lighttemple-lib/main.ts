// M3 story 3.7: run a Light Temple experiment on a caller-owned canvas with no gallery or panel.
import { mountExperiment } from '../../lighttemple/src/lib/index.ts';
import factory from '../../lighttemple/src/experiments/pointer-light-2d/index.ts';

declare global {
  interface Window {
    __lib?: unknown;
  }
}

const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));

try {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const handle = await mountExperiment(canvas, factory, { reducedMotion: false });
  window.__lib = {
    ok: true,
    groups: handle.params.groups.map((group) => group.title ?? '(untitled)'),
    errors,
  };
} catch (error) {
  window.__lib = { ok: false, error: String((error as Error)?.stack ?? error), errors };
}
