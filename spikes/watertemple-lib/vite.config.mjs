import { fileURLToPath } from 'node:url';
import { wgsl } from '../../watertemple/vite-plugin-wgsl.ts';

const library = fileURLToPath(new URL('../../watertemple/src/wgsl', import.meta.url));

export default {
  plugins: [wgsl({ library })],
  server: { host: '127.0.0.1', port: 5299, strictPort: true },
};
