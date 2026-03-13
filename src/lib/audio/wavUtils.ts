/**
 * Utilities for encoding and decoding 16-bit PCM stereo WAV files.
 *
 * The WAV format used here is identical to the one produced by
 * StemSeparationWorker (2 ch, 16-bit PCM, 44 100 Hz), so these
 * functions can be used to decode worker output and re-encode merged results.
 */

/** Encode stereo Float32Arrays to a 16-bit PCM WAV ArrayBuffer (44 100 Hz) */
export function encodeWavStereo16(
  left: Float32Array,
  right: Float32Array,
  sampleRate = 44100,
): ArrayBuffer {
  const numSamples = left.length;
  const numChannels = 2;
  const bitsPerSample = 16;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);         // fmt chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // byte rate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // block align
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true); off += 2;
    view.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true); off += 2;
  }
  return buf;
}

/**
 * Decode a 16-bit PCM stereo WAV ArrayBuffer (as produced by encodeWavStereo16)
 * into separate left/right Float32Arrays.
 *
 * The header is assumed to be exactly 44 bytes (standard WAV with no extra chunks).
 */
export function decodeWavStereo16(buf: ArrayBuffer): { left: Float32Array; right: Float32Array } {
  const HEADER_BYTES = 44;
  const numSamples = (buf.byteLength - HEADER_BYTES) / 4; // 2 channels × 2 bytes
  const view = new DataView(buf);
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);
  let off = HEADER_BYTES;
  for (let i = 0; i < numSamples; i++) {
    const l = view.getInt16(off, true); off += 2;
    const r = view.getInt16(off, true); off += 2;
    left[i]  = l < 0 ? l / 0x8000 : l / 0x7fff;
    right[i] = r < 0 ? r / 0x8000 : r / 0x7fff;
  }
  return { left, right };
}
