/*
 * M3 story 3.7 spike: present a Light Temple experiment as a HoloGPU `EffectDefinition`, so that
 * `createEffect(canvas, lightEffect(factory, canvas))` drives it. This is throwaway evidence for the
 * "target-based render path" clause, not a published adapter.
 *
 * The mismatch this closes: a Light Temple experiment owns the frame. It reads
 * `ctx.surface.currentTexture()`, encodes into its own command encoder and calls
 * `queue.submit` itself. HoloGPU instead hands the effect an `encoder` and a `target` and presents
 * afterwards. The bridge is `TargetSurface`: the experiment's `surface.currentTexture().createView()`
 * returns the *caller's* target, so the experiment draws into HoloGPU's frame without a code change.
 * The experiment still submits its own command buffer (noted below); HoloGPU's encoder stays empty.
 */
import { defineEffect } from '@mk7s/hologpu-core';
import type { EffectDefinition, EffectInstance, ParamSchema, ParamValues } from '@mk7s/hologpu-core';
import { createTargetExperiment } from '../../lighttemple/src/lib/index.ts';
import type { TargetExperiment } from '../../lighttemple/src/lib/index.ts';
import type { ExperimentFactory } from '../../lighttemple/src/experiments/types.ts';
import type { ParamValues as LightParamValues } from '../../lighttemple/src/ui/params.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The Light Temple `ParamSink` has an imperative `add()`; this one declares into the experiment
 * (so it gets live values) and re-pulls HoloGPU's `ParamStore` snapshot every frame for the keys
 * the two schemas share. Keys only Light Temple knows keep their defaults.
 */
function bridgeParams(read: () => Record<string, unknown>) {
  const groups: Record<string, unknown>[] = [];
  const sink = {
    add<const S extends Record<string, { value: unknown }>>(
      schema: S,
    ): LightParamValues<S> {
      const values = {} as Record<string, unknown>;
      const snapshot = read();
      for (const [key, def] of Object.entries(schema)) {
        values[key] = key in snapshot ? snapshot[key] : def.value;
      }
      groups.push(values);
      return values as LightParamValues<S>;
    },
    button(): void {},
    onChange(): () => void {
      return () => {};
    },
  };
  return {
    ...sink,
    pull() {
      const snapshot = read();
      for (const values of groups) {
        for (const key of Object.keys(values)) if (key in snapshot) values[key] = snapshot[key];
      }
    },
  };
}

export interface LightAdapterOptions {
  id: string;
  title: string;
  family?: string;
  fallback?: string;
  /** HoloGPU parameter schema; keys shared with the experiment stay live. */
  params?: ParamSchema;
  presets?: Readonly<Record<string, ParamValues>>;
  /** Caller-owned canvas, exposed to the experiment as `surface.canvas`. */
  canvas: HTMLCanvasElement;
  size?: readonly [number, number];
}

export function lightEffect(
  factory: ExperimentFactory,
  options: LightAdapterOptions,
): EffectDefinition {
  const [width, height] = options.size ?? [480, 320];
  const surfaceSize = (w: number, h: number) => ({
    width: w,
    height: h,
    cssWidth: w,
    cssHeight: h,
    pixelRatio: 1,
  });

  return defineEffect({
    id: options.id,
    family: options.family ?? 'stylized',
    title: options.title,
    tier: 'T2',
    core: false,
    tags: ['light', 'webgpu'],
    features: [],
    inputs: [],
    params: (options.params ?? {}) as ParamSchema,
    presets: options.presets ?? {},
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: options.fallback ?? 'radial-gradient(circle at 62% 38%, #ffe2bd 0%, #2a2623 100%)',
    async create(ctx) {
      const bridge = bridgeParams(() => ctx.params.snapshot() as Record<string, unknown>);
      let target: GPUTextureView | null = null;
      const built: TargetExperiment = await createTargetExperiment(factory, {
        device: ctx.device,
        canvas: options.canvas,
        format: ctx.format,
        size: surfaceSize(width, height),
        getTarget: () => {
          if (!target) throw new Error('Light adapter rendered before a target was bound');
          return target;
        },
        params: bridge,
      });
      const calls = ((globalThis as any).__calls ??= { resize: 0, update: 0, render: 0 });
      return {
        resize(size) {
          calls.resize += 1;
          built.setSize(surfaceSize(size[0], size[1]));
        },
        update() {
          calls.update += 1;
          bridge.pull();
        },
        render(frame, _encoder, view) {
          calls.render += 1;
          // Point the experiment at HoloGPU's target, then let it draw and submit its own frame.
          target = view;
          bridge.pull();
          built.experiment.frame({
            time: frame.time,
            dt: frame.delta,
            frame: frame.index,
            size: built.surface.size,
          });
        },
        reset() {
          // Light Temple experiments have no reset; a real adapter would dispose and recreate.
        },
        dispose() {
          built.experiment.dispose();
        },
      } satisfies EffectInstance;
    },
  });
}
