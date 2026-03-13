/* eslint-disable no-restricted-globals */

import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import type { ChordInfo } from './AudioAnalyzer';
import { ANALYSIS_FILTERS } from './analysisConfig.js';
import { processChordFrames } from './chordUtils.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EssentiaInstance = any;

interface AnalyzeRequest {
  id: number;
  type: 'analyze';
  payload: {
    mono: Float32Array;
    sampleRate: number;
    minHoldSeconds?: number;
  };
}

interface WarmupRequest {
  id: number;
  type: 'warmup';
}

type WorkerRequest = AnalyzeRequest | WarmupRequest;

type WorkerResponse =
  | {
      id: number;
      type: 'result';
      payload: {
        bpm: number;
        key: string;
        chords: ChordInfo[];
      };
    }
  | {
      id: number;
      type: 'ok';
    }
  | {
      id: number;
      type: 'error';
      error: string;
    };

let essentia: EssentiaInstance | null = null;
let initPromise: Promise<EssentiaInstance> | null = null;

async function getEssentia(): Promise<EssentiaInstance> {
  if (essentia) return essentia;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let wasmModule: unknown = EssentiaWASM;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const maybeAny = wasmModule as any;

    if (maybeAny && typeof maybeAny.then === 'function') {
      wasmModule = await maybeAny;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ready = (wasmModule as any)?.ready;
    if (ready && typeof ready.then === 'function') {
      await ready;
    }

    essentia = new Essentia(wasmModule);
    return essentia;
  })();

  return initPromise;
}

function toVector(ess: EssentiaInstance, mono: Float32Array) {
  return ess.arrayToVector(mono);
}

function onePoleLowPass(input: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  if (cutoffHz <= 0 || cutoffHz >= sampleRate / 2) return input.slice();

  const output = new Float32Array(input.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);

  output[0] = input[0] ?? 0;
  for (let i = 1; i < input.length; i++) {
    output[i] = output[i - 1] + alpha * (input[i] - output[i - 1]);
  }

  return output;
}

function onePoleHighPass(input: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  if (cutoffHz <= 0) return input.slice();

  const output = new Float32Array(input.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + dt);

  output[0] = 0;
  for (let i = 1; i < input.length; i++) {
    output[i] = alpha * (output[i - 1] + input[i] - input[i - 1]);
  }

  return output;
}

function preprocessForBpm(mono: Float32Array, sampleRate: number): Float32Array {
  const highPassed = onePoleHighPass(mono, sampleRate, ANALYSIS_FILTERS.bpm.highPassHz);
  return onePoleLowPass(highPassed, sampleRate, ANALYSIS_FILTERS.bpm.lowPassHz);
}

function preprocessForTonal(mono: Float32Array, sampleRate: number): Float32Array {
  const highPassed = onePoleHighPass(mono, sampleRate, ANALYSIS_FILTERS.tonal.highPassHz);
  return onePoleLowPass(highPassed, sampleRate, ANALYSIS_FILTERS.tonal.lowPassHz);
}

function detectBpm(ess: EssentiaInstance, mono: Float32Array, sampleRate: number): number {
  const filtered = preprocessForBpm(mono, sampleRate);
  const signal = toVector(ess, filtered);
  try {
    const rhythm = ess.RhythmExtractor2013(
      signal,
      208,
      'multifeature',
      40
    );

    if (typeof rhythm?.bpm === 'number' && Number.isFinite(rhythm.bpm)) {
      return Math.round(rhythm.bpm);
    }

    const result = ess.PercivalBpmEstimator(signal, undefined, undefined, undefined, undefined, undefined, undefined, sampleRate);
    return Math.round(result.bpm);
  } catch {
    return 0;
  } finally {
    signal.delete();
  }
}

function detectKey(ess: EssentiaInstance, mono: Float32Array, sampleRate: number): string {
  const filtered = preprocessForTonal(mono, sampleRate);
  const signal = toVector(ess, filtered);
  try {
    let result;

    try {
      result = ess.KeyExtractor(
        signal,
        true,
        4096,
        2048,
        36,
        undefined,
        undefined,
        undefined,
        undefined,
        'edma'
      );
    } catch {
      result = ess.KeyExtractor(signal);
    }

    const scaleJa = result.scale === 'major' ? 'メジャー' : 'マイナー';
    return `${result.key} ${scaleJa}`;
  } catch {
    return '';
  } finally {
    signal.delete();
  }
}

function detectChords(
  ess: EssentiaInstance,
  mono: Float32Array,
  sampleRate: number,
  minHoldSeconds = 1.0
): ChordInfo[] {
  const filtered = preprocessForTonal(mono, sampleRate);
  const signal = toVector(ess, filtered);

  try {
    const hopSize = 2048;
    const result = ess.TonalExtractor(signal, undefined, hopSize);

    const numFrames: number = result.chords_progression.size();
    const frames: string[] = Array.from({ length: numFrames }, (_, i) => result.chords_progression.get(i) as string);

    return processChordFrames(frames, hopSize, sampleRate, minHoldSeconds);
  } catch {
    return [];
  } finally {
    signal.delete();
  }
}

async function analyze(mono: Float32Array, sampleRate: number, minHoldSeconds = 1.0) {
  const ess = await getEssentia();
  const bpm = detectBpm(ess, mono, sampleRate);
  const key = detectKey(ess, mono, sampleRate);
  const chords = detectChords(ess, mono, sampleRate, minHoldSeconds);
  return { bpm, key, chords };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void (async () => {
    const data = event.data;
    try {
      if (data.type === 'warmup') {
        await getEssentia();
        const response: WorkerResponse = { id: data.id, type: 'ok' };
        self.postMessage(response);
        return;
      }

      const result = await analyze(
        data.payload.mono,
        data.payload.sampleRate,
        data.payload.minHoldSeconds
      );

      const response: WorkerResponse = {
        id: data.id,
        type: 'result',
        payload: result,
      };
      self.postMessage(response);
    } catch (err) {
      const response: WorkerResponse = {
        id: data.id,
        type: 'error',
        error: err instanceof Error ? err.message : 'Unknown worker error',
      };
      self.postMessage(response);
    }
  })();
};
