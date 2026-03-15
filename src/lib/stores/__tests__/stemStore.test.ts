/**
 * stemStore unit tests
 *
 * All external dependencies (StemSeparationClient, AudioEngine, IndexedDB) are
 * mocked so the tests focus on store state transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { StemType, StemVolumes } from '../../types';
import { DEFAULT_STEM_VOLUMES } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSilentWav(): ArrayBuffer {
  const samples = 100;
  const dataSize = samples * 4;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); w(8, 'WAVE');
  w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * 4, true); view.setUint16(32, 4, true);
  view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, dataSize, true);
  return buf;
}

function fakeStems(): Partial<Record<StemType, ArrayBuffer>> {
  return {
    vocals: makeSilentWav(),
    drums:  makeSilentWav(),
    bass:   makeSilentWav(),
    other:  makeSilentWav(),
    guitar: makeSilentWav(),
    piano:  makeSilentWav(),
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSeparateFn, mockOnModelDownload, mockEngine,
        mockGetTrackMeta, mockSaveTrackMeta,
        mockGetAllStemFiles, mockSaveStemFile,
        mockCreateNewSeparateFn, mockCreateNewTerminate,
        mockIsModelCached, mockOnBackendInfo } = vi.hoisted(() => ({
  mockSeparateFn:     vi.fn(),
  mockOnModelDownload: vi.fn().mockReturnValue(() => {}),
  mockOnBackendInfo:  vi.fn().mockReturnValue(() => {}),
  mockIsModelCached:  vi.fn().mockResolvedValue(true),
  mockEngine: {
    getAudioBuffer:           vi.fn(),
    loadStemsFromArrayBuffers: vi.fn().mockResolvedValue(undefined),
    setStemVolumes:            vi.fn(),
    setStemVolume:             vi.fn(),
    clearStems:                vi.fn(),
  },
  mockGetTrackMeta:    vi.fn(),
  mockSaveTrackMeta:   vi.fn().mockResolvedValue(undefined),
  mockGetAllStemFiles: vi.fn(),
  mockSaveStemFile:    vi.fn().mockResolvedValue(undefined),
  mockCreateNewSeparateFn: vi.fn(),
  mockCreateNewTerminate:  vi.fn(),
}));

vi.mock('../../audio/StemSeparationClient', () => ({
  StemSeparationClient: {
    getInstance: () => ({
      separate: mockSeparateFn,
      onModelDownload: mockOnModelDownload,
      onBackendInfo: mockOnBackendInfo,
      isModelCached: mockIsModelCached,
    }),
    createNew: () => ({
      separate: mockCreateNewSeparateFn,
      terminate: mockCreateNewTerminate,
      onModelDownload: vi.fn().mockReturnValue(() => {}),
      onBackendInfo: vi.fn().mockReturnValue(() => {}),
    }),
  },
}));

// Mock wavUtils to avoid large WAV allocations in tests
vi.mock('../../audio/wavUtils', () => ({
  encodeWavStereo16: () => makeSilentWav(),
  decodeWavStereo16: () => ({ left: new Float32Array(100), right: new Float32Array(100) }),
}));

vi.mock('../playerStore', async () => {
  // Writable store so get(playerStore) works; default trackId matches test tracks
  const { writable } = await import('svelte/store');
  const _inner = writable({ trackId: null as string | null });
  const mockPS = {
    engine: mockEngine,
    reAnalyzeWithStem: vi.fn().mockResolvedValue(undefined),
    subscribe: _inner.subscribe,
    _setTrackId: (id: string | null) => _inner.set({ trackId: id }),
  };
  return { playerStore: mockPS, isAnyProcessingActive: vi.fn().mockReturnValue(false) };
});

vi.mock('../trackStore', () => ({
  trackStore: { updateStemStatus: vi.fn() },
}));

vi.mock('../../storage/db', () => ({
  getTrackMeta:           (...args: unknown[]) => mockGetTrackMeta(...args),
  saveTrackMeta:          (...args: unknown[]) => mockSaveTrackMeta(...args),
  getAllStemFiles:         (...args: unknown[]) => mockGetAllStemFiles(...args),
  saveStemFile:           (...args: unknown[]) => mockSaveStemFile(...args),
  getAudioFile:           vi.fn().mockResolvedValue(null),
  saveProcessingState:    vi.fn().mockResolvedValue(undefined),
  deleteProcessingState:  vi.fn().mockResolvedValue(undefined),
  getProcessingState:     vi.fn().mockResolvedValue(undefined),
}));

// OfflineAudioContext stub (for extractStereo44k in stemStore)
class MockOfflineAudioContext {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  destination = {};
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: vi.fn() };
  }
  startRendering() {
    // Return a fake rendered buffer at 44100 Hz
    const rendered: AudioBuffer = {
      numberOfChannels: 2,
      length: this.length,
      sampleRate: this.sampleRate,
      duration: this.length / this.sampleRate,
      getChannelData: (ch: number) => new Float32Array(this.length),
      copyFromChannel: vi.fn(),
      copyToChannel: vi.fn(),
    } as unknown as AudioBuffer;
    return Promise.resolve(rendered);
  }
}

globalThis.OfflineAudioContext = MockOfflineAudioContext as unknown as typeof OfflineAudioContext;

// ── Import store after mocks ──────────────────────────────────────────────────
import { stemStore } from '../stemStore';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('stemStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnModelDownload.mockReturnValue(() => {});
  });

  // ── onTrackLoaded ──────────────────────────────────────────────────────────

  describe('onTrackLoaded()', () => {
    it('resets to initial state when track has no stems', async () => {
      mockGetTrackMeta.mockResolvedValue({ id: 'track-1', stemStatus: 'none' });
      mockGetAllStemFiles.mockResolvedValue({});

      await stemStore.onTrackLoaded('track-1');

      const state = get(stemStore);
      expect(state.status).toBe('none');
      expect(state.downloadProgress).toBeNull();
      expect(state.message).toBe('');
    });

    it('loads existing stems and sets status to ready', async () => {
      const stems = fakeStems();
      mockGetTrackMeta.mockResolvedValue({
        id: 'track-2',
        stemStatus: 'ready',
        stemVolumes: { vocals: 0.8, drums: 0.6, bass: 1, other: 1 },
      });
      mockGetAllStemFiles.mockResolvedValue(stems);

      await stemStore.onTrackLoaded('track-2');

      expect(mockEngine.loadStemsFromArrayBuffers).toHaveBeenCalledWith(stems);
      expect(mockEngine.setStemVolumes).toHaveBeenCalledWith({
        vocals: 0.8, drums: 0.6, bass: 1, other: 1, guitar: 1, piano: 1,
      });

      const state = get(stemStore);
      expect(state.status).toBe('ready');
      expect(state.volumes.vocals).toBe(0.8);
    });

    it('falls back to none if saved stems are missing from IDB', async () => {
      mockGetTrackMeta.mockResolvedValue({ id: 'track-3', stemStatus: 'ready' });
      // Only 3 out of 4 stems present
      mockGetAllStemFiles.mockResolvedValue({
        vocals: makeSilentWav(),
        drums:  makeSilentWav(),
        bass:   makeSilentWav(),
        // 'other' missing
      });

      await stemStore.onTrackLoaded('track-3');

      const state = get(stemStore);
      expect(state.status).toBe('none');
    });
  });

  // ── separate() ────────────────────────────────────────────────────────────

  describe('separate()', () => {
    function makeFakeAudioBuffer(sampleRate = 44100): AudioBuffer {
      const buf: AudioBuffer = {
        numberOfChannels: 2,
        length: sampleRate,
        sampleRate,
        duration: 1,
        getChannelData: (ch: number) => new Float32Array(sampleRate),
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
      } as unknown as AudioBuffer;
      return buf;
    }

    it('transitions state: none → processing → ready on success', async () => {
      mockEngine.getAudioBuffer.mockReturnValue(makeFakeAudioBuffer());
      mockGetTrackMeta.mockResolvedValue({ id: 'track-4' });

      const stems = fakeStems();
      mockSeparateFn.mockResolvedValue({ stems });
      // loadStemsIntoEngine needs all stems to be present in storage
      mockGetAllStemFiles.mockResolvedValue(stems);
      Object.assign(mockEngine, { loadedStemTypes: ['vocals', 'drums', 'bass', 'other'] });      // Set the current trackId in the player mock so the guard allows engine load
      const { playerStore: mockPS } = await import('../playerStore');
      (mockPS as unknown as { _setTrackId: (id: string) => void })._setTrackId('track-4');
      // Trigger and wait
      const promise = stemStore.separate('track-4');

      // Initial transition to 'processing' happens synchronously before awaits
      // (may be deferred slightly; flush microtasks)
      await Promise.resolve();
      let state = get(stemStore);
      expect(state.status).toBe('processing');

      // Complete
      await promise;

      state = get(stemStore);
      expect(state.status).toBe('ready');
      expect(state.downloadProgress).toBeNull();
      expect(state.message).toBe('');
      expect(mockSaveStemFile).toHaveBeenCalledTimes(6);
    });

    it('transitions state to error when separation fails', async () => {
      mockEngine.getAudioBuffer.mockReturnValue(makeFakeAudioBuffer());
      mockGetTrackMeta.mockResolvedValue({ id: 'track-5' });
      mockSeparateFn.mockRejectedValue(new Error('WASM out of memory'));

      await stemStore.separate('track-5');

      const state = get(stemStore);
      expect(state.status).toBe('error');
      expect(state.message).toContain('WASM out of memory');
    });

    it('does nothing if no AudioBuffer is loaded', async () => {
      mockEngine.getAudioBuffer.mockReturnValue(null);

      await stemStore.separate('track-6');

      expect(mockSeparateFn).not.toHaveBeenCalled();
    });

    it('returns immediately if status is already processing (guard)', async () => {
      // Prime a track so the store is in processing state
      mockEngine.getAudioBuffer.mockReturnValue(
        (() => {
          const buf: AudioBuffer = {
            numberOfChannels: 2, length: 44100, sampleRate: 44100, duration: 1,
            getChannelData: () => new Float32Array(44100),
            copyFromChannel: vi.fn(), copyToChannel: vi.fn(),
          } as unknown as AudioBuffer;
          return buf;
        })()
      );
      mockGetTrackMeta.mockResolvedValue({ id: 'track-guard' });

      // Hold the first separate() call in-flight
      let resolveSep!: (v: { stems: Partial<Record<string, ArrayBuffer>> }) => void;
      const inflight = new Promise<{ stems: Partial<Record<string, ArrayBuffer>> }>((res) => {
        resolveSep = res;
      });
      mockSeparateFn.mockReturnValue(inflight);

      const { playerStore: mockPS } = await import('../playerStore');
      (mockPS as unknown as { _setTrackId: (id: string) => void })._setTrackId('track-guard');

      const p1 = stemStore.separate('track-guard');
      // Let microtasks run so status transitions to 'processing'
      await Promise.resolve();
      await Promise.resolve();

      // Second call while still processing — should be a no-op
      const p2 = stemStore.separate('track-guard');
      await p2; // resolves immediately since guard fires

      // Resolve the first call
      resolveSep({ stems: {} });
      await p1;

      // separate was called only once
      expect(mockSeparateFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── setStemVolume() ────────────────────────────────────────────────────────

  describe('setStemVolume()', () => {
    it('updates a single stem volume in engine and store', async () => {
      mockGetTrackMeta.mockResolvedValue({ id: 'track-7' });

      await stemStore.setStemVolume('vocals' as StemType, 0.5, 'track-7');

      expect(mockEngine.setStemVolume).toHaveBeenCalledWith('vocals', 0.5);
      const state = get(stemStore);
      expect(state.volumes.vocals).toBe(0.5);
    });
  });

  // ── resetVolumes() ────────────────────────────────────────────────────────

  describe('resetVolumes()', () => {
    it('resets all volumes to 1 and updates engine', async () => {
      // First lower a volume
      await stemStore.setStemVolume('drums' as StemType, 0.2, null);

      await stemStore.resetVolumes(null);

      expect(mockEngine.setStemVolumes).toHaveBeenCalledWith(DEFAULT_STEM_VOLUMES);
      const state = get(stemStore);
      expect(state.volumes).toEqual(DEFAULT_STEM_VOLUMES);
    });
  });

  // ── revertToNormal() ──────────────────────────────────────────────────────

  describe('revertToNormal()', () => {
    it('calls engine.clearStems()', () => {
      stemStore.revertToNormal();
      expect(mockEngine.clearStems).toHaveBeenCalledOnce();
    });
  });

  // ── separate() parallel path (long audio) ─────────────────────────────────

  describe('separate() parallel path (long audio >30.5 s)', () => {
    /** 2 full 30-second segments worth of samples at 44100 Hz → triggers parallel */
    const LONG_SAMPLES = 2 * 30 * 44100; // 2,646,000

    function makeLongAudioBuffer(): AudioBuffer {
      return {
        numberOfChannels: 2,
        length: LONG_SAMPLES,
        sampleRate: 44100,
        duration: LONG_SAMPLES / 44100,
        getChannelData: (_ch: number) => new Float32Array(LONG_SAMPLES),
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
      } as unknown as AudioBuffer;
    }

    beforeEach(async () => {
      mockEngine.getAudioBuffer.mockReturnValue(makeLongAudioBuffer());
      mockGetTrackMeta.mockResolvedValue({ id: 'track-parallel', title: 'Long Track', stemStatus: 'none' });
      mockSeparateFn.mockResolvedValue({ stems: fakeStems() });
      mockCreateNewSeparateFn.mockResolvedValue({ stems: fakeStems() });
      mockGetAllStemFiles.mockResolvedValue(fakeStems());
      Object.assign(mockEngine, { loadedStemTypes: ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'] });
      // Set trackId so the engine-load guard allows processing
      const { playerStore: mockPS } = await import('../playerStore');
      (mockPS as unknown as { _setTrackId: (id: string) => void })._setTrackId('track-parallel');
    });

    it('creates a new worker for the second segment', async () => {
      await stemStore.separate('track-parallel');
      // Singleton handles segment 0; createNew handles segment 1
      expect(mockCreateNewSeparateFn).toHaveBeenCalledTimes(1);
    });

    it('terminates the additional worker after completion', async () => {
      await stemStore.separate('track-parallel');
      expect(mockCreateNewTerminate).toHaveBeenCalledTimes(1);
    });

    it('calls singleton.separate once for segment 0', async () => {
      await stemStore.separate('track-parallel');
      expect(mockSeparateFn).toHaveBeenCalledTimes(1);
    });

    it('saves 6 merged stems and reaches ready state', async () => {
      await stemStore.separate('track-parallel');
      expect(mockSaveStemFile).toHaveBeenCalledTimes(6);
      const state = get(stemStore);
      expect(state.status).toBe('ready');
    });

    it('shows segment progress message during processing', async () => {
      let seenProgressMsg = false;
      const unsub = stemStore.subscribe((s) => {
        if (s.message.includes('セグメント')) seenProgressMsg = true;
      });
      await stemStore.separate('track-parallel');
      unsub();
      expect(seenProgressMsg).toBe(true);
    });
  });
});
