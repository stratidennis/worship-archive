import { useEffect, useMemo, useState } from 'react';
import type { ServiceSet, SetItem, Song } from '@worship/core';
import { repo } from './repo.js';

/**
 * The set currently being led, with every song already in memory.
 *
 * Fetched whole, in one request, and deliberately not refetched per song: a device that
 * loses WiFi mid-service must keep showing the rest of the service. Nothing here
 * depends on the network once it has loaded.
 */
export interface LiveSet {
  set: ServiceSet | null;
  songs: Record<string, Song>;
  loading: boolean;
  error: string | null;
}

export function useLiveSet(setId: string | null, reloadKey = 0): LiveSet {
  const [data, setData] = useState<{ set: ServiceSet; songs: Record<string, Song> } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!setId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    repo
      .setFull(setId)
      .then((result) => {
        if (cancelled || !result) return;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => {
        // Keep whatever is already on screen. A failed refresh must never blank a song
        // that a musician is in the middle of playing.
        if (!cancelled) setError(String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [setId, reloadKey]);

  return { set: data?.set ?? null, songs: data?.songs ?? {}, loading, error };
}

/** The item at an index, or null when the index has run off the end. */
export function itemAt(set: ServiceSet | null, index: number): SetItem | null {
  return set?.items[index] ?? null;
}

/** The song at an index, if that item is a song. */
export function songAt(
  set: ServiceSet | null,
  songs: Record<string, Song>,
  index: number,
): { item: Extract<SetItem, { kind: 'song' }>; song: Song } | null {
  const item = itemAt(set, index);
  if (!item || item.kind !== 'song') return null;
  const song = songs[item.songId];
  return song ? { item, song } : null;
}

/** Indices of the items that are songs — used for next/previous song navigation. */
export function useSongIndices(set: ServiceSet | null): number[] {
  return useMemo(
    () => (set?.items ?? []).flatMap((item, index) => (item.kind === 'song' ? [index] : [])),
    [set],
  );
}
