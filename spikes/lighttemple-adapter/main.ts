import { createEffect } from '@mk7s/hologpu-core';
import factory from '../../lighttemple/src/experiments/pointer-light-2d/index.ts';
import { lightEffect } from './adapter.ts';

declare global {
  interface Window {
    __spike: unknown;
  }
}

const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));

try {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const definition = lightEffect(factory, {
    id: 'pointer-light-2d',
    title: 'Pointer light (hosted)',
    canvas,
    params: {
      intensity: {
        type: 'f32',
        default: 1.6,
        min: 0,
        max: 6,
        step: 0.01,
        description: 'Light intensity',
      },
      color: { type: 'color', default: '#ffd2a1', description: 'Light colour' },
      animate: { type: 'bool', default: true, description: 'Animate the fill light' },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const field: any = await createEffect(canvas, definition, { seed: 3 });
  field.play?.();
  if (field.params && 'intensity' in field.params) field.params.intensity = 2.4;

  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Note: drawImage/toDataURL on a WebGPU canvas is unreliable here; run.mjs saves the screenshot.
  window.__spike = {
    ok: true,
    id: definition.id,
    size: [canvas.width, canvas.height],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    calls: (window as any).__calls,
    errors,
  };
} catch (error) {
  window.__spike = { ok: false, error: String((error as Error)?.stack ?? error), errors };
}
