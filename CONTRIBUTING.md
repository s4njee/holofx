# Contributing to holofx

holofx is a superproject: it holds five projects as git submodules and a site that
documents and demonstrates them.

```
hologpu/       submodule — WebGPU runtime and effect library (@mk7s/hologpu)
firetemple/    submodule — fire effects gallery
watertemple/   submodule — liquid effects gallery
lighttemple/   submodule — lighting and shadow experiments
eightfoldpath/ submodule — effects in the HD-2D style
site/          the marketing site and catalogue (content of this repo)
scripts/       bootstrap, build-labs, catalogue orchestration, link check
```

The backlog in [`backlog.md`](backlog.md) is the plan; `research.md` lists effect
families not yet covered.

## Set up

```sh
git clone --recurse-submodules https://github.com/s4njee/holofx.git
cd holofx
npm run bootstrap     # init submodules + install every project and the site
```

`bootstrap` installs each submodule with its own package manager (pnpm for
hologpu, npm for the temples) and installs the site. Each project keeps its own
lockfile; the superproject does not impose a single workspace.

## Build and run

```sh
npm run dev            # the site at http://127.0.0.1:5188
npm run build          # build the five labs, the catalogue and the site into site/dist
npm run check:links    # verify local links in the built site (after build)
```

`npm run build` orchestrates: `build-labs` (each project's gallery into the
git-ignored `site/public/labs/<project>/`), the catalogue import, then the site
build. `site/public/labs/` is generated — never commit it. `site/dist/` is the
built site.

## Where to make a change

Each project lives in its own repository and is edited there, not in the
superproject. A change normally looks like:

1. `cd hologpu` (or `firetemple`, `watertemple`, `lighttemple`, `eightfoldpath`).
2. Make the change on a branch, run that project's own checks, and open a pull
   request against that repository's `main`.
3. After it merges, bump the pin in the superproject (below).

To try a submodule change from inside the superproject without touching the
project repo, you can work in the submodule checkout directly and commit on a
branch there; the superproject will show a dirty submodule until you commit and
push. Do not commit a pin that points at an unpushed commit.

## Bump a submodule pin

After a project's `main` moves, update the superproject:

```sh
git submodule update --remote --merge <project>
git add <project>
git commit -m "Bump <project> to current main"
```

Dependabot (`.github/dependabot.yml`) also opens a PR when a submodule's tracked
branch moves; CI on that PR is the integration test. `git submodule update
--remote` respects the `branch = main` recorded in `.gitmodules`.

## The site

The site is ordinary content of this repo under `site/`. Its source is
JavaScript; it imports the HoloGPU runtime from the `hologpu` submodule through
the `@mk7s/hologpu-core` alias and reads effect metadata and posters from the
submodules. `npm run catalogue` (in `site/`) regenerates `site/src/catalogues.json`
and the copied posters; commit its output.

## Licensing

Every repository is MIT. Record any third-party asset in that repository's
`CREDITS.md` before adding it, and do not add assets without a clear licence.
