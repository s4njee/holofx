/*
 * M3 story 3.1 spike: present a Fire Temple `EffectModule` as a HoloGPU `EffectDefinition`
 * so that `createEffect(canvas, candle)` drives it. This is throwaway evidence for the ADR
 * in hologpu/docs/adr, not a published adapter.
 *
 * The temple contract is `defineEffect({ meta, params, presets, create })`, where
 * `create(ctx)` returns `{ resize(w, h, dpr), frame(time, encoder, target), destroy() }`.
 * The HoloGPU contract is `create(ctx)` returning `{ resize([w, h]), update(frame),
 * render(frame, encoder, target), reset(seed), dispose() }`, with parameters in a `ParamStore`.
 */
import { defineEffect } from '@mk7s/hologpu-core';
import type { EffectDefinition, EffectInstance } from '@mk7s/hologpu-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type TempleModule = any;
type TempleSpec = any;

const linear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toSrgb = (c: number) => Math.round(Math.max(0, Math.min(1, linear(c))) * 255);
function linearToCss([r, g, b]: readonly number[]): string {
  return `#${[r ?? 0, g ?? 0, b ?? 0].map((c) => toSrgb(c).toString(16).padStart(2, '0')).join('')}`;
}
function cssToLinear(css: string): [number, number, number] {
  const hex = /^#?([\da-f]{6})$/i.exec(css.trim());
  if (!hex) return [0, 0, 0];
  const n = parseInt(hex[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHologpuSchema(schema: Record<string, TempleSpec>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema)) {
    if (spec.type === 'number')
      out[name] = {
        type: 'f32',
        default: spec.default,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        description: spec.label,
      };
    else if (spec.type === 'boolean')
      out[name] = { type: 'bool', default: spec.default, description: spec.label };
    else if (spec.type === 'color')
      out[name] = { type: 'color', default: linearToCss(spec.default), description: spec.label };
    else if (spec.type === 'select')
      out[name] = { type: 'enum', default: spec.default, options: spec.options, description: spec.label };
    else throw new Error(`Temple parameter type not mapped: ${spec.type}`);
  }
  return out;
}

function toHologpuPresets(
  presets: Record<string, Record<string, unknown>>,
  schema: Record<string, TempleSpec>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, values] of Object.entries(presets)) {
    out[name] = Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const spec = schema[key];
        return [key, spec?.type === 'color' ? linearToCss(value as readonly number[]) : value];
      }),
    );
  }
  return out;
}

const TIER: Record<string, 'T1' | 'T2' | 'T3' | 'T4' | 'T5'> = {
  A: 'T1',
  B: 'T2',
  C: 'T5',
};

export interface TempleAdapterOptions {
  family?: string;
  fallback?: string;
}

/** Wrap a temple EffectModule as a HoloGPU EffectDefinition. The canvas is needed for the temple's
 * pointer tracking, which the HoloGPU effect context does not expose. */
export function templeEffect(
  module: TempleModule,
  canvas: HTMLCanvasElement,
  options: TempleAdapterOptions = {},
): EffectDefinition {
  const schema = toHologpuSchema(module.params);
  return defineEffect({
    id: module.meta.id,
    family: options.family ?? module.meta.tags?.[0] ?? 'temple',
    title: module.meta.title,
    tier: TIER[module.meta.tier as string] ?? 'T2',
    core: false,
    tags: [...(module.meta.tags ?? [])],
    features: module.meta.scorecard?.features?.required ?? [],
    inputs: [],
    params: schema,
    presets: toHologpuPresets(module.presets ?? {}, module.params),
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback:
      options.fallback ?? 'radial-gradient(circle at 50% 82%, #7a3a06, #170b04 70%, #0a0503)',
    async create(ctx) {
      // The temple reads a plain object of live parameter values; HoloGPU holds a ParamStore.
      const view: Record<string, unknown> = {};
      const pull = () => {
        const snapshot = ctx.params.snapshot() as Record<string, unknown>;
        for (const [name, spec] of Object.entries(module.params as Record<string, TempleSpec>)) {
          const value = snapshot[name];
          view[name] = spec.type === 'color' ? cssToLinear(value as string) : value;
        }
      };
      pull();

      // The temple wants a pass profiler; HoloGPU's is a different shape, so timings are dropped.
      const profiler = { pass: () => undefined };
      const instance = await module.create({
        device: ctx.device,
        format: ctx.format,
        hdr: ctx.format.startsWith('rgba16float'),
        canvas,
        params: view,
        profiler,
      });

      let dpr = 1;
      const calls = ((globalThis as unknown as { __calls?: Record<string, number> }).__calls ??= {
        resize: 0,
        update: 0,
        render: 0,
      });
      return {
        resize(size) {
          calls.resize += 1;
          instance.resize(size[0], size[1], dpr);
        },
        update(frame) {
          calls.update += 1;
          dpr = frame.dpr;
          pull();
        },
        render(frame, encoder, target) {
          calls.render += 1;
          pull();
          instance.frame(
            { time: frame.time, delta: frame.delta, frame: frame.index },
            encoder,
            target,
          );
        },
        reset() {
          // The temple instance contract has no reset; a real adapter would dispose and recreate.
        },
        dispose() {
          instance.destroy();
        },
      } satisfies EffectInstance;
    },
  });
}
