import { fileURLToPath } from 'node:url';
import { wgsl } from '../../firetemple/vite-plugin-wgsl.ts';

const fireLibrary = fileURLToPath(new URL('../../firetemple/src/wgsl', import.meta.url));

export default {
  plugins: [wgsl({ library: fireLibrary })],
  server: { host: '127.0.0.1', port: 5299, strictPort: true },
};
