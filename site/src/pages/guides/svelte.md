---
layout: ../../layouts/Doc.astro
title: Svelte — HoloGPU
description: Mount a HoloGPU effect in a Svelte component.
---

# Svelte

`attach` fits Svelte's lifecycle directly: mount on `onMount`, and return the cleanup.

```sh
npm install @mk7s/hologpu
```

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { attach } from '@mk7s/hologpu/dom';
  import gradient from '@mk7s/hologpu/effects/gradient-oklch';

  let host: HTMLElement | null = $state(null);

  onMount(async () => {
    if (!host) return;
    const attachment = await attach(host, gradient, { preset: 'lagoon' });
    return () => attachment.destroy();
  });
</script>

<div bind:this={host} class="hero">
  <h1>Give the web a little wonder.</h1>
</div>
```

On Svelte 4, declare the host with `let host: HTMLElement;` instead of `$state`.

## Notes

- **`onMount` returning a cleanup** is the idiomatic dispose: it runs once on destroy, so the effect
  and its GPU resources go with the component.
- **The effect is client-only.** `onMount` never runs during SSR, so the same component can render on
  the server without a guard.
- **Keep content inside the host** as the accessible fallback for the WebGPU-missing case.

A runnable consumer follows the same shape as the repository's `examples/vanilla`.

## Next

- The [Astro guide](/guides/astro/) for an island that mounts the same way.
- The [guides index](/guides/) lists everything.
