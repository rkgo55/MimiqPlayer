import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock external dependencies before importing playerStore
vi.mock('../../storage/db', () => ({
  getAudioFile: vi.fn().mockResolvedValue(null),
  getAllTracks: vi.fn().mockResolvedValue([]),
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
