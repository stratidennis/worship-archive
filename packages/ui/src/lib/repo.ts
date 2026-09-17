import type { ServiceSet, Song } from '@worship/core';
import { api, type SearchHit, type SongSummary } from './api.js';
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

/** Run a network call, recording whether the host answered. */
async function probe<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    const result = await run();
    setReachable('online');
    return result;
  } catch {
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
   * Sends the last-known timestamp so an unchanged library costs a 204 rather than a
   * megabyte — the usual case on arriving at church with last week's songs.
   */
  async sync(): Promise<{ synced: boolean; songs: number } | null> {
    const since = await store.latest();
    const result = await probe(() => api.libraryExport(since));
    if (result === null) return null;
    if (result === 'unchanged') {
      const status = await store.status();
      return { synced: false, songs: status.songs };
    }
    await store.replaceAll(result.songs, result.sets, result.latest);
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
    if (remote) await store.putSong(remote);
    return remote;
  },

  async search(query: string): Promise<SearchHit[]> {
    // The server's FTS5 ranking is better, so prefer it when the host answers.
    const remote = await probe(() => api.search(query));
    if (remote) return remote;
    const local = await store.search(query);
    return local.map(({ song, snippet }) => ({ ...summarise(song), snippet, rank: 0 }));
  },

  async sets(): Promise<ServiceSet[]> {
    return store.allSets();
  },

  async set(id: string): Promise<ServiceSet | null> {
    const local = await store.set(id);
    if (local) return local;
    const remote = await probe(() => api.set(id));
    if (remote) await store.putSet(remote);
    return remote;
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
