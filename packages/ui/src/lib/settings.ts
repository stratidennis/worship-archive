import { useCallback, useEffect, useState } from 'react';

/**
 * Per-device preferences.
 *
 * These belong to the person holding the device, not to the song or the service: the
 * guitarist wants capo 3 and chords on, the singer wants words only at a large size,
 * and neither should affect the other. Stored in localStorage, which is exactly the
 * right tool for a per-viewer convenience — and every access is guarded, because it
 * throws in private windows and can come back empty at any time.
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
}

export const DEFAULT_PREFS: Prefs = {
  showChords: true,
  showBass: false,
  capo: 0,
  transpose: 0,
  maxFontPx: 26,
  language: 'ro',
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

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  // Read after mount so server-side/first paint is deterministic.
  useEffect(() => setPrefs(read()), []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      write(next);
      return next;
    });
  }, []);

  return [prefs, update];
}
