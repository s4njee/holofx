// M3 story 3.3: mount a Fire Temple effect through the library entry, on a canvas the caller
// owns, with no gallery shell, registry or CSS.
import { createGpuSession } from '../../firetemple/src/gpu/device.ts';
import { mount } from '../../firetemple/src/lib/index.ts';
import { effect as candle } from '../../firetemple/src/effects/candle/index.ts';

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
  const session = await createGpuSession({});
  const host = mount(session, canvas, candle, { initialParams: { speed: 1.4 } });
  window.__lib = { ok: true, started: true, errors };
  // Confirm the effect actually loaded (the mount is asynchronous inside the host).
  host.onLoad((loaded) => {
    window.__lib = { ok: true, loaded: loaded.effect.meta.id, errors };
  });
} catch (error) {
  window.__lib = { ok: false, error: String((error as Error)?.stack ?? error), errors };
}
