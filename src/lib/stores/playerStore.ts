import { writable, get } from 'svelte/store';
import type { PlayerState, EQBands, LoopBookmark } from '../types';
import { EQ_FLAT } from '../types';
import { AudioEngine } from '../audio/AudioEngine';
import { getAudioFile, getTrackMeta, saveTrackMeta } from '../storage/db';
import { extractWaveformData } from '../audio/WaveformAnalyzer';
import { analyzeAudioInWorker, analyzeStructureInWorker } from '../audio/AudioAnalysisWorkerClient.js';
import { ANALYSIS_CACHE_VERSION } from '../audio/analysisConfig.js';
import { decodeWavStereo16 } from '../audio/wavUtils';
import type { WaveformData } from '../types';
import type { ChordInfo } from '../audio/AudioAnalyzer';

const EQ_STORAGE_KEY = 'mimiqplayer_eq';

function loadEQFromStorage(): EQBands {
  try {
    const raw = localStorage.getItem(EQ_STORAGE_KEY);
    if (!raw) return [...EQ_FLAT];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 10 && parsed.every((v) => typeof v === 'number')) {
      return parsed as EQBands;
    }
  } catch {
    // ignore
  }
  return [...EQ_FLAT];
}

function saveEQToStorage(bands: EQBands): void {
  try {
    localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(bands));
  } catch {
    // ignore
  }
}

const engine = new AudioEngine();
// Apply saved EQ on startup
engine.setEQ(loadEQFromStorage());

/** Most recently loaded AudioBuffer — used for structure analysis */
let _currentAudioBuffer: AudioBuffer | null = null;

/** Active Wake Lock sentinel — prevents screen sleep during playback */
let wakeLock: WakeLockSentinel | null = null;
/** Tracked separately at module scope so the visibilitychange handler can read it */
let _isPlaying = false;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // ignore (e.g. page not visible)
  }
}
function releaseWakeLock() {
  if (wakeLock) {
    void wakeLock.release();
    wakeLock = null;
  }
}
// Re-acquire when the page becomes visible again after a background period
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _isPlaying) {
    void requestWakeLock();
  }
});

const initialState: PlayerState = {
  trackId: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  speed: 1.0,
  pitch: 0,
  volume: 1.0,
  abRepeat: { enabled: false, a: null, b: null },
};

function createPlayerStore() {
  const { subscribe, set, update } = writable<PlayerState>({ ...initialState });
  const waveform = writable<WaveformData | null>(null);
  const bpm = writable<number>(0);
  const key = writable<string>('');
  const eq = writable<EQBands>(loadEQFromStorage());
  const bookmarks = writable<LoopBookmark[]>([]);
  const chords = writable<ChordInfo[]>([]);

  // A-B repeat check
  let abCheckInterval: ReturnType<typeof setInterval> | null = null;

  function startABCheck() {
    stopABCheck();
    abCheckInterval = setInterval(() => {
      const state = get({ subscribe });
      if (state.abRepeat.enabled && state.abRepeat.b !== null) {
        const currentTime = engine.currentTime;
        if (currentTime >= state.abRepeat.b) {
          engine.seek(state.abRepeat.a ?? 0);
        }
      }
    }, 50);
  }

  function stopABCheck() {
    if (abCheckInterval !== null) {
      clearInterval(abCheckInterval);
      abCheckInterval = null;
    }
  }

  // Set up engine callbacks
  engine.onProgress((currentTime, duration) => {
    update((s) => ({ ...s, currentTime, duration }));
  });

  engine.onPlaybackEnded(() => {
    update((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
    stopABCheck();
    _isPlaying = false;
    releaseWakeLock();
  });

  return {
    subscribe,
    waveform,
    bpm,
    key,
    eq,
    bookmarks,
    chords,
    engine,

    /** Load and play a track */
    async loadTrack(trackId: string) {
      const file = await getAudioFile(trackId);
      if (!file) return;

      const audioBuffer = await engine.loadAudio(file.data);
      _currentAudioBuffer = audioBuffer;
      const waveformData = extractWaveformData(audioBuffer);
      waveform.set(waveformData);

      update((s) => ({
        ...s,
        trackId,
        currentTime: 0,
        duration: audioBuffer.duration,
        isPlaying: false,
        abRepeat: { enabled: false, a: null, b: null },
      }));

      const isCurrentTrack = () => get({ subscribe }).trackId === trackId;

      // Load metadata in background and restore cached values first
      void (async () => {
        const meta = await getTrackMeta(trackId);
        if (!isCurrentTrack()) return;

        bookmarks.set(meta?.bookmarks ?? []);

        // Restore per-track EQ (fallback to global localStorage value, then flat)
        const savedEQ = meta?.eq ?? loadEQFromStorage();
        engine.setEQ(savedEQ);
        eq.set(savedEQ);

        const isAnalysisCacheCurrent = meta?.analysisVersion === ANALYSIS_CACHE_VERSION;
        const hasCachedBpm = isAnalysisCacheCurrent && typeof meta?.bpm === 'number';
        const hasCachedKey = isAnalysisCacheCurrent && typeof meta?.key === 'string' && meta.key.length > 0;
        const hasCachedChords = isAnalysisCacheCurrent && Array.isArray(meta?.chords) && meta.chords.length > 0;

        bpm.set(hasCachedBpm ? (meta?.bpm ?? 0) : 0);
        key.set(hasCachedKey ? (meta?.key ?? '') : '');
        chords.set(hasCachedChords ? (meta?.chords ?? []) : []);

        // If any analysis cache is missing, run worker analysis and persist all results.
        if (hasCachedBpm && hasCachedKey && hasCachedChords) return;

        setTimeout(() => {
          void analyzeAudioInWorker(audioBuffer)
            .then(async (detected) => {
              if (!isCurrentTrack()) return;

              bpm.set(detected.bpm);
              key.set(detected.key);
              chords.set(detected.chords);

              const latestMeta = await getTrackMeta(trackId);
              if (!latestMeta) return;

              await saveTrackMeta({
                ...latestMeta,
                analysisVersion: ANALYSIS_CACHE_VERSION,
                bpm: detected.bpm,
                key: detected.key,
                chords: detected.chords,
              });
            })
            .catch(() => {
              if (!isCurrentTrack()) return;
              bpm.set(0);
              key.set('');
              chords.set([]);
            });
        }, 0);
      })();
    },

    /**
     * Re-run audio analysis using a stem mix optimised for harmony.
     * Uses: bass (x1.0) + piano (x0.5) + guitar (x0.5), or vocals if those
     * stems are unavailable (4-stem model).
     * Called after stem separation for more accurate chord / key analysis.
     */
    async reAnalyzeWithStem(
      trackId: string,
      stems: Partial<Record<string, ArrayBuffer>>,
    ): Promise<void> {
      const isCurrentTrack = () => get({ subscribe }).trackId === trackId;
      if (!isCurrentTrack()) return;

      // Build a harmony-focused mix: bass + piano 50% + guitar 50%
      // Fallback to vocals if the 6-stem mix is not available.
      const harmonyStemBuffers: Array<{ buf: ArrayBuffer; gain: number }> = [];
      if (stems.bass)   harmonyStemBuffers.push({ buf: stems.bass,   gain: 1.0 });
      if (stems.piano)  harmonyStemBuffers.push({ buf: stems.piano,  gain: 0.5 });
      if (stems.guitar) harmonyStemBuffers.push({ buf: stems.guitar, gain: 0.5 });

      // Fall back to vocals if no harmony stems are present (4-stem model)
      const fallbackBuf = harmonyStemBuffers.length === 0 ? stems.vocals : null;
      const wavBuf = fallbackBuf ?? null;

      let stemBuffer: AudioBuffer;
      const ctx = new AudioContext();
      try {
        if (harmonyStemBuffers.length > 0) {
          // Decode each stem and mix them into a single AudioBuffer
          const decoded = await Promise.all(
            harmonyStemBuffers.map(async ({ buf, gain }) => ({ pcm: decodeWavStereo16(buf), gain }))
          );
          const length = decoded[0].pcm.left.length;
          const mixLeft  = new Float32Array(length);
          const mixRight = new Float32Array(length);
          for (const { pcm, gain } of decoded) {
            for (let i = 0; i < length; i++) {
              mixLeft[i]  += pcm.left[i]  * gain;
              mixRight[i] += pcm.right[i] * gain;
            }
          }
          stemBuffer = ctx.createBuffer(2, length, 44100);
          stemBuffer.copyToChannel(mixLeft,  0);
          stemBuffer.copyToChannel(mixRight, 1);
        } else if (wavBuf) {
          stemBuffer = await ctx.decodeAudioData(wavBuf.slice(0));
        } else {
          return; // no usable stems
        }
      } finally {
        await ctx.close();
      }

      if (!isCurrentTrack()) return;

      const detected = await analyzeAudioInWorker(stemBuffer);
      if (!isCurrentTrack()) return;

      bpm.set(detected.bpm);
      key.set(detected.key);
      chords.set(detected.chords);

      // Overwrite cached analysis with stem-based results
      const meta = await getTrackMeta(trackId);
      if (meta) {
        await saveTrackMeta({
          ...meta,
          analysisVersion: ANALYSIS_CACHE_VERSION,
          bpm: detected.bpm,
          key: detected.key,
          chords: detected.chords,
        });
      }
    },

    play() {
      engine.play();
      update((s) => ({ ...s, isPlaying: true }));
      startABCheck();
      _isPlaying = true;
      void requestWakeLock();
    },

    pause() {
      engine.pause();
      update((s) => ({ ...s, isPlaying: false }));
      _isPlaying = false;
      releaseWakeLock();
    },

    togglePlay() {
      const state = get({ subscribe });
      if (state.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    stop() {
      engine.stop();
      update((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
      stopABCheck();
      _isPlaying = false;
      releaseWakeLock();
    },

    seek(time: number) {
      engine.seek(time);
      update((s) => ({ ...s, currentTime: time }));
    },

    skip(seconds: number) {
      const state = get({ subscribe });
      const newTime = Math.max(0, Math.min(state.duration, state.currentTime + seconds));
      this.seek(newTime);
    },

    setSpeed(speed: number) {
      engine.setSpeed(speed);
      update((s) => ({ ...s, speed }));
    },

    setPitch(semitones: number) {
      engine.setPitch(semitones);
      update((s) => ({ ...s, pitch: semitones }));
    },

    setVolume(volume: number) {
      engine.setVolume(volume);
      update((s) => ({ ...s, volume }));
    },

    setEQ(bands: EQBands) {
      engine.setEQ(bands);
      eq.set([...bands] as EQBands);
      saveEQToStorage(bands);
      // Also persist per-track to DB
      const state = get({ subscribe });
      if (state.trackId) {
        void getTrackMeta(state.trackId).then((meta) => {
          if (!meta) return;
          return saveTrackMeta({ ...meta, eq: [...bands] as EQBands });
        });
      }
    },

    // Bookmarks
    async saveBookmark(label: string) {
      const state = get({ subscribe });
      const { a, b } = state.abRepeat;
      if (a === null || b === null) return;

      // Disallow duplicate A-B range
      const current = get(bookmarks);
      const isDuplicate = current.some((bm) => bm.a === a && bm.b === b);
      if (isDuplicate) return;

      const bookmark: LoopBookmark = {
        id: `bm-${Date.now()}`,
        label,
        a,
        b,
      };

      const next = [...current, bookmark];
      bookmarks.set(next);

      // Persist to DB
      if (state.trackId) {
        const meta = await getTrackMeta(state.trackId);
        if (meta) {
          await saveTrackMeta({ ...meta, bookmarks: next });
        }
      }
    },

    async deleteBookmark(id: string) {
      const state = get({ subscribe });
      const current = get(bookmarks);
      const next = current.filter((b) => b.id !== id);
      bookmarks.set(next);

      if (state.trackId) {
        const meta = await getTrackMeta(state.trackId);
        if (meta) {
          await saveTrackMeta({ ...meta, bookmarks: next });
        }
      }
    },

    /**
     * Analyse the current track's structure (SSM + Foote novelty on HPCP)
     * and create loop bookmarks for each detected section.
     * Existing auto-generated bookmarks (id prefix "auto-") are replaced;
     * manually saved bookmarks are kept.
     */
    async autoBookmarks(): Promise<void> {
      const state = get({ subscribe });
      if (!state.trackId || !_currentAudioBuffer) return;

      const segments = await analyzeStructureInWorker(_currentAudioBuffer);

      const AUTO_PREFIX = 'auto-';
      const manual = get(bookmarks).filter((b) => !b.id.startsWith(AUTO_PREFIX));
      const generated: LoopBookmark[] = segments.map((seg, i) => ({
        id: `${AUTO_PREFIX}${seg.start.toFixed(2)}`,
        label: `セクション ${i + 1}`,
        a: seg.start,
        b: seg.end,
      }));

      const next = [...manual, ...generated];
      bookmarks.set(next);

      const meta = await getTrackMeta(state.trackId);
      if (meta) await saveTrackMeta({ ...meta, bookmarks: next });
    },

    async updateBookmark(id: string, label: string, a: number, b: number) {
      const state = get({ subscribe });
      const current = get(bookmarks);
      const next = current.map((bm) => {
        if (bm.id !== id) return bm;
        return { ...bm, label: label.trim() || bm.label, a, b };
      });
      bookmarks.set(next);

      if (state.trackId) {
        const meta = await getTrackMeta(state.trackId);
        if (meta) {
          await saveTrackMeta({ ...meta, bookmarks: next });
        }
      }
    },

    loadBookmark(bookmark: LoopBookmark) {
      update((s) => ({
        ...s,
        abRepeat: { enabled: true, a: bookmark.a, b: bookmark.b },
      }));
      engine.seek(bookmark.a);
    },

    async reorderBookmarks(next: LoopBookmark[]) {
      // Strip Svelte 5 reactive Proxy wrappers before writing to IDB
      const plain: LoopBookmark[] = next.map(({ id, label, a, b }) => ({ id, label, a, b }));
      bookmarks.set(plain);
      const state = get({ subscribe });
      if (state.trackId) {
        const meta = await getTrackMeta(state.trackId);
        if (meta) await saveTrackMeta({ ...meta, bookmarks: plain });
      }
    },

    // A-B Repeat
    setA() {
      const state = get({ subscribe });
      const time = state.currentTime;
      update((s) => {
        const b = s.abRepeat.b;
        // If A is set after existing B, swap them
        if (b !== null && time > b) {
          return {
            ...s,
            abRepeat: { enabled: true, a: b, b: time },
          };
        }
        return {
          ...s,
          abRepeat: { ...s.abRepeat, a: time, enabled: b !== null },
        };
      });
    },

    setB() {
      const state = get({ subscribe });
      const time = state.currentTime;
      update((s) => {
        // Toggle off if B is already set
        if (s.abRepeat.b !== null) {
          return {
            ...s,
            abRepeat: { ...s.abRepeat, b: null, enabled: false },
          };
        }
        const a = s.abRepeat.a;
        let bTime = time;
        // If B is before A, swap them
        if (a !== null && bTime < a) {
          return {
            ...s,
            abRepeat: { enabled: true, a: bTime, b: a },
          };
        }
        return {
          ...s,
          abRepeat: { ...s.abRepeat, b: bTime, enabled: a !== null },
        };
      });
    },

    toggleABRepeat() {
      update((s) => ({
        ...s,
        abRepeat: { ...s.abRepeat, enabled: !s.abRepeat.enabled },
      }));
    },

    clearAB() {
      update((s) => ({
        ...s,
        abRepeat: { enabled: false, a: null, b: null },
      }));
    },

  };
}

export const playerStore = createPlayerStore();
