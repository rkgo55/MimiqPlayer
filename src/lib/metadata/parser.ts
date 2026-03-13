import * as mm from 'music-metadata';
import type { TrackMeta } from '../types';

const MAX_METADATA_TEXT_LENGTH = 200;
const MAX_COVER_ART_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_COVER_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function sanitizeText(value: string): string {
  return value.trim().slice(0, MAX_METADATA_TEXT_LENGTH);
}

/**
 * Parse audio file metadata (ID3, Vorbis, etc.)
 */
export async function parseMetadata(
  file: File,
  id: string,
): Promise<TrackMeta> {
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  let title = sanitizeText(file.name.replace(/\.[^.]+$/, ''));
  let artist = '不明なアーティスト';
  let album = '不明なアルバム';
  let duration = 0;
  let coverArt: string | undefined;

  try {
    const metadata = await mm.parseBuffer(uint8, {
      mimeType: file.type || undefined,
      size: file.size,
    });

    if (metadata.common.title) title = sanitizeText(metadata.common.title);
    if (metadata.common.artist) artist = sanitizeText(metadata.common.artist);
    if (metadata.common.album) album = sanitizeText(metadata.common.album);
    if (metadata.format.duration) duration = metadata.format.duration;

    // Extract cover art
    const picture = metadata.common.picture?.[0];
    if (
      picture
      && ALLOWED_COVER_MIME.has(picture.format)
      && picture.data.byteLength <= MAX_COVER_ART_BYTES
    ) {
      const blob = new Blob([picture.data], { type: picture.format });
      coverArt = await blobToDataURL(blob);
    }
  } catch (e) {
    console.warn('メタデータ解析に失敗:', e);
  }

  return {
    id,
    fileName: file.name,
    title,
    artist,
    album,
    duration,
    coverArt,
    addedAt: Date.now(),
  };
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
