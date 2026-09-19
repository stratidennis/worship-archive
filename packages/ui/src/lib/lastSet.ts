/**
 * Which set this device was last working in.
 *
 * Per device rather than on the server, deliberately: the leader's laptop and a
 * guitarist's phone are usually in the same set but need not be, and a shared "current
 * set" would mean one person opening last month's service moves everyone else.
 *
 * localStorage, so it survives a restart — which is the whole point, since the app now
 * opens straight into a set.
 */

const KEY = 'worship-archive:last-set';
const ITEM_KEY = 'worship-archive:last-set-item:';

export function rememberSet(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private window or blocked storage. The app falls back to the newest set, which is
    // a reasonable guess and better than refusing to open.
  }
}

export function lastSet(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetSet(id: string): void {
  try {
    if (localStorage.getItem(KEY) === id) localStorage.removeItem(KEY);
    localStorage.removeItem(`${ITEM_KEY}${id}`);
  } catch {
    // Nothing to do; a stale id is handled by the caller falling back.
  }
}

/** Remember which running-order item this device was reading in one set. */
export function rememberSetItem(setId: string, index: number): void {
  if (!Number.isInteger(index) || index < 0) return;
  try {
    localStorage.setItem(`${ITEM_KEY}${setId}`, String(index));
  } catch {
    // The set still opens normally when storage is unavailable; it starts at item one.
  }
}

/**
 * The last running-order item, if it still exists.
 *
 * Bounds checking here matters after an item has been removed on another device. A
 * stale position must never make the workspace render an empty preview.
 */
export function lastSetItem(setId: string, itemCount: number): number | null {
  try {
    const raw = localStorage.getItem(`${ITEM_KEY}${setId}`);
    if (raw === null) return null;
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 && index < itemCount ? index : null;
  } catch {
    return null;
  }
}

/** Clear a remembered item when that item itself no longer exists. */
export function forgetSetItem(setId: string): void {
  try {
    localStorage.removeItem(`${ITEM_KEY}${setId}`);
  } catch {
    // There is no useful recovery work to do when storage is unavailable.
  }
}

/**
 * Choose which set to open.
 *
 * In order: the one this device last had open, then the most recently *created*, then
 * nothing — which tells the caller to make one. The remembered id is checked against
 * the list rather than trusted, because a set deleted on the host would otherwise send
 * this device to a page that cannot load.
 */
export function chooseSet<T extends { id: string; createdAt?: string; updatedAt?: string }>(
  sets: readonly T[],
  remembered: string | null,
): T | null {
  if (sets.length === 0) return null;
  const previous = remembered ? sets.find((set) => set.id === remembered) : undefined;
  if (previous) return previous;
  const newest = [...sets].sort((a, b) =>
    (b.createdAt ?? b.updatedAt ?? '').localeCompare(a.createdAt ?? a.updatedAt ?? ''),
  )[0];
  return newest ?? null;
}
