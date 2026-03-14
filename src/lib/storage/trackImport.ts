import { unzip } from 'fflate';
import type { TrackMeta, StemType, EQBands, LoopBookmark, StemVolumes, StemStatus } from '../types';
import { saveTrackMeta, saveAudioFile, saveStemFile } from './db';
import { TRACK_EXPORT_VERSION, sanitizeBaseName } from './trackExport';

/** Shape of metadata.json inside a .mimiqtrack.zip */
interface ExportMetadata {
  exportVersion: number;
  baseName?: string;
  id: string;
  fileName: string;
  mimeType: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  addedAt: number;
  stems: StemType[];
  coverArt?: string;
  analysisVersion?: number;
  bpm?: number;
  key?: string;
  chords?: { time: number; chord: string }[];
  eq?: EQBands;
  bookmarks?: LoopBookmark[];
  stemStatus?: StemStatus;
  stemVolumes?: StemVolumes;
}

/**
 * Import a track from a .mimiqtrack.zip file.
 * Assigns a fresh track ID so the same zip can be imported multiple times
 * without conflicting with existing tracks.
 *
 * Returns the newly created TrackMeta (caller should call `trackStore.load()`
 * to refresh the track list).
 */
export async function importTrackFromZip(file: File): Promise<TrackMeta> {
  const buffer = await file.arrayBuffer();

  // ── Unzip ─────────────────────────────────────────────────────────────────
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(new Uint8Array(buffer), (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  // ── Parse metadata ────────────────────────────────────────────────────────
  const metaBytes = files['metadata.json'];
  if (!metaBytes) throw new Error('Invalid .mimiqtrack.zip: metadata.json が見つかりません');

  const exportMeta: ExportMetadata = JSON.parse(new TextDecoder().decode(metaBytes));

  if (exportMeta.exportVersion !== TRACK_EXPORT_VERSION) {
    throw new Error(
      `非対応のエクスポートバージョン: ${exportMeta.exportVersion} (対応: ${TRACK_EXPORT_VERSION})`,
    );
  }

  // ── Find audio file in ZIP ────────────────────────────────────────────────
  const baseName = exportMeta.baseName ?? sanitizeBaseName(exportMeta.fileName);
  const audioExt = exportMeta.mimeType
    ? ({
        'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
        'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
        'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav',
        'audio/flac': 'flac', 'audio/x-flac': 'flac',
        'audio/ogg': 'ogg', 'audio/aac': 'aac',
        'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff',
        'audio/webm': 'webm',
      }[exportMeta.mimeType] ?? exportMeta.fileName.split('.').pop()?.toLowerCase() ?? 'audio')
    : (exportMeta.fileName.includes('.')
        ? exportMeta.fileName.split('.').pop()!.toLowerCase()
        : 'audio');
  const audioKey = `${baseName}_audio.${audioExt}`;
  const audioData = files[audioKey];
  if (!audioData) {
    throw new Error(`Invalid .mimiqtrack.zip: 音声ファイルが見つかりません (${audioKey})`);
  }

  // ── Generate new track ID ─────────────────────────────────────────────────
  const newId = `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ── Save audio file ───────────────────────────────────────────────────────
  // Use .slice().buffer to ensure we own the ArrayBuffer (avoid detached-buffer issues)
  await saveAudioFile(newId, audioData.slice().buffer, exportMeta.mimeType);

  // ── Save stem files ───────────────────────────────────────────────────────
  const importedStems: StemType[] = [];
  for (const stemName of exportMeta.stems ?? []) {
    const stemKey = `stems/${baseName}_${stemName}.wav`;
    const stemData = files[stemKey];
    if (stemData) {
      await saveStemFile(newId, stemName, stemData.slice().buffer);
      importedStems.push(stemName);
    }
  }

  // ── Build TrackMeta ───────────────────────────────────────────────────────
  const trackMeta: TrackMeta = {
    id: newId,
    fileName: exportMeta.fileName,
    title: exportMeta.title,
    artist: exportMeta.artist,
    album: exportMeta.album,
    duration: exportMeta.duration,
    addedAt: Date.now(), // use import time so it sorts to the top
  };

  if (exportMeta.coverArt) trackMeta.coverArt = exportMeta.coverArt;
  if (exportMeta.analysisVersion !== undefined)
    trackMeta.analysisVersion = exportMeta.analysisVersion;
  if (exportMeta.bpm !== undefined) trackMeta.bpm = exportMeta.bpm;
  if (exportMeta.key !== undefined) trackMeta.key = exportMeta.key;
  if (exportMeta.chords !== undefined) trackMeta.chords = exportMeta.chords;
  if (exportMeta.eq !== undefined) trackMeta.eq = exportMeta.eq;
  if (exportMeta.bookmarks !== undefined) trackMeta.bookmarks = exportMeta.bookmarks;
  if (exportMeta.stemVolumes !== undefined) trackMeta.stemVolumes = exportMeta.stemVolumes;

  // stemStatus: 'ready' only if all advertised stems were actually found in the ZIP
  trackMeta.stemStatus =
    importedStems.length > 0 && importedStems.length === (exportMeta.stems?.length ?? 0)
      ? 'ready'
      : importedStems.length > 0
        ? 'ready'
        : 'none';

  await saveTrackMeta(trackMeta);

  return trackMeta;
}
