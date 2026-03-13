/**
 * Tests for AudioAnalyzer.ts
 *
 * Essentia.js (WASM) is injected via the _setEssentia helper so that tests run
 * entirely in jsdom without needing to load or initialise the WASM binary.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCurrentChord,
  analyzeBPM,
  analyzeKey,
  analyzeChords,
  _setEssentia,
  type ChordInfo,
} from '../AudioAnalyzer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal AudioBuffer-like object for testing */
function makeAudioBuffer(duration = 3.0, sampleRate = 44100): AudioBuffer {
  const length = Math.floor(duration * sampleRate);
  return {
    duration,
    sampleRate,
    length,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

/** Creates an Emscripten-style VectorString */
function makeVectorString(items: string[]) {
  return {
    size: () => items.length,
    get: (i: number) => items[i],
  };
}

/** Creates a mock Essentia instance */
function makeMockEssentia(opts: {
  bpm?: number;
  key?: string;
  scale?: string;
  chords?: string[];
} = {}) {
  const {
    bpm = 120,
    key = 'C',
    scale = 'major',
    chords = ['Am', 'Am', 'G', 'G', 'C'],
  } = opts;

  return {
    audioBufferToMonoSignal: (buf: AudioBuffer) => buf.getChannelData(0),
    arrayToVector: (_arr: Float32Array) => ({ delete: () => {} }),
    PercivalBpmEstimator: () => ({ bpm }),
    KeyExtractor: () => ({ key, scale, strength: 0.9 }),
    TonalExtractor: () => ({
      chords_progression: makeVectorString(chords),
    }),
  };
}

// ---------------------------------------------------------------------------
// getCurrentChord (pure JS, no WASM needed)
// ---------------------------------------------------------------------------

describe('getCurrentChord', () => {
  const sample: ChordInfo[] = [
    { time: 0,    chord: 'Am' },
    { time: 4.0,  chord: 'F'  },
    { time: 8.0,  chord: 'C'  },
    { time: 12.0, chord: 'G'  },
  ];

  it('returns empty string for empty chord list', () => {
    expect(getCurrentChord([], 5)).toBe('');
  });

  it('returns first chord at time 0', () => {
    expect(getCurrentChord(sample, 0)).toBe('Am');
  });

  it('returns correct chord exactly at transition', () => {
    expect(getCurrentChord(sample, 4.0)).toBe('F');
  });

  it('returns chord in the middle of a segment', () => {
    expect(getCurrentChord(sample, 9.5)).toBe('C');
  });

  it('returns last chord when time exceeds all chord entries', () => {
    expect(getCurrentChord(sample, 100)).toBe('G');
  });

  it('returns first chord when time is before first entry', () => {
    // time 0 has 'Am', so any time < 0 should not match — but time 0 does
    expect(getCurrentChord(sample, 0.5)).toBe('Am');
  });
});

// ---------------------------------------------------------------------------
// analyzeBPM
// ---------------------------------------------------------------------------

describe('analyzeBPM', () => {
  beforeEach(() => _setEssentia(makeMockEssentia({ bpm: 128 })));
  afterEach(() => _setEssentia(null));

  it('returns BPM value from Essentia', async () => {
    expect(await analyzeBPM(makeAudioBuffer())).toBe(128);
  });

  it('rounds floating-point BPM', async () => {
    _setEssentia(makeMockEssentia({ bpm: 119.7 }));
    expect(await analyzeBPM(makeAudioBuffer())).toBe(120);
  });

  it('returns 0 if Essentia throws', async () => {
    _setEssentia({
      audioBufferToMonoSignal: () => new Float32Array(1),
      arrayToVector: () => ({ delete: () => {} }),
      PercivalBpmEstimator: () => { throw new Error('crash'); },
    });
    expect(await analyzeBPM(makeAudioBuffer())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// analyzeKey
// ---------------------------------------------------------------------------

describe('analyzeKey', () => {
  afterEach(() => _setEssentia(null));

  it('formats C major as "C メジャー"', async () => {
    _setEssentia(makeMockEssentia({ key: 'C', scale: 'major' }));
    expect(await analyzeKey(makeAudioBuffer())).toBe('C メジャー');
  });

  it('formats A minor as "A マイナー"', async () => {
    _setEssentia(makeMockEssentia({ key: 'A', scale: 'minor' }));
    expect(await analyzeKey(makeAudioBuffer())).toBe('A マイナー');
  });

  it('formats F# major as "F# メジャー"', async () => {
    _setEssentia(makeMockEssentia({ key: 'F#', scale: 'major' }));
    expect(await analyzeKey(makeAudioBuffer())).toBe('F# メジャー');
  });

  it('returns empty string if Essentia throws', async () => {
    _setEssentia({
      audioBufferToMonoSignal: () => new Float32Array(1),
      arrayToVector: () => ({ delete: () => {} }),
      KeyExtractor: () => { throw new Error('crash'); },
    });
    expect(await analyzeKey(makeAudioBuffer())).toBe('');
  });
});

// ---------------------------------------------------------------------------
// analyzeChords
// ---------------------------------------------------------------------------

describe('analyzeChords', () => {
  afterEach(() => _setEssentia(null));

  it('deduplicates consecutive identical chords', async () => {
    const frames = [...Array(10).fill('Am'), ...Array(10).fill('G')];
    _setEssentia(makeMockEssentia({ chords: frames }));
    const result = await analyzeChords(makeAudioBuffer(10), 0);
    expect(result.length).toBe(2);
    expect(result[0].chord).toBe('Am');
    expect(result[1].chord).toBe('G');
  });

  it('skips "N" (no chord) frames', async () => {
    _setEssentia(makeMockEssentia({ chords: ['N', 'N', 'Am', 'Am'] }));
    const result = await analyzeChords(makeAudioBuffer(5), 0);
    expect(result.every((c) => c.chord !== 'N')).toBe(true);
  });

  it('returns empty array when all frames are N', async () => {
    _setEssentia(makeMockEssentia({ chords: ['N', 'N', 'N'] }));
    expect(await analyzeChords(makeAudioBuffer(3), 0)).toEqual([]);
  });

  it('assigns correct start time for first chord', async () => {
    _setEssentia(makeMockEssentia({ chords: ['Am', 'G'] }));
    const result = await analyzeChords(makeAudioBuffer(5), 0);
    expect(result[0].time).toBeCloseTo(0, 5);
  });

  it('assigns correct start time for second chord', async () => {
    const sampleRate = 44100;
    const hopSize = 4096; // AudioAnalyzer uses hopSize=4096 for TonalExtractor
    const frames = [...Array(5).fill('Am'), ...Array(5).fill('G')];
    _setEssentia(makeMockEssentia({ chords: frames }));
    const result = await analyzeChords(makeAudioBuffer(10), 0);
    expect(result.length).toBe(2);
    expect(result[1].time).toBeCloseTo((5 * hopSize) / sampleRate, 2);
  });

  it('returns empty array if Essentia throws', async () => {
    _setEssentia({
      audioBufferToMonoSignal: () => new Float32Array(1),
      arrayToVector: () => ({ delete: () => {} }),
      TonalExtractor: () => { throw new Error('crash'); },
    });
    expect(await analyzeChords(makeAudioBuffer(3), 0)).toEqual([]);
  });
});
