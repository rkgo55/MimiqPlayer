import { writable, get } from 'svelte/store';
import type { PlayerState, EQBands, LoopBookmark } from '../types';
import { EQ_FLAT } from '../types';
import { AudioEngine } from '../audio/AudioEngine';
import { getAudioFile, saveAudioFile, getTrackMeta, saveTrackMeta, getStemFile, saveProcessingState, deleteProcessingState, deleteStemFiles } from '../storage/db';
import { extractWaveformData } from '../audio/WaveformAnalyzer';
import { analyzeAudioInWorker, analyzeStructureInWorker } from '../audio/AudioAnalysisWorkerClient.js';
import { ANALYSIS_CACHE_VERSION } from '../audio/analysisConfig.js';
import type { WaveformData } from '../types';
import type { ChordInfo } from '../audio/AudioAnalyzer';
import { settingsStore } from './settingsStore';
import { getApiClient, type StructureResponse } from '../audio/apiClient';
import { encodeWavStereo16 } from '../audio/wavUtils';

/** Per-track guard sets — prevents concurrent duplicate processing */
const _analyzingTracks = new Set<string>();
const _analyzingStructureTracks = new Set<string>();

/** Reactive stores so UI components can show spinners even after reload */
export const analyzingTrackId = writable<string | null>(null);
export const analyzingStructureTrackId = writable<string | null>(null);

/** Currently active bookmark — set when loadBookmark() is called, cleared on manual A/B edits */
export const activeBookmarkId = writable<string | null>(null);

/** Thrown by analyzeTrack / autoBookmarks when the track exceeds the API's 10-min limit */
export const AI_DURATION_LIMIT_ERROR = 'duration_limit';

/** Reactive trim selection (seconds) for the audio cutter */
export const trimStart = writable<number>(0);
export const trimEnd = writable<number | null>(null);

/** Check if any AI processing is currently active (used by beforeunload) */
export function isAnyProcessingActive(): boolean {
  return _analyzingTracks.size > 0 || _analyzingStructureTracks.size > 0;
}

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

/**
 * Register Media Session action handlers once.
 * These let the OS notification area / lock screen control playback.
 */
function setupMediaSession(store: ReturnType<typeof createPlayerStore>) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => store.play());
  navigator.mediaSession.setActionHandler('pause', () => store.pause());
  navigator.mediaSession.setActionHandler('stop', () => store.stop());
  navigator.mediaSession.setActionHandler('seekbackward', (details) =>
    store.skip(-(details.seekOffset ?? 10)),
  );
  navigator.mediaSession.setActionHandler('seekforward', (details) =>
    store.skip(details.seekOffset ?? 10),
  );
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime !== undefined) store.seek(details.seekTime);
  });
}

function updateMediaSessionPositionState(currentTime: number, duration: number, speed: number) {
  if (!('mediaSession' in navigator)) return;
  try {
    if (duration > 0 && currentTime <= duration) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: speed,
        position: currentTime,
      });
    }
  } catch {
    // Ignore: position state is best-effort
  }
}

/**
 * Convert a data URL to a Blob URL so Android Chrome can load it as
 * media notification artwork (data URLs are silently ignored on Android).
 * Returns null if the input is falsy.
 */
function dataUrlToObjectUrl(dataUrl: string): string {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** Currently active artwork Blob URL — revoke before creating a new one */
let _artworkObjectUrl: string | null = null;

function setMediaSessionMetadata(title: string, artist: string, album: string, coverArtDataUrl?: string) {
  if (!('mediaSession' in navigator)) return;
  // Revoke old blob URL to avoid leaking memory
  if (_artworkObjectUrl) {
    URL.revokeObjectURL(_artworkObjectUrl);
    _artworkObjectUrl = null;
  }
  let artwork: MediaImage[] = [];
  if (coverArtDataUrl) {
    try {
      _artworkObjectUrl = dataUrlToObjectUrl(coverArtDataUrl);
      artwork = [{ src: _artworkObjectUrl, sizes: '512x512', type: 'image/jpeg' }];
    } catch {
      // fall back to no artwork
    }
  }
  navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork });
}

/** Most recently loaded AudioBuffer — used for structure analysis */
let _currentAudioBuffer: AudioBuffer | null = null;
/** Cached track metadata for the currently loaded track — used to refresh Media Session on play() */
let _currentTrackMeta: { title: string; artist: string; album: string; coverArt?: string } | null = null;

/** Active Wake Lock sentinel — prevents screen sleep during playback */
let wakeLock: WakeLockSentinel | null = null;
/** Tracked separately at module scope so the visibilitychange handler can read it */
let _isPlaying = false;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (wakeLock && !wakeLock.released) return; // already held
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
/**
 * Acquire or release the wake lock based on current playing state and
 * the keepAwake setting. Call this whenever either changes.
 */
function syncWakeLock() {
  const { keepAwake } = get(settingsStore);
  if (keepAwake || _isPlaying) {
    void requestWakeLock();
  } else {
    releaseWakeLock();
  }
}
// Re-acquire when the page becomes visible again after a background period
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncWakeLock();
    if (_isPlaying) {
      // Resume AudioContext and flush SoundTouch buffers to prevent crackle noise
      void engine.handleForeground();
      // Re-set metadata and state — OS may have cleared them while backgrounded
      if (_currentTrackMeta) {
        setMediaSessionMetadata(
          _currentTrackMeta.title,
          _currentTrackMeta.artist,
          _currentTrackMeta.album,
          _currentTrackMeta.coverArt,
        );
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }
  }
});

// Sync wake lock whenever keepAwake setting changes
settingsStore.subscribe(() => syncWakeLock());

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
    updateMediaSessionPositionState(currentTime, duration, engine.speed);
  });

  engine.onPlaybackEnded(() => {
    update((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
    stopABCheck();
    _isPlaying = false;
    syncWakeLock();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
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
      // Reset trim handles whenever a new track is loaded
      trimStart.set(0);
      trimEnd.set(null);

      const isCurrentTrack = () => get({ subscribe }).trackId === trackId;

      // Load metadata in background and restore cached values first
      void (async () => {
        const meta = await getTrackMeta(trackId);
        if (!isCurrentTrack()) return;

        bookmarks.set(meta?.bookmarks ?? []);

        // Cache metadata and update Media Session.
        // Use a Blob URL for artwork so Android Chrome can show it in the notification.
        _currentTrackMeta = {
          title: meta?.title || '',
          artist: meta?.artist || '',
          album: meta?.album || '',
          coverArt: meta?.coverArt,
        };
        setMediaSessionMetadata(
          _currentTrackMeta.title,
          _currentTrackMeta.artist,
          _currentTrackMeta.album,
          _currentTrackMeta.coverArt,
        );

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

        // If any analysis cache is missing, run analysis and persist all results.
        if (hasCachedBpm && hasCachedKey && hasCachedChords) return;

        // Analysis is always triggered explicitly by the user via the Analyze
        // button in ChordDisplay. Skip auto-run regardless of whether the API
        // is configured, to avoid unexpected network requests or background CPU
        // usage on page load.
        return;
      })();
    },

    /**
     * Explicitly run BPM / key / chord analysis via the API (or browser worker).
     * Called when the user presses the Analyze button.
     * Per-track guard prevents concurrent duplicate processing.
     */
    async analyzeTrack(): Promise<void> {
      const currentTrackId = get({ subscribe }).trackId;
      if (!currentTrackId) return;
      if (_analyzingTracks.has(currentTrackId)) return;

      // Add guard immediately (before any await) to prevent concurrent duplicate calls
      _analyzingTracks.add(currentTrackId);
      analyzingTrackId.set(currentTrackId);
      try {
        // Check cache: if all analysis results exist for this track, restore them
        const cachedMeta = await getTrackMeta(currentTrackId);
        const isAnalysisCacheCurrent = cachedMeta?.analysisVersion === ANALYSIS_CACHE_VERSION;
        if (
          isAnalysisCacheCurrent &&
          typeof cachedMeta?.bpm === 'number' &&
          typeof cachedMeta?.key === 'string' && cachedMeta.key.length > 0 &&
          Array.isArray(cachedMeta?.chords) && cachedMeta.chords.length > 0
        ) {
          bpm.set(cachedMeta.bpm);
          key.set(cachedMeta.key);
          chords.set(cachedMeta.chords);
          return;
        }

        await saveProcessingState({ id: `${currentTrackId}:analyze`, trackId: currentTrackId, tool: 'analyze', startedAt: Date.now() });
        try {
          const apiSettings = get(settingsStore);
          const audioBuffer = _currentAudioBuffer;

          let result: { bpm: number; key: string; chords: ChordInfo[] };
          if (apiSettings.apiEndpoint) {
            if (_currentAudioBuffer && _currentAudioBuffer.duration > 600) {
              throw new Error(AI_DURATION_LIMIT_ERROR);
            }
            const audioFile = await getAudioFile(currentTrackId);
            if (!audioFile) return;
            const client = getApiClient(apiSettings.apiEndpoint, apiSettings.apiKey);
            const contentHash = cachedMeta?.contentHash;
            const res = await client.analyze(audioFile.data, contentHash);
            result = { bpm: res.bpm, key: res.key, chords: res.chords as ChordInfo[] };
          } else {
            if (!audioBuffer) return;
            result = await analyzeAudioInWorker(audioBuffer);
          }

          if (get({ subscribe }).trackId !== currentTrackId) return;

          bpm.set(result.bpm);
          key.set(result.key);
          chords.set(result.chords);

          const meta = await getTrackMeta(currentTrackId);
          if (meta) {
            await saveTrackMeta({
              ...meta,
              analysisVersion: ANALYSIS_CACHE_VERSION,
              bpm: result.bpm,
              key: result.key,
              chords: result.chords,
            });
          }
        } finally {
          await deleteProcessingState(`${currentTrackId}:analyze`);
        }
      } finally {
        _analyzingTracks.delete(currentTrackId);
        analyzingTrackId.set(null);
      }
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
          // Decode each stem (OGG from API or WAV from browser worker) via AudioContext
          // then mix them into a single AudioBuffer with per-stem gain.
          const decoded = await Promise.all(
            harmonyStemBuffers.map(async ({ buf, gain }) => {
              const ab = await ctx.decodeAudioData(buf.slice(0));
              return { ab, gain };
            })
          );
          const length = decoded[0].ab.length;
          const mixLeft  = new Float32Array(length);
          const mixRight = new Float32Array(length);
          for (const { ab, gain } of decoded) {
            const ch0 = ab.getChannelData(0);
            const ch1 = ab.numberOfChannels > 1 ? ab.getChannelData(1) : ch0;
            for (let i = 0; i < length; i++) {
              mixLeft[i]  += ch0[i] * gain;
              mixRight[i] += ch1[i] * gain;
            }
          }
          const sr = decoded[0].ab.sampleRate;
          stemBuffer = ctx.createBuffer(2, length, sr);
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
      syncWakeLock();
      // Always (re-)set Media Session metadata so the notification appears immediately.
      // Metadata may have been cleared by the OS while the app was in background.
      if (_currentTrackMeta) {
        setMediaSessionMetadata(
          _currentTrackMeta.title,
          _currentTrackMeta.artist,
          _currentTrackMeta.album,
          _currentTrackMeta.coverArt,
        );
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    },

    pause() {
      engine.pause();
      update((s) => ({ ...s, isPlaying: false }));
      _isPlaying = false;
      syncWakeLock();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
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
      syncWakeLock();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    },

    seek(time: number) {
      engine.seek(time);
      update((s) => ({ ...s, currentTime: time }));
    },

    skip(seconds: number) {
      const state = get({ subscribe });
      const floor = (seconds < 0 && state.abRepeat.a !== null) ? state.abRepeat.a : 0;
      const newTime = Math.max(floor, Math.min(state.duration, state.currentTime + seconds));
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
     * Analyse the current track's structure and create loop bookmarks.
     * Caches structure segments separately; second calls use the cache.
     * Per-track guard prevents concurrent duplicate processing.
     */
    async autoBookmarks(): Promise<void> {
      const state = get({ subscribe });
      if (!state.trackId || !_currentAudioBuffer) return;
      const trackId = state.trackId;
      if (_analyzingStructureTracks.has(trackId)) return;

      // Add guard immediately (before any await) to prevent concurrent duplicate calls
      _analyzingStructureTracks.add(trackId);
      analyzingStructureTrackId.set(trackId);
      const AUTO_PREFIX = 'auto-';
      try {
        // Check structure cache: reuse saved segments if available
        const cachedMeta = await getTrackMeta(trackId);
        if (cachedMeta?.structureSegments && cachedMeta.structureSegments.length > 0) {
          if (get({ subscribe }).trackId !== trackId) return;
          const generated = cachedMeta.structureSegments.map((seg) => ({
            id: `auto-${seg.start.toFixed(2)}`,
            label: seg.label || 'セクション',
            a: seg.start,
            b: seg.end,
          }));
          const manual = get(bookmarks).filter((b) => !b.id.startsWith(AUTO_PREFIX));
          const next = [...manual, ...generated];
          bookmarks.set(next);
          await saveTrackMeta({ ...cachedMeta, bookmarks: next });
          return;
        }

        // Fallback cache: auto-bookmarks exist in the saved meta but structureSegments is
        // missing (data saved before the field was introduced, or an incomplete save).
        const savedAutoBookmarks = (cachedMeta?.bookmarks ?? []).filter((b) => b.id.startsWith(AUTO_PREFIX));
        if (savedAutoBookmarks.length > 0) {
          if (get({ subscribe }).trackId !== trackId) return;
          // Backfill structureSegments so future calls hit the primary cache
          const structureSegments = savedAutoBookmarks.map((bm) => ({ start: bm.a, end: bm.b, label: bm.label }));
          if (cachedMeta) void saveTrackMeta({ ...cachedMeta, structureSegments });
          const manual = get(bookmarks).filter((b) => !b.id.startsWith(AUTO_PREFIX));
          bookmarks.set([...manual, ...savedAutoBookmarks]);
          return;
        }

        await saveProcessingState({ id: `${trackId}:structure`, trackId, tool: 'structure', startedAt: Date.now() });
        try {
        const apiSettings = get(settingsStore);
        const apiAvailable = !!apiSettings.apiEndpoint;

        let generated: LoopBookmark[];
        let structureSegments: { start: number; end: number; label: string }[];

        if (apiAvailable) {
          if (_currentAudioBuffer && _currentAudioBuffer.duration > 600) {
            throw new Error(AI_DURATION_LIMIT_ERROR);
          }
          // Server-side: allin1 returns functional labels (verse, chorus, …)
          const audioFile = await getAudioFile(trackId);
          if (!audioFile) return;
          const client = getApiClient(apiSettings.apiEndpoint, apiSettings.apiKey);
          const contentHash = cachedMeta?.contentHash;

          // Pass pre-separated stems when available so the server can skip demucs
          const REQUIRED_STEMS = ['bass', 'drums', 'other', 'vocals'] as const;
          const stemEntries = await Promise.all(
            REQUIRED_STEMS.map(async (name) => {
              const buf = await getStemFile(trackId, name);
              return [name, buf ?? null] as const;
            }),
          );
          const stems = Object.fromEntries(stemEntries.filter(([, buf]) => buf !== null));
          const hasAllStems = REQUIRED_STEMS.every((name) => stems[name] != null);

          let res: StructureResponse;
          if (hasAllStems) {
            res = await client.analyzeStructureWithStems(audioFile.data, stems, contentHash);
          } else {
            res = await client.analyzeStructure(audioFile.data, contentHash);
          }
          generated = res.bookmarks;
          structureSegments = res.segments;
        } else {
          // Browser-side fallback: boundary detection only, generic labels
          const segments = await analyzeStructureInWorker(_currentAudioBuffer);
          structureSegments = segments.map((seg, i) => ({
            start: seg.start,
            end: seg.end,
            label: `セクション ${i + 1}`,
          }));
          generated = structureSegments.map((seg) => ({
            id: `auto-${seg.start.toFixed(2)}`,
            label: seg.label,
            a: seg.start,
            b: seg.end,
          }));
        }

        if (get({ subscribe }).trackId !== trackId) return;
        const manual = get(bookmarks).filter((b) => !b.id.startsWith(AUTO_PREFIX));
        const next = [...manual, ...generated];
        bookmarks.set(next);

        const meta = await getTrackMeta(trackId);
        if (meta) await saveTrackMeta({ ...meta, bookmarks: next, structureSegments });
        } finally {
          await deleteProcessingState(`${trackId}:structure`);
        }
      } finally {
        _analyzingStructureTracks.delete(trackId);
        analyzingStructureTrackId.set(null);
      }
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
      activeBookmarkId.set(bookmark.id);
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
      activeBookmarkId.set(null);
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
      activeBookmarkId.set(null);
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

    /** Set A point to an explicit time (used by waveform drag — does not clear activeBookmarkId). */
    setATime(t: number) {
      update((s) => {
        const b = s.abRepeat.b;
        const clamped = Math.max(0, b !== null ? Math.min(t, b - 0.05) : t);
        return { ...s, abRepeat: { ...s.abRepeat, a: clamped } };
      });
    },

    /** Set B point to an explicit time (used by waveform drag — does not clear activeBookmarkId). */
    setBTime(t: number) {
      update((s) => {
        const a = s.abRepeat.a ?? 0;
        const dur = engine.duration;
        const clamped = Math.min(dur, Math.max(t, a + 0.05));
        return { ...s, abRepeat: { ...s.abRepeat, b: clamped, enabled: a !== null } };
      });
    },

    toggleABRepeat() {
      update((s) => ({
        ...s,
        abRepeat: { ...s.abRepeat, enabled: !s.abRepeat.enabled },
      }));
    },

    /**
     * Trim the current track's audio to [startSec, endSec].
     * Saves the sliced WAV back to IDB, adjusts bookmarks, clears caches,
     * deletes stems (they'd be out of sync), and reloads the track.
     */
    async trimAudio(startSec: number, endSec: number): Promise<void> {
      const state = get({ subscribe });
      const trackId = state.trackId;
      if (!trackId || !_currentAudioBuffer) return;

      const buf = _currentAudioBuffer;
      const sr = buf.sampleRate;
      const startSample = Math.max(0, Math.round(startSec * sr));
      const endSample = Math.min(buf.length, Math.round(endSec * sr));
      if (endSample <= startSample) return;

      const ch0 = buf.getChannelData(0).slice(startSample, endSample);
      const ch1 = buf.numberOfChannels > 1
        ? buf.getChannelData(1).slice(startSample, endSample)
        : ch0;
      const wavData = encodeWavStereo16(ch0, ch1, sr);

      await saveAudioFile(trackId, wavData, 'audio/wav');
      await deleteStemFiles(trackId);

      const meta = await getTrackMeta(trackId);
      if (meta) {
        const newDuration = (endSample - startSample) / sr;
        const adjustedBookmarks = (meta.bookmarks ?? [])
          .map((bm) => ({ ...bm, a: bm.a - startSec, b: bm.b - startSec }))
          .filter((bm) => bm.b > 0 && bm.a < newDuration)
          .map((bm) => ({ ...bm, a: Math.max(0, bm.a), b: Math.min(newDuration, bm.b) }));
        await saveTrackMeta({
          ...meta,
          duration: newDuration,
          bookmarks: adjustedBookmarks,
          stemStatus: 'none',
          bpm: undefined,
          key: undefined,
          chords: undefined,
          analysisVersion: undefined,
          structureSegments: undefined,
          contentHash: undefined,
        });
      }

      trimStart.set(0);
      trimEnd.set(null);
      await this.loadTrack(trackId);
    },

    clearAB() {
      activeBookmarkId.set(null);
      update((s) => ({
        ...s,
        abRepeat: { enabled: false, a: null, b: null },
      }));
    },

  };
}

export const playerStore = createPlayerStore();
setupMediaSession(playerStore);
