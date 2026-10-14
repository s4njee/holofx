---
layout: ../../layouts/Doc.astro
title: Vue — HoloGPU
description: Mount a HoloGPU effect in a Vue single-file component.
---

# Vue

The public API is plain async DOM code, so it drops into a Vue component with no wrapper.

```sh
npm install @mk7s/hologpu
```

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

const host = ref<HTMLElement | null>(null);
let attachment: Awaited<ReturnType<typeof attach>> | undefined;

onMounted(async () => {
  if (host.value) attachment = await attach(host.value, gradient, { preset: 'lagoon' });
});

onBeforeUnmount(() => attachment?.destroy());
</script>

<template>
  <div ref="host" class="hero">
    <h1>Give the web a little wonder.</h1>
  </div>
</template>
```

The `<h1>` stays in the DOM as the accessible fallback; the attachment renders behind it.

## Notes

- **Dispose on unmount.** `onBeforeUnmount` releases the GPU resources; skipping it leaks a device
  context on every navigation.
- **One effect per host.** `attach` owns the element it is given; mount several components for
  several effects.
- **Reactivity is not needed.** The effect has its own parameter store and render loop; keep Vue
  state for the surrounding UI, not for the shader's per-frame values.

A runnable Vite + Vue consumer follows the same shape as the repository's `examples/vanilla`.

## Next

- The [React guide](/guides/react/) if you also target React.
- The [guides index](/guides/) lists everything.
