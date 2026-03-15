import { writable, get } from 'svelte/store';
import type { StemStatus, StemType, StemVolumes } from '../types';
import {
  STEM_TYPES,
  DEFAULT_STEM_VOLUMES,
} from '../types';
import {
  getAllStemFiles,
  saveStemFile,
  getTrackMeta,
  saveTrackMeta,
  getAudioFile,
  saveProcessingState,
  deleteProcessingState,
  getProcessingState,
} from '../storage/db';
import { playerStore } from './playerStore';
import { trackStore } from './trackStore';
import { settingsStore } from './settingsStore';
import { getApiClient } from '../audio/apiClient';

export interface StemState {
  /** Separation status of the currently loaded track */
  status: StemStatus;
  /** Per-stem volume (0–1) */
  volumes: StemVolumes;
  /** Processing progress (0–100) */
  downloadProgress: number | null;
  /** Human-readable status message */
  message: string;
  /** Stem types actually loaded in the engine (null = none loaded) */
  loadedStems: StemType[] | null;
}

const initialState: StemState = {
  status: 'none',
  volumes: { ...DEFAULT_STEM_VOLUMES },
  downloadProgress: null,
  message: '',
  loadedStems: null,
};

function createStemStore() {
  const { subscribe, set, update } = writable<StemState>({ ...initialState });

  /** Load stems from IndexedDB into the AudioEngine for the given trackId */
  async function loadStemsIntoEngine(trackId: string): Promise<boolean> {
    const stemFiles = await getAllStemFiles(trackId);
    const hasAll = STEM_TYPES.every((s) => !!stemFiles[s]);
    if (!hasAll) return false;

    await playerStore.engine.loadStemsFromArrayBuffers(
      stemFiles as Record<StemType, ArrayBuffer>,
    );
    // Record which stems are now loaded in the engine
    const loaded = playerStore.engine.loadedStemTypes;
    update((s) => ({ ...s, loadedStems: loaded }));
    return true;
  }

  return {
    subscribe,

    /**
     * Called when a new track is loaded.
     * Checks whether stems already exist and loads them if so.
     */
    async onTrackLoaded(trackId: string): Promise<void> {
      // Reset to initial state first
      set({ ...initialState });

      const meta = await getTrackMeta(trackId);
      const savedVolumes: StemVolumes = { ...DEFAULT_STEM_VOLUMES, ...meta?.stemVolumes };

      if (meta?.stemStatus === 'ready') {
        // Attempt to load stems from storage
        const loaded = await loadStemsIntoEngine(trackId);
        if (loaded) {
          playerStore.engine.setStemVolumes(savedVolumes);
          // loadStemsIntoEngine already set loadedStems via update(); read it back
          const loadedStems = playerStore.engine.loadedStemTypes;
          set({
            status: 'ready',
            volumes: savedVolumes,
            downloadProgress: null,
            message: '',
            loadedStems,
          });
          return;
        }
        // Stem files missing – treat as 'none' and let user re-separate
      }

      // If a previous separation was interrupted (e.g. page reload mid-process),
      // check whether the API is configured and can resume processing.
      const interruptedPS = await getProcessingState(`${trackId}:separate`);
      if (interruptedPS) {
        const apiSettings = get(settingsStore);
        if (apiSettings.apiEndpoint) {
          void this.separate(trackId);
          return;
        }
        await deleteProcessingState(`${trackId}:separate`);
      }

      set({ ...initialState, volumes: savedVolumes });
    },

    /**
     * Start stem separation for the given trackId via the API.
     * Guard: if already processing, return immediately.
     */
    async separate(trackId: string): Promise<void> {
      // Per-track guard: skip if already processing
      if (get({ subscribe }).status === 'processing') return;

      const engine = playerStore.engine;
      if (!engine.getAudioBuffer()) return;

      const apiSettings = get(settingsStore);
      if (!apiSettings.apiEndpoint || !apiSettings.apiKey) {
        update((s) => ({ ...s, status: 'error', message: 'APIが設定されていません' }));
        return;
      }

      update((s) => ({ ...s, status: 'processing', message: 'API でステム分離中…', downloadProgress: null }));
      await saveProcessingState({ id: `${trackId}:separate`, trackId, tool: 'separate', startedAt: Date.now() });

      try {
        const audioFile = await getAudioFile(trackId);
        if (!audioFile) throw new Error('Audio file not found');

        const client = getApiClient(apiSettings.apiEndpoint, apiSettings.apiKey);
        const trackMeta = await getTrackMeta(trackId);
        const res = await client.separate(audioFile.data, trackMeta?.contentHash);

        // Save binary OGG stems to IndexedDB
        for (const [stemName, buf] of Object.entries(res.stems)) {
          if (buf) {
            await saveStemFile(trackId, stemName as StemType, buf);
          }
        }

        // Update track meta
        const meta = await getTrackMeta(trackId);
        if (meta) {
          await saveTrackMeta({ ...meta, stemStatus: 'ready' });
        }

        // Guard: skip engine load/state update if track changed
        if (get(playerStore).trackId !== trackId) return;

        await loadStemsIntoEngine(trackId);
        const currentState = get({ subscribe });
        engine.setStemVolumes(currentState.volumes);

        trackStore.updateStemStatus(trackId, 'ready');
        update((s) => ({ ...s, status: 'ready', message: '', downloadProgress: null }));
        await deleteProcessingState(`${trackId}:separate`);
      } catch (err) {
        console.error('[StemStore] API separation failed:', err);
        update((s) => ({
          ...s,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          downloadProgress: null,
        }));
        await deleteProcessingState(`${trackId}:separate`);
      }
    },

    /** Update a single stem's volume */
    async setStemVolume(stem: StemType, volume: number, trackId: string | null): Promise<void> {
      playerStore.engine.setStemVolume(stem, volume);
      update((s) => ({
        ...s,
        volumes: { ...s.volumes, [stem]: volume },
      }));

      // Persist to DB
      if (trackId) {
        const meta = await getTrackMeta(trackId);
        if (meta) {
          const state = get({ subscribe });
          await saveTrackMeta({ ...meta, stemVolumes: state.volumes });
        }
      }
    },

    /** Update a guitar/piano stem volume — persists just like any other stem */
    setStemVolumeExtra(stem: 'guitar' | 'piano', volume: number, trackId: string | null = null): void {
      void this.setStemVolume(stem, volume, trackId);
    },

    /** Reset all stem volumes to 1 */
    async resetVolumes(trackId: string | null): Promise<void> {
      const vols = { ...DEFAULT_STEM_VOLUMES };
      playerStore.engine.setStemVolumes(vols);
      update((s) => ({ ...s, volumes: vols }));

      if (trackId) {
        const meta = await getTrackMeta(trackId);
        if (meta) await saveTrackMeta({ ...meta, stemVolumes: vols });
      }
    },

    /** Clear stems from engine (revert to normal playback mode) */
    revertToNormal(): void {
      playerStore.engine.clearStems();
    },
  };
}

export const stemStore = createStemStore();
