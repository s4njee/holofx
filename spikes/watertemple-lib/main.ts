// M3 story 3.3: mount a Water Temple effect through the library entry, on a canvas the caller
// owns, with no gallery shell, registry or CSS.
import { createGpuSession } from '../../watertemple/src/gpu/device.ts';
import { setShaderLibrary } from '../../watertemple/src/gpu/shader.ts';
import { getChunk } from '../../watertemple/src/wgsl/index.ts';
import { mount } from '../../watertemple/src/lib/index.ts';
import { effect as calmLake } from '../../watertemple/src/effects/calm-lake/index.ts';

setShaderLibrary(getChunk);

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
  const session = await createGpuSession();
  const host = mount(session, canvas, calmLake);
  window.__lib = { ok: true, started: true, errors };
  host.onLoad((loaded) => {
    window.__lib = { ok: true, loaded: loaded.effect.meta.id, errors };
  });
} catch (error) {
  window.__lib = { ok: false, error: String((error as Error)?.stack ?? error), errors };
}
