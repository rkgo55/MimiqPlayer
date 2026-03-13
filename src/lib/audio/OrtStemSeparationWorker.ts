/**
 * Web Worker for stem separation using ONNX Runtime Web (WebGPU + WASM backend).
 *
 * Uses the same message protocol as StemSeparationClient.ts.
 *
 * Model: HTDemucs ONNX — smank/htdemucs-onnx on HuggingFace (MIT license)
 *   Input  shape: [1, 2, chunkSamples]      – stereo float32 @ 44 100 Hz
 *   Output shape: [1, stemCount, 2, chunkSamples]
 *
 * Long inputs are split into overlapping chunks:
 *   overlap = chunkSamples × 25 %
 *   stride  = chunkSamples × 75 %
 *
 * Each chunk is blended with a Hann window (overlap-add synthesis).
 *
 * Execution provider priority: WebGPU → WASM (ORT handles the fallback
 * automatically; GPU availability is probed beforehand to inform the UI).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

// WebGPU EP requires the /webgpu sub-path import of onnxruntime-web.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – subpath import; types come from onnxruntime-web root
import * as ort from 'onnxruntime-web/webgpu';

import type { StemType4, StemType6 } from '../types';

type StemType = StemType4 | StemType6;

// ── Message types (compatible with StemSeparationWorker.ts) ──────────────────

/** Messages sent FROM main thread TO this worker */
export type WorkerInMessage =
  | {
      type: 'separate';
      id: string;
      /** Left channel Float32Array @ 44 100 Hz */
      left: Float32Array;
      /** Right channel Float32Array @ 44 100 Hz */
      right: Float32Array;
      /** ONNX model URL (required; must be accessible by the browser) */
      modelUrl?: string;
      /** Cache key used to store/retrieve the model */
      modelCacheKey?: string;
      /** Number of stems this model outputs (4 or 6, default 4) */
      stemCount?: 4 | 6;
      /**
       * Fixed chunk size the ONNX model was exported with (in samples).
       * Defaults to DEFAULT_CHUNK_SAMPLES if not provided.
       * Must match the exported ONNX model's input shape dim[2].
       */
      chunkSamples?: number;
    }
  | { type: 'cancel'; id: string }
  | { type: 'check_model_cached'; id: string };

/** Messages sent FROM this worker TO main thread */
export type WorkerOutMessage =
  | { type: 'model_download'; id: string; progress: number; message: string }
  | { type: 'processing'; id: string; progress: number }
  | { type: 'result'; id: string; stems: Partial<Record<StemType, ArrayBuffer>> }
  | { type: 'error'; id: string; message: string }
  | { type: 'model_cache_status'; id: string; cached: boolean }
  /** Reports which execution provider ORT selected (sent once per model load) */
  | { type: 'backend_info'; backend: 'webgpu' | 'wasm' };

// ── Constants ─────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 44_100;
/**
 * Default chunk size in samples for inference.
 * Must match the ONNX model's fixed input dimension (dim 2 of "mix").
 * Override per-request via WorkerInMessage.chunkSamples.
 *
 * This value is a fallback only; the caller (stemStore) should always pass
 * the correct chunkSamples from the OnnxModelOption metadata.
 */
const DEFAULT_CHUNK_SAMPLES = 343_980; // 7.8 s @ 44100 Hz (smank/htdemucs-onnx segment)
/** Overlap fraction for overlap-add synthesis (25 % of chunk) */
const OLA_OVERLAP_RATIO = 0.25;

const MODEL_CACHE_NAME = 'demucs-weights';
/** Default cache key for the ONNX model (overridden per-request via modelCacheKey) */
const DEFAULT_MODEL_CACHE_KEY = 'htdemucs.onnx';

// Demucs output order (same as StemSeparationWorker.ts)
const STEM_ORDER_4: StemType4[] = ['drums', 'bass', 'other', 'vocals'];
const STEM_ORDER_6: StemType6[] = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];

// ── ORT environment initialisation ───────────────────────────────────────────

// Set WASM binary paths before any session is created.
// vite-plugin-static-copy places them at the app's BASE_URL root.
ort.env.wasm.wasmPaths = import.meta.env.BASE_URL;
// Suppress ORT's "Some nodes not assigned to preferred EP" advisory warnings.
// These are expected for WebGPU — unsupported ops silently fall back to WASM.
ort.env.logLevel = 'error';

// ── Model weight cache (same logic as StemSeparationWorker.ts) ───────────────

async function loadModelWeights(
  id: string,
  modelUrl: string,
  cacheKey: string,
): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (cached) {
      self.postMessage({
        type: 'model_download',
        id,
        progress: 100,
        message: 'モデルキャッシュ済み',
      } satisfies WorkerOutMessage);
      return cached.arrayBuffer();
    }
  } catch { /* Cache API unavailable */ }

  self.postMessage({
    type: 'model_download',
    id,
    progress: 0,
    message: 'モデルをダウンロード中…',
  } satisfies WorkerOutMessage);

  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`モデルのダウンロードに失敗: ${response.status}`);

  const contentLength = Number(response.headers.get('Content-Length') ?? 0);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const progress = contentLength > 0 ? Math.round((received / contentLength) * 100) : -1;
    self.postMessage({
      type: 'model_download',
      id,
      progress,
      message:
        contentLength > 0
          ? `モデルをダウンロード中… ${progress}%  (${(received / 1024 / 1024).toFixed(0)}/${(contentLength / 1024 / 1024).toFixed(0)} MB)`
          : `モデルをダウンロード中… ${(received / 1024 / 1024).toFixed(0)} MB`,
    } satisfies WorkerOutMessage);
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.length; }

  try {
    if (cache) {
      await cache.put(
        cacheKey,
        new Response(buf.buffer.slice(0), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
      );
    }
  } catch { /* Ignore cache write errors */ }

  self.postMessage({
    type: 'model_download',
    id,
    progress: 100,
    message: 'モデルのダウンロード完了',
  } satisfies WorkerOutMessage);
  return buf.buffer;
}

// ── ORT session management (singleton per worker instance) ──────────────────

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let lastModelCacheKey: string | null = null;
let detectedBackend: 'webgpu' | 'wasm' = 'wasm';
/** Last cache key seen from a 'separate' message — used by check_model_cached */
let knownCacheKey: string = DEFAULT_MODEL_CACHE_KEY;

/**
 * Probe WebGPU availability before session creation so we can report the
 * backend to the UI immediately.  ORT itself handles the actual EP fallback.
 */
async function probeWebGpu(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = await (navigator as any).gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

async function getSession(modelData: ArrayBuffer, cacheKey: string): Promise<ort.InferenceSession> {
  // Re-create session if model changed
  if (sessionPromise && lastModelCacheKey !== cacheKey) {
    sessionPromise = null;
  }
  if (!sessionPromise) {
    lastModelCacheKey = cacheKey;
    sessionPromise = (async () => {
      const hasGpu = await probeWebGpu();
      detectedBackend = hasGpu ? 'webgpu' : 'wasm';

      const eps = hasGpu
        ? (['webgpu', 'wasm'] as ort.InferenceSession.ExecutionProviderConfig[])
        : (['wasm'] as ort.InferenceSession.ExecutionProviderConfig[]);

      // Note: `enableGraphCapture` cannot be used with dynamic-shape models
      // (htdemucs-onnx uses [1, 2, 'samples'] — the sample count varies per chunk).
      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: eps,
      };

      return ort.InferenceSession.create(modelData, sessionOptions);
    })();
  }
  return sessionPromise;
}

// ── WAV encoder (identical to StemSeparationWorker.ts) ──────────────────────

function encodeWavStereo(left: Float32Array, right: Float32Array): ArrayBuffer {
  const numSamples = left.length;
  const numChannels = 2;
  const bitsPerSample = 16;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  w(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true); off += 2;
    view.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true); off += 2;
  }
  return buf;
}

// ── Hann window ──────────────────────────────────────────────────────────────

function makeHannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

// ── Overlap-add inference ────────────────────────────────────────────────────

/**
 * Run the ONNX model on a full-length stereo signal using overlap-add (OLA)
 * synthesis to handle inputs longer than the model's fixed chunk size.
 *
 * @param session       ORT InferenceSession with fixed input [1, 2, chunkSamples]
 * @param leftFull      Left channel float32 array (any length)
 * @param rightFull     Right channel float32 array (same length)
 * @param chunkSamples  Fixed input length the ONNX model expects
 * @param stemCount     Number of stem outputs (4 or 6)
 * @param onProgress    Callback receiving chunk completion progress (0-100)
 * @returns             Array of Float32Arrays: [stemL0, stemR0, stemL1, stemR1, …]
 *                      in stem order (drums, bass, other, vocals [, guitar, piano])
 */
async function runOlaInference(
  session: ort.InferenceSession,
  leftFull: Float32Array,
  rightFull: Float32Array,
  chunkSamples: number,
  stemCount: number,
  onProgress: (progress: number) => void,
): Promise<Float32Array[]> {
  const N = leftFull.length;
  const overlapSamples = Math.round(chunkSamples * OLA_OVERLAP_RATIO);
  const stride = chunkSamples - overlapSamples;

  // Number of chunks needed to cover the entire signal
  const numChunks = Math.max(1, Math.ceil((N - overlapSamples) / stride));

  // Output accumulation buffers: 2 channels per stem (L and R)
  const outputChannels = stemCount * 2;
  const accum: Float32Array[] = Array.from({ length: outputChannels }, () => new Float32Array(N));
  const weights = new Float32Array(N);

  const hannWindow = makeHannWindow(chunkSamples);

  for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
    const start = chunkIdx * stride;
    const end = start + chunkSamples;

    // Extract chunk with zero-padding if it extends beyond the signal
    const chunkL = new Float32Array(chunkSamples);
    const chunkR = new Float32Array(chunkSamples);
    const copyLen = Math.min(chunkSamples, N - start);
    if (copyLen > 0) {
      chunkL.set(leftFull.subarray(start, start + copyLen));
      chunkR.set(rightFull.subarray(start, start + copyLen));
    }

    // Build ONNX input tensor: [1, 2, chunkSamples] interleaved
    const mixData = new Float32Array(2 * chunkSamples);
    mixData.set(chunkL, 0);
    mixData.set(chunkR, chunkSamples);
    const inputTensor = new ort.Tensor('float32', mixData, [1, 2, chunkSamples]);

    // Run inference
    const feeds: Record<string, ort.Tensor> = { mix: inputTensor };
    const results = await session.run(feeds);

    // ORT output name: 'sources' (smank/htdemucs-onnx) or 'stems' with shape [1, stemCount, 2, N]
    const stemTensor = results['sources'] ?? results['stems'] ?? Object.values(results)[0];
    const stemData = stemTensor.data as Float32Array;
    // Use actual output length (dims[3]) in case it differs from input chunkSamples
    const outLen = (stemTensor.dims[3] as number) ?? chunkSamples;

    // stemData layout: [1, S, 2, T] → stem s, channel c, sample t:
    //   index = (s * 2 + c) * outLen + t
    for (let s = 0; s < stemCount; s++) {
      for (let c = 0; c < 2; c++) {
        const srcOffset = (s * 2 + c) * outLen;
        const dstBuf = accum[s * 2 + c];
        const writeLen = Math.min(outLen, N - start);

        for (let t = 0; t < writeLen; t++) {
          dstBuf[start + t] += stemData[srcOffset + t] * hannWindow[t];
        }
      }
    }

    // Accumulate window weights for normalisation
    const wtLen = Math.min(outLen, N - start);
    for (let t = 0; t < wtLen; t++) {
      weights[start + t] += hannWindow[t];
    }

    onProgress(Math.round(((chunkIdx + 1) / numChunks) * 100));
    void end; // suppress unused-variable lint
  }

  // Normalise by accumulated weights (avoid divide-by-zero at edges)
  for (let ch = 0; ch < outputChannels; ch++) {
    for (let i = 0; i < N; i++) {
      if (weights[i] > 1e-8) accum[ch][i] /= weights[i];
    }
  }

  return accum;
}

// ── Main message handler ──────────────────────────────────────────────────────

self.addEventListener('message', async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  // ── check_model_cached ──────────────────────────────────────────────────
  if (msg.type === 'check_model_cached') {
    let cached = false;
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      cached = !!(await cache.match(knownCacheKey));
    } catch { /* ignore */ }
    self.postMessage({
      type: 'model_cache_status',
      id: msg.id,
      cached,
    } satisfies WorkerOutMessage);
    return;
  }

  if (msg.type !== 'separate') return;

  const {
    id,
    left,
    right,
    modelUrl,
    modelCacheKey = DEFAULT_MODEL_CACHE_KEY,
    stemCount = 4,
    chunkSamples = DEFAULT_CHUNK_SAMPLES,
  } = msg;
  // Remember cache key so check_model_cached can probe the right entry
  knownCacheKey = modelCacheKey;

  if (!modelUrl) {
    self.postMessage({
      type: 'error',
      id,
      message: 'ONNX モデルの URL が指定されていません。types.ts の ONNX_MODEL_OPTIONS を確認してください。',
    } satisfies WorkerOutMessage);
    return;
  }

  try {
    // 1. Download / retrieve model from Cache API
    const modelData = await loadModelWeights(id, modelUrl, modelCacheKey);

    // 2. Create (or reuse) ORT InferenceSession
    self.postMessage({ type: 'processing', id, progress: 0 } satisfies WorkerOutMessage);
    const session = await getSession(modelData, modelCacheKey);

    // Report backend once per session creation
    self.postMessage({ type: 'backend_info', backend: detectedBackend } satisfies WorkerOutMessage);

    self.postMessage({ type: 'processing', id, progress: 5 } satisfies WorkerOutMessage);

    // 3. Run overlap-add inference
    const channels = await runOlaInference(
      session,
      left,
      right,
      chunkSamples,
      stemCount,
      (chunkPct) => {
        // Map chunk progress (0-100) into overall progress (5-95)
        const overall = 5 + Math.round(chunkPct * 0.9);
        self.postMessage({ type: 'processing', id, progress: overall } satisfies WorkerOutMessage);
      },
    );

    self.postMessage({ type: 'processing', id, progress: 95 } satisfies WorkerOutMessage);

    // 4. Encode stems as stereo WAV ArrayBuffers
    const stemOrder: StemType[] = stemCount === 6 ? STEM_ORDER_6 : STEM_ORDER_4;
    const stems: Partial<Record<StemType, ArrayBuffer>> = {};
    const transfers: ArrayBuffer[] = [];

    for (let s = 0; s < stemCount; s++) {
      const stemL = channels[s * 2];
      const stemR = channels[s * 2 + 1];
      const wav = encodeWavStereo(stemL, stemR);
      stems[stemOrder[s]] = wav;
      transfers.push(wav);
    }

    self.postMessage(
      { type: 'result', id, stems } satisfies WorkerOutMessage,
      transfers,
    );
  } catch (err) {
    // If WebGPU session creation fails, clear the cached session so next
    // call retries (possibly falling back to WASM only).
    if (sessionPromise) {
      sessionPromise = null;
      lastModelCacheKey = null;
    }
    self.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOutMessage);
  }
});
