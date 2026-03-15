/**
 * stemStore unit tests
 *
 * External dependencies (AudioEngine, IndexedDB, apiClient, settingsStore) are
 * mocked so the tests focus on store state transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { StemType } from '../../types';
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

const { mockSeparateApi, mockEngine, mockGetTrackMeta, mockSaveTrackMeta,
        mockGetAllStemFiles, mockSaveStemFile } = vi.hoisted(() => ({
  mockSeparateApi: vi.fn(),
  mockEngine: {
    getAudioBuffer:            vi.fn(),
    loadStemsFromArrayBuffers: vi.fn().mockResolvedValue(undefined),
    setStemVolumes:            vi.fn(),
    setStemVolume:             vi.fn(),
    clearStems:                vi.fn(),
  },
  mockGetTrackMeta:    vi.fn(),
  mockSaveTrackMeta:   vi.fn().mockResolvedValue(undefined),
  mockGetAllStemFiles: vi.fn(),
  mockSaveStemFile:    vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../audio/apiClient', () => ({
  getApiClient: () => ({ separate: mockSeparateApi }),
}));

vi.mock('../settingsStore', () => ({
  settingsStore: {
    subscribe: (fn: (v: unknown) => void) => {
      fn({ apiEndpoint: 'https://api.example.com', apiKey: 'key' });
      return () => {};
    },
  },
}));

vi.mock('../playerStore', async () => {
  const { writable } = await import('svelte/store');
  const _inner = writable({ trackId: null as string | null });
  const mockPS = {
    engine: mockEngine,
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
  getAudioFile:           vi.fn().mockResolvedValue({ data: new ArrayBuffer(0) }),
  saveProcessingState:    vi.fn().mockResolvedValue(undefined),
  deleteProcessingState:  vi.fn().mockResolvedValue(undefined),
  getProcessingState:     vi.fn().mockResolvedValue(undefined),
}));

// ── Import store after mocks ──────────────────────────────────────────────────
import { stemStore } from '../stemStore';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('stemStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    function makeFakeAudioBuffer(): AudioBuffer {
      return {
        numberOfChannels: 2, length: 44100, sampleRate: 44100, duration: 1,
        getChannelData: () => new Float32Array(44100),
        copyFromChannel: vi.fn(), copyToChannel: vi.fn(),
      } as unknown as AudioBuffer;
    }

    it('transitions state: none -> processing -> ready on success', async () => {
      mockEngine.getAudioBuffer.mockReturnValue(makeFakeAudioBuffer());
      mockGetTrackMeta.mockResolvedValue({ id: 'track-4' });

      const stems = fakeStems();
      mockSeparateApi.mockResolvedValue({ stems });
      mockGetAllStemFiles.mockResolvedValue(stems);
      Object.assign(mockEngine, { loadedStemTypes: ['vocals', 'drums', 'bass', 'other'] });

      const { playerStore: mockPS } = await import('../playerStore');
      (mockPS as unknown as { _setTrackId: (id: string) => void })._setTrackId('track-4');

      const promise = stemStore.separate('track-4');

      await Promise.resolve();
      let state = get(stemStore);
      expect(state.status).toBe('processing');

      await promise;

      state = get(stemStore);
      expect(state.status).toBe('ready');
      expect(state.downloadProgress).toBeNull();
      expect(state.message).toBe('');
      expect(mockSaveStemFile).toHaveBeenCalledTimes(6);
    });

    it('transitions state to error when API separation fails', async () => {
      mockEngine.getAudioBuffer.mockReturnValue(makeFakeAudioBuffer());
      mockGetTrackMeta.mockResolvedValue({ id: 'track-5' });
      mockSeparateApi.mockRejectedValue(new Error('API error'));

      await stemStore.separate('track-5');

      const state = get(stemStore);
      expect(state.status).toBe('error');
      expect(state.message).toContain('API error');
    });

    it('does nothing if no AudioBuffer is loaded', async () => {
      mockEngine.getAudioBuffer.mockReturnValue(null);

      await stemStore.separate('track-6');

      expect(mockSeparateApi).not.toHaveBeenCalled();
    });

    it('returns immediately if status is already processing (guard)', async () => {
      mockEngine.getAudioBuffer.mockReturnValue(makeFakeAudioBuffer());
      mockGetTrackMeta.mockResolvedValue({ id: 'track-guard' });

      let resolveSep!: (v: { stems: Partial<Record<string, ArrayBuffer>> }) => void;
      const inflight = new Promise<{ stems: Partial<Record<string, ArrayBuffer>> }>((res) => {
        resolveSep = res;
      });
      mockSeparateApi.mockReturnValue(inflight);

      const { playerStore: mockPS } = await import('../playerStore');
      (mockPS as unknown as { _setTrackId: (id: string) => void })._setTrackId('track-guard');

      const p1 = stemStore.separate('track-guard');
      await Promise.resolve();
      await Promise.resolve();

      const p2 = stemStore.separate('track-guard');
      await p2;

      resolveSep({ stems: {} });
      await p1;

      expect(mockSeparateApi).toHaveBeenCalledTimes(1);
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
});

