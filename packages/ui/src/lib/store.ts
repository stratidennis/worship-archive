import Dexie, { type Table } from 'dexie';
import type { ServiceSet, Song } from '@worship/core';

/**
 * The local mirror.
 *
 * Every read goes through here, and the network only ever fills it. That is what makes
 * "at home with no host" and "at church on good WiFi" the same code path rather than
 * two, and it means a WiFi drop mid-service changes nothing about what is on screen.
 *
 * 153 songs is well under a megabyte, so the whole library is mirrored rather than
 * lazily cached. Partial caching would mean discovering, mid-service, that the one song
 * you need is the one that was never fetched.
 */

class WorshipDb extends Dexie {
  songs!: Table<Song, string>;
  sets!: Table<ServiceSet, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super('worship-archive');
    this.version(1).stores({
      songs: 'id, title, updatedAt',
      sets: 'id, date, updatedAt',
      meta: 'key',
    });
  }
}

const db = new WorshipDb();

/** Strip diacritics so `bunatatea` finds `bunătatea`, as the server's index does. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface MirrorStatus {
  songs: number;
  sets: number;
  lastSync: string | null;
}

export const store = {
  async status(): Promise<MirrorStatus> {
    const [songs, sets, lastSync] = await Promise.all([
      db.songs.count(),
      db.sets.count(),
      db.meta.get('lastSync'),
    ]);
    return { songs, sets, lastSync: lastSync?.value ?? null };
  },

  /**
   * Replace the mirror wholesale.
   *
   * A full replace rather than a merge: the server's copy is authoritative, and a merge
   * would quietly resurrect songs that were deleted while this device was away.
   */
  async replaceAll(songs: Song[], sets: ServiceSet[], latest: string): Promise<void> {
    await db.transaction('rw', db.songs, db.sets, db.meta, async () => {
      await db.songs.clear();
      await db.sets.clear();
      await db.songs.bulkPut(songs);
      await db.sets.bulkPut(sets);
      await db.meta.bulkPut([
        { key: 'lastSync', value: new Date().toISOString() },
        { key: 'latest', value: latest },
      ]);
    });
  },

  async latest(): Promise<string | null> {
    return (await db.meta.get('latest'))?.value ?? null;
  },

  async allSongs(): Promise<Song[]> {
    return db.songs.orderBy('title').toArray();
  },

  async song(id: string): Promise<Song | null> {
    return (await db.songs.get(id)) ?? null;
  },

  async putSong(song: Song): Promise<void> {
    await db.songs.put(song);
  },

  async deleteSong(id: string): Promise<void> {
    await db.songs.delete(id);
  },

  async allSets(): Promise<ServiceSet[]> {
    return db.sets.toArray();
  },

  async set(id: string): Promise<ServiceSet | null> {
    return (await db.sets.get(id)) ?? null;
  },

  async putSet(set: ServiceSet): Promise<void> {
    await db.sets.put(set);
  },

  /**
   * Search the mirror.
   *
   * A plain scan, not an index: 153 songs is a few milliseconds, and an offline search
   * that behaves differently from the online one would be worse than a slow one. Terms
   * are ANDed and the last is prefix-matched, matching the server's FTS5 behaviour, and
   * title matches rank above lyric matches for the same reason.
   */
  async search(query: string, limit = 50): Promise<{ song: Song; snippet: string }[]> {
    const terms = fold(query).trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const songs = await db.songs.toArray();
    const hits: { song: Song; snippet: string; score: number }[] = [];

    for (const song of songs) {
      const title = fold(song.title);
      const lyrics = fold(song.blocks.flatMap((b) => b.lines.map((l) => l.text)).join('\n'));
      const haystack = `${title}\n${lyrics}`;

      const matchesAll = terms.every((term, i) =>
        i === terms.length - 1
          ? haystack.includes(term)
          : new RegExp(`\\b${escape(term)}`).test(haystack),
      );
      if (!matchesAll) continue;

      const inTitle = terms.some((t) => title.includes(t));
      const at = lyrics.indexOf(terms[terms.length - 1]!);
      const raw = song.blocks.flatMap((b) => b.lines.map((l) => l.text)).join('\n');
      const snippet =
        at === -1 ? (raw.slice(0, 80) ?? '') : `…${raw.slice(Math.max(0, at - 30), at + 50)}…`;

      hits.push({ song, snippet, score: inTitle ? 0 : 1 });
    }

    return hits
      .sort((a, b) => a.score - b.score || a.song.title.localeCompare(b.song.title))
      .slice(0, limit)
      .map(({ song, snippet }) => ({ song, snippet }));
  },
};

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
