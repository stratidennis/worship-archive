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
  async replaceAll(songs: Song[], sets: ServiceSet[], fingerprint: string): Promise<void> {
    await db.transaction('rw', db.songs, db.sets, db.meta, async () => {
      await db.songs.clear();
      await db.sets.clear();
      await db.songs.bulkPut(songs);
      await db.sets.bulkPut(sets);
      await db.meta.bulkPut([
        { key: 'lastSync', value: new Date().toISOString() },
        { key: 'fingerprint', value: fingerprint },
      ]);
    });
  },

  async fingerprint(): Promise<string | null> {
    return (await db.meta.get('fingerprint'))?.value ?? null;
  },

  async deleteSet(id: string): Promise<void> {
    await db.sets.delete(id);
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
    const titleHits: { song: Song; snippet: string }[] = [];
    const lyricHits: { song: Song; snippet: string }[] = [];

    for (const song of songs) {
      const title = fold(song.title);
      const lyrics = fold(song.blocks.flatMap((b) => b.lines.map((l) => l.text)).join('\n'));
      const matches = (value: string): boolean =>
        terms.every((term, i) =>
          i === terms.length - 1
            ? value.includes(term)
            : new RegExp(`\\b${escape(term)}`).test(value),
        );
      const titleMatches = matches(title);
      const lyricsMatch = matches(lyrics);
      if (!titleMatches && !lyricsMatch) continue;

      const at = lyrics.indexOf(terms[terms.length - 1]!);
      const raw = song.blocks.flatMap((b) => b.lines.map((l) => l.text)).join('\n');
      const snippet =
        at === -1 ? (raw.slice(0, 80) ?? '') : `…${raw.slice(Math.max(0, at - 30), at + 50)}…`;

      (titleMatches ? titleHits : lyricHits).push({ song, snippet });
    }

    return (titleHits.length > 0 ? titleHits : lyricHits)
      .sort((a, b) => a.song.title.localeCompare(b.song.title))
      .slice(0, limit)
      .map(({ song, snippet }) => ({ song, snippet }));
  },
};

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
