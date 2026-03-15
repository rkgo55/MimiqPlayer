import type { ChordInfo } from './AudioAnalyzer';

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const ENHARMONIC: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

function transposeNote(note: string, semitones: number): string {
  if (semitones === 0) return note;
  const normalized = ENHARMONIC[note] ?? note;
  const idx = NOTES_SHARP.indexOf(normalized as (typeof NOTES_SHARP)[number]);
  if (idx === -1) return note;
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return NOTES_SHARP[newIdx];
}

/**
 * Transpose a key string (e.g. "C メジャー") by the given semitones.
 * Only the root note is transposed; the scale label is preserved.
 */
export function transposeKey(key: string, semitones: number): string {
  if (!key || semitones === 0) return key;
  const spaceIdx = key.indexOf(' ');
  if (spaceIdx === -1) return transposeNote(key, semitones);
  return transposeNote(key.slice(0, spaceIdx), semitones) + key.slice(spaceIdx);
}

/**
 * Transpose a chord in Harte notation (e.g. "F#:min", "C:maj") by the given semitones.
 * "N" (no chord) is returned unchanged.
 */
export function transposeChord(chord: string, semitones: number): string {
  if (!chord || semitones === 0 || chord === 'N') return chord;
  const colonIdx = chord.indexOf(':');
  if (colonIdx === -1) return transposeNote(chord, semitones);
  return transposeNote(chord.slice(0, colonIdx), semitones) + chord.slice(colonIdx);
}

/**
 * Post-processes raw chord frame data from Essentia's TonalExtractor into a
 * deduplicated, merged list of ChordInfo entries.
 *
 * Shared between AudioAnalyzer.ts (main thread) and AudioAnalysisWorker.ts
 * (Web Worker) to avoid algorithm drift.
 *
 * @param frames - Raw chord label per analysis frame (already converted from
 *   Essentia's VectorString). "N" (no chord) entries are skipped.
 * @param hopSize - Number of audio samples per analysis frame.
 * @param sampleRate - Audio sample rate in Hz.
 * @param minHoldSeconds - Minimum duration before a chord change is reported.
 *   Shorter segments are absorbed into the preceding chord.
 */
export function processChordFrames(
  frames: string[],
  hopSize: number,
  sampleRate: number,
  minHoldSeconds: number,
): ChordInfo[] {
  const minHoldFrames = Math.ceil((minHoldSeconds * sampleRate) / hopSize);

  // 1. Collect raw entries, skipping "N" (no chord)
  const raw: ChordInfo[] = [];
  for (let i = 0; i < frames.length; i++) {
    const chord = frames[i];
    if (!chord || chord === 'N') continue;
    raw.push({ time: (i * hopSize) / sampleRate, chord });
  }

  if (raw.length === 0) return [];

  // 2. De-duplicate consecutive identical chords
  const deduped: ChordInfo[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].chord !== deduped[deduped.length - 1].chord) {
      deduped.push(raw[i]);
    }
  }

  if (deduped.length <= 1) return deduped;

  // 3. Merge segments shorter than minHoldFrames into the previous chord
  const merged: ChordInfo[] = [deduped[0]];
  for (let i = 1; i < deduped.length; i++) {
    const prevTime = merged[merged.length - 1].time;
    const duration = deduped[i].time - prevTime;
    const holdFrames = (duration * sampleRate) / hopSize;

    if (holdFrames < minHoldFrames) {
      // Short segment – absorb into the previous chord
      continue;
    }
    merged.push(deduped[i]);
  }

  return merged;
}
