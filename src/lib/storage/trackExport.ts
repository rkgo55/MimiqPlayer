import { zip } from 'fflate';
import type { StemType } from '../types';
import { getTrackMeta, getAudioFile, getAllStemFiles } from './db';

export const TRACK_EXPORT_VERSION = 1;

/** MIME type → file extension mapping */
function mimeTypeToExt(mimeType: string, fallbackFileName: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/aiff': 'aiff',
    'audio/x-aiff': 'aiff',
    'audio/webm': 'webm',
  };
  if (map[mimeType]) return map[mimeType];
  // Fall back to extension from the original file name
  const dot = fallbackFileName.lastIndexOf('.');
  if (dot >= 0) return fallbackFileName.slice(dot + 1).toLowerCase();
  return 'audio';
}

/** Strip extension and sanitize file name for use inside a ZIP */
export function sanitizeBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const name = dot >= 0 ? fileName.slice(0, dot) : fileName;
  // Replace characters that are problematic in paths / file names
  return name.replace(/[/\\?%*:|"<>]/g, '_');
}

/**
 * Export a single track (audio + stems + metadata) as a .mimiqtrack.zip Blob.
 *
 * ZIP structure:
 * ```
 * metadata.json
 * {baseName}_audio.{ext}
 * stems/
 *   {baseName}_vocals.wav
 *   {baseName}_bass.wav
 *   ...
 * ```
 */
export async function exportTrackAsZip(
  trackId: string,
): Promise<{ blob: Blob; fileName: string }> {
  const meta = await getTrackMeta(trackId);
  if (!meta) throw new Error(`Track not found: ${trackId}`);

  const audioRecord = await getAudioFile(trackId);
  if (!audioRecord) throw new Error(`Audio file not found for track: ${trackId}`);

  const stems = await getAllStemFiles(trackId);

  const baseName = sanitizeBaseName(meta.title || meta.fileName);
  const audioExt = mimeTypeToExt(audioRecord.mimeType, meta.fileName);
  const stemNames = Object.keys(stems) as StemType[];

  // ── Build metadata JSON ───────────────────────────────────────────────────
  const metaPayload: Record<string, unknown> = {
    exportVersion: TRACK_EXPORT_VERSION,
    baseName,
    id: meta.id,
    fileName: meta.fileName,
    mimeType: audioRecord.mimeType,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    addedAt: meta.addedAt,
    stems: stemNames,
  };

  if (meta.coverArt !== undefined) metaPayload.coverArt = meta.coverArt;
  if (meta.analysisVersion !== undefined) metaPayload.analysisVersion = meta.analysisVersion;
  if (meta.bpm !== undefined) metaPayload.bpm = meta.bpm;
  if (meta.key !== undefined) metaPayload.key = meta.key;
  if (meta.chords !== undefined) metaPayload.chords = meta.chords;
  if (meta.eq !== undefined) metaPayload.eq = meta.eq;
  if (meta.bookmarks !== undefined) metaPayload.bookmarks = meta.bookmarks;
  if (meta.sectionPoints !== undefined) metaPayload.sectionPoints = meta.sectionPoints;
  if (meta.sectionLabels !== undefined) metaPayload.sectionLabels = meta.sectionLabels;
  if (meta.structureSegments !== undefined) metaPayload.structureSegments = meta.structureSegments;
  if (meta.stemStatus !== undefined) metaPayload.stemStatus = meta.stemStatus;
  if (meta.stemVolumes !== undefined) metaPayload.stemVolumes = meta.stemVolumes;
  if (meta.speed !== undefined) metaPayload.speed = meta.speed;
  if (meta.pitch !== undefined) metaPayload.pitch = meta.pitch;

  const metaJson = JSON.stringify(metaPayload, null, 2);

  // ── Assemble ZIP entries ──────────────────────────────────────────────────
  // level: 0 → store only (audio/WAV are already compressed or not compressible)
  const entries: Parameters<typeof zip>[0] = {
    'metadata.json': [new TextEncoder().encode(metaJson), { level: 6 }],
    [`${baseName}_audio.${audioExt}`]: [new Uint8Array(audioRecord.data), { level: 0 }],
  };

  for (const [stemName, data] of Object.entries(stems)) {
    if (!data) continue;
    entries[`stems/${baseName}_${stemName}.wav`] = [new Uint8Array(data), { level: 0 }];
  }

  // ── Compress ─────────────────────────────────────────────────────────────
  const zipBuffer = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => {
      if (err) reject(err);
      else resolve(data as Uint8Array<ArrayBuffer>);
    });
  });

  return {
    blob: new Blob(
      [zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength)],
      { type: 'application/zip' },
    ),
    fileName: `${baseName}.mimiqtrack.zip`,
  };
}

/** Trigger a browser download of the given Blob */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
