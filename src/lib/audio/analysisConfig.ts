export const ANALYSIS_CACHE_VERSION = 2;

export const ANALYSIS_FILTERS = {
  bpm: {
    highPassHz: 30,
    lowPassHz: 280,
  },
  tonal: {
    highPassHz: 45,
    lowPassHz: 5000,
  },
} as const;