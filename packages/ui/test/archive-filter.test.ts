import { describe, expect, it } from 'vitest';
import type { SongSummary } from '../src/lib/api.js';
import { filterArchiveSongs } from '../src/lib/archiveFilter.js';

function song(index: number): SongSummary {
  return {
    id: `song-${index}`,
    title: `Song ${index}`,
    writtenKey: index % 2 === 0 ? 'G' : 'D',
    performanceKey: null,
    tempo: null,
    timeSignature: null,
    authors: [],
    tags: [],
    collection: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    blockCount: 1,
  };
}

describe('set workspace archive filtering', () => {
  it('keeps every song when no filters are applied', () => {
    const songs = Array.from({ length: 160 }, (_, index) => song(index));

    expect(filterArchiveSongs(songs, { collection: '', key: '' }, null)).toHaveLength(160);
  });

  it('filters the complete list by collection and key', () => {
    const songs = Array.from({ length: 160 }, (_, index) => song(index));
    const collection = new Set(songs.filter((_, index) => index % 3 === 0).map(({ id }) => id));
    const expected = songs.filter(
      (candidate, index) => index % 3 === 0 && candidate.writtenKey === 'G',
    );

    expect(filterArchiveSongs(songs, { collection: 'Sunday', key: 'G' }, collection)).toEqual(
      expected,
    );
  });
});
