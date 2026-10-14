// Astro config (M5 story 5.1): the site grew from one hand-written page to a page per effect plus
// guides, so it is generated now. The HoloGPU runtime is aliased to the submodule source.
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  vite: {
    build: { target: 'es2022' },
    resolve: {
      alias: [
        {
          find: '@mk7s/hologpu-core',
          replacement: fileURLToPath(
            new URL('../hologpu/packages/core/src/index.ts', import.meta.url),
          ),
        },
      ],
    },
  },
});
