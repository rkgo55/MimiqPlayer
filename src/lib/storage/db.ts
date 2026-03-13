import { openDB, type IDBPDatabase } from 'idb';
import type { TrackMeta, StemType } from '../types';

const DB_NAME = 'mimiqplayer-db';
const DB_VERSION = 2;

interface StemFileRecord {
  /** composite key: `${trackId}:${stem}` */
  id: string;
  trackId: string;
  stem: StemType;
  /** WAV-encoded audio data */
  data: ArrayBuffer;
}

interface MimiqPlayerDB {
  tracks: {
    key: string;
    value: TrackMeta;
    indexes: { 'by-added': number };
  };
  audioFiles: {
    key: string;
    value: { id: string; data: ArrayBuffer; mimeType: string };
  };
  stemFiles: {
    key: string;
    value: StemFileRecord;
    indexes: { 'by-track': string };
  };
}

let dbPromise: Promise<IDBPDatabase<MimiqPlayerDB>> | null = null;

function getDB(): Promise<IDBPDatabase<MimiqPlayerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MimiqPlayerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 → initial schema
        if (oldVersion < 1) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('by-added', 'addedAt');
          db.createObjectStore('audioFiles', { keyPath: 'id' });
        }
        // v2 → add stemFiles store
        if (oldVersion < 2) {
          const stemStore = db.createObjectStore('stemFiles', { keyPath: 'id' });
          stemStore.createIndex('by-track', 'trackId');
        }
      },
    });
  }
  return dbPromise;
}

/** Save track metadata */
export async function saveTrackMeta(meta: TrackMeta): Promise<void> {
  const db = await getDB();
  await db.put('tracks', meta);
}

/** Get all track metadata sorted by added time */
export async function getAllTracks(): Promise<TrackMeta[]> {
  const db = await getDB();
  const tracks = await db.getAllFromIndex('tracks', 'by-added');
  return tracks.reverse();
}

/** Get a single track's metadata */
export async function getTrackMeta(id: string): Promise<TrackMeta | undefined> {
  const db = await getDB();
  return db.get('tracks', id);
}

/** Delete track and its audio data */
export async function deleteTrack(id: string): Promise<void> {
  const db = await getDB();

  // Delete all stem files for this track first
  const stemKeys = await db.getAllKeysFromIndex('stemFiles', 'by-track', id);
  const tx = db.transaction(['tracks', 'audioFiles', 'stemFiles'], 'readwrite');
  await Promise.all([
    tx.objectStore('tracks').delete(id),
    tx.objectStore('audioFiles').delete(id),
    ...stemKeys.map((k) => tx.objectStore('stemFiles').delete(k)),
    tx.done,
  ]);
}

/** Save audio file data */
export async function saveAudioFile(
  id: string,
  data: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const db = await getDB();
  await db.put('audioFiles', { id, data, mimeType });
}

/** Get audio file as ArrayBuffer */
export async function getAudioFile(
  id: string,
): Promise<{ data: ArrayBuffer; mimeType: string } | undefined> {
  const db = await getDB();
  return db.get('audioFiles', id);
}

/** Get storage usage estimate */
export async function getStorageEstimate(): Promise<{ usedMB: number; quotaMB: number; ratio: number }> {
  if (!navigator.storage?.estimate) {
    return { usedMB: 0, quotaMB: 0, ratio: 0 };
  }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const usedMB = usage / 1024 / 1024;
  const quotaMB = quota / 1024 / 1024;
  const ratio = quota > 0 ? usage / quota : 0;
  return { usedMB, quotaMB, ratio };
}

/** Delete ALL tracks and audio files */
export async function deleteAllTracks(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['tracks', 'audioFiles', 'stemFiles'], 'readwrite');
  await Promise.all([
    tx.objectStore('tracks').clear(),
    tx.objectStore('audioFiles').clear(),
    tx.objectStore('stemFiles').clear(),
    tx.done,
  ]);
}

// ─── Stem file helpers ──────────────────────────────────────────────────────

/** Save a single stem's WAV data */
export async function saveStemFile(
  trackId: string,
  stem: StemType,
  data: ArrayBuffer,
): Promise<void> {
  const db = await getDB();
  await db.put('stemFiles', { id: `${trackId}:${stem}`, trackId, stem, data });
}

/** Get a single stem's WAV data */
export async function getStemFile(
  trackId: string,
  stem: StemType,
): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  const record = await db.get('stemFiles', `${trackId}:${stem}`);
  return record?.data;
}

/** Get all stem WAV data for a track, keyed by stem type */
export async function getAllStemFiles(
  trackId: string,
): Promise<Partial<Record<StemType, ArrayBuffer>>> {
  const db = await getDB();
  const records = await db.getAllFromIndex('stemFiles', 'by-track', trackId);
  const result: Partial<Record<StemType, ArrayBuffer>> = {};
  for (const rec of records) {
    const r = rec as StemFileRecord;
    result[r.stem] = r.data;
  }
  return result;
}

/** Delete all stem files for a track */
export async function deleteStemFiles(trackId: string): Promise<void> {
  const db = await getDB();
  const keys = await db.getAllKeysFromIndex('stemFiles', 'by-track', trackId);
  const tx = db.transaction('stemFiles', 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}
