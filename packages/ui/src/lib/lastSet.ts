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
  } catch {
    // Nothing to do; a stale id is handled by the caller falling back.
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
