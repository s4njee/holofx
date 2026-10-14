import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

const hero = document.querySelector<HTMLElement>('#hero');
if (!hero) throw new Error('Missing #hero');

// `attach` degrades to the effect's poster or CSS fallback when WebGPU is unavailable.
const field = await attach(hero, gradient, { preset: 'lagoon' });

// Kept on the window so a headless check can confirm the mount happened.
(window as unknown as { field?: unknown }).field = field;
