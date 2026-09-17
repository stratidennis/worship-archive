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

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
  return (await response.json()) as T;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

  sets: () => get<SetSummary[]>('/api/sets'),
  set: (id: string) => get<ServiceSet>(`/api/sets/${encodeURIComponent(id)}`),
  /** A set plus every song it references, in one request. */
  setFull: (id: string) =>
    get<{ set: ServiceSet; songs: Record<string, Song> }>(
      `/api/sets/${encodeURIComponent(id)}/full`,
    ),
  createSet: (body: { title?: string; date?: string | null }) =>
    send<ServiceSet>('/api/sets', 'POST', body),
  saveSet: (id: string, set: ServiceSet) =>
    send<ServiceSet>(`/api/sets/${encodeURIComponent(id)}`, 'PUT', set),
  duplicateSet: (id: string, body: { title?: string; date?: string | null } = {}) =>
    send<ServiceSet>(`/api/sets/${encodeURIComponent(id)}/duplicate`, 'POST', body),
  deleteSet: (id: string) => send<void>(`/api/sets/${encodeURIComponent(id)}`, 'DELETE'),
};
