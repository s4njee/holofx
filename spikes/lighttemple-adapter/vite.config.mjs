import { fileURLToPath } from 'node:url';

const hologpuCore = fileURLToPath(
  new URL('../../hologpu/packages/core/src/index.ts', import.meta.url),
);

export default {
  resolve: {
    // Resolve the HoloGPU runtime from its source in the submodule.
    alias: { '@mk7s/hologpu-core': hologpuCore },
  },
  server: { host: '127.0.0.1', port: 5300, strictPort: true },
};
