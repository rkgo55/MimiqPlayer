import { writable, get } from 'svelte/store';
import type { StemStatus, StemType, StemVolumes } from '../types';
import {
  STEM_TYPES,
  DEFAULT_STEM_VOLUMES,
  STEM_MODEL_OPTIONS,
} from '../types';
import {
  getAllStemFiles,
  saveStemFile,
  getTrackMeta,
  saveTrackMeta,
  getAudioFile,
  saveProcessingState,
  deleteProcessingState,
  getProcessingState,
} from '../storage/db';
import { StemSeparationClient } from '../audio/StemSeparationClient';
import type { StemResult } from '../audio/StemSeparationClient';
import { encodeWavStereo16, decodeWavStereo16 } from '../audio/wavUtils';
import { playerStore } from './playerStore';
import { trackStore } from './trackStore';
import { settingsStore } from './settingsStore';
import { getApiClient } from '../audio/apiClient';

// ── Parallel segmentation constants ──────────────────────────────────────────
const SAMPLE_RATE = 44100;
/** Target chunk size for parallel processing (30 seconds) */
const SEG_SAMPLES = 30 * SAMPLE_RATE; // 1,323,000
/** Cross-fade overlap at each segment boundary (0.5 seconds) */
const OVERLAP_SAMPLES = Math.round(0.5 * SAMPLE_RATE); // 22,050
/** Minimum total samples to trigger parallel processing (>30.5 s) */
const PARALLEL_MIN_SAMPLES = SEG_SAMPLES + OVERLAP_SAMPLES;
/**
 * Maximum number of parallel workers, dynamically set from logical CPU count.
 * Capped at 8 to avoid over-subscription; minimum 2 for parallel benefit.
 */
const MAX_PARALLEL = Math.max(2, Math.min(8, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0) || 4));


export interface StemState {
  /** Separation status of the currently loaded track */
  status: StemStatus;
  /** Per-stem volume (0–1) */
  volumes: StemVolumes;
  /** Processing progress (0–100), only meaningful during model download */
  downloadProgress: number | null;
  /** Human-readable status message */
  message: string;
  /** Estimated remaining seconds (fake time-based, null when not processing) */
  remainingSeconds: number | null;
  /** Stem types actually loaded in the engine (null = none loaded) */
  loadedStems: StemType[] | null;
  /** Execution provider used by the ORT worker ('webgpu' | 'wasm' | null) */
  backend: 'webgpu' | 'wasm' | null;
}

const initialState: StemState = {
  status: 'none',
  volumes: { ...DEFAULT_STEM_VOLUMES },
  downloadProgress: null,
  message: '',
  remainingSeconds: null,
  loadedStems: null,
  backend: null,
};

function createStemStore() {
  const { subscribe, set, update } = writable<StemState>({ ...initialState });

  /** Load stems from IndexedDB into the AudioEngine for the given trackId */
  async function loadStemsIntoEngine(trackId: string): Promise<boolean> {
    const stemFiles = await getAllStemFiles(trackId);
    const hasAll = STEM_TYPES.every((s) => !!stemFiles[s]);
    if (!hasAll) return false;

    await playerStore.engine.loadStemsFromArrayBuffers(
      stemFiles as Record<StemType, ArrayBuffer>,
    );
    // Record which stems are now loaded in the engine
    const loaded = playerStore.engine.loadedStemTypes;
    update((s) => ({ ...s, loadedStems: loaded }));
    return true;
  }

  return {
    subscribe,

    /**
     * Called when a new track is loaded.
     * Checks whether stems already exist and loads them if so.
     */
    async onTrackLoaded(trackId: string): Promise<void> {
      // Reset to initial state first
      set({ ...initialState });

      const meta = await getTrackMeta(trackId);
      const savedVolumes: StemVolumes = { ...DEFAULT_STEM_VOLUMES, ...meta?.stemVolumes };

      if (meta?.stemStatus === 'ready') {
        // Attempt to load stems from storage
        const loaded = await loadStemsIntoEngine(trackId);
        if (loaded) {
          playerStore.engine.setStemVolumes(savedVolumes);
          // loadStemsIntoEngine already set loadedStems via update(); read it back
          const loadedStems = playerStore.engine.loadedStemTypes;
          set({
            status: 'ready',
            volumes: savedVolumes,
            downloadProgress: null,
            message: '',
            remainingSeconds: null,
            loadedStems,
            backend: null,
          });
          return;
        }
        // Stem files missing – treat as 'none' and let user re-separate
      }

      // If a previous separation was interrupted (e.g. page reload mid-process),
      // check whether the API is configured and can resume processing.
      const interruptedPS = await getProcessingState(`${trackId}:separate`);
      if (interruptedPS) {
        const apiSettings = get(settingsStore);
        if (apiSettings.apiEndpoint) {
          // API path: server may have completed or cached the result.
          // Status is currently 'none' (from initialState above), so the guard
          // in separate() will pass. separate() will poll until result arrives.
          void this.separate(trackId);
          return;
        }
        // Browser ONNX path: worker is gone; clean up so user can start fresh.
        await deleteProcessingState(`${trackId}:separate`);
      }

      set({ ...initialState, volumes: savedVolumes });
    },

    /**
     * Start stem separation for the given trackId.
     * Guard: if already processing, return immediately.
     */
    async separate(trackId: string): Promise<void> {
      // Per-track guard: skip if already processing
      if (get({ subscribe }).status === 'processing') return;

      const engine = playerStore.engine;
      const audioBuf = engine.getAudioBuffer();
      if (!audioBuf) return;

      update((s) => ({ ...s, status: 'processing', message: 'ステム分離中…', downloadProgress: null }));
      await saveProcessingState({ id: `${trackId}:separate`, trackId, tool: 'separate', startedAt: Date.now() });

      // ── API path (modal.com server) ────────────────────────────────────────
      const apiSettings = get(settingsStore);
      if (apiSettings.apiEndpoint) {
        try {
          update((s) => ({
            ...s,
            message: 'API でステム分離中…',
            downloadProgress: null,
          }));

          const audioFile = await getAudioFile(trackId);
          if (!audioFile) throw new Error('Audio file not found');

          const client = getApiClient(apiSettings.apiEndpoint, apiSettings.apiKey);
          const trackMeta = await getTrackMeta(trackId);
          const res = await client.separate(audioFile.data, trackMeta?.contentHash);

          // Save binary OGG stems to IndexedDB
          for (const [stemName, buf] of Object.entries(res.stems)) {
            if (buf) {
              await saveStemFile(trackId, stemName as StemType, buf);
            }
          }

          // Update track meta
          const meta = await getTrackMeta(trackId);
          if (meta) {
            await saveTrackMeta({ ...meta, stemStatus: 'ready' });
          }

          // Guard: skip engine load/state update if track changed
          if (get(playerStore).trackId !== trackId) return;

          // Load into engine
          await loadStemsIntoEngine(trackId);
          const currentState = get({ subscribe });
          engine.setStemVolumes(currentState.volumes);

          update((s) => ({ ...s, status: 'ready', message: '', downloadProgress: null }));
          await deleteProcessingState(`${trackId}:separate`);
        } catch (err) {
          console.error('[StemStore] API separation failed:', err);
          update((s) => ({
            ...s,
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
            downloadProgress: null,
          }));
          await deleteProcessingState(`${trackId}:separate`);
        }
        return;
      }

      // ── Browser (ONNX / WebGPU) fallback path ────────────────────────────── 

      // Estimate segment count early (before extractStereo44k) so we can show
      // "ステム分離中 (0 / N セグメント完了)" immediately for long tracks.
      const estimatedSamples = Math.round(audioBuf.duration * SAMPLE_RATE);
      const estimatedSegCount = estimatedSamples <= PARALLEL_MIN_SAMPLES
        ? 1
        : Math.ceil(estimatedSamples / SEG_SAMPLES);
      if (estimatedSegCount > 1) {
        update((s) => ({
          ...s,
          message: `ステム分離中 (0 / ${estimatedSegCount} セグメント完了)`,
        }));
      }

      // Resample to stereo 44 100 Hz (required by the demucs WASM engine)
      const { left, right } = await extractStereo44k(audioBuf);

      const segments = segmentAudio(left, right);
      const useParallel = segments.length > 1;

      const client = StemSeparationClient.getInstance();

      // Read model config from settings
      const settings = get(settingsStore);
      const modelOpt = STEM_MODEL_OPTIONS.find((m) => m.id === settings.stemModel)
        ?? STEM_MODEL_OPTIONS[0];
      const modelUrl = modelOpt.url;
      const modelCacheKey = modelOpt.cacheKey;
      const stemCount = modelOpt.stemCount;
      const chunkSamples = modelOpt.chunkSamples;

      // Flag: once batch processing starts, suppress model_download messages so
      // they don't override the "X / N セグメント完了" progress message.
      let suppressModelDownloadMsg = false;

      // Listen to model download progress from the singleton worker
      const unsubscribe = client.onModelDownload((message, progress) => {
        if (suppressModelDownloadMsg) return;
        const pct = progress !== undefined && progress >= 0 ? progress : null;
        update((s) => ({ ...s, message, downloadProgress: pct }));
      });

      // Listen to backend selection (WebGPU vs WASM) from the ORT worker
      const unsubscribeBackend = client.onBackendInfo((backend) => {
        update((s) => ({ ...s, backend }));
      });

      // ── Fake time-based progress bar ────────────────────────────────────────
      // Estimate total wall time based on segment count and parallelism.
      // ~100s per 30-second segment at 1 worker; scales with parallel batches.
      // Model download (first use) adds ~40s.
      // Progress moves from 0% to 95% over the estimate; snaps to 100% when done.
      let progressIntervalId: ReturnType<typeof setInterval> | null = null;
      const startFakeProgress = (estimatedSeconds: number) => {
        const t0 = Date.now();
        progressIntervalId = setInterval(() => {
          const elapsed = (Date.now() - t0) / 1000;
          // Asymptotic: reaches ~95% at estimatedSeconds
          const progress = Math.min(95, Math.round((elapsed / estimatedSeconds) * 100));
          const remaining = Math.max(0, Math.round(estimatedSeconds - elapsed));
          update((s) =>
            s.status === 'processing'
              ? { ...s, downloadProgress: progress, remainingSeconds: remaining }
              : s,
          );
        }, 800);
      };
      const stopFakeProgress = () => {
        if (progressIntervalId !== null) {
          clearInterval(progressIntervalId);
          progressIntervalId = null;
        }
        update((s) => ({ ...s, remainingSeconds: null }));
      };

      try {
        let resultStems: Partial<Record<StemType, ArrayBuffer>>;

        if (!useParallel) {
          // ── Single-segment path (≤ 30.5 s) ──────────────────────────────
          // Estimate ~100s for model cached + ~140s for first download
          const isModelCachedSingle = await client.isModelCached();
          const singleEstimate = isModelCachedSingle ? 100 : 140;
          suppressModelDownloadMsg = isModelCachedSingle;
          startFakeProgress(singleEstimate);
          update((s) => ({ ...s, message: 'ステム分離中…' }));

          const result = await client.separate(trackId, left, right, {
            onProcessing: () => {
              update((s) => ({
                ...s,
                message: 'ステム分離中…',
              }));
            },
            modelUrl,
            modelCacheKey,
            stemCount,
            chunkSamples,
          });
          resultStems = result.stems;
        } else {
          // ── Parallel multi-segment path ──────────────────────────────────
          const totalSegs = segments.length;
          const completed = new Array<boolean>(totalSegs).fill(false);
          const t0 = performance.now();
          const segStartTimes: number[] = new Array(totalSegs).fill(0);
          const segEndTimes: number[] = new Array(totalSegs).fill(0);

          console.log(`[StemStore] parallel: ${totalSegs} segments, MAX_PARALLEL=${MAX_PARALLEL}`);

          const updateSegProgress = () => {
            const done = completed.filter(Boolean).length;
            update((s) => ({
              ...s,
              message: `ステム分離中 (${done} / ${totalSegs} セグメント完了)`,
              // downloadProgress is managed by the fake progress interval
            }));
          };

          update((s) => ({
            ...s,
            message: `ステム分離中 (0 / ${totalSegs} セグメント完了)`,
          }));

          const allResults: StemResult[] = new Array(totalSegs);

          // If the model is not yet cached, process segment 0 alone first so
          // it can download and cache the weights before additional Workers
          // start.  This avoids N Workers downloading 81 MB in parallel on
          // first use.
          const isModelCached = await client.isModelCached();
          let firstBatchStart = 0;

          if (!isModelCached && totalSegs > 1) {
            console.log('[StemStore] model not cached — processing seg0 first to prime cache');
            const seg0 = segments[0];
            segStartTimes[0] = performance.now();
            const firstResult = await client.separate(
              `${trackId}-seg0`,
              seg0.left,
              seg0.right,
              {
                onModelDownload: (msg, prog) => {
                  const pct = prog !== undefined && prog >= 0 ? prog : null;
                  update((s) => ({ ...s, message: msg, downloadProgress: pct }));
                },
                modelUrl,
                modelCacheKey,
                stemCount,
                chunkSamples,
              },
            );
            segEndTimes[0] = performance.now();
            console.log(`[StemStore] seg0 done in ${((segEndTimes[0] - segStartTimes[0]) / 1000).toFixed(1)}s`);
            allResults[0] = firstResult;
            completed[0] = true;
            updateSegProgress();
            firstBatchStart = 1; // Remaining segments start from index 1
          }

          // Process remaining segments in parallel batches of MAX_PARALLEL
          // Start fake time-based progress bar now (model is cached at this point
          // whether we downloaded it via seg0 or it was already cached).
          const numRemainingBatches = Math.ceil((totalSegs - firstBatchStart) / MAX_PARALLEL);
          const estimatedRemainingSeconds = numRemainingBatches * 110;
          suppressModelDownloadMsg = true;
          startFakeProgress(estimatedRemainingSeconds);
          update((s) => ({
            ...s,
            message: `ステム分離中 (${completed.filter(Boolean).length} / ${totalSegs} セグメント完了)`,
          }));

          for (let batchStart = firstBatchStart; batchStart < totalSegs; batchStart += MAX_PARALLEL) {
            const batchEnd = Math.min(batchStart + MAX_PARALLEL, totalSegs);
            const batch: Array<Promise<void>> = [];
            const batchClients: StemSeparationClient[] = [];
            const batchT0 = performance.now();
            console.log(`[StemStore] batch segs ${batchStart}..${batchEnd - 1} start`);

            for (let j = batchStart; j < batchEnd; j++) {
              const seg = segments[j];
              // In the cached path (firstBatchStart=0): reuse singleton for j=0.
              // In the uncached path (firstBatchStart=1): all remaining segments
              // use fresh workers because the singleton already handled seg 0.
              const segClient =
                firstBatchStart === 0 && j === 0
                  ? client
                  : StemSeparationClient.createNew();
              if (segClient !== client) batchClients.push(segClient);
              const segIdx = j;
              segStartTimes[segIdx] = performance.now();

              batch.push(
                segClient
                  .separate(`${trackId}-seg${segIdx}`, seg.left, seg.right, { modelUrl, modelCacheKey, stemCount, chunkSamples })
                  .then((result) => {
                    segEndTimes[segIdx] = performance.now();
                    const took = ((segEndTimes[segIdx] - segStartTimes[segIdx]) / 1000).toFixed(1);
                    const wall = ((segEndTimes[segIdx] - t0) / 1000).toFixed(1);
                    console.log(`[StemStore] seg${segIdx} done in ${took}s (wall +${wall}s)`);
                    allResults[segIdx] = result;
                    completed[segIdx] = true;
                    updateSegProgress();
                  }),
              );
            }

            await Promise.all(batch);
            console.log(`[StemStore] batch ${batchStart}..${batchEnd - 1} done in ${((performance.now() - batchT0) / 1000).toFixed(1)}s`);

            // Terminate non-singleton workers after each batch
            for (const c of batchClients) c.terminate();
          }

          console.log(`[StemStore] all ${totalSegs} segments done in ${((performance.now() - t0) / 1000).toFixed(1)}s total`);
          // Check overlap: if max(segEndTimes) - min(segStartTimes) < sum(individual times), parallelism worked
          const activeTimes = Array.from({ length: totalSegs }, (_, i) => segEndTimes[i] - segStartTimes[i]);
          const wallTime = performance.now() - t0;
          const serialTime = activeTimes.reduce((a, b) => a + b, 0);
          console.log(`[StemStore] wall=${(wallTime / 1000).toFixed(1)}s, serial_sum=${(serialTime / 1000).toFixed(1)}s, speedup=${(serialTime / wallTime).toFixed(2)}x`);
          console.log('[StemStore] per-segment times (ms):', activeTimes.map((t) => Math.round(t)).join(', '));

          // Merge all segments with cross-fade at boundaries
          const mergeT0 = performance.now();
          resultStems = mergeStemSegments(segments, allResults, left.length);
          console.log(`[StemStore] merge done in ${((performance.now() - mergeT0) / 1000).toFixed(2)}s`);
        }

        // Save each stem to IndexedDB (handles both 4-stem and 6-stem results)
        for (const [stem, buf] of Object.entries(resultStems) as [StemType, ArrayBuffer][]) {
          if (buf) await saveStemFile(trackId, stem, buf);
        }

        // Update track metadata
        const meta = await getTrackMeta(trackId);
        if (meta) {
          const currentState = get({ subscribe });
          await saveTrackMeta({
            ...meta,
            stemStatus: 'ready',
            stemVolumes: currentState.volumes,
          });
        }

        // Update the in-memory track list
        trackStore.updateStemStatus(trackId, 'ready');

        // Guard: skip engine load/state update if track changed
        if (get(playerStore).trackId !== trackId) {
          stopFakeProgress();
          return;
        }

        // Load into engine
        await loadStemsIntoEngine(trackId);
        const currentState = get({ subscribe });
        engine.setStemVolumes(currentState.volumes);

        stopFakeProgress();
        update((s) => ({ ...s, status: 'ready', message: '', downloadProgress: null }));
        await deleteProcessingState(`${trackId}:separate`);

        // Re-analyze chords/key/BPM using a harmony mix (bass + piano/guitar blend)
        void playerStore.reAnalyzeWithStem(trackId, resultStems);
      } catch (err) {
        console.error('[StemStore] separation failed:', err);
        stopFakeProgress();
        update((s) => ({
          ...s,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          downloadProgress: null,
        }));
        await deleteProcessingState(`${trackId}:separate`);
      } finally {
        unsubscribe();
        unsubscribeBackend();
      }
    },

    /** Update a single stem's volume */
    async setStemVolume(stem: StemType, volume: number, trackId: string | null): Promise<void> {
      playerStore.engine.setStemVolume(stem, volume);
      update((s) => ({
        ...s,
        volumes: { ...s.volumes, [stem]: volume },
      }));

      // Persist to DB
      if (trackId) {
        const meta = await getTrackMeta(trackId);
        if (meta) {
          const state = get({ subscribe });
          await saveTrackMeta({ ...meta, stemVolumes: state.volumes });
        }
      }
    },

    /** Update a guitar/piano stem volume — persists just like any other stem */
    setStemVolumeExtra(stem: 'guitar' | 'piano', volume: number, trackId: string | null = null): void {
      void this.setStemVolume(stem, volume, trackId);
    },

    /** Reset all stem volumes to 1 */
    async resetVolumes(trackId: string | null): Promise<void> {
      const vols = { ...DEFAULT_STEM_VOLUMES };
      playerStore.engine.setStemVolumes(vols);
      update((s) => ({ ...s, volumes: vols }));

      if (trackId) {
        const meta = await getTrackMeta(trackId);
        if (meta) await saveTrackMeta({ ...meta, stemVolumes: vols });
      }
    },

    /** Clear stems from engine (revert to normal playback mode) */
    revertToNormal(): void {
      playerStore.engine.clearStems();
    },
  };
}

/** Resample an AudioBuffer to stereo 44 100 Hz Float32Arrays */
async function extractStereo44k(src: AudioBuffer): Promise<{ left: Float32Array; right: Float32Array }> {
  const TARGET_SR = 44100;
  const ratio = TARGET_SR / src.sampleRate;
  const targetLength = Math.ceil(src.length * ratio);
  const offCtx = new OfflineAudioContext(2, targetLength, TARGET_SR);
  const srcNode = offCtx.createBufferSource();
  srcNode.buffer = src;
  srcNode.connect(offCtx.destination);
  srcNode.start(0);
  const rendered = await offCtx.startRendering();
  const left = rendered.getChannelData(0).slice();
  const right = rendered.numberOfChannels > 1
    ? rendered.getChannelData(1).slice()
    : left.slice();
  return { left, right };
}

// ── Segment helpers ───────────────────────────────────────────────────────────


interface AudioSegment {
  /** Start position in the original audio (in samples) */
  startSample: number;
  /** Left channel audio for this segment (may extend up to OVERLAP_SAMPLES beyond startSample + SEG_SAMPLES) */
  left: Float32Array;
  /** Right channel audio for this segment */
  right: Float32Array;
}

/**
 * Split stereo audio into overlapping segments suitable for parallel demucs processing.
 *
 * Each segment except the last is extended by OVERLAP_SAMPLES beyond its nominal end
 * so that adjacent segments share an overlap region for cross-fade merging.
 *
 * Returns a single segment if the audio is short enough to process in one pass.
 */
function segmentAudio(left: Float32Array, right: Float32Array): AudioSegment[] {
  if (left.length <= PARALLEL_MIN_SAMPLES) {
    return [{ startSample: 0, left, right }];
  }

  const segments: AudioSegment[] = [];
  let start = 0;

  while (start < left.length) {
    // Extend by OVERLAP_SAMPLES unless this is the last segment
    const isLast = start + SEG_SAMPLES >= left.length;
    const end = isLast
      ? left.length
      : Math.min(start + SEG_SAMPLES + OVERLAP_SAMPLES, left.length);

    segments.push({
      startSample: start,
      left: left.slice(start, end),
      right: right.slice(start, end),
    });

    start += SEG_SAMPLES;
    if (start >= left.length) break;
  }

  return segments;
}

/**
 * Merge stem results from multiple parallel workers into a single set of WAV buffers.
 *
 * Adjacent segments are combined with a linear cross-fade over the OVERLAP_SAMPLES
 * region to minimise boundary artifacts.
 */
function mergeStemSegments(
  segments: AudioSegment[],
  results: StemResult[],
  totalSamples: number,
): Partial<Record<StemType, ArrayBuffer>> {
  // Determine which stems to merge from the first result
  const availableStems = Object.keys(results[0].stems) as StemType[];

  // Decode all segment WAVs first (avoids repeated decoding in the inner loop)
  const decoded = results.map((r) => {
    const d: Partial<Record<StemType, { left: Float32Array; right: Float32Array }>> = {};
    for (const stem of availableStems) {
      const buf = r.stems[stem];
      if (buf) d[stem] = decodeWavStereo16(buf);
    }
    return d;
  });

  // Allocate output buffers
  const out: Partial<Record<StemType, { left: Float32Array; right: Float32Array }>> = {};
  for (const stem of availableStems) {
    out[stem] = { left: new Float32Array(totalSamples), right: new Float32Array(totalSamples) };
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    for (const stem of availableStems) {
      const dec = decoded[i][stem];
      if (!dec) continue;
      const { left: segL, right: segR } = dec;
      const outCh = out[stem]!;

      // 1. Copy the non-overlapping portion (first SEG_SAMPLES of each segment)
      const copyLen = isLast ? segL.length : Math.min(SEG_SAMPLES, segL.length);
      outCh.left.set(segL.subarray(0, copyLen), seg.startSample);
      outCh.right.set(segR.subarray(0, copyLen), seg.startSample);

      // 2. Cross-fade with the head of segment i+1 in the overlap region
      if (!isLast && segL.length > SEG_SAMPLES) {
        const overlapLen = segL.length - SEG_SAMPLES;
        const next = decoded[i + 1][stem];
        if (next) {
          const { left: nextL, right: nextR } = next;
          const crossStart = seg.startSample + SEG_SAMPLES;

          for (let s = 0; s < overlapLen; s++) {
            const t = s / overlapLen;       // 0 → 1
            const fadeOut = 1 - t;          // 1 → 0
            outCh.left[crossStart + s]  = segL[SEG_SAMPLES + s] * fadeOut + nextL[s] * t;
            outCh.right[crossStart + s] = segR[SEG_SAMPLES + s] * fadeOut + nextR[s] * t;
          }
        }
      }
    }
  }

  // Re-encode to WAV
  const merged: Partial<Record<StemType, ArrayBuffer>> = {};
  for (const stem of availableStems) {
    const ch = out[stem];
    if (ch) merged[stem] = encodeWavStereo16(ch.left, ch.right);
  }
  return merged;
}

export const stemStore = createStemStore();
