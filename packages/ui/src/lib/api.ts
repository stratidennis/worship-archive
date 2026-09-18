import type { ServiceSet, Song } from '@worship/core';

export interface SongSummary {
  id: string;
  title: string;
  writtenKey: string | null;
  performanceKey: string | null;
  tempo: number | null;
  timeSignature: string | null;
  authors: string[];
  tags: string[];
  collection: string;
  updatedAt: string;
  blockCount: number;
}

export interface SearchHit extends SongSummary {
  snippet: string;
  rank: number;
}

export interface Facets {
  collections: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  keys: { name: string; count: number }[];
}

export interface SetSummary {
  id: string;
  title: string;
  date: string | null;
  itemCount: number;
  songCount: number;
  updatedAt: string;
}

/**
 * The host answered, and the thing is not there.
 *
 * Distinct from a network failure on purpose: "gone" and "unreachable" call for
 * opposite responses. Unreachable means fall back to the local copy; gone means throw
 * the local copy away, or a device goes on working inside a set that no longer exists
 * and edits it back into existence on the next save.
 */
export class NotFound extends Error {
  constructor(readonly path: string) {
    super(`not found: ${path}`);
    this.name = 'NotFound';
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (response.status === 404) throw new NotFound(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
  return (await response.json()) as T;
}

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
  /** Let the request outlive the page, for a save fired as the tab goes away. */
  keepalive = false,
): Promise<T> {
  /*
    No `content-type` without a body.

    Declaring `application/json` and then sending nothing makes Fastify try to parse an
    empty body and answer 400 — so every DELETE this helper made was rejected, and
    deleting a song or a set had never once worked from the interface. It failed
    quietly: the row stayed, and the error went to a state nobody was showing.
  */
  const response = await fetch(path, {
    method,
    ...(keepalive ? { keepalive: true } : {}),
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  stats: () => get<{ songs: number; collections: number; songsDir: string }>('/api/stats'),
  facets: () => get<Facets>('/api/facets'),
  songs: (params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return get<SongSummary[]>(`/api/songs?${q}`);
  },
  song: (id: string) => get<Song>(`/api/songs/${encodeURIComponent(id)}`),
  search: (query: string) => get<SearchHit[]>(`/api/search?q=${encodeURIComponent(query)}`),

  /** The whole library in one call. `204` means the fingerprint still matches. */
  libraryExport: async (since: string | null) => {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await fetch(`/api/library/export${q}`, {
      headers: { accept: 'application/json' },
    });
    if (response.status === 204) return 'unchanged' as const;
    if (!response.ok) throw new Error(`${response.status} for library export`);
    return (await response.json()) as {
      songs: Song[];
      sets: ServiceSet[];
      fingerprint: string;
      exportedAt: string;
    };
  },

  host: () => get<{ addresses: string[]; port: number; hostname: string }>('/api/host'),

  saveSong: (id: string, song: Song) =>
    send<Song>(`/api/songs/${encodeURIComponent(id)}`, 'PUT', song),

  sets: () => get<SetSummary[]>('/api/sets'),
  set: (id: string) => get<ServiceSet>(`/api/sets/${encodeURIComponent(id)}`),
  /** A set plus every song it references, in one request. */
  setFull: (id: string) =>
    get<{ set: ServiceSet; songs: Record<string, Song> }>(
      `/api/sets/${encodeURIComponent(id)}/full`,
    ),
  createSet: (body: { title?: string; date?: string | null }) =>
    send<ServiceSet>('/api/sets', 'POST', body),
  saveSet: (id: string, set: ServiceSet, options: { keepalive?: boolean } = {}) =>
    send<ServiceSet>(`/api/sets/${encodeURIComponent(id)}`, 'PUT', set, options.keepalive),
  duplicateSet: (id: string, body: { title?: string; date?: string | null } = {}) =>
    send<ServiceSet>(`/api/sets/${encodeURIComponent(id)}/duplicate`, 'POST', body),
  deleteSet: (id: string) => send<void>(`/api/sets/${encodeURIComponent(id)}`, 'DELETE'),
};

// ---- backup, restore, chord cleanup ----------------------------------------

export interface Backup {
  format: 'worship-archive-backup';
  version: number;
  createdAt: string;
  counts: { songs: number; sets: number };
  songs: { path: string; text: string }[];
  sets: { path: string; text: string }[];
}

export interface RestoreResult {
  songs: number;
  sets: number;
  removed: number;
  skipped: { path: string; error: string }[];
}

export interface CleanupSuggestion {
  songId: string;
  title: string;
  blockId: string;
  lineIndex: number;
  at: number;
  layer: 'chords' | 'bass';
  raw: string;
  fixed: string;
  reason: string;
  context: string;
}

export interface CleanupAudit {
  suggestions: CleanupSuggestion[];
  spellings: { raw: string; fixed: string; reason: string; count: number }[];
  songsAffected: number;
  chordsScanned: number;
}

export const adminApi = {
  backup: () => get<Backup>('/api/backup'),
  restore: (backup: Backup, mode: 'merge' | 'replace') =>
    send<RestoreResult>('/api/restore', 'POST', { backup, mode }),
  cleanup: () => get<CleanupAudit>('/api/cleanup'),
  applyCleanup: (fixes: Omit<CleanupSuggestion, 'title' | 'reason' | 'context'>[]) =>
    send<{ songs: number; chords: number; stale: number }>('/api/cleanup/apply', 'POST', {
      fixes,
    }),
  /** Creates in one write, so an imported song starts with a clean history. */
  createSong: (song: Partial<Song>) => send<Song>('/api/songs', 'POST', song),
  deleteSong: (id: string) => send<void>(`/api/songs/${encodeURIComponent(id)}`, 'DELETE'),
};
