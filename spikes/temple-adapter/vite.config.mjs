import { fileURLToPath } from 'node:url';
import { wgsl } from '../../firetemple/vite-plugin-wgsl.ts';

const hologpuCore = fileURLToPath(
  new URL('../../hologpu/packages/core/src/index.ts', import.meta.url),
);
const fireLibrary = fileURLToPath(new URL('../../firetemple/src/wgsl', import.meta.url));

export default {
  resolve: {
    // Resolve the HoloGPU runtime from its source in the submodule.
    alias: { '@mk7s/hologpu-core': hologpuCore },
  },
  // Fire Temple's candle imports its WGSL through the temple's own plugin.
  plugins: [wgsl({ library: fireLibrary })],
  server: { host: '127.0.0.1', port: 5299, strictPort: true },
};
