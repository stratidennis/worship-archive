import type { Song } from '@worship/core';

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

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
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
};
