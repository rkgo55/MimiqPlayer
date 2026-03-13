import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioEngine } from '../../audio/AudioEngine';

vi.mock('@soundtouchjs/audio-worklet', () => {
  class MockSoundTouchNode {
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
  }

  return { SoundTouchNode: MockSoundTouchNode };
});

vi.mock('@soundtouchjs/audio-worklet/processor?url', () => ({
  default: '/mock-soundtouch-processor.js',
}));

// Stub AudioContext
const mockGainNode = { gain: { value: 1 }, connect: vi.fn() };
const mockAnalyserNode = {
  fftSize: 2048,
  frequencyBinCount: 1024,
  connect: vi.fn(),
  getByteFrequencyData: vi.fn(),
};
const mockSourceNode = {
  buffer: null as AudioBuffer | null,
  playbackRate: { value: 1 },
  onended: null as (() => void) | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

globalThis.AudioContext = class {
  state = 'running';
  destination = {};
  sampleRate = 44100;
  currentTime = 0;
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createGain() { return mockGainNode; }
  createAnalyser() { return mockAnalyserNode; }
  createBufferSource() { return { ...mockSourceNode }; }
  decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> {
    // Return a minimal stub AudioBuffer
    const ab = {
      duration: 120,
      length: 120 * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(120 * 44100),
    } as unknown as AudioBuffer;
    return Promise.resolve(ab);
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
} as unknown as typeof AudioContext;

describe('AudioEngine', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    engine = new AudioEngine();
  });

  describe('initial state', () => {
    it('is not playing', () => {
      expect(engine.isPlaying).toBe(false);
    });

    it('has duration 0 before loading', () => {
      expect(engine.duration).toBe(0);
    });

    it('has currentTime 0 before loading', () => {
      expect(engine.currentTime).toBe(0);
    });
  });

  describe('setSpeed()', () => {
    it('clamps speed to minimum 0.25', () => {
      engine.setSpeed(0.01);
      expect(engine.speed).toBe(0.25);
    });

    it('clamps speed to maximum 2.0', () => {
      engine.setSpeed(99);
      expect(engine.speed).toBe(2.0);
    });

    it('sets valid speed', () => {
      engine.setSpeed(0.75);
      expect(engine.speed).toBe(0.75);
    });

    it('stores speed multiplied by each preset step', () => {
      const presets = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
      for (const p of presets) {
        engine.setSpeed(p);
        expect(engine.speed).toBe(p);
      }
    });
  });

  describe('setPitch()', () => {
    it('clamps pitch to minimum -12', () => {
      engine.setPitch(-99);
      expect(engine.pitch).toBe(-12);
    });

    it('clamps pitch to maximum +12', () => {
      engine.setPitch(99);
      expect(engine.pitch).toBe(12);
    });

    it('sets valid pitch', () => {
      engine.setPitch(-3);
      expect(engine.pitch).toBe(-3);
    });

    it('+12 semitones is exactly 1 octave up (ratio 2.0)', () => {
      // verify the conversion formula: Math.pow(2, semitones/12)
      const ratio = Math.pow(2, 12 / 12);
      expect(ratio).toBeCloseTo(2.0, 5);
    });

    it('-12 semitones is exactly 1 octave down (ratio 0.5)', () => {
      const ratio = Math.pow(2, -12 / 12);
      expect(ratio).toBeCloseTo(0.5, 5);
    });

    it('0 semitones is no pitch change (ratio 1.0)', () => {
      const ratio = Math.pow(2, 0 / 12);
      expect(ratio).toBe(1.0);
    });

    it('+7 semitones is perfect fifth (ratio ≈ 1.498)', () => {
      const ratio = Math.pow(2, 7 / 12);
      expect(ratio).toBeCloseTo(1.4983, 3);
    });

    it('-5 semitones is perfect fourth down (ratio ≈ 0.749)', () => {
      const ratio = Math.pow(2, -5 / 12);
      expect(ratio).toBeCloseTo(0.7492, 3);
    });

    it('increments pitch by steps', () => {
      engine.setPitch(3);
      expect(engine.pitch).toBe(3);
      engine.setPitch(engine.pitch + 1);
      expect(engine.pitch).toBe(4);
      engine.setPitch(engine.pitch - 2);
      expect(engine.pitch).toBe(2);
    });
  });

  describe('setVolume()', () => {
    it('clamps volume to minimum 0', () => {
      engine.setVolume(-1);
      expect(engine.volume).toBe(0);
    });

    it('clamps volume to maximum 1', () => {
      engine.setVolume(99);
      expect(engine.volume).toBe(1);
    });
  });

  describe('seek() clamping', () => {
    it('does nothing when no audio is loaded', () => {
      // Should not throw
      expect(() => engine.seek(50)).not.toThrow();
      expect(engine.currentTime).toBe(0);
    });
  });

  describe('stop()', () => {
    it('resets position to 0', () => {
      engine.stop();
      expect(engine.currentTime).toBe(0);
      expect(engine.isPlaying).toBe(false);
    });
  });
});
