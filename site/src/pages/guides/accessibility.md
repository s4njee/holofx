---
layout: ../../layouts/Doc.astro
title: Accessibility — HoloGPU
description: Reduced motion, flash ratings, pause controls, and keeping type readable over animated backgrounds.
---

# Accessibility

An animated background is decoration. The page's meaning lives in its HTML, and the effects are built
so that meaning survives every preference and every fallback.

## Reduced motion

Effects ship a **reduced-motion pose**: a still frame drawn at a fixed time. When
`prefers-reduced-motion: reduce` is set, the runtime plays that pose instead of animating, so the
effect is present but static.

- `attach` and `<hgpu-field>` read the preference themselves; `attach` also takes `reducedMotion`.
- The custom element honours it live: changing the preference re-poses the field.
- Effects that settle stop rendering once they are still, rather than spinning a frame loop.

## Flash

Bright, large-area changes can trigger photosensitive seizures. **WCAG 2.3.1** allows no more than
**three flashes per second over a large area**, and treats saturated red as the worst case. Each
temple effect records a **flash rating** on its scorecard:

| rating | meaning |
| --- | --- |
| `none` | no rapid large-area brightness change |
| `low` | flickers, but stays well under three flashes a second over a quarter of the view |
| `high` | can exceed the threshold; needs the flicker cap or a warning |
| `unmeasured` | nobody has looked yet |

Fire Temple runs a WCAG 2.3.1 analyser over every effect, and a preset that goes over the threshold
must be named in the scorecard (`flashPresets`) or the test fails. If you ship a `high` effect, cap
the flicker or warn — the effect pages here show the rating as a badge.

## Pausing

Nothing should animate that a visitor cannot stop. The site's hero has a **pause control**
(the ⏸ button in the corner), the labs have a full transport (pause, step, reset), and every
attachment **pauses when it scrolls off-screen or the tab is hidden**. `<hgpu-field>` dispatches
`hgpu-ready`/`hgpu-fallback` so a host can reflect the state.

## Type over effects

Effects declare how they read over a light page (`scorecard.lightPage`): `yes` as they are,
`underlay` only with a dark underlay or backplate behind the text, or `no` when they need a dark
region of their own. Fire Temple measures the **WCAG contrast ratio** of the body text's mean
luminance against the page in its compositing study.

The practical rule: keep headings and body copy on a surface you control — a solid band, a card, a
gradient scrim — over the busiest effects, and let motion live where there is no text.

## Keep the content real

- The canvas is `aria-hidden`; the effect is not announced.
- The custom element keeps your slotted light-DOM children as the accessible content.
- Interactive effects should expose role and state in HTML. Water Temple's liquid button, for
  example, exposes its fill through a `progressbar` role and stays keyboard-operable.
- Images used as decoration stay decorative; real links, headings and controls stay in the DOM.

## Further reading

- [Fallback and progressive enhancement](/guides/fallback/).
- The per-effect pages list each effect's flash rating and browser notes.
