---
layout: ../../layouts/Doc.astro
title: Fallback and progressive enhancement — HoloGPU
description: What the page shows without WebGPU, on insecure origins, and where the effect cannot run.
---

# Fallback and progressive enhancement

An effect is an enhancement. The page should be finished, readable and usable before any shader
runs, and the same page should stay that way wherever WebGPU is not available.

## What happens without WebGPU

`createEffect` throws `WebGPUUnavailableError`. The higher-level entry points catch it and degrade to
the effect's fallback:

- **`attach(host, effect)`** keeps your markup visible and shows a poster or the effect's declared
  CSS `fallback`.
- **`<hgpu-field effect="…">`** does the same and dispatches `hgpu-ready` when the field runs, or
  `hgpu-fallback` when it cannot.
- **`<HoloField>`** (React) is a thin wrapper over `attach`, so it degrades identically.

`attachment.field` is nullable when GPU setup fails; the attachment and the authored content remain
usable. The poster, when an effect has one, takes precedence over the CSS fallback.

The rule of thumb: keep real HTML inside the host — a heading, a paragraph, a link — and let the
canvas sit behind it. A reader on a fallback path sees the page, not an empty rectangle.

## Insecure origins

WebGPU requires a secure context: HTTPS, or `localhost`. A page served over plain HTTP on a LAN
address — say you open `http://192.168.1.20/` on a phone to test — is not a secure context, so
`navigator.gpu` is simply absent and the fallback path runs. That is expected, not a bug. Use HTTPS
or a tunnel while developing for other devices, and leave the fallback in place either way.

## When `navigator.gpu` exists but the effect still cannot run

An adapter is not guaranteed. `requestAdapter()` can return `null` when the GPU is blocklisted, when
hardware acceleration is off, or when no suitable GPU is found. A software adapter may be reported as
a fallback (`adapter.info.isFallbackAdapter`). An effect that asks for an optional feature it did not
receive — a texture format, timestamps — should be treated as unavailable rather than forced.

The site's own effect pages follow this: if the mount throws, they keep the poster and print
"Showing the fallback preview", so the effect page never becomes a broken canvas.

## Detecting and reacting

```ts
import { attach } from '@mk7s/hologpu/dom';
import aurora from '@mk7s/hologpu/effects/aurora-veil';

const field = await attach(hero, aurora);
if (!field.field) {
  // No GPU: the poster or CSS fallback is already showing. Add anything else you want here.
}
```

With the custom element, listen for the events instead:

```js
document.querySelector('hgpu-field').addEventListener('hgpu-fallback', (event) => {
  console.info('Showing the fallback:', event.detail?.reason);
});
```

## Listening for reduced motion too

Reduced motion is a preference, not a failure, but it belongs in the same code path: an effect with a
reduced-motion pose holds a still frame, and the site pauses it. See the
[accessibility guide](/guides/accessibility/).

## Further reading

- [Browser support](/guides/browser-support/) for the version matrix and the per-effect feature gates.
- [Performance](/guides/performance/) for keeping the enhancement cheap on the devices that do run it.
