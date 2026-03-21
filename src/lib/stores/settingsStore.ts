import { writable } from 'svelte/store';
import type { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const STORAGE_KEY = 'mimiqplayer-settings';

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>;
      // Build-time env vars always win; user cannot override via localStorage.
      parsed.apiEndpoint = DEFAULT_SETTINGS.apiEndpoint;
      if (!parsed.apiKey) parsed.apiKey = DEFAULT_SETTINGS.apiKey;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

function createSettingsStore() {
  const { subscribe, set, update } = writable<AppSettings>(loadSettings());

  return {
    subscribe,
    update(fn: (s: AppSettings) => AppSettings) {
      update((current) => {
        const next = fn(current);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    setSkipDuration(seconds: number) {
      this.update((s) => ({ ...s, skipDuration: seconds }));
    },
    setLoopOffset(seconds: number) {
      this.update((s) => ({ ...s, loopOffset: seconds }));
    },
    setApi(endpoint: string, key: string) {
      this.update((s) => ({ ...s, apiEndpoint: endpoint.trim(), apiKey: key.trim() }));
    },
    reset() {
      set({ ...DEFAULT_SETTINGS });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    },
  };
}

export const settingsStore = createSettingsStore();

