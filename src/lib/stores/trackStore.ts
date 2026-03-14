import { writable, derived } from 'svelte/store';
import type { TrackMeta, StemStatus } from '../types';
import { getAllTracks, saveTrackMeta, deleteTrack as dbDeleteTrack, saveAudioFile } from '../storage/db';
import { parseMetadata } from '../metadata/parser';

function createTrackStore() {
  const { subscribe, set, update } = writable<TrackMeta[]>([]);
  const selectedId = writable<string | null>(null);

  return {
    subscribe,
    selectedId,

    /** Load all tracks from IndexedDB */
    async load() {
      const tracks = await getAllTracks();
      set(tracks);
    },

    /** Add a new audio file */
    async addFile(file: File): Promise<TrackMeta> {
      const id = `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const arrayBuffer = await file.arrayBuffer();

      // Parse metadata
      const meta = await parseMetadata(file, id);

      // Save to IndexedDB
      await saveAudioFile(id, arrayBuffer, file.type);
      await saveTrackMeta(meta);

      // Update store
      update((tracks) => [meta, ...tracks]);

      return meta;
    },

    /** Delete a track */
    async deleteTrack(id: string) {
      await dbDeleteTrack(id);
      update((tracks) => tracks.filter((t) => t.id !== id));
      selectedId.update((current) => (current === id ? null : current));
    },

    /** Select a track for playback */
    select(id: string | null) {
      selectedId.set(id);
    },

    /** Update the stem status for a track (in-memory only; DB is updated separately) */
    updateStemStatus(id: string, status: StemStatus) {
      update((tracks) =>
        tracks.map((t) => (t.id === id ? { ...t, stemStatus: status } : t)),
      );
    },

    /** Update editable metadata (title / artist / album) and persist to DB */
    async updateTrackInfo(id: string, fields: { title?: string; artist?: string; album?: string }) {
      update((tracks) =>
        tracks.map((t) => (t.id === id ? { ...t, ...fields } : t)),
      );
      const { getTrackMeta } = await import('../storage/db');
      const meta = await getTrackMeta(id);
      if (meta) await saveTrackMeta({ ...meta, ...fields });
    },
  };
}

export const trackStore = createTrackStore();

export const selectedTrack = derived(
  [trackStore, trackStore.selectedId],
  ([$tracks, $selectedId]) => $tracks.find((t) => t.id === $selectedId) ?? null,
);
