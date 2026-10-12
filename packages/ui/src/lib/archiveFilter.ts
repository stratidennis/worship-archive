import { canonicalFilterKey } from '@worship/core';
import type { SongSummary } from './api.js';

export interface ArchiveFilters {
  collection: string;
  key: string;
}

/** Apply the set workspace's archive filters without truncating the result list. */
export function filterArchiveSongs<T extends SongSummary>(
  songs: T[],
  filters: ArchiveFilters,
  inCollection: Set<string> | null,
): T[] {
  return songs.filter(
    (song) =>
      (inCollection === null || inCollection.has(song.id)) &&
      (filters.key === '' ||
        canonicalFilterKey(song.performanceKey ?? song.writtenKey ?? '') === filters.key),
  );
}
