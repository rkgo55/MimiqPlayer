import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const mockGetTrackMeta  = vi.fn().mockResolvedValue(undefined);
const mockSaveTrackMeta = vi.fn().mockResolvedValue(undefined);
const mockSaveProcessingState   = vi.fn().mockResolvedValue(undefined);
const mockDeleteProcessingState = vi.fn().mockResolvedValue(undefined);
const mockGetAudioFile = vi.fn().mockResolvedValue(null);

// Mock external dependencies before importing playerStore
vi.mock('../../storage/db', () => ({
  getAudioFile:          (...args: unknown[]) => mockGetAudioFile(...args),
  getAllTracks:           vi.fn().mockResolvedValue([]),
  getTrackMeta:          (...args: unknown[]) => mockGetTrackMeta(...args),
  saveTrackMeta:         (...args: unknown[]) => mockSaveTrackMeta(...args),
  getStemFile:           vi.fn().mockResolvedValue(undefined),
  saveProcessingState:   (...args: unknown[]) => mockSaveProcessingState(...args),
  deleteProcessingState: (...args: unknown[]) => mockDeleteProcessingState(...args),
}));

const mockApiAnalyze            = vi.fn();
const mockApiAnalyzeStructure   = vi.fn();
const mockApiAnalyzeStructureWithStems = vi.fn();

vi.mock('../../audio/apiClient', () => ({
  getApiClient: vi.fn().mockReturnValue({
    analyze:                   (...args: unknown[]) => mockApiAnalyze(...args),
    analyzeStructure:          (...args: unknown[]) => mockApiAnalyzeStructure(...args),
    analyzeStructureWithStems: (...args: unknown[]) => mockApiAnalyzeStructureWithStems(...args),
  }),
}));

vi.mock('../settingsStore', () => ({
  settingsStore: {
    subscribe: (cb: (v: unknown) => void) => { cb({ apiEndpoint: 'https://api.example.com', apiKey: 'test-key' }); return () => {}; },
  },
}));

vi.mock('../../audio/WaveformAnalyzer', () => ({
  extractWaveformData: vi.fn().mockReturnValue({ peaks: [], duration: 0 }),
}));

vi.mock('@soundtouchjs/audio-worklet', () => ({
  SoundTouchNode: class {
    parameters = new Map([
      ['pitch', { value: 1 }],
      ['tempo', { value: 1 }],
      ['rate', { value: 1 }],
      ['pitchSemitones', { value: 0 }],
      ['playbackRate', { value: 1 }],
    ]);
    static register = vi.fn().mockResolvedValue(undefined);
    connect() {}
    disconnect() {}
    get pitch() { return this.parameters.get('pitch'); }
    get tempo() { return this.parameters.get('tempo'); }
    get rate() { return this.parameters.get('rate'); }
    get pitchSemitones() { return this.parameters.get('pitchSemitones'); }
    get playbackRate() { return this.parameters.get('playbackRate'); }
  },
}));

vi.mock('@soundtouchjs/audio-worklet/processor?url', () => ({
  default: '/mock-soundtouch-processor.js',
}));

// Stub AudioContext for JSDOM
globalThis.AudioContext = class {
  state = 'running';
  destination = {};
  currentTime = 0;
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, getByteFrequencyData() {} }; }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      onended: null,
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
    };
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
} as unknown as typeof AudioContext;

import { playerStore } from '../playerStore';

// Helper: get current store value
function getState() {
  return get(playerStore);
}

// Helper: set currentTime via seek (engine.seek is no-op without audio, store still updates)
function seedTime(time: number) {
  playerStore.seek(time);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default resolved values after clearAllMocks
  mockGetTrackMeta.mockResolvedValue(undefined);
  mockSaveTrackMeta.mockResolvedValue(undefined);
  mockSaveProcessingState.mockResolvedValue(undefined);
  mockDeleteProcessingState.mockResolvedValue(undefined);
  mockGetAudioFile.mockResolvedValue(null);
  playerStore.stop();
  playerStore.clearAB();
});

// ──────────────────────────────────────────────
// A-B リピート: setA / setB
// ──────────────────────────────────────────────
describe('setA()', () => {
  it('sets A to currentTime', () => {
    seedTime(42);
    playerStore.setA();
    expect(getState().abRepeat.a).toBe(42);
  });

  it('overwrites previous A value', () => {
    seedTime(10);
    playerStore.setA();
    seedTime(25);
    playerStore.setA();
    expect(getState().abRepeat.a).toBe(25);
  });
});

describe('setB() — toggle behavior', () => {
  it('sets B to currentTime when B is null', () => {
    seedTime(60);
    playerStore.setB();
    expect(getState().abRepeat.b).toBe(60);
  });

  it('clears B (sets to null) when B is already set', () => {
    seedTime(60);
    playerStore.setB(); // B = 60
    seedTime(90);
    playerStore.setB(); // Should clear B, not update it
    expect(getState().abRepeat.b).toBeNull();
  });

  it('disables repeat when B is cleared', () => {
    seedTime(30);
    playerStore.setA();
    seedTime(90);
    playerStore.setB();
    // Repeat is now enabled because A and B are set
    playerStore.setB(); // Clear B
    expect(getState().abRepeat.enabled).toBe(false);
  });

  it('enables repeat automatically when A is set and B is provided after A', () => {
    seedTime(30);
    playerStore.setA();
    seedTime(90);
    playerStore.setB();
    expect(getState().abRepeat.enabled).toBe(true);
    expect(getState().abRepeat.a).toBe(30);
    expect(getState().abRepeat.b).toBe(90);
  });

  it('swaps A and B when new B position is before A', () => {
    seedTime(60);
    playerStore.setA(); // A = 60
    seedTime(20);
    playerStore.setB(); // B is before A → swap
    const { a, b } = getState().abRepeat;
    expect(a).toBe(20);
    expect(b).toBe(60);
  });
});

describe('clearAB()', () => {
  it('clears all A-B state', () => {
    seedTime(10);
    playerStore.setA();
    seedTime(80);
    playerStore.setB();
    playerStore.clearAB();
    const { a, b, enabled } = getState().abRepeat;
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(enabled).toBe(false);
  });
});

describe('toggleABRepeat()', () => {
  it('enables repeat when both A and B are set', () => {
    seedTime(10);
    playerStore.setA();
    seedTime(50);
    playerStore.setB();
    // setB auto-enables, so disable first then toggle
    playerStore.toggleABRepeat(); // off
    expect(getState().abRepeat.enabled).toBe(false);
    playerStore.toggleABRepeat(); // on
    expect(getState().abRepeat.enabled).toBe(true);
  });
});

// ──────────────────────────────────────────────
// skip()
// ──────────────────────────────────────────────
describe('skip()', () => {
  it('never goes below 0', () => {
    seedTime(5);
    playerStore.skip(-100);
    expect(getState().currentTime).toBe(0);
  });

  it('clamps to duration (0 when no audio loaded)', () => {
    seedTime(10);
    playerStore.skip(9999);
    // duration = 0 when no audio loaded → clamps to 0
    expect(getState().currentTime).toBe(0);
  });
});

// ──────────────────────────────────────────────
// setSpeed / setPitch
// ──────────────────────────────────────────────
describe('setSpeed()', () => {
  it('updates speed in store', () => {
    playerStore.setSpeed(0.75);
    expect(getState().speed).toBe(0.75);
  });
});

describe('setPitch()', () => {
  it('updates pitch in store', () => {
    playerStore.setPitch(-3);
    expect(getState().pitch).toBe(-3);
  });
});

// ──────────────────────────────────────────────
// analyzeTrack() — per-track guard & cache
// ──────────────────────────────────────────────
describe('analyzeTrack()', () => {
  const ANALYSIS_CACHE_VERSION = 2; // matches analysisConfig.ts

  it('does nothing when no track is loaded', async () => {
    await playerStore.analyzeTrack();
    expect(mockApiAnalyze).not.toHaveBeenCalled();
  });

  it('uses cached results without calling worker when cache is current', async () => {
    // Simulate a loaded track by manually updating trackId
    playerStore.seek(0); // keeps trackId null — need set via loadTrack stub
    // Directly test via getTrackMeta returning valid cache
    mockGetTrackMeta.mockResolvedValue({
      id: 'track-x',
      analysisVersion: ANALYSIS_CACHE_VERSION,
      bpm: 120,
      key: 'C メジャー',
      chords: [{ time: 0, chord: 'C' }],
    });

    // Load a track stub to set trackId
    mockGetAudioFile.mockResolvedValue({ data: new ArrayBuffer(4), mimeType: 'audio/mp3' });
    const mockDecode = vi.fn().mockResolvedValue({
      duration: 10,
      length: 441000,
      sampleRate: 44100,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(441000),
    });
    globalThis.AudioContext = class {
      state = 'running';
      destination = {};
      currentTime = 0;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      decodeAudioData = mockDecode;
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, getByteFrequencyData() {} }; }
      createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    } as unknown as typeof AudioContext;

    await playerStore.loadTrack('track-x');
    mockApiAnalyze.mockResolvedValue({ bpm: 99, key: 'X', chords: [], beats: [], key_confidence: 0.9, elapsed_seconds: 1 });

    await playerStore.analyzeTrack();

    // Should NOT call API since cache is valid
    expect(mockApiAnalyze).not.toHaveBeenCalled();
    expect(get(playerStore.bpm)).toBe(120);
    expect(get(playerStore.key)).toBe('C メジャー');
  });

  it('calls worker and saves result when no cache', async () => {
    mockGetTrackMeta.mockResolvedValue({ id: 'track-y', analysisVersion: undefined });
    mockGetAudioFile.mockResolvedValue({ data: new ArrayBuffer(4), mimeType: 'audio/mp3' });
    const mockDecode2 = vi.fn().mockResolvedValue({
      duration: 5,
      length: 220500,
      sampleRate: 44100,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(220500),
    });
    globalThis.AudioContext = class {
      state = 'running';
      destination = {};
      currentTime = 0;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      decodeAudioData = mockDecode2;
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, getByteFrequencyData() {} }; }
      createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    } as unknown as typeof AudioContext;

    await playerStore.loadTrack('track-y');
    mockApiAnalyze.mockResolvedValue({ bpm: 130, key: 'D マイナー', chords: [{ time: 0, chord: 'Dm' }], beats: [], key_confidence: 0.9, elapsed_seconds: 1 });

    await playerStore.analyzeTrack();

    // API should have been called once
    expect(mockApiAnalyze).toHaveBeenCalledOnce();
    expect(get(playerStore.bpm)).toBe(130);
    expect(mockSaveTrackMeta).toHaveBeenCalled();
    expect(mockDeleteProcessingState).toHaveBeenCalledWith('track-y:analyze');
  });

  it('per-track guard: concurrent calls fire only once', async () => {
    mockGetTrackMeta.mockResolvedValue({ id: 'track-z', analysisVersion: undefined });
    mockGetAudioFile.mockResolvedValue({ data: new ArrayBuffer(4), mimeType: 'audio/mp3' });
    let resolveWorker!: (v: { bpm: number; key: string; chords: never[]; beats: never[]; key_confidence: number; elapsed_seconds: number }) => void;
    const slowWorker = new Promise<{ bpm: number; key: string; chords: never[]; beats: never[]; key_confidence: number; elapsed_seconds: number }>((res) => { resolveWorker = res; });
    mockApiAnalyze.mockReturnValue(slowWorker);

    const mockDecode3 = vi.fn().mockResolvedValue({
      duration: 5, length: 220500, sampleRate: 44100, numberOfChannels: 1,
      getChannelData: () => new Float32Array(220500),
    });
    globalThis.AudioContext = class {
      state = 'running'; destination = {}; currentTime = 0;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      decodeAudioData = mockDecode3;
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, getByteFrequencyData() {} }; }
      createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    } as unknown as typeof AudioContext;

    await playerStore.loadTrack('track-z');

    // Fire two concurrent calls
    const p1 = playerStore.analyzeTrack();
    const p2 = playerStore.analyzeTrack(); // should be blocked by guard

    resolveWorker({ bpm: 110, key: 'E', chords: [], beats: [], key_confidence: 0.9, elapsed_seconds: 1 });
    await Promise.all([p1, p2]);

    // API called only once despite two concurrent calls
    expect(mockApiAnalyze).toHaveBeenCalledOnce();
  });

  it('saves processingState on start and deletes on completion', async () => {
    mockGetTrackMeta.mockResolvedValue({ id: 'track-ps', analysisVersion: undefined });
    mockGetAudioFile.mockResolvedValue({ data: new ArrayBuffer(4), mimeType: 'audio/mp3' });
    mockApiAnalyze.mockResolvedValue({ bpm: 100, key: 'F', chords: [], beats: [], key_confidence: 0.9, elapsed_seconds: 1 });
    const mockDecode4 = vi.fn().mockResolvedValue({
      duration: 5, length: 220500, sampleRate: 44100, numberOfChannels: 1,
      getChannelData: () => new Float32Array(220500),
    });
    globalThis.AudioContext = class {
      state = 'running'; destination = {}; currentTime = 0;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      decodeAudioData = mockDecode4;
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, getByteFrequencyData() {} }; }
      createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    } as unknown as typeof AudioContext;

    await playerStore.loadTrack('track-ps');
    await playerStore.analyzeTrack();

    expect(mockSaveProcessingState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'track-ps:analyze', tool: 'analyze' })
    );
    expect(mockDeleteProcessingState).toHaveBeenCalledWith('track-ps:analyze');
  });
});

// ──────────────────────────────────────────────
// autoBookmarks() — per-track guard & structure cache
// ──────────────────────────────────────────────
describe('autoBookmarks()', () => {
  it('uses cached structureSegments without calling worker', async () => {
    mockGetTrackMeta.mockResolvedValue({
      id: 'track-struct',
      structureSegments: [
        { start: 0, end: 30, label: 'イントロ' },
        { start: 30, end: 90, label: 'サビ' },
      ],
    });
    mockGetAudioFile.mockResolvedValue({ data: new ArrayBuffer(4), mimeType: 'audio/mp3' });
    const mockDecode5 = vi.fn().mockResolvedValue({
      duration: 90, length: 90 * 44100, sampleRate: 44100, numberOfChannels: 2,
      getChannelData: () => new Float32Array(90 * 44100),
    });
    globalThis.AudioContext = class {
      state = 'running'; destination = {}; currentTime = 0;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      decodeAudioData = mockDecode5;
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, getByteFrequencyData() {} }; }
      createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    } as unknown as typeof AudioContext;

    await playerStore.loadTrack('track-struct');
    await playerStore.autoBookmarks();

    // Should use cache; API not called
    expect(mockApiAnalyzeStructure).not.toHaveBeenCalled();
    // Bookmarks generated from cached segments
    const bms = get(playerStore.bookmarks);
    expect(bms).toHaveLength(2);
    expect(bms[0].label).toBe('イントロ');
    expect(bms[1].label).toBe('サビ');
  });

  it('calls worker, saves structureSegments, and sets bookmarks when no cache', async () => {
    mockGetTrackMeta.mockResolvedValue({ id: 'track-struct2' });
    mockGetAudioFile.mockResolvedValue({ data: new ArrayBuffer(4), mimeType: 'audio/mp3' });
    const mockDecode6 = vi.fn().mockResolvedValue({
      duration: 60, length: 60 * 44100, sampleRate: 44100, numberOfChannels: 2,
      getChannelData: () => new Float32Array(60 * 44100),
    });
    globalThis.AudioContext = class {
      state = 'running'; destination = {}; currentTime = 0;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      decodeAudioData = mockDecode6;
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect() {}, getByteFrequencyData() {} }; }
      createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    } as unknown as typeof AudioContext;

    mockApiAnalyzeStructure.mockResolvedValue({
      segments: [{ start: 0, end: 20, label: '' }, { start: 20, end: 60, label: '' }],
      bookmarks: [{ id: 'auto-0', label: '', a: 0, b: 20 }, { id: 'auto-1', label: '', a: 20, b: 60 }],
      beats: [],
      downbeats: [],
      elapsed_seconds: 1,
    });

    await playerStore.loadTrack('track-struct2');
    await playerStore.autoBookmarks();

    expect(mockApiAnalyzeStructure).toHaveBeenCalledOnce();
    // Bookmarks created from segments
    const bms = get(playerStore.bookmarks);
    expect(bms).toHaveLength(2);
    // structureSegments saved to meta
    expect(mockSaveTrackMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        structureSegments: expect.arrayContaining([
          expect.objectContaining({ start: 0, end: 20 }),
        ]),
      })
    );
    expect(mockDeleteProcessingState).toHaveBeenCalledWith('track-struct2:structure');
  });
});
