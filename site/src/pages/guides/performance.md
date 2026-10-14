---
layout: ../../layouts/Doc.astro
title: Performance — HoloGPU
description: Tiers, resolution scale, DPR caps, adaptive quality, pausing off-screen, and how many effects a page can hold.
---

# Performance

Every effect carries a **planning estimate**, not a measurement: a `tier` and, when one is authored,
a frame `budget` in milliseconds at a reference size. The estimate tells you what to expect before
you measure on your own hardware and audience.

## The tiers

| Tier | What it usually is | Example |
| --- | --- | --- |
| **T1** | one fragment pass, no state | `gradient-oklch`, `aurora-veil`, `grain-overlay` |
| **T2** | a feedback buffer (last frame read back) | `reaction-diffusion`, `life`, `wave` |
| **T3** | compute over particles or a grid | `emitters`, `n-body`, `flow-particles` |
| **T4** | several filter passes, often pyramids | `bloom`, `blur`, `edges` |
| **T5** | geometry, scenes, heavy buffers | `terrain`, `path-tracer`, `splats` |

Measured on an Apple M1 Max in Chrome, a single **T1** effect costs on the order of 0.15–0.3 ms of
CPU and under 0.5 ms of GPU per frame at 512², DPR 1. Higher tiers multiply that; a page can hold
many T1 effects and only one or two T5 ones. The per-effect pages show the measured numbers where a
temple recorded them (bundle size, GPU ms, flash).

## Resolution scale

Rendering below the display resolution is the cheapest lever, and for a soft background it is
invisible: the bilinear upscale does the blur for you. Each effect declares a
`quality.resolutionScale` range (commonly `0.25`–`1`), and a `defaultResolutionScale` inside it. Pass
`resolutionScale` to the attachment to override it within the range.

```ts
await attach(hero, aurora, { resolutionScale: 0.5 });
```

## DPR caps

Fill rate is the dominant cost of a full-screen effect, and 3× phone screens rarely look better for
it. `attach` takes a `maxDpr` cap (default 2), and the render surface clamps the device pixel ratio
to it. The DOM effect pages in this site render at a cap of 1.5 and 85% resolution.

## Adaptive quality

Where a target frame time matters, run the effect with adaptive quality: a governor watches the work
per frame and steps `resolutionScale` in 0.25 increments within the effect's range, down when frames
run over budget and up when they are comfortably under. It is off by default — turn it on when you
would rather lose sharpness than drop frames.

## Pausing when nobody is looking

Every attachment **sleeps when its host scrolls off-screen and when the tab is hidden**, and wakes on
return. This is on by default and keeps a gallery of effects from burning a battery in a background
tab. Effects that can settle optionally expose `renderRate` to schedule frames at a fraction of the
display rate (`grain-overlay`, for example, updates at film cadence).

## How many effects per page

There is no fixed number, but the shape is: a handful of T1 backgrounds, one or two heavier effects
in view at a time, and the rest paused. This site's own gallery renders 12 cards at a time and only
mounts a preview while its card is visible — the same pattern a busy landing page should follow.

## Measuring

Do not trust the tier alone. Use the lab's HUD, which reads per-pass GPU timestamps where the device
provides them (`timestamp-query`), and watch CPU encode/submit separately from GPU time. A device
that lacks timestamp support reports CPU cost only.

## Further reading

- [Fallback and progressive enhancement](/guides/fallback/).
- [Browser support](/guides/browser-support/) for the feature gates that decide what can run.
