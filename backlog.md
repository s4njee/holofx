# holofx backlog

Goal: turn holofx into a superproject that holds hologpu, firetemple, lighttemple and watertemple as git submodules, and ship the result as a library of WebGPU effects that another developer can install and use in a few lines, with a site that teaches them how.

Written 2026-10-13 from a read-only review of all four projects and the site. Nothing in those projects was changed.

Sizes: **S** is half a day or less, **M** is one to two days, **L** is several days. Stories are ordered within each milestone; milestones are ordered by dependency.

## What "shippable" means here

v0.1.0 is done when all of these are true:

1. `git clone --recurse-submodules` of the public holofx repo, then one documented command, gives a working site and all four labs.
2. A developer can `npm install` a package, paste five lines, and see an effect from any of the four projects on their own page, using the same call shape for all four.
3. That works in a Vite app, a Next.js app and a plain HTML page with a `<script type="module">` tag.
4. When WebGPU is missing, or the user prefers reduced motion, the page still looks intentional without the developer writing extra code.
5. Every effect marked ready has its own page on the site with a live demo, a parameter table and a snippet to copy.
6. Every repo has a licence, a README and green CI.

## Where things stand

| | hologpu | firetemple | watertemple | lighttemple |
|---|---|---|---|---|
| Shape | pnpm workspace: `core`, `dom`, `effects`, facade, playground | Vite gallery app | Vite gallery app plus 12 showcase pages | Vite gallery app plus 1 demo page |
| Effects | 78 | 25 | 72 | 10, all `status: 'prototype'` |
| Public API | `createEffect`, `attach`, `<hgpu-field>` | none; `mountEffect` lives in the gallery shell | none; same as firetemple | none; `mountExperiment` builds the whole gallery page |
| npm | all packages `private`, `0.0.0` | `private`, no `exports` | `private`, no `exports` | `private`, no `exports` |
| Git | local only, no remote; 7 commits; 404 uncommitted entries | `s4njee/firetemple`, `main` in sync | **not a git repo** | `s4njee/lighttemple`; only branch is `claude/dreamy-planck-drfsyb`, no `main` |
| Licence | none | none | none | none |
| README | milestone changelog, not a guide | none | none | experiment table and scripts only |
| CI | workflow exists, never run | runs | workflow exists, never run | none |
| Tests | 21 vitest files, 73 Playwright specs | 41 vitest files on headless Dawn | 66 vitest files on headless Dawn | one Playwright smoke script |
| Toolchain | pnpm 11, TS 6, Vite 8 | npm, TS 6, Vite 8 | npm, TS 6, Vite 8 | npm, TS 5.9, Vite 7, no lint or unit tests |

The site (`sites/hologpu-temples/`) is a single marketing page with a searchable gallery of all 185 effects and an iframe dialog that loads each project's own gallery build. It has no install instructions, no code samples, no documentation and no per-effect URLs.

Four facts shape the rest of this document:

- **There are three different effect contracts.** hologpu has `EffectDefinition` and `createEffect(canvas, def, options)`. firetemple and watertemple share `defineEffect({ meta, params, presets, create })` returning `{ resize, frame(time, encoder, target), destroy }`. lighttemple has a factory that returns `{ frame, resize?, dispose }` and declares parameters by calling a DOM-building panel. A user cannot learn one and use the others.
- **firetemple and watertemple are one codebase copied twice.** About 40 files under `src/gpu`, `src/wgsl` and `src/shell` are byte-identical, and another 15 differ by 30 lines or fewer.
- **The site consumes the projects by copying them.** `vendor/hologpu` and `vendor/lighttemple` are source snapshots, `public/labs/` is 1,440 committed build-output files (28 MB), `node_modules` is a tracked symlink to an absolute path on one machine, and the scripts reach into `../../..` for sibling repos and for hologpu's copy of TypeScript and Playwright.
- **Every project's `plan.md` lists a published npm library as a non-goal**, and firetemple's also lists a shared package with watertemple as a non-goal (`firetemple/plan.md:15-18`, `watertemple/plan.md:14`, `hologpu/plan.md:38`). This backlog reverses both. Story 1.15 updates those plans so they stop contradicting it.

## Decisions to make first

These block the work below. Each has a recommendation; change any of them and the affected stories are noted.

- **D1. Licence.** Recommend MIT for all five repos. The vendored holocss in hologpu is already MIT. Blocks 1.1 and all of M4.
- **D2. Names.** Recommend: `holofx` is the name of the superproject repo and the site; the runtime keeps publishing as `@mk7s/hologpu` (the scope hologpu and holocss already use); each temple publishes as `@mk7s/firetemple`, `@mk7s/watertemple`, `@mk7s/lighttemple`. Confirm you own the `@mk7s` npm scope and check the names are free; the npm registry was not reachable from the review session. Blocks M4.
- **D3. The one public API.** Recommend hologpu's: `createEffect(canvas, effect, options)`, `attach(element, effect, options)` and `<hgpu-field effect="...">`. It already has presets, seeds, pause, step, reduced-motion poses, device-loss recovery and poster fallback. The temples adapt to it instead of each growing its own `mount()`. Blocks M3.
- **D4. Where the shared temple core lives.** Recommend a new package inside the hologpu repo (working name `@mk7s/hologpu-temple-core`), published to npm and consumed by fire and water as an ordinary dependency. Putting it in the superproject would make each submodule unbuildable on its own. Blocks 3.5.
- **D5. How the superproject installs dependencies.** Recommend starting with orchestration: each submodule keeps its own lockfile and installs itself, and root scripts call into them. Move to a single pnpm workspace across submodules only if cross-repo development gets painful. Blocks 2.5.
- **D6. Site ownership, stack and hosting.** Recommend the site becomes ordinary content of the superproject at `site/`, not a fifth submodule; that it moves to Astro, since it needs to grow from one page to about 200 with Markdown notes and live demos; and that it deploys from GitHub Actions. The current site is tied to an OpenAI Sites project (`.openai/hosting.json`) and its repo history is five commits titled "Update Site source". Blocks 2.3 and M5.
- **D7. What counts as ready.** Not all 185 effects belong in a library: hologpu's own `docs/backlog-v2.md` §1.3 lists effects unsuitable for real pages, firetemple's 12 Epic 3 entries are technique demos, and every lighttemple experiment is marked prototype. Recommend a `status` field with three values, `ready`, `demo` and `research`, where only `ready` effects get a stable export, a docs page promise and semver protection. Blocks 3.9.

## M1. Make each project fit to be a submodule

A submodule pins a commit that must exist on a remote. Today that is true for one of the four.

### All four

- [ ] **1.1 Add `LICENSE` and the `license`, `repository`, `description` and `homepage` fields** to every `package.json`. S, needs D1.
- [ ] **1.2 Write a real README for each repo**: what it is, a screenshot, how to run it, how to use one effect, link to the holofx site. firetemple and watertemple have none. M.
- [ ] **1.3 Add a credits file to each repo.** firetemple's shaders cite Quilez, Gustavson and Narkowicz as written from the published algorithm; lighttemple ships a Poly Haven HDRI and a Khronos model (already in `public/assets/CREDITS.md`); fonts are OFL; watertemple carries `scripts/ui/MSDFGEN-LICENSE.txt`. S.
- [ ] **1.4 Move personal deploy scripts out of the public path.** `scripts/publish-site-mk7s.mjs` in hologpu and watertemple copies builds into a sibling `mk7s` repo and deploys a Cloudflare project named `mk7s`; firetemple's `deploy` script hardcodes `--project-name firetemple`. Keep them if you want, but document them as maintainer-only or move them to a private location. S.
- [ ] **1.5 Decide the commit identity before the first public push.** hologpu's commits use a personal gmail address and lighttemple's are authored as `Claude <noreply@anthropic.com>`. Set `user.email` to a GitHub noreply address first if that matters to you. S.

### hologpu

- [ ] **1.6 Commit the uncommitted work.** HEAD is the M5 milestone; all of M6, M7 and v2 exists only in the working tree (296 untracked, 108 modified). Commit it in milestone-sized commits, not one. This is the largest single risk in the project: there is no second copy of that work. M.
- [ ] **1.7 Fix `.gitignore` before that commit.** Only `artifacts/mk7s/` is ignored, so `git add -A` would add 37 MB of logs and PNGs from `artifacts/`. Decide which of the 77 files in `docs/benchmarks` (up to 2.7 MB each) are worth tracking. S, do before 1.6.
- [ ] **1.8 Resolve the AI-generated image.** `Gemini_Generated_Image_qanynxqanynxqany.jpg` in the root is byte-identical to `apps/playground/public/media/dive-connect.jpg`, which `lcd.html` uses. Delete the root copy, and either record its provenance in `public/media/README.md` or replace it. S.
- [ ] **1.9 Remove `docs/backlog-compose.md`.** It is about Holochart dashboards. S.
- [ ] **1.10 Create `s4njee/hologpu`, push, and get the first CI run green.** `.github/workflows/check.yml` has never executed. Expect to fix things. M.

### watertemple

- [ ] **1.11 Clean up, then `git init` and push.** In order: add `output/` to `.gitignore` (15.5 MB, and 13 of its logs contain `/Users/sanjee/...`); move the one file the build needs out of it (`vite.config.ts:41` emits `output/epic-9/capture-spike.jpg`); fix the hardcoded scratchpad path in `experiments/pbf2d-scratch.test.ts:8`; then create `s4njee/watertemple` and get CI green for the first time. M.
- [ ] **1.12 Replace `public/lantern/maui-torch.jpg`.** It is a commercial product photograph from americangaslamp.com with no licence to redistribute, and the current publish script deploys it. Use a self-rendered or CC0 image, or drop `lantern.html`. **This is a hard blocker for making the repo public.** S.

### lighttemple

- [ ] **1.13 Create `main`.** The only branch, local and remote, is `claude/dreamy-planck-drfsyb`. Create `main` from `d824b58`, push it, make it the GitHub default, delete the old branch. S.
- [ ] **1.14 Confirm where `demos/ace-of-spades/eye-emblem.png` came from.** Nothing in the repo records its source. Replace it if you cannot. Also check that the subset `yesteryear-latin.woff2` complies with the OFL reserved-font-name clause. S.

### Plans

- [ ] **1.15 Update each `plan.md`** so the non-goals no longer rule out npm publication and a shared core, and point to this backlog for the cross-project work. S.

## M2. Build the superproject

Target layout:

```
holofx/
  .gitmodules
  hologpu/          submodule: s4njee/hologpu
  firetemple/       submodule: s4njee/firetemple
  lighttemple/      submodule: s4njee/lighttemple
  watertemple/      submodule: s4njee/watertemple
  site/             the site, moved from sites/hologpu-temples
  examples/         starter projects (M6)
  scripts/          bootstrap, build-labs, build-catalogue, capture-previews
  .github/workflows/
  README.md  LICENSE  CONTRIBUTING.md  backlog.md
```

- [ ] **2.1 `git init` holofx and create `s4njee/holofx`.** Keep it private until M1 is finished for all four. S.
- [ ] **2.2 Add the four submodules** at the top level, each tracking `main`. S, needs 1.10, 1.11, 1.13.
- [ ] **2.3 Move the site to `site/` with fresh history.** The existing site repo's history is five generic commits carrying 22 MB of build output and the tracked `node_modules` symlink, so there is nothing worth preserving. Note that another process was committing to that repo during this review (animated-preview capture); let it finish and take its output across before moving. S, needs D6.
- [ ] **2.4 Delete `site/vendor/`.** Point the `@mk7s/hologpu-core` alias in `vite.config.js` at `../hologpu/packages/core/src`, and later at the published package. The vendored copies currently match upstream apart from test files, so this is safe today and gets less safe every week. S.
- [ ] **2.5 Replace committed lab builds with a build step.** `scripts/build-labs.mjs` builds each submodule with `--base /labs/<project>/` into a git-ignored `site/public/labs/`. Remove the 1,440 tracked files. The current build also ships things it should not, such as `labs/watertemple/output/` and `labs/watertemple/scripts/`; fix that at the source. M, needs D5.
- [ ] **2.6 Give the site its own dependencies.** Remove the `node_modules` symlink; add TypeScript and Playwright as real devDependencies; remove every `../../..` path from `import-catalogues.mjs` and `capture-animated-previews.cjs`. S.
- [ ] **2.7 Add root scripts**: `bootstrap` (init submodules, install each), `build` (labs, catalogue, site), `dev`. One command from a fresh clone to a running site. M.
- [ ] **2.8 Add superproject CI**: checkout with `submodules: recursive`, bootstrap, build, link-check. M.
- [ ] **2.9 Automate submodule bumps.** Dependabot's `gitsubmodule` ecosystem opens a PR when a submodule's `main` moves; CI on that PR is the integration test. S.
- [ ] **2.10 Write `CONTRIBUTING.md`** covering the submodule workflow: where to make a change, how to bump a pin, how to work on a submodule branch from inside the superproject. S.

## M3. One API for every effect

This milestone is what makes the collection a library. Until it lands, three of the four projects can only be used by copying their source.

- [ ] **3.1 Spike: wrap one temple effect as a hologpu `EffectDefinition`.** Take firetemple's `candle` and make `createEffect(canvas, candle)` work. The open question is whether hologpu's instance shape (`resize`, `update`, `render`, `reset`, `dispose`) can host an effect that expects the host to own the command encoder and hand it a target view. Write down what had to bend. **Do this before committing to D3.** M.
- [ ] **3.2 Record the contract as an ADR** in hologpu's `docs/adr`, including the parameter schema (the temples have number, boolean, color and select; lighttemple adds text), presets, HDR opt-in and the metadata every effect must carry. S, needs 3.1.
- [ ] **3.3 Give firetemple and watertemple a library entry.** Move `mountEffect` out of `src/shell/host.ts`; accept the caller's canvas instead of creating a `div.ft-host`; drop the CSS imports from `src/gpu/fallback.ts` and `shader-overlay.ts`; replace the `import.meta.glob` registry with generated per-effect entry points so each effect is importable alone. L.
- [ ] **3.4 Make shaders consumable outside Vite.** A library build must emit plain JS with WGSL inlined as strings. firetemple's `vite-plugin-wgsl.ts` relies on Vite's `?raw`; watertemple has 78 `?raw` imports and an eager glob in `src/wgsl/index.ts` that pulls every shared chunk into one 70 kB bundle. Adopt firetemple's per-effect chunking in watertemple as part of this. L.
- [ ] **3.5 Extract the shared temple core.** Start from the byte-identical set (`gpu/{canvas,fullscreen,targets,texture,mipmap,pointer,profiler,uniforms,types}`, `gpu/scene/*`, `gpu/passes/*`, the shared WGSL library, `tests/setup.ts`). Reconcile the three places that diverged first: shader packaging, the HDR post tail (`gpu/post/{bloom,output}`), and `EffectMeta`/`Scorecard`. Delete `src/gpu/audio.ts` and `scroll.ts` from firetemple; nothing imports them. L, needs D4.
- [ ] **3.6 Untangle watertemple's effect-to-effect imports.** `aurora` imports `ink-orbit`, six effects import `orbit-variants/material.ts`, `fluid-warp` imports `media-distortion`, and two import `ripple-dom/demo.ts`. Shared pieces move to a shared module so each effect can ship alone. M.
- [ ] **3.7 Make lighttemple experiments embeddable.** Move `hexToLinear` out of `src/ui/params` (all 10 experiments import it); put a headless interface behind `ExperimentContext.params` the way `PostProcess` already does; convert the imperative `ctx.params.add(...)` calls to a declared schema; then adapt to the contract from 3.2. This subsumes lighttemple's own E8-S4. L.
- [ ] **3.8 Move accessibility from the gallery shells into the runtime.** In fire and water, reduced-motion handling, the pause-when-hidden logic, the brightness cap and the flash warnings all live in `src/shell`, so an embedder gets none of them. They must apply on the library path by default. Carry firetemple's `flashPresets` labelling into the shared metadata. M.
- [ ] **3.9 Tag every effect `ready`, `demo` or `research`.** Use the existing evidence: hologpu `docs/backlog-v2.md` §1.3, the fire and water tier scores, firetemple's flash scorecard. Expect well under 185 to be `ready`. M, needs D7.
- [ ] **3.10 One catalogue schema, emitted by each project.** Each repo's build writes a `catalogue.json` with id, title, summary, family, tags, status, tier, parameter schema, presets, poster, measured cost, flash rating and browser notes. The site reads those files. This replaces `import-catalogues.mjs`, which today parses hologpu's TypeScript AST and invents summaries such as "Explore compute, texture, mipmap, cube with live parameters and shader source." M.
- [ ] **3.11 Close hologpu's fallback asymmetry.** `createEffect` throws `WebGPUUnavailableError` while `attach` and `<hgpu-field>` degrade to a poster. Either give `createEffect` a fallback option or make the docs steer new users to `attach`. S.
- [ ] **3.12 Make every package safe to import on a server.** Only the custom-element registration is guarded today. Importing any entry point in Node must not touch `window`, `document` or `navigator`. Add a test that imports each entry in a bare Node process. M.
- [ ] **3.13 Publish a React wrapper** (`<HoloField effect={...} />`) once the core API is stable. It is a thin component over `attach`, and it removes the most common integration mistake, which is not disposing on unmount. M.

## M4. Package and release

- [ ] **4.1 Make the hologpu packages publishable**: remove `private`, add `files`, `publishConfig`, per-package READMEs. The facade depends on three internal packages through `workspace:*`, so all four publish together. M, needs D2.
- [ ] **4.2 Stop rewriting `package.json` on every dev run.** `scripts/catalogue.mjs` regenerates the export maps of two packages on `predev`, `prebuild` and `pretypecheck`. Keep the generation, commit its output, and have CI fail if it is stale. S.
- [ ] **4.3 Decide how posters ship.** Effects load them with `new URL('./poster.png', import.meta.url)`, which only works when the consumer's bundler handles asset URLs. Either document that requirement or move posters to a separate optional entry. M.
- [ ] **4.4 Package the three temples** with `exports`, types and a library build alongside the gallery build. M each, needs 3.3, 3.4, 3.7.
- [ ] **4.5 Add Changesets and a release workflow** with npm provenance, in each repo that publishes. Start at `0.1.0`; state plainly in the README that `0.x` can break. M.
- [ ] **4.6 Verify the published shape**: `publint` and `@arethetypeswrong/cli` in CI for every package. S.
- [ ] **4.7 Test installation the way users will do it.** Fresh projects, installed from a packed tarball, in CI: Vite, Next.js (server rendering on), webpack, and a plain HTML page loading from a CDN. This is acceptance criterion 3. L.
- [ ] **4.8 Enforce bundle budgets.** hologpu has `scripts/bundle-size.mjs` (core 39.3 kB gzip, DOM 32.4 kB, effects 6.6 to 15.5 kB each) and firetemple has `check-bundle.mjs`. Turn the current numbers into CI limits and show them on each effect's page. S.
- [ ] **4.9 Align the toolchains.** Bring lighttemple to Vite 8 and TypeScript 6; add ESLint to hologpu and lighttemple; add an `engines` field everywhere. hologpu requires Node 22.12 or later, which is worth stating on the install page. M.
- [ ] **4.10 Replace hologpu's vendored holocss** (`apps/playground/src/vendor/holocss`) with the published `@mk7s/holocss` dependency. S.

## M5. Expand the site

The site today sells the collection but does not help anyone use it. Its copy also promises things that are not yet true for three of the four projects ("Framework agnostic", "Use the effects with ordinary HTML, or bring them into your own framework").

### Foundation

- [ ] **5.1 Move the site to a generator.** Three hand-written files will not scale to a page per effect. Port the existing design to Astro: the landing page as is, effect pages from the catalogue, guides from Markdown. M, needs D6.
- [ ] **5.2 Deploy from GitHub Actions** on push to `main`, with a preview per pull request. S.
- [ ] **5.3 Make the copy match reality.** Until M3 lands, the page should say what works today; after it lands, the framework-agnostic claims become true. S.

### Getting started

- [ ] **5.4 Quick start page**: install, the five-line example, the custom-element version, the CDN script-tag version, and what the user sees when WebGPU is missing. This is the most important page on the site. M.
- [ ] **5.5 Put the install command and a working snippet on the landing page**, above the gallery. S.
- [ ] **5.6 Framework guides**: React, Next.js, Vue, Svelte, Astro. Each one is a short page with a complete component. M.

### Effects

- [ ] **5.7 A page per effect with a stable URL** (`/effects/<project>/<id>`). Live demo mounted through the public API, not an iframe; parameter table generated from the schema; preset switcher; snippets for vanilla, custom element and React; badges for tier, measured cost, bundle size and flash rating; browser notes; link to source on GitHub; the effect's `notes.md` rendered below. Mounting through the library is the point: the site becomes the first real consumer of M3. L, needs 3.10.
- [ ] **5.8 "Copy code" that reflects the current controls.** Change a parameter in the demo and the snippet updates to match. M.
- [ ] **5.9 Filters.** Today there is only text search. Add project, family, status, tier, "needs pointer", "works behind DOM content" and "safe for reduced motion". hologpu's catalogue entries currently carry no family at all. M, needs 3.10.
- [ ] **5.10 A preview for every effect.** watertemple has posters for 30 of 72 effects and many hologpu entries have none. Animated capture is in progress (61 of 185 when this was written, none yet for firetemple). Finish it for all `ready` effects, make the capture script run from the superproject without machine-specific paths, and generate Open Graph images from the stills. M.
- [ ] **5.11 Real summaries for hologpu's 78 effects**, one sentence each on what it looks like and where it fits. M.
- [ ] **5.12 Recipes by use case**: hero backgrounds, card hovers, text treatments, page transitions, loading states. People search by what they are building, not by technique. hologpu's v2 playground pages (`cards`, `products`, `transitions`, `ambient`, `launch`) are a ready source. M.

### Guides and reference

- [ ] **5.13 Fallback and progressive enhancement guide**: what happens without WebGPU, on insecure origins (LAN HTTP on a phone gets the fallback), and on Firefox, where stable WebGPU is limited to Windows and Apple-silicon macOS. M.
- [ ] **5.14 Performance guide**: the tier system, resolution scale, DPR caps, adaptive quality, pausing off-screen, how many effects per page is reasonable. M.
- [ ] **5.15 Accessibility guide**: reduced motion, the flash ratings and what they mean, pause controls, contrast over animated backgrounds. S.
- [ ] **5.16 "Write your own effect" guide**, from `fragmentEffect` upward. Both temples already have a `docs/effect-authoring.md` to draw on. M.
- [ ] **5.17 Generated API reference** from the hologpu packages with TypeDoc. S.
- [ ] **5.18 Browser support page**, built from hologpu's `docs/compatibility.md` and the temples' `support-matrix.md`. Call out that `backdrop-glass` needs a Chrome flag for HTML-in-canvas. S.
- [ ] **5.19 "Open in StackBlitz" on each effect page**, using the starter from 6.2. S.

### Site quality

- [ ] **5.20 Automated checks.** The README's validation section describes manual checks in Chromium only. Add Playwright smoke tests (each view loads, the gallery batches, the dialog opens and closes, the fallback path renders), an axe pass, and a Lighthouse budget. M.
- [ ] **5.21 Per-page titles, descriptions, social images and a sitemap.** S.
- [ ] **5.22 Keep the labs, demote them.** The four full galleries stay at `/labs/<project>/` for people who want every knob, linked from effect pages instead of being the only way in. S.

## M6. Publish on GitHub

- [ ] **6.1 Superproject README**: a looping preview, one sentence on what it is, the quick start, a table of the four projects, a link to the site. M.
- [ ] **6.2 `examples/`**: minimal runnable projects for vanilla Vite, React, Next.js and plain HTML. The install tests in 4.7 run against these, so they cannot rot. M.
- [ ] **6.3 Community files**: `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue forms (bug report asks for browser, GPU and the output of hologpu's device-check page), pull request template. S.
- [ ] **6.4 Repository settings**: description, topics (`webgpu`, `wgsl`, `shaders`, `effects`), social preview image, site URL, branch protection on `main`, Discussions on. S.
- [ ] **6.5 Make the repos public and tag v0.1.0**, with release notes that say which effects are `ready` and what is known not to work. S, needs M1 to M4 and at least 5.4 and 5.7.

## M7. Harden

Each project already has an unfinished hardening milestone. These are the parts that matter for people depending on the library.

- [ ] **7.1 Finish hologpu's M8**: whole-catalogue passes on Safari and Firefox, memory budgets and leak checks, benchmarks on three devices. Validation so far is one M1 Max and a partial iPhone pass. L.
- [ ] **7.2 Run the outstanding device checks** from `hologpu/docs/backlog-v2.md`: Android, Intel Windows, Safari 26. The launch page also misses its 4 ms p95 gate (line 286). M.
- [ ] **7.3 Run the flash sweep in CI.** firetemple has a WCAG 2.3.1 analyser, but CI sets `FLASH_SWEEP=0`. Run it nightly at least, and extend it to the other three projects through the shared catalogue. M.
- [ ] **7.4 Put lighttemple's smoke test in CI** and give it pixel assertions; it currently only checks that frames were produced and does not cover the demo page. M.
- [ ] **7.5 Test the embed path, not just the galleries**: mount, resize, dispose, remount, and device loss, through the public API, for every `ready` effect. M, needs M3.
- [ ] **7.6 Leak test**: mount and destroy each `ready` effect 50 times and assert GPU resource counts return to baseline. Single-page apps will do exactly this. M.

## Parked

Deliberately not in the path to v0.1.0:

- New effects. firetemple has 83 unticked stories across Epics 5 to 13, watertemple has Epic 11, lighttemple has E3 to E9, and hologpu deferred 23 stretch effects. The collection is already large; it is not yet usable.
- Rehoming the watertemple effects that are not water (`game-of-life`, `neon-mycelium`, `neon-calligraphy`, `aurora`, `eclipse-halos`, `dichroic-glass`, `silk-embers`, `lantern`). Worth doing once the shared core exists and moving an effect between repos is cheap.
- A WebGL fallback. hologpu rules it out by design, and poster fallback is enough for v0.1.0.
- A single pnpm workspace across all submodules (see D5).

## Suggested order

1. Decide D1, D2, D6. Run spike 3.1, then decide D3.
2. M1 for all four repos. Start with 1.6 and 1.7 (hologpu's uncommitted work) and 1.12 (the product photograph).
3. M2. After this the superproject exists and the site builds from submodules.
4. M3 for firetemple first (it is the smallest and cleanest), then watertemple with the shared core, then lighttemple.
5. M4 and the M5 foundation and getting-started stories in parallel.
6. 5.7 onward, M6, then tag v0.1.0. M7 continues after the tag.
