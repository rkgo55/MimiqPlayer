import type { ChordInfo } from './AudioAnalyzer';

export interface WorkerAnalyzeResult {
  bpm: number;
  key: string;
  chords: ChordInfo[];
}

type PendingRequest =
  | {
      kind: 'warmup';
      resolve: () => void;
      reject: (reason?: unknown) => void;
    }
  | {
      kind: 'analyze';
      resolve: (value: WorkerAnalyzeResult) => void;
      reject: (reason?: unknown) => void;
    };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./AudioAnalysisWorker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { id: number; type: 'result'; payload: WorkerAnalyzeResult }
      | { id: number; type: 'ok' }
      | { id: number; type: 'error'; error: string };

    const request = pending.get(data.id);
    if (!request) return;

    pending.delete(data.id);

    if (data.type === 'error') {
      request.reject(new Error(data.error));
      return;
    }

    if (data.type === 'ok') {
      if (request.kind === 'warmup') {
        request.resolve();
      } else {
        request.reject(new Error('Unexpected warmup response for analyze request'));
      }
      return;
    }

    if (request.kind === 'analyze') {
      request.resolve(data.payload);
      return;
    }

    request.reject(new Error('Unexpected analyze response for warmup request'));
  };

  worker.onerror = (event) => {
    const error = event.error ?? new Error(event.message || 'Audio analysis worker crashed');
    for (const [, request] of pending) {
      request.reject(error);
    }
    pending.clear();
    // Reset so ensureWorker() creates a fresh Worker on the next call
    worker = null;
  };

  return worker;
}

function audioBufferToMonoFloat32(audioBuffer: AudioBuffer): Float32Array {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  if (channels === 1) {
    return audioBuffer.getChannelData(0).slice();
  }

  const mono = new Float32Array(length);
  const channelData = Array.from({ length: channels }, (_, i) => audioBuffer.getChannelData(i));

  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += channelData[c][i];
    }
    mono[i] = sum / channels;
  }

  return mono;
}

export async function warmupAudioAnalysisWorker(): Promise<void> {
  const w = ensureWorker();
  const id = nextId++;

  return new Promise<void>((resolve, reject) => {
    pending.set(id, { kind: 'warmup', resolve, reject });
    w.postMessage({ id, type: 'warmup' });
  });
}

export async function analyzeAudioInWorker(
  audioBuffer: AudioBuffer,
  minHoldSeconds = 0.75
): Promise<WorkerAnalyzeResult> {
  const w = ensureWorker();
  const mono = audioBufferToMonoFloat32(audioBuffer);
  const id = nextId++;

  return new Promise<WorkerAnalyzeResult>((resolve, reject) => {
    pending.set(id, { kind: 'analyze', resolve, reject });
    w.postMessage(
      {
        id,
        type: 'analyze',
        payload: {
          mono,
          sampleRate: audioBuffer.sampleRate,
          minHoldSeconds,
        },
      },
      [mono.buffer]
    );
  });
}
