import type { ServiceSet, Song } from '@worship/core';
import { api, NotFound, type SearchHit, type SongSummary } from './api.js';
import { store } from './store.js';

/**
 * The repository every screen reads through.
 *
 * Offline-first, in the strict sense: reads are answered from the local mirror, and the
 * network only fills it. That makes "at home with no host" and "at church on good WiFi"
 * the same code path, and it is why a WiFi drop mid-song changes nothing on screen.
 *
 * Writes still go to the server, because the server owns the files. A write attempted
 * offline fails loudly rather than queueing — a musician who thinks they fixed a chord
 * and finds it gone next Sunday is worse served than one who is told now.
 */

export type Reachability = 'online' | 'offline' | 'unknown';

let reachable: Reachability = 'unknown';
const listeners = new Set<(state: Reachability) => void>();

function setReachable(next: Reachability): void {
  if (reachable === next) return;
  reachable = next;
  for (const listener of listeners) listener(next);
}

export function onReachabilityChange(listener: (state: Reachability) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reachability(): Reachability {
  return reachable;
}

/**
 * Run a network call, recording whether the host answered.
 *
 * A 404 counts as the host answering. It comes back as `'gone'` rather than `null` so
 * callers can tell "the host says this does not exist" from "there is no host".
 */
async function probe<T>(run: () => Promise<T>): Promise<T | null | 'gone'> {
  try {
    const result = await run();
    setReachable('online');
    return result;
  } catch (error) {
    if (error instanceof NotFound) {
      setReachable('online');
      return 'gone';
    }
    setReachable('offline');
    return null;
  }
}

function summarise(song: Song): SongSummary {
  return {
    id: song.id,
    title: song.title,
    writtenKey: song.writtenKey,
    performanceKey: song.performanceKey,
    tempo: song.tempo,
    timeSignature: song.timeSignature,
    authors: song.authors,
    tags: song.tags,
    collection: '',
    updatedAt: song.updatedAt,
    blockCount: song.blocks.length,
  };
}

export const repo = {
  /**
   * Pull the whole library into the mirror.
   *
   * Sends the fingerprint already held, so an unchanged library costs a 204 rather than
   * a megabyte — the usual case on arriving at church with last week's songs. A
   * fingerprint rather than a timestamp because a deletion lowers the newest
   * `updatedAt` and so could never be noticed.
   */
  async sync(): Promise<{ synced: boolean; songs: number } | null> {
    const since = await store.fingerprint();
    const result = await probe(() => api.libraryExport(since));
    // `'gone'` cannot happen here — the export endpoint always exists — but narrowing
    // it explicitly is cheaper than an assertion that could quietly become untrue.
    if (result === null || result === 'gone') return null;
    if (result === 'unchanged') {
      const status = await store.status();
      return { synced: false, songs: status.songs };
    }
    await store.replaceAll(result.songs, result.sets, result.fingerprint);
    return { synced: true, songs: result.songs.length };
  },

  async songs(): Promise<SongSummary[]> {
    const local = await store.allSongs();
    return local.map(summarise);
  },

  async song(id: string): Promise<Song | null> {
    const local = await store.song(id);
    if (local) return local;
    // Not mirrored yet — a song added since the last sync.
    const remote = await probe(() => api.song(id));
    if (remote === null || remote === 'gone') return null;
    await store.putSong(remote);
    return remote;
  },

  async search(query: string): Promise<SearchHit[]> {
    // The server's FTS5 ranking is better, so prefer it when the host answers.
    const remote = await probe(() => api.search(query));
    if (remote && remote !== 'gone') return remote;
    const local = await store.search(query);
    return local.map(({ song, snippet }) => ({ ...summarise(song), snippet, rank: 0 }));
  },

  async sets(): Promise<ServiceSet[]> {
    return store.allSets();
  },

  async set(id: string): Promise<ServiceSet | null> {
    const remote = await probe(() => api.set(id));
    if (remote === 'gone') {
      await store.deleteSet(id);
      return null;
    }
    if (remote) {
      await store.putSet(remote);
      return remote;
    }
    return store.set(id);
  },

  /**
   * A set with every song it references.
   *
   * Assembled from the mirror so a service keeps working with no host: the host's own
   * `/full` endpoint is preferred when reachable, because it is one request instead of
   * many and its copy is authoritative.
   */
  async setFull(id: string): Promise<{ set: ServiceSet; songs: Record<string, Song> } | null> {
    const remote = await probe(() => api.setFull(id));
    if (remote === 'gone') {
      // Deleted on the host. Drop the local copy rather than letting someone keep
      // working in a set that no longer exists.
      await store.deleteSet(id);
      return null;
    }
    if (remote) {
      await store.putSet(remote.set);
      for (const song of Object.values(remote.songs)) await store.putSong(song);
      return remote;
    }

    const set = await store.set(id);
    if (!set) return null;
    const songs: Record<string, Song> = {};
    for (const item of set.items) {
      if (item.kind !== 'song') continue;
      const song = await store.song(item.songId);
      if (song) songs[item.songId] = song;
    }
    return { set, songs };
  },

  /** Write through: server first, mirror updated from what it stored. */
  async saveSong(id: string, song: Song): Promise<Song> {
    const stored = await api.saveSong(id, song);
    await store.putSong(stored);
    setReachable('online');
    return stored;
  },

  async saveSet(id: string, set: ServiceSet): Promise<ServiceSet> {
    const stored = await api.saveSet(id, set);
    await store.putSet(stored);
    setReachable('online');
    return stored;
  },

  status: store.status,
};
