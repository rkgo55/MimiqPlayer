import type { WaveformData } from '../types';

/**
 * Extract waveform peaks from AudioBuffer for visualization
 */
export function extractWaveformData(
  audioBuffer: AudioBuffer,
  targetSamples = 800,
): WaveformData {
  const channelData = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(channelData.length / targetSamples);
  const peaks = new Float32Array(targetSamples);

  for (let i = 0; i < targetSamples; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize; j++) {
      const abs = Math.abs(channelData[start + j] || 0);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  return {
    peaks,
    length: targetSamples,
    duration: audioBuffer.duration,
  };
}
