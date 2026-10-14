# HoloGPU / Temples product site

A product page with a top-left view selector for HoloGPU, Light Temple, Water Temple, and Fire Temple. Each view has its own copy, accent colors, featured experiments, and interactive WebGPU sculpture. The URL stores the selected view in `?site=`. Browser back/forward works. The entire temple card is a native link, supporting image/text clicks, keyboard navigation, and opening in a new tab. Every site exposes its complete experiment catalogue in the product page: HoloGPU 78, Light Temple 10, Water Temple 72, and Fire Temple 25. The gallery renders 12 cards initially, then adds batches automatically as its scroll sentinel approaches the viewport. A Load more button provides a keyboard fallback. Search checks the complete catalogue before batching; changing sites clears the filter. Preview images receive a source only while intersecting the viewport, are decoded asynchronously, and drop their source when off screen. Opening a lab or hiding the tab suspends background previews. The hero initializes when visible and pauses GPU rendering when off screen or behind a demo.

The lab dialog loads the real project builds hosted at `/labs/hologpu/`, `/labs/lighttemple/`, `/labs/watertemple/`, and `/labs/firetemple/`. Featured experiments link directly to their original routes. Closing the dialog unloads its GPU resources. Full-screen links also work independently.

## Development

Run `npm install`, then `npm run dev`. Run `npm run build` to produce `dist/`.

The product page imports the HoloGPU runtime from the `hologpu` submodule through the `@mk7s/hologpu-core` alias (`../hologpu/packages/core/src`). It reads effect metadata and posters directly from the submodules: `hologpu/packages/effects/src`, `firetemple/src/effects`, `watertemple/src/effects`, and `lighttemple/src/gallery/registry.ts`.

The lab bundles are built into the git-ignored `public/labs/` from the submodules by the superproject's `scripts/build-labs.mjs`, each with `--base /labs/<project>/`. Refresh them with that script, then rebuild this site.

The metadata snapshot is `src/catalogues.json`. Refresh it with `npm run catalogue` (runs `scripts/import-catalogues.mjs`), which reads the submodule registries and copies available posters into `public/images/catalogues/`.

Images are original effect posters, local screenshots, authored SVG illustrations, or captured animated AVIFs. All 100 formerly text-only experiment cards have a real demo capture: 51 HoloGPU, 42 Water Temple, and 7 Light Temple. Fire Temple already had posters for every experiment. Animated previews loop at 8 fps with 20 frames at 480×300; their JPEG first frames are used for reduced motion or an AVIF decoding failure. The same viewport observer controls both animated and still preview sources. Reduced-motion changes apply to already visible cards. The product hero is a custom WGSL sculpture running on the HoloGPU runtime; it is an illustrative showcase, not a measurement of temple effects. A static preview is used when WebGPU is unavailable. The page follows the reduced-motion preference and offers a pause control. Lab performance and browser coverage remain those documented by each original project.

## Validation

Verified in Chromium with WebGPU: all four views and lab galleries, featured-effect links, URL/history behavior, pause/resume, source links, dialog dismissal, a 390 px mobile viewport without horizontal overflow, reduced motion, and forced static fallback. Also verified full-card temple navigation, all four default catalogue counts, search/empty/reset states, and a one-to-one match between listed experiment ids and their bundled lab registries. Infinite-scroll checks verify the initial 12-card batch, no off-screen catalogue image requests, viewport-only active image sources, automatic access to every experiment in all four catalogues, full-catalogue search, empty/reset states, and preview suspension while a demo is open.

The hosting identity is persisted in `.openai/hosting.json`. Publish through the Sites source workflow and deployment operation appropriate to the existing audience; do not create a second project.

## Animated preview capture

Start the built site's local preview on port 5188. `node scripts/capture-animated-previews.cjs` records only the originally text-only cards, retaining completed captures when resumed. Pass `project/effect` keys to select a subset, or `--recapture` with those keys to replace a capture. The script uses the site's own installed Playwright, a hardware WebGPU browser, `avifenc`, and `ffmpeg`. Raw frames stay under ignored `.site-runtime/capture/`. Some static diagnostics are recorded while their original controls are scrubbed, and image filters use their original animated-canvas input.

`src/animated-preview-targets.json` records the original 100-card scope; `src/animated-previews.json` records every clip's source route, capture settings, frame count, still frame, and size. Run `node scripts/verify-animated-previews.cjs` to decode every sequence, confirm dimensions/frame count/infinite looping, and check motion. Run `node scripts/apply-animated-previews.mjs` before rebuilding. Catalogue refreshes preserve these captured assets.
