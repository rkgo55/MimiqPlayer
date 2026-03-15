/** Stem type identifiers for 4-stem models */
export type StemType4 = 'vocals' | 'drums' | 'bass' | 'other';
/** Stem type identifiers for 6-stem models (superset of 4-stem) */
export type StemType6 = StemType4 | 'guitar' | 'piano';
/** Union of all stem types */
export type StemType = StemType6;

export const STEM_TYPES_4: StemType4[] = ['vocals', 'drums', 'bass', 'other'];
export const STEM_TYPES_6: StemType6[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
/** Default stem list (used for storage, volumes, etc.) */
export const STEM_TYPES: StemType4[] = STEM_TYPES_4;

/** Human-readable Japanese labels for each stem */
export const STEM_LABELS: Record<StemType, string> = {
  vocals: 'ボーカル',
  drums: 'ドラム',
  bass: 'ベース',
  other: 'その他',
  guitar: 'ギター',
  piano: 'ピアノ',
};

/** Stem separation status for a track */
export type StemStatus = 'none' | 'processing' | 'ready' | 'error';

/** Per-stem volume levels (0–1) — uses 4-stem base */
export type StemVolumes = Record<StemType, number>;

export const DEFAULT_STEM_VOLUMES: StemVolumes = {
  vocals: 1,
  drums:  1,
  bass:   1,
  other:  1,
  guitar: 1,
  piano:  1,
};

/** Stored track metadata */
export interface TrackMeta {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverArt?: string; // data URL
  addedAt: number;
  analysisVersion?: number;
  bpm?: number;
  key?: string;
  bookmarks?: LoopBookmark[];
  eq?: EQBands;
  chords?: { time: number; chord: string }[];
  /** SHA-256 hash of the audio file content (first 32 hex chars) */
  contentHash?: string;
  /** Cached structure analysis segments (separate from user bookmarks) */
  structureSegments?: { start: number; end: number; label: string }[];
  /** Whether stems have been separated for this track */
  stemStatus?: StemStatus;
  /** Per-stem volume levels saved by the user */
  stemVolumes?: StemVolumes;
  /** Manual sort order (lower = higher in list); undefined = sort by addedAt */
  order?: number;
}

/** Processing tool types for tracking in-progress AI work */
export type ProcessingTool = 'analyze' | 'structure' | 'separate';

/** Persisted processing state — allows recovery after app crash */
export interface ProcessingState {
  /** Composite key: `${trackId}:${tool}` */
  id: string;
  trackId: string;
  tool: ProcessingTool;
  startedAt: number;
}

/** Chord information with start time */
export interface ChordInfo {
  time: number;  // seconds from start
  chord: string; // e.g. "Am", "C", "G", "F#m"
}

/** App settings */
export interface AppSettings {
  skipDuration: number; // seconds
  defaultSpeed: number;
  defaultPitch: number; // semitones
  /** Keep the screen awake even when not playing */
  keepAwake: boolean;
  /** modal.com API base URL (e.g. https://xxx--mimiqplayer-api.modal.run) */
  apiEndpoint: string;
  /** Bearer token for the Modal API */
  apiKey: string;
}

/** Player state */
export interface PlayerState {
  trackId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  pitch: number; // semitones
  volume: number;
  abRepeat: {
    enabled: boolean;
    a: number | null;
    b: number | null;
  };
}

/** Named A-B loop bookmark */
export interface LoopBookmark {
  id: string;
  label: string;
  a: number;
  b: number;
}

/** 10-band EQ gains in dB, indices 0-9 correspond to 32/64/125/250/500/1k/2k/4k/8k/16kHz */
export type EQBands = [number, number, number, number, number, number, number, number, number, number];

export const EQ_FLAT: EQBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const EQ_PRESETS: Record<string, EQBands> = {
  flat:   [0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
  bass:   [6,  8,  6,  2,  0, -1, -2, -2, -2, -2],
  vocal:  [-3, -2, -1,  1,  4,  6,  5,  3,  1,  0],
  treble: [-2, -2, -1,  0,  0,  1,  2,  4,  6,  7],
};

/** Waveform data for visualization */
export interface WaveformData {
  peaks: Float32Array;
  length: number;
  duration: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  skipDuration: 5,
  defaultSpeed: 1.0,
  defaultPitch: 0,
  keepAwake: false,
  // Populated at build time via VITE_API_ENDPOINT / VITE_API_KEY env vars.
  // The user can override these in the Settings UI.
  apiEndpoint: import.meta.env.VITE_API_ENDPOINT ?? '',
  apiKey: import.meta.env.VITE_API_KEY ?? '',
};
