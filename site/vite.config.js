import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({resolve:{alias:[{find:'@mk7s/hologpu-core',replacement:fileURLToPath(new URL('./vendor/hologpu/core/index.ts',import.meta.url))}]},build:{target:'es2022'},server:{host:'127.0.0.1',port:5188,strictPort:true}});
