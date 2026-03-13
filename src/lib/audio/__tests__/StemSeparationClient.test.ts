/**
 * StemSeparationClient unit tests
 *
 * Worker is mocked to simulate model download → processing → result / error flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal stereo WAV ArrayBuffer (44100 Hz, 16-bit, N samples) */
function makeSilentWav(samples = 44100): ArrayBuffer {
  const dataSize = samples * 4; // stereo × 2 bytes
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 2, true);  // stereo
  view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, dataSize, true);
  return buf;
}

/** Create fake stems record (4 silent WAV buffers) */
function fakeStems(): Record<string, ArrayBuffer> {
  return {
    vocals: makeSilentWav(),
    drums:  makeSilentWav(),
    bass:   makeSilentWav(),
    other:  makeSilentWav(),
  };
}

// ── Mock Worker implementation ────────────────────────────────────────────────

type EventHandler = (event: { data: unknown }) => void;

class MockWorker {
  private handlers: Map<string, EventHandler[]> = new Map();
  /** Captured messages sent to the worker */
  sentMessages: unknown[] = [];

  postMessage(data: unknown) {
    this.sentMessages.push(data);
  }

  addEventListener(type: string, handler: EventHandler) {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  /** Simulate worker sending a message back to main thread */
  emit(data: unknown) {
    for (const h of this.handlers.get('message') ?? []) {
      h({ data });
    }
  }

  /** Simulate a worker error */
  emitError(message: string) {
    for (const h of this.handlers.get('error') ?? []) {
      (h as unknown as (e: ErrorEvent) => void)(
        new ErrorEvent('error', { message }),
      );
    }
  }

  terminate() {}
}

// ── Mock Worker constructor ──────────────────────────────────────────────────

let mockWorkerInstance: MockWorker;

// Replace global Worker so StemSeparationClient's `new Worker(...)` returns our mock
const OriginalWorker = globalThis.Worker;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StemSeparationClient', () => {
  beforeEach(async () => {
    // Reset singleton between tests
    vi.resetModules();

    mockWorkerInstance = new MockWorker();
    // A constructor that returns an object: `new` uses that return value as instance
    const captured = mockWorkerInstance;
    function MockWorkerConstructor(this: unknown) { return captured; }
    // @ts-expect-error – replace global Worker
    globalThis.Worker = MockWorkerConstructor;
  });

  afterEach(() => {
    globalThis.Worker = OriginalWorker;
    vi.clearAllMocks();
  });

  it('sends separate message with left/right Float32Arrays', async () => {
    const { StemSeparationClient } = await import('../StemSeparationClient');
    const client = StemSeparationClient.getInstance();
    const left  = new Float32Array(44100);
    const right = new Float32Array(44100);

    // Start separation (don't await yet)
    const promise = client.separate('track-1', left, right);

    // Verify message was sent
    expect(mockWorkerInstance.sentMessages).toHaveLength(1);
    const msg = mockWorkerInstance.sentMessages[0] as Record<string, unknown>;
    expect(msg.type).toBe('separate');
    expect(msg.id).toBe('track-1');
    expect(msg.left).toBeInstanceOf(Float32Array);
    expect(msg.right).toBeInstanceOf(Float32Array);
    expect((msg.left as Float32Array).length).toBe(44100);

    // Simulate result from worker
    mockWorkerInstance.emit({ type: 'result', id: 'track-1', stems: fakeStems() });

    const result = await promise;
    expect(Object.keys(result.stems).sort()).toEqual(['bass', 'drums', 'other', 'vocals']);
  });

  it('invokes onProcessing callback when worker signals processing', async () => {
    const { StemSeparationClient } = await import('../StemSeparationClient');
    const client = StemSeparationClient.getInstance();
    const onProcessing = vi.fn();

    const left  = new Float32Array(100);
    const right = new Float32Array(100);
    const promise = client.separate('track-2', left, right, { onProcessing });

    mockWorkerInstance.emit({ type: 'processing', id: 'track-2', progress: 10 });
    expect(onProcessing).toHaveBeenCalledOnce();

    // Resolve the promise
    mockWorkerInstance.emit({ type: 'result', id: 'track-2', stems: fakeStems() });
    await promise;
  });

  it('invokes onModelDownload callback during model download', async () => {
    const { StemSeparationClient } = await import('../StemSeparationClient');
    const client = StemSeparationClient.getInstance();
    const onModelDownload = vi.fn();

    const left  = new Float32Array(100);
    const right = new Float32Array(100);
    const promise = client.separate('track-3', left, right, { onModelDownload });

    mockWorkerInstance.emit({
      type: 'model_download',
      id: 'track-3',
      progress: 42,
      message: 'モデルをダウンロード中… 42%',
    });

    expect(onModelDownload).toHaveBeenCalledWith('モデルをダウンロード中… 42%', 42);

    mockWorkerInstance.emit({ type: 'result', id: 'track-3', stems: fakeStems() });
    await promise;
  });

  it('rejects promise on worker error message', async () => {
    const { StemSeparationClient } = await import('../StemSeparationClient');
    const client = StemSeparationClient.getInstance();

    const left  = new Float32Array(100);
    const right = new Float32Array(100);
    const promise = client.separate('track-4', left, right);

    mockWorkerInstance.emit({ type: 'error', id: 'track-4', message: 'WASM failed' });

    await expect(promise).rejects.toThrow('WASM failed');
  });

  it('rejects promise when worker crashes (ErrorEvent)', async () => {
    const { StemSeparationClient } = await import('../StemSeparationClient');
    const client = StemSeparationClient.getInstance();

    const left  = new Float32Array(100);
    const right = new Float32Array(100);
    const promise = client.separate('track-5', left, right);

    mockWorkerInstance.emitError('Worker crashed');

    await expect(promise).rejects.toThrow('Worker crashed');
  });
});
