---
layout: ../../layouts/Doc.astro
title: Write your own effect — HoloGPU
description: From fragmentEffect upward, and the temple effect contract, with the metadata every effect needs.
---

# Write your own effect

There are two ways in: a **fragment effect** for something that fits in one pass, and the **temple
contract** for effects that own their passes, buffers and lifetime.

## A fragment effect

`fragmentEffect` takes a body that implements `fn effect(uv: vec2f) -> vec4f` and wraps it in the
runtime's fullscreen pass, parameter uniform and WGSL chunks:

```ts
import { fragmentEffect } from '@mk7s/hologpu-core';

export default fragmentEffect({
  id: 'plasma',
  title: 'Plasma',
  family: 'procedural',
  tags: ['noise', 'background'],
  params: {
    scale: { type: 'f32', default: 3, min: 0.5, max: 8 },
    tint: { type: 'color', default: '#7aa2ff' },
  },
  presets: { cool: { scale: 2, tint: '#4bd0ff' } },
  fallback: 'linear-gradient(135deg, #263448, #7aa2ff)',
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let n = fbm(uv * params.scale + vec2f(frame.time * 0.05));
  return vec4f(mix(vec3f(0.1), params.tint, n), 1.0);
}`,
  chunks: [noise],
});
```

The parameter types are `f32`/`i32`/`u32`, `bool`, `color`, `enum` and the vector forms; presets are
plain value maps; `quality.resolutionScale` and `reducedMotion.time` default sensibly. Import the
chunks you use (`noise`, `hash`, `colour`, `sdf`, `fbm`, `camera`, …) rather than copying shader text.

## The temple contract

Fire, Water, Eightfold and Light temples use `defineEffect({ meta, params, presets, create })`. An
effect is a directory:

```
src/effects/<id>/
  meta.ts      export const meta: EffectMeta     (kept tiny, no imports but types)
  index.ts     export const effect = defineEffect({ meta, params, presets, create })
  *.wgsl       the effect's own shaders
  notes.md     the write-up
```

`create(ctx)` receives `{ device, format, canvas, params, profiler }` and returns
`{ resize(width, height, dpr), frame(time, encoder, target), destroy() }`:

- **`params` is live.** Read it every frame; never copy it at creation.
- **`frame` encodes into the encoder it is given** and must finish by drawing into `target` (a view
  of the canvas texture, in `format`). The shell submits — do not submit yourself.
- **`resize`** is called before the first frame and whenever the drawing buffer changes; create
  size-dependent targets there.
- **`destroy`** releases every GPU object and listener the effect made.
- Give each pass `timestampWrites: profiler.pass('label')` so the HUD can time it.
- Colours in `params` are linear RGB; sRGB-encode output because the canvas is not an `-srgb`
  format. The canvas uses premultiplied alpha: an overlay writes `vec4f(rgb * a, a)`.
- Advance your own phase from `time.delta` so a `speed` parameter does not jump the picture, and
  step simulations with a fixed stepper.
- There is no DOM in the tests: guard `window`/`document`/`matchMedia` and take input only through
  the canvas you are given.

## The metadata every effect needs

`meta` (temple) and the top-level fields (HoloGPU) carry the same story:

- `id`, `title`, `family`, `tags` — how it is found.
- `tier` — the planning estimate (see [Performance](/guides/performance/)).
- `scorecard` (temples) — `compute`, `mobile`, `flash`, `lightPage`, `bundleKb`, `features`,
  `fallback` and `useCases`. Fill a field only when you know the answer.
- a `fallback` — the CSS shown where WebGPU is unavailable, and a poster if you have one.

## Testing

Temples test headlessly on Dawn (a software Vulkan driver) so shaders and simulation invariants are
checked without a GPU, and the browser checks run the real thing. On this site, an effect appears at
`/effects/<project>/<id>` as soon as its catalogue entry exists, mounting through the project's
library entry.

## Further reading

- [Performance](/guides/performance/) — tiers, resolution scale and adaptive quality.
- [Accessibility](/guides/accessibility/) — reduced motion and flash, before you ship.
