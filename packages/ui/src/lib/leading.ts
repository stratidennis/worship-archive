import { useSyncExternalStore } from 'react';

/**
 * Who is being led, and how — for as long as the leader says so.
 *
 * This used to be `useState` inside the set page, which meant it died the moment you
 * navigated anywhere: opening the QR screen to get one more phone connected closed the
 * leader's socket, dropped it out of everyone's device list, and left the switch off
 * when you came back. Leading is not a property of a page you happen to be looking at.
 * It is a thing you turned on and have not turned off.
 *
 * So it lives here, above the router, and the socket lives with it. Deliberately *not*
 * persisted to storage: a device that came back leading after a refresh would reclaim
 * the service and move every screen in the building, silently, to recover from a
 * reload. Pressing the switch again is one click and is unambiguous.
 */

export interface Leading {
  /** The set being led, or null when nobody here is leading. */
  setId: string | null;
  /**
   * Whether the preview follows the service or runs ahead of it.
   *
   * Here rather than on the page for the same reason as `setId`: a leader who switched
   * to Manual to look at the next song, then stepped away to the QR screen, should not
   * come back to find themselves pushing every glance straight to the congregation.
   */
  auto: boolean;
}

let current: Leading = { setId: null, auto: true };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setLeading(patch: Partial<Leading>): void {
  const next = { ...current, ...patch };
  if (next.setId === current.setId && next.auto === current.auto) return;
  current = next;
  emit();
}

export function useLeading(): Leading {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
