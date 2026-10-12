import { describe, expect, it } from 'vitest';
import type { SongSummary } from '../src/lib/api.js';
import { filterArchiveSongs, toggleArchiveKey } from '../src/lib/archiveFilter.js';

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

describe('shared archive filtering', () => {
  it('keeps every song when no filters are applied', () => {
    const songs = Array.from({ length: 160 }, (_, index) => song(index));

    expect(filterArchiveSongs(songs, { collection: '', keys: [] }, null)).toHaveLength(160);
  });

  it('filters the complete list by collection and key', () => {
    const songs = Array.from({ length: 160 }, (_, index) => song(index));
    const collection = new Set(songs.filter((_, index) => index % 3 === 0).map(({ id }) => id));
    const expected = songs.filter(
      (candidate, index) => index % 3 === 0 && candidate.writtenKey === 'G',
    );

    expect(
      filterArchiveSongs(songs, { collection: 'Sunday', keys: ['G'] }, collection),
    ).toEqual(expected);
  });
});

describe('multiple archive key toggles', () => {
  it('adds and removes keys independently, returning to all songs when cleared', () => {
    const songs = [song(0), song(1), { ...song(2), writtenKey: 'A' }];
    let keys: string[] = [];
    keys = toggleArchiveKey(keys, 'G');
    expect(filterArchiveSongs(songs, { collection: '', keys }, null)).toEqual([songs[0]]);
    keys = toggleArchiveKey(keys, 'D');
    expect(keys).toEqual(['G', 'D']);
    expect(filterArchiveSongs(songs, { collection: '', keys }, null)).toEqual(
      songs.slice(0, 2),
    );
    keys = toggleArchiveKey(keys, 'G');
    expect(keys).toEqual(['D']);
    expect(filterArchiveSongs(songs, { collection: '', keys }, null)).toEqual([songs[1]]);
    keys = toggleArchiveKey(keys, 'D');
    expect(filterArchiveSongs(songs, { collection: '', keys }, null)).toEqual(songs);
  });

  it('intersects the selected keys with the collection and search results', () => {
    const hits = [song(0), song(1), { ...song(2), writtenKey: 'A' }, song(3)].map((song) => ({
      ...song,
      snippet: 'matching lyrics',
      rank: 1,
    }));
    expect(
      filterArchiveSongs(
        hits,
        { collection: 'Sunday', keys: ['G', 'D'] },
        new Set(['song-0', 'song-2', 'song-3']),
      ),
    ).toEqual([hits[0], hits[3]]);
  });

  it('uses the performed key, supports enharmonic keys, and distinguishes minor keys', () => {
    const songs = [
      { ...song(0), writtenKey: 'C', performanceKey: 'Eb' },
      { ...song(1), writtenKey: 'D#m' },
      { ...song(2), writtenKey: null },
      { ...song(3), writtenKey: 'Gm' },
    ];
    expect(filterArchiveSongs(songs, { collection: '', keys: ['D#', 'Gm'] }, null)).toEqual([
      songs[0],
      songs[3],
    ]);
    expect(filterArchiveSongs(songs, { collection: '', keys: [] }, null)).toEqual(songs);
  });

  it('does not mutate the previous selection', () => {
    const keys = ['G', 'D'];
    toggleArchiveKey(keys, 'G');
    toggleArchiveKey(keys, 'A');
    expect(keys).toEqual(['G', 'D']);
  });
});
