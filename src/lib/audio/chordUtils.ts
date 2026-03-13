import type { ChordInfo } from './AudioAnalyzer';

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
