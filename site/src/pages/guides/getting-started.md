---
layout: ../../layouts/Doc.astro
title: Getting started — HoloGPU
description: Install HoloGPU and put your first effect on a page — a bundler, a custom element, or a CDN script tag.
---

# Getting started

HoloGPU is a WebGPU effect library: instantiate one runtime, mount any effect from the catalogue, and
get a poster or a CSS fallback where WebGPU is unavailable.

**Requires Node 22.12 or later** to install and build, and a WebGPU-capable browser at runtime
(Chrome/Edge 113+, Safari 26+, Firefox 141+ on Windows).

## Install

```sh
npm install @mk7s/hologpu
```

The effect declarations reference WebGPU types (`GPUDevice` and friends), so add `@webgpu/types` to
your app's `types` (or turn on `skipLibCheck`). Every example in the repository does.

## The five-line effect

```ts
import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

await attach(document.querySelector('.hero')!, gradient, { preset: 'lagoon' });
```

`attach` mounts the effect on an element you own, drives its render loop and disposes it when the
page goes away. Import one effect and your bundler only ships that effect.

## A custom element

```html
<script type="module">
  import '@mk7s/hologpu/element';
</script>
<hgpu-field effect="gradient-oklch" preset="lagoon"></hgpu-field>
```

The element registers itself and resolves effects lazily by id, so an ordinary HTML page gets live
effects with no build step. Style the host element, and keep your own content inside it as the
accessible fallback.

## From a CDN

No bundler at all — an import map points the packages at a CDN, and the effects inline their shaders:

```html
<script type="importmap">
  {
    "imports": {
      "@mk7s/hologpu-core": "https://unpkg.com/@mk7s/hologpu-core@0.1.0/dist/index.js",
      "@mk7s/hologpu-dom": "https://unpkg.com/@mk7s/hologpu-dom@0.1.0/dist/index.js",
      "@mk7s/hologpu-effects/gradient-oklch": "https://unpkg.com/@mk7s/hologpu-effects@0.1.0/dist/gradient-oklch/index.js"
    }
  }
</script>
<script type="module">
  import { attach } from '@mk7s/hologpu-dom';
  import gradient from '@mk7s/hologpu-effects/gradient-oklch';

  await attach(document.getElementById('hero'), gradient, { preset: 'lagoon' });
</script>
```

The packages ship as ESM with no shader-loader requirement, so unpkg and jsDelivr serve them as-is.
(Until they are on npm, the repository's `examples/cdn` runs the same page against a local build.)

## When WebGPU is missing

`createEffect` throws `WebGPUUnavailableError`. `attach`, `<hgpu-field>` and the React wrapper catch
it and fall back to the effect's poster, or to its declared CSS `fallback` when it has no poster, so
the page stays readable either way. Motion pauses under `prefers-reduced-motion`, and a lab view can
pause each effect. A full fallback and progressive-enhancement guide is planned (story 5.13).

## Frameworks

`@mk7s/hologpu-react` wraps the attachment as `<HoloField>`; the underlying API is framework
agnostic, so Vue, Svelte and Astro use `attach` directly. Runnable consumers for Vite, React,
Next.js, webpack and plain HTML live in the repository's `examples/`.

## Next

- [Browse every effect](/#experiments).
- [All guides](/guides/).
