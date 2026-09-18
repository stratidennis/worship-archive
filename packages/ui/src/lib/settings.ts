import { useCallback, useSyncExternalStore } from 'react';

/**
 * Per-device preferences.
 *
 * These belong to the person holding the device, not to the song or the service: the
 * guitarist wants capo 3 and chords on, the singer wants words only at a large size,
 * and neither should affect the other. Stored in localStorage, which is exactly the
 * right tool for a per-viewer convenience — and every access is guarded, because it
 * throws in private windows and can come back empty at any time.
 *
 * One store for the whole app, not one per component. Language and theme are read in a
 * dozen places and changed in one; with per-component state, changing the language in
 * Settings would update the Settings page and nothing else.
 */

export interface Prefs {
  showChords: boolean;
  showBass: boolean;
  capo: number;
  /** Extra transposition on top of the song's performance key. */
  transpose: number;
  /** A ceiling, not a command — the fit algorithm decides the actual size. */
  maxFontPx: number;
  language: 'ro' | 'en';
  /**
   * `auto` follows the operating system. `stage` is not a darker dark — it is a
   * different job: near-black with warm high-contrast text, for a display read from
   * across a room with the house lights down.
   */
  theme: 'auto' | 'light' | 'dark' | 'stage';
  /** The set workspace's tools row. Collapsed during a service, expanded while building one. */
  setHeaderExpanded: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  showChords: true,
  showBass: false,
  capo: 0,
  transpose: 0,
  maxFontPx: 26,
  language: 'ro',
  theme: 'auto',
  setHeaderExpanded: true,
};

const KEY = 'worship-archive:prefs';

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function write(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private window, blocked storage, quota — the app works fine without persistence.
  }
}

let current: Prefs = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The same object identity until something actually changes, as the hook requires. */
function snapshot(): Prefs {
  return current;
}

export function updatePrefs(patch: Partial<Prefs>): void {
  const next = { ...current, ...patch };
  if ((Object.keys(patch) as (keyof Prefs)[]).every((k) => current[k] === next[k])) return;
  current = next;
  write(next);
  for (const listener of listeners) listener();
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, snapshot, snapshot);
  const update = useCallback((patch: Partial<Prefs>) => updatePrefs(patch), []);
  return [prefs, update];
}
