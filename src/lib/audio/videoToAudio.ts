import { encodeWavStereo16 } from './wavUtils';

/**
 * Supported video MIME types that browsers can reliably decode via HTMLVideoElement.
 * Used for detection in FileUpload.
 */
export const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/x-m4v',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-matroska',
  'video/avi',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
  'video/3gpp2',
]);

/** Return true if the file is a video that should be converted to audio. */
export function isVideoFile(file: File): boolean {
  if (VIDEO_MIME_TYPES.has(file.type)) return true;
  // Fallback: inspect extension for cases where the browser returns an empty/wrong MIME type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', '3gp', '3g2'].includes(ext);
}

/**
 * Extract the audio track from a video File and return it as a new audio/wav File.
 *
 * Strategy:
 *   Fast path  — `AudioContext.decodeAudioData()` (audio-only containers, some MP4/WebM)
 *   Slow path  — `HTMLVideoElement` + Web Audio API realtime capture at 16× speed
 *                (handles .mov / HEVC / any format the browser can play)
 */
export async function videoToAudio(file: File): Promise<File> {
  const baseName = file.name.replace(/\.[^.]+$/, '');

  // ── Fast path ────────────────────────────────────────────────────────────
  try {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = new AudioContext();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } finally {
      await ctx.close();
    }
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels >= 2 ? audioBuffer.getChannelData(1) : left;
    const wavBuffer = encodeWavStereo16(left, right, audioBuffer.sampleRate);
    return new File([wavBuffer], `${baseName}.wav`, { type: 'audio/wav' });
  } catch {
    // decodeAudioData failed (e.g. .mov / HEVC) — fall through to slow path
  }

  // ── Slow path: HTMLVideoElement capture ──────────────────────────────────
  return extractViaVideoElement(file, baseName);
}

/**
 * Capture audio by playing the video in a hidden HTMLVideoElement at maximum
 * playback speed and collecting raw PCM samples via a ScriptProcessorNode.
 *
 * Typical 3-min video at 16× ≈ 11 s of processing time.
 */
async function extractViaVideoElement(file: File, baseName: string): Promise<File> {
  const SAMPLE_RATE = 44100;
  const objectUrl = URL.createObjectURL(file);

  try {
    // 1. Load metadata to get duration
    const video = document.createElement('video');
    video.src = objectUrl;
    video.preload = 'metadata';
    // Silence output so the user doesn't hear it during extraction
    video.volume = 0;

    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () =>
        reject(new Error(`"${file.name}" を読み込めませんでした。非対応のコーデックの可能性があります。`)),
        { once: true },
      );
      video.load();
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`"${file.name}" の再生時間を取得できませんでした。`);
    }

    const totalSamples = Math.ceil(duration * SAMPLE_RATE);
    const leftBuf = new Float32Array(totalSamples);
    const rightBuf = new Float32Array(totalSamples);
    let writePos = 0;

    // 2. Wire up Web Audio pipeline
    const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });

    const BLOCK = 4096;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = audioCtx.createScriptProcessor(BLOCK, 2, 2);

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.numberOfChannels >= 2
        ? e.inputBuffer.getChannelData(1)
        : inL;
      const copyLen = Math.min(inL.length, totalSamples - writePos);
      if (copyLen <= 0) return;
      leftBuf.set(inL.subarray(0, copyLen), writePos);
      rightBuf.set(inR.subarray(0, copyLen), writePos);
      writePos += copyLen;
    };

    const source = audioCtx.createMediaElementSource(video);
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    // 3. Play at maximum allowed speed
    video.playbackRate = 16;

    await new Promise<void>((resolve, reject) => {
      video.addEventListener('ended', () => resolve(), { once: true });
      video.addEventListener('error', () =>
        reject(new Error(`"${file.name}" の再生中にエラーが発生しました。`)),
        { once: true },
      );
      video.play().catch(reject);
    });

    // Allow the processor to flush its last block
    await new Promise<void>((r) => setTimeout(r, 200));

    processor.disconnect();
    source.disconnect();
    silentGain.disconnect();
    await audioCtx.close();

    // 4. Encode captured samples to WAV
    const captured = writePos;
    const wavBuffer = encodeWavStereo16(
      leftBuf.subarray(0, captured),
      rightBuf.subarray(0, captured),
      SAMPLE_RATE,
    );

    return new File([wavBuffer], `${baseName}.wav`, { type: 'audio/wav' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
