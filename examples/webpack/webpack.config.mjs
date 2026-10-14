import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HtmlWebpackPlugin from 'html-webpack-plugin';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  entry: './src/main.ts',
  output: {
    path: path.join(dir, 'dist'),
    filename: 'main.js',
    clean: true,
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    // WGSL ships as inlined strings in the package, so no shader loader is needed.
    // Type-checking is `tsc --noEmit` in the build script; ts-loader only transpiles.
    rules: [
      { test: /\.ts$/, use: { loader: 'ts-loader', options: { transpileOnly: true } }, exclude: /node_modules/ },
    ],
  },
  plugins: [new HtmlWebpackPlugin({ template: 'index.html' })],
  performance: { hints: false },
};
