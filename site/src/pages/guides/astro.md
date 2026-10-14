---
layout: ../../layouts/Doc.astro
title: Astro — HoloGPU
description: Mount a HoloGPU effect in Astro with a client script.
---

# Astro

Astro ships no client JavaScript by default, so the effect lives in a `<script>` tag: Astro bundles
it, runs it in the browser, and leaves the rest of the page static.

```sh
npm install @mk7s/hologpu
```

```astro
---
import gradient from '@mk7s/hologpu/effects/gradient-oklch';
---

<div id="hero" class="hero">
  <h1>Give the web a little wonder.</h1>
</div>

<script>
  import { attach } from '@mk7s/hologpu/dom';
  import gradient from '@mk7s/hologpu/effects/gradient-oklch';

  const host = document.getElementById('hero');
  if (host) await attach(host, gradient, { preset: 'lagoon' });
</script>
```

The `<script>` is processed and bundled by Astro (with the effect's shaders inlined), and only runs
on the client, so the page itself can stay fully static.

## Notes

- **Import the effect in the script, not the frontmatter,** so the WebGPU runtime never enters the
  server render.
- **`import.meta.env.BASE_URL`** is available if you build a sub-path deploy, as this site does.
- The `<h1>` is real markup and doubles as the fallback when WebGPU is unavailable.

## Next

- The [Svelte guide](/guides/svelte/) for the same lifecycle shape.
- The [guides index](/guides/) lists everything.
