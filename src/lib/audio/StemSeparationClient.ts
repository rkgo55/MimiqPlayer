import type { StemType } from '../types';
import type { WorkerOutMessage } from './OrtStemSeparationWorker';

export interface StemResult {
  stems: Partial<Record<StemType, ArrayBuffer>>;
}

export interface StemProgressCallback {
  onModelDownload?: (status: string, progress?: number) => void;
  onProcessing?: () => void;
  /** Override model URL (optional). Falls back to default htdemucs-4s if not provided. */
  modelUrl?: string;
  /** Cache key for the model. Must match modelUrl if provided. */
  modelCacheKey?: string;
  /** Number of stems the model outputs (4 or 6, default 4) */
  stemCount?: 4 | 6;
  /**
   * Fixed chunk size the ONNX model was exported with (samples).
   * Must match OnnxModelOption.chunkSamples for the selected model.
   */
  chunkSamples?: number;
}

/**
 * Client for the StemSeparationWorker.
 * Singleton worker is reused across calls; the model stays cached in the Worker.
 */
export class StemSeparationClient {
  private static instance: StemSeparationClient | null = null;
  private worker: Worker;
  private pendingCallbacks = new Map<
    string,
    {
      resolve: (result: StemResult) => void;
      reject: (err: Error) => void;
      progress?: StemProgressCallback;
    }
  >();
  private globalModelListeners: Array<(status: string, progress?: number) => void> = [];
  private globalBackendListeners: Array<(backend: 'webgpu' | 'wasm') => void> = [];
  private pendingCacheChecks = new Map<string, (cached: boolean) => void>();

  private constructor() {
    this.worker = new Worker(
      new URL('./OrtStemSeparationWorker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.addEventListener('message', this.handleMessage.bind(this));
    this.worker.addEventListener('error', this.handleWorkerError.bind(this));
  }

  static getInstance(): StemSeparationClient {
    if (!StemSeparationClient.instance) {
      StemSeparationClient.instance = new StemSeparationClient();
    }
    return StemSeparationClient.instance;
  }

  /**
   * Creates a fresh StemSeparationClient instance (not the singleton).
   * Used for parallel segment processing where each segment needs its own Worker.
   * Caller must call `terminate()` after use to clean up the Worker.
   */
  static createNew(): StemSeparationClient {
    return new StemSeparationClient();
  }

  /** Subscribe to model download progress (shown before any track is being processed) */
  onModelDownload(cb: (status: string, progress?: number) => void): () => void {
    this.globalModelListeners.push(cb);
    return () => {
      this.globalModelListeners = this.globalModelListeners.filter((l) => l !== cb);
    };
  }

  /**
   * Subscribe to backend selection events.
   * Called once per session creation with 'webgpu' | 'wasm'.
   */
  onBackendInfo(cb: (backend: 'webgpu' | 'wasm') => void): () => void {
    this.globalBackendListeners.push(cb);
    return () => {
      this.globalBackendListeners = this.globalBackendListeners.filter((l) => l !== cb);
    };
  }

  /**
   * Ask the Worker (which has Cache API access) whether the model weights
   * are already persisted. Resolves within a few milliseconds for cached models.
   */
  isModelCached(): Promise<boolean> {
    return new Promise((resolve) => {
      const id = `cache-check-${Date.now()}-${Math.random()}`;
      this.pendingCacheChecks.set(id, resolve);
      this.worker.postMessage({ type: 'check_model_cached', id });
    });
  }

  /**
   * Separate audio into stems.
   * @param id     Unique request ID (typically the track ID)
   * @param left   Left channel Float32Array at 44 100 Hz
   * @param right  Right channel Float32Array at 44 100 Hz
   * @param progress Optional progress callbacks
   */
  separate(
    id: string,
    left: Float32Array,
    right: Float32Array,
    progress?: StemProgressCallback,
  ): Promise<StemResult> {
    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(id, { resolve, reject, progress });
      // Transfer ownership of both channel buffers to avoid copying
      const leftBuf = left.buffer.slice(0);
      const rightBuf = right.buffer.slice(0);
      const msg: {
        type: 'separate';
        id: string;
        left: Float32Array;
        right: Float32Array;
        modelUrl?: string;
        modelCacheKey?: string;
        stemCount?: 4 | 6;
        chunkSamples?: number;
      } = {
        type: 'separate',
        id,
        left: new Float32Array(leftBuf),
        right: new Float32Array(rightBuf),
      };
      if (progress?.modelUrl) msg.modelUrl = progress.modelUrl;
      if (progress?.modelCacheKey) msg.modelCacheKey = progress.modelCacheKey;
      if (progress?.stemCount) msg.stemCount = progress.stemCount;
      if (progress?.chunkSamples) msg.chunkSamples = progress.chunkSamples;
      this.worker.postMessage(msg, [leftBuf, rightBuf]);
    });
  }

  private handleMessage(event: MessageEvent<WorkerOutMessage>) {
    const msg = event.data;

    if (msg.type === 'model_cache_status') {
      const resolve = this.pendingCacheChecks.get(msg.id);
      if (resolve) {
        this.pendingCacheChecks.delete(msg.id);
        resolve(msg.cached);
      }
      return;
    }

    if (msg.type === 'model_download') {
      // Broadcast to global listeners
      for (const cb of this.globalModelListeners) {
        cb(msg.message, msg.progress);
      }
      // Also forward to per-request callback if any
      this.pendingCallbacks.get(msg.id)?.progress?.onModelDownload?.(msg.message, msg.progress);
      return;
    }

    if (msg.type === 'backend_info') {
      for (const cb of this.globalBackendListeners) cb(msg.backend);
      return;
    }

    const cb = this.pendingCallbacks.get(msg.id);
    if (!cb) return;

    switch (msg.type) {
      case 'processing':
        cb.progress?.onProcessing?.();
        break;
      case 'result':
        this.pendingCallbacks.delete(msg.id);
        cb.resolve({ stems: msg.stems });
        break;
      case 'error':
        this.pendingCallbacks.delete(msg.id);
        cb.reject(new Error(msg.message));
        break;
    }
  }

  private handleWorkerError(event: ErrorEvent) {
    const message = event.message ?? 'Worker crashed';
    for (const [id, cb] of this.pendingCallbacks) {
      cb.reject(new Error(message));
      this.pendingCallbacks.delete(id);
    }
  }

  /** Terminate the worker and clean up resources */
  terminate() {
    this.worker.terminate();
    // Only clear the singleton reference when THIS instance is the singleton
    if (StemSeparationClient.instance === this) {
      StemSeparationClient.instance = null;
    }
  }
}
