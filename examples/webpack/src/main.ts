import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

const hero = document.querySelector<HTMLElement>('#hero');
if (!hero) throw new Error('Missing #hero');

const field = await attach(hero, gradient, { preset: 'dusk' });

(window as unknown as { field?: unknown }).field = field;
