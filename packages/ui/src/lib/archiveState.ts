import { canonicalFilterKey } from '@worship/core';
import type { ArchiveFilters } from './archiveFilter.js';

const PREFIX = 'worship-archive:archive:';

/** Per-device browsing state survives navigation and application restarts. */
export function readArchiveState(view: string): URLSearchParams {
  try {
    return new URLSearchParams(localStorage.getItem(PREFIX + view) ?? '');
  } catch {
    return new URLSearchParams();
  }
}

export function rememberArchiveState(view: string, params: URLSearchParams): void {
  try {
    localStorage.setItem(PREFIX + view, params.toString());
  } catch {
    // Browsing must still work when device storage is unavailable.
  }
}

export function archiveFiltersFromParams(params: URLSearchParams): ArchiveFilters {
  return {
    collection: params.get('collection') ?? '',
    keys: [
      ...new Set(
        params
          .getAll('key')
          .map(canonicalFilterKey)
          .filter((key) => key !== null),
      ),
    ],
  };
}

export function readArchiveScroll(view: string): number {
  const value = Number(readArchiveState('scroll:' + view).get('top'));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function rememberArchiveScroll(view: string, top: number): void {
  rememberArchiveState('scroll:' + view, new URLSearchParams({ top: String(top) }));
}
