---
layout: ../../layouts/Doc.astro
title: Browser support — HoloGPU
description: Where WebGPU is available, why an adapter is not guaranteed, and the features each effect asks for.
---

# Browser support

WebGPU is shipping, but availability is **adapter-gated**: `navigator.gpu` can exist and
`requestAdapter()` still return `null` because of the GPU, the driver, a blocklist or a browser
setting. Never infer availability from the browser name — check for an adapter, and keep a fallback.

## The matrix

| Browser | Established shipping scope |
| --- | --- |
| **Chrome / Edge** | Chrome 113 on Windows, macOS and ChromeOS; Chrome 121 on selected Android devices. Linux is partial: Chrome 144 for Intel Gen12+, Chrome 147 for NVIDIA on Wayland. |
| **Safari** | Safari 26 on macOS 26 Tahoe and later, iOS/iPadOS 26 and visionOS 26. Safari 26–27 on older macOS needs the **WebGPU feature flag**. |
| **Firefox** | Firefox 141 on Windows; Firefox 147 on **Apple-silicon macOS**. Intel Macs, Linux and Android are not in the stable shipping scope — treat them as adapter-gated. |
| **Samsung Internet** | Chromium-based; safe floor is Samsung Internet 25 (Chromium 121). |

Chromium on Windows uses a single adapter and ignores `powerPreference`. `requestAdapter()` returns
`null` when the GPU is blocklisted, when "use graphics acceleration" is off, or when no GPU is found.
A **software** adapter may still be returned; Chromium sets `adapter.info.isFallbackAdapter` for
CPU-type adapters.

## Secure context

WebGPU requires a secure context: HTTPS or `localhost`. An insecure origin — a LAN HTTP page on a
phone — reports no `navigator.gpu`, which lands on the [fallback path](/guides/fallback/).

## Optional features, per effect

Beyond the core, effects may ask for optional features. HoloGPU passes the requested ones when
creating the device and treats a missing **required** feature as unavailable:

- `timestamp-query` — per-pass GPU timings in the HUD; without it the profiler reports CPU cost only.
- `texture-formats-tier1` / `tier2` — additional texture formats; tier 2 depends on tier 1.
- others used by individual effects (float32 filtering, HDR canvas options) are listed on the
  effect's own page under **Browser notes**.

If a feature is not granted, the effect should be skipped rather than forced, and the fallback shown.

## One effect to call out

`backdrop-glass` uses **HTML-in-canvas** to refract the real DOM behind a panel. That entry point is
behind a Chrome flag today, so on other browsers (and default Chrome) it falls back — the effect page
says so in its browser notes.

## Automation notes

Headless Firefox on macOS returned no adapter in the project's probes, while **headed** Firefox
worked; CI runs Chromium on SwiftShader, whose adapter identity is asserted by the pixel tests.
These are environment results, not claims about the browser generally. When testing effects in CI,
run a headless Chromium with the software Vulkan backend, and run the graphics-sensitive checks
headed.

## Further reading

- [Fallback and progressive enhancement](/guides/fallback/) for the checks to write.
- [Performance](/guides/performance/) for what to do once it does run.
