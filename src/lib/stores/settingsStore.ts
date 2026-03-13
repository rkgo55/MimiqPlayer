import { writable, get } from 'svelte/store';
import type { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const STORAGE_KEY = 'mimiqplayer-settings';

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings & { stemModel: string }>;
      // Migrate hdemucs-mmi-v3 (removed) → htdemucs-4s
      if ((parsed.stemModel as string) === 'hdemucs-mmi-v3') {
        parsed.stemModel = 'htdemucs-4s';
      }
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
    reset() {
      set({ ...DEFAULT_SETTINGS });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    },
  };
}

export const settingsStore = createSettingsStore();
