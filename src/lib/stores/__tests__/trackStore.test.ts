/**
 * trackStore unit tests
 *
 * Focus: addFile() computes and persists a SHA-256 content hash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSaveAudioFile = vi.fn().mockResolvedValue(undefined);
const mockSaveTrackMeta  = vi.fn().mockResolvedValue(undefined);
const mockGetAllTracks   = vi.fn().mockResolvedValue([]);

vi.mock('../../storage/db', () => ({
  saveAudioFile:  (...args: unknown[]) => mockSaveAudioFile(...args),
  saveTrackMeta:  (...args: unknown[]) => mockSaveTrackMeta(...args),
  getAllTracks:    (...args: unknown[]) => mockGetAllTracks(...args),
  deleteTrack:    vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../metadata/parser', () => ({
  parseMetadata: vi.fn().mockImplementation((_file: File, id: string) =>
    Promise.resolve({ id, title: 'Test Track', artist: '', album: '' })
  ),
}));

import { trackStore } from '../trackStore';

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveAudioFile.mockResolvedValue(undefined);
  mockSaveTrackMeta.mockResolvedValue(undefined);
  mockGetAllTracks.mockResolvedValue([]);
});

describe('trackStore.addFile()', () => {
  it('computes a 32-char hex SHA-256 contentHash and saves it to meta', async () => {
    const bytes = new Uint8Array(16).fill(0xab);
    const file = new File([bytes], 'sample.mp3', { type: 'audio/mpeg' });

    const meta = await trackStore.addFile(file);

    // contentHash must be exactly 32 hex characters
    expect(meta.contentHash).toBeDefined();
    expect(meta.contentHash).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(meta.contentHash!)).toBe(true);
  });

  it('persists contentHash in saveTrackMeta call', async () => {
    const file = new File([new Uint8Array(8).fill(0x11)], 'track.mp3', { type: 'audio/mpeg' });

    await trackStore.addFile(file);

    expect(mockSaveTrackMeta).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: expect.stringMatching(/^[0-9a-f]{32}$/) })
    );
  });

  it('produces the same hash for identical file content', async () => {
    const content = new Uint8Array(32).fill(0x42);
    const file1 = new File([content], 'a.mp3', { type: 'audio/mpeg' });
    const file2 = new File([content], 'b.mp3', { type: 'audio/mpeg' });

    const meta1 = await trackStore.addFile(file1);
    const meta2 = await trackStore.addFile(file2);

    expect(meta1.contentHash).toBe(meta2.contentHash);
  });

  it('produces different hashes for different file content', async () => {
    const file1 = new File([new Uint8Array(8).fill(0xaa)], 'a.mp3', { type: 'audio/mpeg' });
    const file2 = new File([new Uint8Array(8).fill(0xbb)], 'b.mp3', { type: 'audio/mpeg' });

    const meta1 = await trackStore.addFile(file1);
    const meta2 = await trackStore.addFile(file2);

    expect(meta1.contentHash).not.toBe(meta2.contentHash);
  });
});
