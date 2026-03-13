/**
 * AudioAnalyzer: Essentia.js-based audio analysis for BPM, Chord, and Key detection.
 *
 * Replaces the custom BpmDetector, ChordDetector, and KeyDetector implementations
 * with the Essentia.js WASM-based algorithms for improved accuracy.
 *
 * Note: Production analysis runs entirely inside AudioAnalysisWorker (Web Worker).
 * The functions here remain for unit-testing purposes via the `_setEssentia` injection
 * helper, which avoids loading the WASM binary in test environments.
 */
import { processChordFrames } from './chordUtils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EssentiaClass = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EssentiaInstance = any;

/** Chord information with start time */
export interface ChordInfo {
  time: number;  // seconds from start
  chord: string; // e.g. "Am", "C", "G", "F#m"
}

// Singleton Essentia instance
let _essentia: EssentiaInstance | null = null;
let _initPromise: Promise<EssentiaInstance> | null = null;

/**
 * Lazily initialise Essentia WASM backend (singleton).
 * Subsequent calls return the same instance without re-initialising.
 */
export async function getEssentia(): Promise<EssentiaInstance> {
  if (_essentia) return _essentia;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Load ESM builds directly to avoid CJS interop mismatches in Vite.
    const [coreModule, wasmModuleImport] = await Promise.all([
      import('essentia.js/dist/essentia.js-core.es.js'),
      import('essentia.js/dist/essentia-wasm.es.js')
    ]);

    const Essentia: EssentiaClass = coreModule.default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wasmModule: any = (wasmModuleImport as any).EssentiaWASM
      ?? (wasmModuleImport as any).default
      ?? wasmModuleImport;

    if (wasmModule && typeof wasmModule.then === 'function') {
      wasmModule = await wasmModule;
    }
    if (wasmModule?.ready && typeof wasmModule.ready.then === 'function') {
      await wasmModule.ready;
    }

    _essentia = new Essentia(wasmModule);
    console.log('[AudioAnalyzer] Essentia WASM ready, version:', _essentia.version);
    return _essentia;
  })();

  return _initPromise;
}

/**
 * Pre-warm the Essentia WASM backend so that the first track analysis
 * does not incur the initialisation overhead. Call this on app mount.
 */
export function warmupEssentia(): void {
  getEssentia().catch((err) =>
    console.error('[AudioAnalyzer] WASM warmup failed:', err)
  );
}

// For tests: allow injecting a mock Essentia instance
export function _setEssentia(instance: EssentiaInstance | null): void {
  _essentia = instance;
  _initPromise = null;
}

/**
 * Helper: convert AudioBuffer to mono VectorFloat for Essentia.
 */
function toMonoVector(essentia: EssentiaInstance, audioBuffer: AudioBuffer) {
  const mono = essentia.audioBufferToMonoSignal(audioBuffer);
  return essentia.arrayToVector(mono);
}

/**
 * Detect BPM using PercivalBpmEstimator (fast, designed for near-real-time use).
 *
 * Only the first 90 seconds of audio are used for efficiency.
 * @param audioBuffer - Web Audio API AudioBuffer
 * @returns BPM rounded to nearest integer, or 0 on error
 */
export async function analyzeBPM(audioBuffer: AudioBuffer): Promise<number> {
  const essentia = await getEssentia();
  const sampleRate = audioBuffer.sampleRate;

  // Truncate to first 90 s to reduce processing time and WASM memory
  const maxSamples = Math.min(audioBuffer.length, Math.floor(90 * sampleRate));
  const monoFull = essentia.audioBufferToMonoSignal(audioBuffer);
  const truncated = monoFull.subarray(0, maxSamples);
  const signal = essentia.arrayToVector(truncated);

  try {
    const result = essentia.PercivalBpmEstimator(
      signal,
      undefined, // frameSize default 1024
      undefined, // frameSizeOSS default 2048
      undefined, // hopSize default 128
      undefined, // hopSizeOSS default 128
      undefined, // maxBPM default 210
      undefined, // minBPM default 50
      sampleRate
    );
    return Math.round(result.bpm);
  } catch (err) {
    console.error('[AudioAnalyzer] BPM detection failed:', err);
    return 0;
  } finally {
    signal.delete();
  }
}

/**
 * Detect musical key using KeyExtractor (HPCP + Key algorithm).
 * Returns a localised string like "C メジャー" or "A マイナー".
 * @param audioBuffer - Web Audio API AudioBuffer
 * @returns Key string or empty string on error
 */
export async function analyzeKey(audioBuffer: AudioBuffer): Promise<string> {
  const essentia = await getEssentia();
  const signal = toMonoVector(essentia, audioBuffer);
  try {
    const result = essentia.KeyExtractor(signal);
    const scaleJa = result.scale === 'major' ? 'メジャー' : 'マイナー';
    return `${result.key} ${scaleJa}`;
  } catch (err) {
    console.error('[AudioAnalyzer] Key detection failed:', err);
    return '';
  } finally {
    signal.delete();
  }
}

/**
 * Detect chord progression using TonalExtractor (HPCP + ChordsDetection).
 *
 * Uses the internal 2-second window smoothing of ChordsDetection.
 * Consecutive duplicate chords and near-silent segments ("N") are merged.
 *
 * @param audioBuffer - Web Audio API AudioBuffer
 * @param minHoldSeconds - Minimum duration (seconds) before a chord change is
 *   reported. Shorter segments are merged into the previous chord.
 * @returns Array of ChordInfo sorted by time
 */
export async function analyzeChords(
  audioBuffer: AudioBuffer,
  minHoldSeconds = 1.0
): Promise<ChordInfo[]> {
  const essentia = await getEssentia();
  const sampleRate = audioBuffer.sampleRate;
  const signal = toMonoVector(essentia, audioBuffer);

  try {
    // Use hopSize=4096 (default=2048) to halve the number of analysis frames
    // and reduce processing time for long tracks
    const hopSize = 4096;
    const result = essentia.TonalExtractor(signal, undefined, hopSize);

    const numFrames: number = result.chords_progression.size();
    const frames: string[] = Array.from({ length: numFrames }, (_, i) => result.chords_progression.get(i) as string);

    return processChordFrames(frames, hopSize, sampleRate, minHoldSeconds);
  } catch (err) {
    console.error('[AudioAnalyzer] Chord detection failed:', err);
    return [];
  } finally {
    signal.delete();
  }
}

/**
 * Return the currently active chord for a given playback position.
 * Returns an empty string when no chord is active yet.
 *
 * @param chords - Sorted array of ChordInfo (from analyzeChords)
 * @param currentTime - Current playback position in seconds
 */
export function getCurrentChord(chords: ChordInfo[], currentTime: number): string {
  if (chords.length === 0) return '';

  let current = '';
  for (const c of chords) {
    if (c.time <= currentTime) {
      current = c.chord;
    } else {
      break;
    }
  }
  return current;
}
