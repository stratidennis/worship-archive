import { canonicalFilterKey } from '@worship/core';
import type { SongSummary } from './api.js';

export interface ArchiveFilters {
  collection: string;
  keys: string[];
}

/** Toggle one key without changing the other selections. */
export function toggleArchiveKey(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((selected) => selected !== key) : [...keys, key];
}

/** Apply either archive view's filters without truncating the result list. */
export function filterArchiveSongs<T extends SongSummary>(
  songs: T[],
  filters: ArchiveFilters,
  inCollection: Set<string> | null,
): T[] {
  const selectedKeys = new Set(
    filters.keys.map(canonicalFilterKey).filter((key) => key !== null),
  );
  return songs.filter(
    (song) =>
      (!filters.collection || inCollection?.has(song.id) === true) &&
      (filters.keys.length === 0 ||
        selectedKeys.has(
          canonicalFilterKey(song.performanceKey ?? song.writtenKey ?? '') ?? '',
        )),
  );
}
