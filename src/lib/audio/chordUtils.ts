import type { ChordInfo } from '../types';

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
 * Returns the chord label active at `currentTime`.
 * Returns an empty string when no chord is active yet.
 */
export function getCurrentChord(chords: ChordInfo[], currentTime: number): string {
  if (chords.length === 0) return '';

  let current = '';
  for (const c of chords) {
    if (c.time <= currentTime) {
      current = c.chord;
    } else {
      break;
    }
  }
  return current;
}
