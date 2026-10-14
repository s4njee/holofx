---
layout: ../../layouts/Doc.astro
title: Getting started — HoloGPU
description: Install HoloGPU and put your first effect on a page.
---

# Getting started

HoloGPU is a WebGPU effect library. Install one package and you get the runtime, the DOM
attachment and the effect catalogue behind one API.

```sh
npm install @mk7s/hologpu
```

Requires Node 22.12 or later to install and build, and a WebGPU-capable browser at runtime.

## Put an effect on a page

```ts
import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

await attach(document.querySelector('.hero')!, gradient, { preset: 'lagoon' });
```

`attach` mounts the effect on an element you own, drives its render loop and disposes it when the
page goes away. Every effect is also available on its own path, so a bundler only pulls in the one
you import.

## When WebGPU is missing

`attach` throws `WebGPUUnavailableError` from `createEffect`, and the DOM attachment degrades to the
effect's poster or its declared CSS `fallback`, so the page stays readable. A full guide to
fallbacks and progressive enhancement is planned (story 5.13).

## Next

- The [guides index](/guides/) lists everything as it is written.
- The [landing page](/#experiments) browses every effect in the collection.
