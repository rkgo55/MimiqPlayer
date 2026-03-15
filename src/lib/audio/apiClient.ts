/**
 * MimiqPlayer — Modal.com API client
 *
 * Typed wrappers for the three server-side endpoints:
 *   POST /analyze    — BPM, key, chords
 *   POST /structure  — segment boundaries + functional labels
 *   POST /separate   — 6-stem separation
 *
 * All requests use multipart/form-data with the audio file as `file`.
 * Authentication: Bearer token from settings.
 */

import type { LoopBookmark, StemType } from '../types';

// ---------------------------------------------------------------------------
// Response types (matching Python dataclasses in core/)
// ---------------------------------------------------------------------------

export interface ChordInfo {
  time: number;
  chord: string;
}

export interface AnalyzeResponse {
  bpm: number;
  key: string;
  key_confidence: number;
  chords: ChordInfo[];
  beats: number[];
  elapsed_seconds: number;
}

export interface StructureSegment {
  start: number;
  end: number;
  label: string;
}

export interface StructureResponse {
  segments: StructureSegment[];
  /** Pre-formatted LoopBookmarks ready for the player store */
  bookmarks: LoopBookmark[];
  beats: number[];
  downbeats: number[];
  elapsed_seconds: number;
}

export interface SeparateResponse {
  stems: Partial<Record<StemType, ArrayBuffer>>;
  stem_names: string[];
  elapsed_seconds: number;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ApiClientOptions {
  endpoint: string;
  apiKey: string;
  /** Request timeout in milliseconds. Default: 300_000 (5 min) */
  timeoutMs?: number;
}

export function createApiClient(options: ApiClientOptions) {
  const { endpoint, apiKey } = options;
  const timeoutMs = options.timeoutMs ?? 300_000;

  /** Interval between retries when the server returns 202 (in-flight dedup). */
  const POLL_INTERVAL_MS = 60_000; // 1 minute
  /** Maximum number of polling retries before giving up (≈ 30 minutes). */
  const MAX_POLL_ATTEMPTS = 30;

  /**
   * A normalised base URL (strips trailing slash).
   */
  const base = endpoint.replace(/\/+$/, '');

  function headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
    };
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
  }

  /**
   * Raw fetch wrapper. Returns the Response for both success (2xx) and
   * in-flight (202).  Throws ApiError for other non-OK statuses.
   */
  async function postRaw(path: string, form: FormData): Promise<Response> {
    const url = path ? `${base}${path}` : base;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // 202 = server is processing; caller retries after delay
    if (response.status === 202) return response;

    if (!response.ok) {
      let detail = '';
      try {
        const json = await response.json();
        detail = json?.error ?? json?.detail ?? '';
      } catch {
        // ignore
      }
      throw new ApiError(
        `API error on ${path}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
        response.status,
        path,
      );
    }

    return response;
  }

  async function postForm<T>(path: string, form: FormData): Promise<T> {
    const response = await postRaw(path, form);
    return response.json() as Promise<T>;
  }

  /**
   * Post a tool request with automatic polling on 202 responses.
   * `buildForm` is called on every attempt so a fresh FormData is used each time.
   * `parseResponse` lets callers choose a non-JSON response parser (e.g. binary stems).
   */
  async function postToolWithPolling<T>(
    buildForm: () => FormData,
    parseResponse: (res: Response) => Promise<T> = (r) => r.json() as Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      const form = buildForm();
      const response = await postRaw('', form);
      if (response.status === 202) {
        if (attempt >= MAX_POLL_ATTEMPTS) {
          throw new ApiError('API processing timed out after polling', 408, '/');
        }
        const retryAfter = (await response.json().catch(() => ({}))).retry_after_ms ?? POLL_INTERVAL_MS;
        await sleep(retryAfter);
        continue;
      }
      return parseResponse(response);
    }
    // unreachable, but TypeScript needs a return
    throw new ApiError('Polling loop exited unexpectedly', 500, '/');
  }

  return {
    /**
     * Analyze a track: BPM, key, chords, beats.
     * Polls the server on 202 (in-flight dedup) with 1-minute retry interval.
     */
    async analyze(audioData: ArrayBuffer, contentHash?: string): Promise<AnalyzeResponse> {
      return postToolWithPolling<AnalyzeResponse>(() => {
        const form = new FormData();
        form.append('file', new Blob([audioData]), 'audio');
        if (contentHash) form.append('content_hash', contentHash);
        form.append('tool', 'analyze');
        return form;
      });
    },

    /**
     * Analyze music structure: segment boundaries with functional labels.
     * Returns pre-formatted LoopBookmarks ready to store.
     * Polls the server on 202 (in-flight dedup) with 1-minute retry interval.
     */
    async analyzeStructure(audioData: ArrayBuffer, contentHash?: string): Promise<StructureResponse> {
      return postToolWithPolling<StructureResponse>(() => {
        const form = new FormData();
        form.append('file', new Blob([audioData]), 'audio');
        if (contentHash) form.append('content_hash', contentHash);
        form.append('tool', 'structure');
        return form;
      });
    },

    /**
     * Like analyzeStructure, but passes pre-separated stems so the server skips
     * its internal demucs run. stems should include bass, drums, other, vocals.
     * Polls the server on 202 (in-flight dedup) with 1-minute retry interval.
     */
    async analyzeStructureWithStems(
      audioData: ArrayBuffer,
      stems: Partial<Record<StemType, ArrayBuffer>>,
      contentHash?: string,
    ): Promise<StructureResponse> {
      return postToolWithPolling<StructureResponse>(() => {
        const form = new FormData();
        form.append('file', new Blob([audioData]), 'audio');
        if (contentHash) form.append('content_hash', contentHash);
        for (const [name, buf] of Object.entries(stems)) {
          if (buf) {
            form.append(name, new Blob([buf], { type: 'audio/wav' }), `${name}.wav`);
          }
        }
        form.append('tool', 'structure');
        return form;
      });
    },

    /**
     * Separate a track into 6 stems (drums, bass, other, vocals, guitar, piano).
     * Returns binary OGG stems (no base64 overhead).
     * Polls the server on 202 (in-flight dedup) with 1-minute retry interval.
     */
    async separate(audioData: ArrayBuffer, contentHash?: string): Promise<SeparateResponse> {
      return postToolWithPolling<SeparateResponse>(
        () => {
          const form = new FormData();
          form.append('file', new Blob([audioData]), 'audio');
          if (contentHash) form.append('content_hash', contentHash);
          form.append('tool', 'separate');
          return form;
        },
        (res) => res.arrayBuffer().then(parseStemsBinary),
      );
    },

    /**
     * Health check. Returns true when the API is reachable and authenticated.
     */
    async healthCheck(): Promise<boolean> {
      try {
        const response = await fetch(`${base}/health`, {
          headers: headers(),
          signal: AbortSignal.timeout(10_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// ---------------------------------------------------------------------------
// Singleton factory — lazily initialized from settings store
// ---------------------------------------------------------------------------

let _client: ApiClient | null = null;

export function getApiClient(endpoint: string, apiKey: string): ApiClient {
  // Re-create if settings changed
  if (
    _client === null ||
    _lastEndpoint !== endpoint ||
    _lastKey !== apiKey
  ) {
    _client = createApiClient({ endpoint, apiKey });
    _lastEndpoint = endpoint;
    _lastKey = apiKey;
  }
  return _client;
}

let _lastEndpoint = '';
let _lastKey = '';

// ---------------------------------------------------------------------------
// Helpers for converting API responses to frontend model types
// ---------------------------------------------------------------------------

/**
 * Decode a base64-encoded string to an ArrayBuffer.
 * Used as a fallback for the legacy JSON API response format.
 */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Parse the binary stems response from the server.
 *
 * Binary format:
 *   [4 bytes uint32 LE] JSON header length
 *   [N bytes]           JSON header (UTF-8)
 *   [stem1 bytes]       Raw OGG data for stem 1
 *   [stem2 bytes]       Raw OGG data for stem 2
 *   ...
 */
export function parseStemsBinary(buffer: ArrayBuffer): SeparateResponse {
  const view = new DataView(buffer);
  const headerLen = view.getUint32(0, true);
  const headerBytes = new Uint8Array(buffer, 4, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as {
    stem_names: string[];
    sizes: number[];
    elapsed_seconds: number;
  };

  const stems: Partial<Record<StemType, ArrayBuffer>> = {};
  let offset = 4 + headerLen;
  for (let i = 0; i < header.stem_names.length; i++) {
    const name = header.stem_names[i] as StemType;
    const size = header.sizes[i];
    stems[name] = buffer.slice(offset, offset + size);
    offset += size;
  }

  return {
    stems,
    stem_names: header.stem_names,
    elapsed_seconds: header.elapsed_seconds,
  };
}
