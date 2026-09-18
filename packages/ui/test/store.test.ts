import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyBlock, emptyLine, type Song } from '@worship/core';
import { fold, store } from '../src/lib/store.js';

function song(id: string, title: string, lyric: string): Song {
  const block = emptyBlock('V1', 'Verse');
  block.lines = [emptyLine(lyric)];
  return {
    id,
    legacyUuid: null,
    title,
    writtenKey: 'G',
    performanceKey: 'Bb',
    tempo: null,
    timeSignature: null,
    authors: [],
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: [block],
    arrangement: null,
    lang: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 1,
  };
}

const LIBRARY = [
  song('a', 'Bunatatea Ta', 'Vreau să cânt bunătatea Ta'),
  song('b', 'La crucea Ta', 'Când mă gândesc la crucea Ta'),
  song('c', 'Crucea', 'altceva complet'),
];

beforeEach(async () => {
  await store.replaceAll(LIBRARY, [], '2026-01-01T00:00:00.000Z');
});

describe('diacritic folding', () => {
  it('strips Romanian diacritics, because nobody types them into a search box', () => {
    expect(fold('bunătatea')).toBe('bunatatea');
    expect(fold('Și-ai venit')).toBe('si-ai venit');
    expect(fold('ȚÂÎȘĂ')).toBe('taisa');
  });
});

describe('the offline mirror', () => {
  it('holds the whole library', async () => {
    const status = await store.status();
    expect(status.songs).toBe(3);
    expect(status.lastSync).not.toBeNull();
  });

  it('returns songs in title order', async () => {
    expect((await store.allSongs()).map((s) => s.title)).toEqual([
      'Bunatatea Ta',
      'Crucea',
      'La crucea Ta',
    ]);
  });

  it('replaces rather than merges, so deletions do not come back', async () => {
    await store.replaceAll([LIBRARY[0]!], [], '2026-02-01T00:00:00.000Z');
    expect((await store.allSongs()).map((s) => s.id)).toEqual(['a']);
  });

  it('remembers the fingerprint, so an unchanged library costs nothing', async () => {
    expect(await store.fingerprint()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('drops a single set, for one deleted on the host', async () => {
    await store.putSet({
      id: 'set-1',
      title: 'Duminică',
      date: null,
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rev: 0,
    });
    expect(await store.set('set-1')).not.toBeNull();
    await store.deleteSet('set-1');
    expect(await store.set('set-1')).toBeNull();
  });
});

describe('offline search matches the server closely enough to be trusted', () => {
  it('finds a song without its diacritics', async () => {
    const hits = await store.search('bunatatea');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.song.title).toBe('Bunatatea Ta');
  });

  it('finds it with diacritics too', async () => {
    expect(await store.search('bunătatea')).toHaveLength(1);
  });

  it('requires every term', async () => {
    expect(await store.search('crucea gandesc')).toHaveLength(1);
    expect(await store.search('crucea bunatatea')).toHaveLength(0);
  });

  it('prefix-matches the last term, so results narrow as you type', async () => {
    expect(await store.search('bunat')).toHaveLength(1);
  });

  it('ranks a title match above a lyric-only match', async () => {
    const hits = await store.search('crucea');
    expect(hits[0]!.song.title).toBe('Crucea');
  });

  it('returns a snippet around the match', async () => {
    const hits = await store.search('gandesc');
    expect(hits[0]!.snippet).toContain('gândesc');
  });

  it('returns nothing for an empty query rather than everything', async () => {
    expect(await store.search('')).toEqual([]);
    expect(await store.search('   ')).toEqual([]);
  });

  it('never throws on regex-looking input', async () => {
    for (const query of ['(', '[a-z]', '\\', '*', '?']) {
      await expect(store.search(query)).resolves.toBeInstanceOf(Array);
    }
  });
});
