# holofx research: effect families to explore next

Written 2026-10-13. This lists effect families that the four projects do not cover yet. Two are committed: **lightning** and **HD-2D pixel art**. Eight more are candidates, ranked at the end.

How the list was chosen: every idea here was checked against the 185 effects in the current catalogue and against the unbuilt stories in each project's `plan.md`. Where something nearby already exists or is already planned, the entry says so.

Two caveats:

- The technique notes and references come from memory, not from a literature search in this session. Treat the references as starting points and confirm them before citing.
- `backlog.md` parks new effects until v0.1.0. Exploration can run alongside that work, but a new family should be built on the shared temple core (backlog story 3.5), not on a third copy of the fire and water scaffold.

Tiers follow the temples' convention: **A** is shader-only and fits on any page, **B** needs compute or several passes and suits a hero section, **C** is a showcase.

---

## 1. Lightning

Working name: Storm Temple. Nothing in the catalogue or any plan covers electrical discharge. The nearest neighbours are hologpu's `border-energy`, firetemple's `sparks`, and firetemple's unbuilt story 11.5 (plasma globe looks), which would move here.

### Looks to cover

- **Cloud-to-ground bolt**: a jagged main channel with branches that fade faster than the trunk.
- **Sheet lightning**: a cloud lit from inside with no visible channel.
- **Arcs between two points**: Tesla coil, Jacob's ladder, plasma-globe filaments. Continuous and writhing, not a single strike.
- **Chain lightning**: a bolt that hops through a list of targets.
- **Lichtenberg figures**: the dense fern-like pattern a discharge burns into wood or acrylic. Slow, static, decorative.
- **Corona and glow discharge**: a soft fringe on edges and points.

### Generating the shape, cheapest first

1. **Noise-warped line in a fragment shader.** Per pixel, measure the distance to a line whose position is offset by animated noise, then map distance to brightness. One fullscreen pass, no geometry. It cannot branch for real; two or three layered lines fake it. Tier A.
2. **Noise-displaced polyline.** Points along the segment from A to B, pushed sideways by several octaves of noise, with an envelope that pins both ends. This is the right model for arcs, because the shape evolves smoothly over time. Tier A.
3. **Midpoint displacement.** Split the segment, shift the midpoint perpendicular by a random amount proportional to segment length, recurse six to eight levels. At each split, spawn a branch with some probability, shorter and dimmer than its parent. This is the classic game bolt. It is cheap enough to regenerate every strike on the CPU and upload, or to run in compute. Tier A.
4. **Guided growth toward targets.** A space-colonisation or random-tree search that grows toward attractor points. Less physical, but it gives control: the bolt ends where you want it, such as the cursor or a DOM element's rectangle. Tier A or B.
5. **Dielectric breakdown model.** Solve Laplace's equation for electric potential on a grid, with the discharge held at zero and the ground at one. Each step, add a cell next to the discharge, chosen with probability proportional to the local potential raised to a power η. The exponent sets the character: near 1 gives dense Lichtenberg ferns, 2 to 3 gives sparse bolt-like channels. This produces the most convincing branching. Tier B or C.

Notes on running the breakdown model on a GPU:

- The potential solve is a Jacobi relaxation, the same kernel as the pressure solve in the existing fluid effects. Warm-start from the previous step's solution; only the neighbourhood of the new cell changes, so a few iterations per step may be enough.
- Weighted random selection without reading back to the CPU is the hard part. Two options: a prefix sum over candidate weights followed by a search (hologpu already has `prefix-sum`), or add Gumbel noise to each candidate's log-weight and take the maximum with a reduction.
- Adding several cells per step trades accuracy for speed. How many before the shape visibly changes is an open question.

### Rendering the channel

- **Core and glow.** The core is a thin, white, very bright HDR line; the glow is blue-violet and wide. Two ways to get the glow: push the core through the existing bloom chain, or build a distance field from the bolt (hologpu has `jump-flood`) and apply an analytic falloff. The second gives a resolution-independent halo of any width at fixed cost. Compare them.
- **Geometry.** Instanced quads per segment with round joins, width scaled by branch depth. hologpu's plan lists a `ribbons` stretch effect that was never built; a shared stroke renderer would serve bolts, beams, trails and vines.
- **Afterimage.** Accumulate into a feedback buffer that decays over 100 to 200 ms. It reads as retinal persistence and softens the cut to black.
- **Lighting the scene.** In 2D, feed the bolt into radiance cascades as an emitter (both hologpu and lighttemple have `radiance-cascades`) so page shapes cast real shadows away from it. The cheap version is a global flash uniform plus lighttemple's `long-shadows`.
- **Lighting clouds.** Treat the bolt as a handful of point lights inside a ray-marched cloud with Beer-Lambert falloff. In 2D, multiply a blurred bolt mask by cloud density.

### Timing

Timing sells lightning more than shape does. A real strike has three phases:

1. A dim, branching **leader** works downward over tens of milliseconds.
2. The **return stroke** flashes up the main channel at full brightness. Branches go dark.
3. Two to four **re-strikes** follow down the same channel, 30 to 100 ms apart. This is the flicker people recognise.

Build this as a reusable strike envelope that drives any bolt generator. A slow-motion mode that shows the leader crawling, as high-speed cameras do, is a strong effect in its own right and avoids the flash problem below.

### Flash safety

Lightning is the worst case in the whole collection for photosensitivity. Re-strikes at 30 to 100 ms intervals exceed the WCAG 2.3.1 limit of three flashes per second if they light a large area.

- The bolt itself is thin and covers little area. The ambient scene flash is the hazard.
- Default presets should merge the re-strikes into one smooth pulse and cap the ambient luminance change. Offer realistic flicker as an opt-in preset carrying the same warning label firetemple uses for `flashPresets`.
- Under reduced motion: a static bolt, or one slow fade, and no ambient flash.
- Run firetemple's analyser (`tests/flash.ts`) over every preset from the first effect onward, not as a later sweep.

### Web motifs

- Storm sky as a hero background, with rain from watertemple's `rain-streaks`.
- An arc between the cursor and the nearest interactive element; a zap on press.
- Chain lightning stepping through nav items or list items.
- Arcs crawling along a headline's outline, following the text's distance field (lighttemple already builds one for `neon-sign` and `lit-type`).
- A Jacob's ladder or Tesla coil as a loading indicator.
- A Lichtenberg figure that grows as the page scrolls. Store each cell's arrival order in a texture at generation time, then reveal by thresholding against scroll position. Growth becomes scrubbable, reversible and nearly free at runtime. The same trick works for cracks, frost and vines.
- Optional thunder through Web Audio: a filtered noise burst, delayed by a chosen distance.

### Candidate effects

| Id | What | Tier |
|---|---|---|
| `noise-bolt` | Shader-only bolt, layered | A |
| `arc` | Two-point writhing arc; Tesla and Jacob's ladder presets | A |
| `midpoint-bolt` | Branching strike with the full timing envelope | A |
| `strike-timing` | Building block: leader, return stroke, re-strikes, slow motion | n/a |
| `glow-study` | Building block: bloom against distance-field falloff | n/a |
| `cursor-zap` | Arc from pointer to element | A |
| `electric-text` | Arcs along glyph outlines | A |
| `chain-lightning` | Hops through DOM rectangles | A or B |
| `lichtenberg` | Dense discharge figure, scroll-scrubbed | B |
| `dbm-lightning` | Breakdown model in compute | B or C |
| `lit-page` | Bolt as a radiance-cascades emitter over page shapes | B |
| `storm-sky` | Clouds, sheet lightning, bolt, rain | B |
| `plasma-globe` | Filaments attracted to the pointer | B |

### Open questions

- Does the breakdown model run interactively at 256² with warm-started Jacobi, and does multigrid (an unbuilt hologpu stretch) change the answer?
- Is a library of bolts baked at load and replayed cheaper than live generation, and does repetition show?
- What is the brightest ambient pulse that passes the flash analyser and still reads as lightning?

### References

- Niemeyer, Pietronero and Wiesmann, "Fractal Dimension of Dielectric Breakdown", 1984. The breakdown model.
- Reed and Wyvill, "Visual Simulation of Lightning", SIGGRAPH 1994.
- Kim and Lin, "Physically Based Animation and Rendering of Lightning", 2004, and "Fast Animation of Lightning Using an Adaptive Mesh", 2007.
- Schneider, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn", SIGGRAPH 2015. For the storm sky.

---

## 2. HD-2D pixel art

Working name: Pixel Temple. "HD-2D" is Square Enix's name for the look of Octopath Traveler and its successors, and the company has reportedly filed trademarks for it. Use it to describe the style; check before putting it in a package or repo name.

Nothing in the catalogue covers this. The pieces that exist are general: hologpu's `dither`, `edges`, `halftone-ascii`, `depth-parallax` and `blur`; lighttemple's shadow maps and post chain.

### What defines the look

Pixel-art sprites and pixel-textured 3D geometry, rendered at full resolution with modern lighting and post-processing: point lights with real shadows, heavy tilt-shift depth of field that makes the scene read as a miniature, bloom on emissives, light shafts and fog, soft particles, reflective water, vignette and a colour grade. The camera sits slightly above the scene with a narrow field of view.

There are two distinct sub-styles, and they need different techniques:

- **HD-2D proper.** Full-resolution render, smooth lighting falling across pixel textures, strong depth of field. The contrast between crisp pixels and soft optics is the point.
- **Low-resolution 3D pixel art.** The whole scene renders to a small target, such as 320 by 180, with lighting, shadows and outlines all quantised to the pixel grid, then scales up with sharp edges. The result looks hand-drawn frame by frame.

Explore both. The first is closer to what you asked for; the second is cheaper per frame and works on any 3D model.

### Building blocks

1. **Sampling pixel textures in perspective.** Nearest-neighbour sampling shimmers as the camera moves; plain bilinear blurs. The fix is a linear sampler with UVs snapped toward texel centres and a one-pixel antialiased transition sized from screen-space derivatives. Compare the three under motion, at non-integer device pixel ratios, and with mipmaps.
2. **Sprites in a 3D world.** Billboards locked to the vertical axis, alpha-tested with alpha-to-coverage, writing depth. The interesting problems are shadows and lighting:
   - *Casting shadows.* A camera-facing quad is edge-on to a side light. Options: rotate the billboard toward the light in the shadow pass, or use crossed quads.
   - *Receiving light.* Flat sprites take light as one flat card. Normal-mapped sprites respond to light direction. Normals can be generated automatically by building a distance field from the sprite's alpha (hologpu's `jump-flood`) and treating it as a rounded height map.
   - *Keeping the palette.* Smooth lighting pushes sprite colours off their palette and makes them look muddy. Posterise the light term into a few steps, or remap through a ramp, so shading stays in the artist's colours.
3. **Texel-snapped lighting.** For the low-resolution sub-style: before lighting a fragment, move its world position to the centre of the texel it falls in, using the derivatives of UV and position. Light and shadow edges then land on texel boundaries. Watch for artefacts at UV seams.
4. **Tilt-shift depth of field.** The signature of the style. The real version computes a circle of confusion from depth, gathers a disc blur at half resolution, and handles near and far fields separately. The cheap version blurs by distance from a horizontal focus line and needs no depth buffer, so it works on flat layers, images and captured DOM content.
5. **Low-resolution render with a snapped camera.** Render at low resolution with an orthographic camera snapped to whole texels so nothing swims, then apply the sub-texel remainder as an offset during upscaling so scrolling stays smooth.
6. **Outlines.** One-pixel outlines from depth and normal discontinuities, drawn in the low-resolution pass. hologpu's `edges` is the starting point.
7. **Palette quantisation.** Map each pixel to the nearest colour of a fixed palette in a perceptual space such as OKLab, with ordered or blue-noise dither. This turns any image, model or DOM capture into pixel art, which matters because it means users do not need pixel-art assets to use the family.
8. **Tile dioramas.** Author a scene as two small images: tile indices and tile heights. Extrude it into instanced blocks textured from an atlas. A web developer can describe a scene in a few kilobytes and get a lit miniature.
9. **Atmosphere.** Light shafts, height fog and dust motes are all unbuilt stories in lighttemple's E5. Torches reuse firetemple's `torch` and `flicker`. Water reuses watertemple's `reflections` and `toon-water` with the palette step on top.
10. **Animation cadence.** Sprites animate at 8 to 12 frames per second while the camera and lighting run at full rate. Mixing the two rates is part of the look.

### Web motifs

- A hero diorama with a scroll-driven camera. A rack focus between foreground and background works as a section transition.
- A sprite or avatar lit by the cursor: lighttemple's `pointer-light-2d` on a normal-mapped sprite. Cheap and immediately appealing.
- A photo that renders as pixel art and resolves to full detail on hover, or the reverse.
- A parallax landscape header built from flat pixel layers at different depths, with depth of field and light shafts. This is the least expensive route to the look.
- Time of day tied to the visitor's clock or `prefers-color-scheme`.
- DOM content as part of the scene: a heading captured and placed as a signboard, body text in an RPG dialogue box.
- A 404 page or an empty state as a small scene.
- Weather: snow, rain or falling leaves snapped to the pixel grid.

### Candidate effects

| Id | What | Tier |
|---|---|---|
| `pixel-sampling` | Building block: nearest, bilinear and antialiased texel sampling compared | n/a |
| `palette-quantise` | Building block and filter: any image to a fixed palette with dither | A |
| `sprite-normals` | Building block: automatic normals from a sprite's alpha | n/a |
| `tilt-shift` | Depth-based and screen-space depth of field compared | A (screen-space), B (depth) |
| `lit-sprite` | Cursor light on a normal-mapped sprite, palette preserved | A |
| `pixelate-hover` | Image resolves between pixel art and full detail | A |
| `parallax-diorama` | Flat layers in depth with depth of field and shafts | A |
| `lowres-3d` | A glTF model as low-resolution pixel art: snapped camera, outlines, texel lighting | B |
| `tile-diorama` | Extruded tilemap with point lights, shadows, bloom, depth of field | B |
| `torchlit-room` | Interior with flickering torches and omnidirectional shadows | B |
| `pixel-water` | Reflective water with pixel-quantised distortion | B |
| `day-night` | Colour grade and light direction over a day cycle | A |
| `rack-focus-scroll` | Scroll-driven focus pull across a diorama | B |

### Assets

This family needs art, and the review already found three images across the repos with licence or provenance problems. Use only CC0 packs (confirm the licence at the time of use), art drawn for the project, or art generated in the repo by `palette-quantise`. Record the source of every file in the credits file. Do not use sprites taken from games.

### Open questions

- Does half-resolution gather depth of field fit an integrated GPU's budget at full canvas size?
- Which sampling method holds up best under perspective, motion and a device pixel ratio of 1.5?
- Are automatically generated sprite normals good enough, or do sprites need authored ones?
- Which billboard shadow approach reads correctly from the default camera angle?
- What is the smallest scene format a web developer would be willing to write by hand?

### References

- Acquire and Square Enix, "The Fusion of Nostalgia and Novelty in the Development of Octopath Traveler", Unreal Fest Europe 2019.
- t3ssel8r's videos on 3D pixel-art rendering. The source for texel-snapped lighting and the snapped camera.
- Thomas Vasseur, "Art Design Deep Dive: Using a 3D pipeline for 2D animation in Dead Cells", 2018.
- Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014. For gather depth of field.

---

## 3. Other candidates

### 3.1 Retro displays and signal

- **Pitch:** make content look like it is shown on a physical display or carried over a bad signal.
- **Effects:** CRT with shadow mask, scanlines, curvature and phosphor persistence; VHS tracking and chroma bleed; oscilloscope and vector display; LED wall; e-ink refresh; film projector gate weave and dust.
- **New techniques:** phosphor decay through feedback; beam-traced vector drawing with intensity proportional to dwell time.
- **Existing or planned:** hologpu has `dot-matrix-field`, `halftone-ascii`, `grain-overlay`, and an LCD page. Its unbuilt stretches `glitch`, `pixel-sort` and `slit-scan` belong here.
- **Why now:** it is mostly tier A, and a CRT pass is the natural last stage for the pixel-art family.
- **Reference:** Timothy Lottes' CRT shader.

### 3.2 Energy and magic

- **Pitch:** game-feel feedback for interfaces.
- **Effects:** hexagonal shield with ripple on impact; portal that shows another view through it; beams and lasers; rune circles; auras; charge-up and release; hit sparks.
- **New techniques:** intersection highlights from depth; a view rendered through a stencilled opening.
- **Existing or planned:** hologpu `border-energy`, `press-ripple`; firetemple `sparks`.
- **Why now:** it shares the bolt, stroke renderer and glow with lightning, so most of the cost is already paid.

### 3.3 Shatter and destruction

- **Pitch:** break things, mainly as transitions and as feedback for dismissing or deleting.
- **Effects:** Voronoi fracture of an image or captured DOM element with tumbling shards; glass that cracks from the click point; crumble; slice along a drawn line; disintegrate into particles.
- **New techniques:** fracture pattern generation; many small rigid bodies in compute; crack propagation, which is the same branching growth as lightning.
- **Existing or planned:** hologpu `text-dissolve`, `voronoi`, `morph-particles`; firetemple's unbuilt burn-front epic.
- **Risk:** depends on capturing DOM content into a texture, which hologpu supports but which is the least portable part of the stack.

### 3.4 Wind and growth

- **Pitch:** living, moving surfaces. The obvious next elemental temple.
- **Effects:** grass field that parts around the cursor; foliage sway; falling leaves and petals; flags, banners and curtains; vines that grow along element borders; fur on text or a logo that can be stroked.
- **New techniques:** instanced blade geometry with wind fields; shell and strand rendering; cloth constraints; space-colonisation growth.
- **Existing or planned:** hologpu's unbuilt `cloth` and `ribbons` stretches.
- **References:** Wohllaib, "Procedural Grass in Ghost of Tsushima", GDC 2021; Müller et al., "Position Based Dynamics", 2007; Runions, Lane and Prusinkiewicz, "Modeling Trees with a Space Colonization Algorithm", 2007.

### 3.5 Cosmos

- **Pitch:** dark-theme hero backgrounds with real depth.
- **Effects:** black hole with gravitational lensing and an accretion disc; nebula volume; planet with atmospheric scattering; spiral galaxy; warp tunnel.
- **New techniques:** ray bending through a gravitational field; volumetric emission with temporal reprojection.
- **Existing or planned:** hologpu `starfield`, `n-body`, `constellation`; lighttemple's unbuilt E5-S6 atmospheric sky.
- **Reference:** James et al., "Gravitational Lensing by Spinning Black Holes in Astrophysics, and in the Movie Interstellar", 2015.

### 3.6 Snow, ice and crystal

- **Pitch:** the cold counterpart to fire and water.
- **Effects:** snowfall with depth; snow that settles on the top edges of page elements; a cursor trail pressed into snow; ice with internal cracks and refraction; frost creeping across glass; gems with dispersion.
- **New techniques:** accumulation driven by DOM rectangles; height-field deformation; dispersion by tracing several wavelengths.
- **Existing or planned:** watertemple `frost-melt` and `fogged-glass`; lighttemple `glass-panels`.
- **Reference:** "Deformable Snow Rendering in Batman: Arkham Origins", GDC 2014.

### 3.7 Paper and print

- **Pitch:** tactile, editorial effects for content-heavy sites.
- **Effects:** page curl and fold transitions; torn edges; layered cut paper with soft shadows; risograph misregistration; ink bleeding into fibre; origami unfolds.
- **New techniques:** developable-surface deformation for curls and folds; fibre-direction-driven diffusion.
- **Existing or planned:** lighttemple `embossed-card`; watertemple `ink-wash`; lighttemple's unbuilt E6 hatching and Kuwahara stories.

### 3.8 Fields and forces

- **Pitch:** make invisible physics visible. Good for science, data and audio sites.
- **Effects:** magnetic field lines and iron filings; ferrofluid spikes; Chladni figures driven by audio; electric field lines around charges the user places; a grid warped by gravity wells.
- **New techniques:** line integral convolution, which is a generally useful way to draw any vector field and is absent from the catalogue.
- **Existing or planned:** hologpu `audio-spectrum`, `flow-particles`, `grid-horizon`.
- **Why it fits:** the electric field effect reuses the potential solve from the lightning breakdown model.

---

## 4. Ranking

| Family | New to the collection | Use on real pages | Reuses existing code | Cost and risk |
|---|---|---|---|---|
| Lightning | High | High | High: bloom, jump flood, radiance cascades, flash analyser | Low to start; flash safety needs care |
| HD-2D pixel art | High | High | Medium: post chain, shadows, torches, water | Medium; needs art and a depth-of-field study |
| Retro displays | Medium | High | High | Low |
| Energy and magic | Medium | Medium | High, after lightning | Low |
| Shatter | High | High for transitions | Medium | Medium; depends on DOM capture |
| Wind and growth | High | Medium | Low | High; new geometry and simulation |
| Cosmos | Medium | Medium, backgrounds only | Medium | Medium |
| Snow, ice, crystal | Medium | Medium | Medium | Medium |
| Paper and print | Medium | High for editorial | Low | Medium |
| Fields and forces | Medium | Low, niche | Medium | Low |

Suggested order after the two committed families: retro displays, because it is cheap and completes the pixel-art look; then energy and magic, because lightning will have built most of it; then shatter.

## 5. Shared pieces worth building once

Several families need the same primitives. Building them as shared code first makes each later family cheaper:

- **Branching growth.** Lightning, Lichtenberg figures, glass cracks, frost and vines are one algorithm with different parameters.
- **Arrival-time textures.** Record when each cell was reached during growth, then reveal by threshold. Makes any growth effect scroll-scrubbable.
- **A stroke renderer.** Thick, joined, HDR lines for bolts, beams, trails, vines and vector displays.
- **Distance-field glow.** Analytic halo from a jump-flood field, as an alternative to wide bloom.
- **A potential solver.** Lightning, electric field lines and the existing fluid pressure solves share it.
- **Tilt-shift depth of field and palette quantisation.** Built for pixel art, useful as general filters over any effect.
