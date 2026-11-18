// The scene contract shared by the browser preview and the Node render worker.
import type { Params, Schema } from './schema.ts';
import type { AudioStyle } from '../theme/index.ts';

/** Minimal canvas surface (HTMLCanvasElement, OffscreenCanvas and @napi-rs/canvas all satisfy it). */
export interface Canvas { width: number; height: number; getContext(type: '2d', opts?: unknown): any }
export type Ctx = CanvasRenderingContext2D;

export interface Env {
  /** create an offscreen canvas of the given *device* size */
  createCanvas(w: number, h: number): Canvas;
  /** device pixels per logical pixel (1 for final renders, 0.5 for a half-res preview) */
  scale: number;
  /** preview-only quality knobs; absent = full quality (the final render never sets them) */
  quality?: { particles: number; glow: boolean };
}

export interface SceneMeta {
  id: string;
  name: string;
  family: string;
  description: string;
  width: number;     // logical size, always 1080 x 1920 for Shorts
  height: number;
  fps: number;
  loudness: number;  // target integrated loudness (LUFS)
}

/** stereo mix; style = the theme's sound palette (pitch, scale, role map, effects), applied by the audio kit */
export interface Mix { sr: number; L: Float32Array; R: Float32Array; style?: AudioStyle }

export interface SceneInstance {
  readonly frames: number;
  /** current frame (after the last renderFrame) */
  readonly frame: number;
  /** true if renderFrame(i) works for any i in any order */
  readonly seekable: boolean;
  /** draw frame i. Non-seekable scenes must be driven forward; use snapshot/restore to jump back. */
  renderFrame(ctx: Ctx, i: number): void;
  /** opaque copy of the complete state (sim + visual layers) at the current frame */
  snapshot?(): unknown;
  restore?(s: unknown): void;
  /** physics / accuracy diagnostics (printed by the renderer, asserted by tests) */
  diagnostics?(): Record<string, unknown>;
  /** state vector for cross-runtime parity hashing */
  stateVector?(): number[];
}

export interface SceneModule {
  meta: SceneMeta;
  schema: Schema;
  create(env: Env, params: Params): SceneInstance;
  /** procedural soundtrack for the whole video (pure function of params) */
  audio(params: Params): Mix;
  /** the on-screen question used when the "Hook / title" parameter is left empty (varies with rule and seed) */
  hook?(params: Params): string;
}

export const frameCount = (params: Params, fps: number) => Math.round(Number(params.duration) * fps);
