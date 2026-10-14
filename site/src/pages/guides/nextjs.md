---
layout: ../../layouts/Doc.astro
title: Next.js — HoloGPU
description: Mount a HoloGPU effect in Next.js with server rendering on.
---

# Next.js

Effects run in the browser, so the component that mounts one is a client component while the page
around it stays server-rendered.

```sh
npm install @mk7s/hologpu @mk7s/hologpu-react
```

## The effect component

```tsx
// app/hero.tsx
'use client';

import { HoloField } from '@mk7s/hologpu-react';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

export function Hero() {
  return (
    <HoloField effect={gradient} preset="lagoon" style={{ minHeight: '60vh' }}>
      <p>Rendered on the server, animated on the client.</p>
    </HoloField>
  );
}
```

## The page stays a server component

```tsx
// app/page.tsx
import { Hero } from './hero';

export default function Page() {
  return (
    <main>
      <Hero />
      <h1>A Next.js consumer</h1>
    </main>
  );
}
```

Because the effect module is imported in the client component, the WebGPU runtime never reaches the
server bundle.

## Looking after the runtime

- Import only the effect you use — `@mk7s/hologpu/effects/<id>` — so the server and client bundles
  stay small.
- If you skip the wrapper, guard the mount in `useEffect`; it never runs on the server, which is the
  natural place to attach and dispose.
- The fallback is automatic: `attach` and `<HoloField>` degrade to the poster or the effect's CSS
  `fallback` when WebGPU is unavailable.

A complete, runnable consumer lives in the repository's `examples/next`.

## Next

- The [React guide](/guides/react/) for the component in detail.
- The [guides index](/guides/) lists everything.
