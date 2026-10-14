# Examples

Minimal consumer projects for the published `@mk7s/hologpu` packages. Each one is a real app that
imports an effect, mounts it with the public API and builds — the acceptance tests from story 4.7
("Test installation the way users will do it").

| Example | Toolchain | Entry |
| --- | --- | --- |
| `vanilla` | Vite + TypeScript | `attach()` from `@mk7s/hologpu/dom` |
| `react` | Vite + React | `HoloField` from `@mk7s/hologpu-react` |
| `next` | Next.js 16 (server rendering on) | a client component around `HoloField` |
| `webpack` | webpack 5 + ts-loader | `attach()` from `@mk7s/hologpu/dom` |
| `cdn` | no build step | `<script type="importmap">` + unpkg |

They declare normal `0.1.0` dependencies so they read like the docs. The install test swaps those
for freshly packed tarballs.

## Running the install test

```sh
npm run test:install              # build + pack hologpu, then install and build every example
npm run test:install -- --no-build # reuse the existing hologpu dist
npm run test:install vanilla react # a subset
```

`scripts/test-install.mjs` builds and packs the five publishable packages, copies each example to a
scratch directory, points every `@mk7s/*` dependency at the packed tarballs (so nothing is fetched
from the registry) and runs `npm install && npm run build` there. This is what catches a broken
`exports` map, a missing `types` entry or a bundler that cannot resolve the package.

The `cdn` example needs the packages to exist on npm; the test **skips it with a message** until
they are published, then serves the page and confirms the effect mounts in a real browser.

> Consumers need WebGPU types: the packages' declarations reference `GPUDevice` and friends, so an
> app should include `@webgpu/types` (each example's `tsconfig.json` does).
