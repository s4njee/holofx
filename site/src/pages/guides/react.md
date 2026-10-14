---
layout: ../../layouts/Doc.astro
title: React — HoloGPU
description: Mount a HoloGPU effect in a React component with @mk7s/hologpu-react.
---

# React

Install the facade and the React wrapper:

```sh
npm install @mk7s/hologpu @mk7s/hologpu-react
```

`<HoloField>` creates one host element, attaches the effect to it and disposes the attachment on
unmount — which is the most common integration mistake out of the way.

```tsx
import { HoloField } from '@mk7s/hologpu-react';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

export function Hero() {
  return (
    <HoloField effect={gradient} preset="lagoon" className="hero" style={{ minHeight: '60vh' }}>
      <h1>Give the web a little wonder.</h1>
    </HoloField>
  );
}
```

Anything you put inside stays in the light DOM as the accessible fallback, so the heading is real
markup, not a canvas.

## Options

`<HoloField>` forwards every `attach` option:

```tsx
<HoloField
  effect={gradient}
  preset="dusk"
  poster="/hero-poster.png"
  initialParams={{ spread: 3 }}
  maxDpr={1.5}
  resolutionScale={0.8}
/>
```

## Doing it yourself

If a hook fits better than the component, `attach` is plain async DOM code:

```tsx
import { useEffect, useRef } from 'react';
import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let attachment: Awaited<ReturnType<typeof attach>> | undefined;
    let cancelled = false;
    void attach(host, gradient, { preset: 'lagoon' }).then((result) => {
      if (cancelled) result.destroy();
      else attachment = result;
    });
    return () => {
      cancelled = true;
      attachment?.destroy();
    };
  }, []);

  return <div ref={ref} className="hero" />;
}
```

Effects mount in the browser only. In a server-rendered app the component runs on the server, but the
attachment happens in `useEffect`, which never does, so there is nothing to guard.

## Next

- The [Next.js guide](/guides/nextjs/) for server rendering and `'use client'`.
- The [guides index](/guides/) lists everything.
