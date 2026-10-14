import { createEffect } from '@mk7s/hologpu-core';
import { effect as candle } from '../../firetemple/src/effects/candle/index.ts';
import { templeEffect } from './adapter.ts';

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
  const definition = templeEffect(candle, canvas);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const field: any = await createEffect(canvas, definition, { preset: 'tea light', seed: 7 });
  field.play?.();
  field.params.speed = 1.4;

  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Note: drawImage/toDataURL on a WebGPU canvas is unreliable here, so this only records that
  // the drives happened without errors. The visual evidence is the screenshot run.mjs saves.
  window.__spike = {
    ok: true,
    id: definition.id,
    size: [canvas.width, canvas.height],
    calls: (window as unknown as { __calls?: unknown }).__calls,
    errors,
  };
} catch (error) {
  window.__spike = { ok: false, error: String((error as Error)?.stack ?? error), errors };
}
