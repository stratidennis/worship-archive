import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_ACCIDENTAL_PREFERENCES,
  DEFAULT_SONG_FONT_SIZE,
  DEFAULT_SONG_LINE_HEIGHT,
  MAX_FITTED_SONG_FONT_SIZE,
  MAX_SONG_FONT_SIZE,
  MAX_SONG_LINE_HEIGHT,
  MIN_SONG_FONT_SIZE,
  MIN_SONG_LINE_HEIGHT,
  type AccidentalPreferences,
  type CueStyle,
} from '@worship/core';

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
  /** Visual density of song cues and section labels. */
  cueStyle: CueStyle;
  capo: number;
  /** Extra transposition on top of the song's performance key. */
  transpose: number;
  /** The automatic fitter may never make normal lyrics smaller than this. */
  minFontPx: number;
  /** The automatic fitter may never make normal lyrics larger than this. */
  maxFontPx: number;
  /** Lyric line height as a unitless multiplier. */
  lineHeight: number;
  /**
   * What colour chords are printed in, as a CSS colour, or null for the theme's own.
   *
   * Only the chords. The same blue is also the app's accent — buttons, selection, the
   * focus ring — and someone who wants their chords in bright orange because the room
   * is bright is not asking for an orange interface.
   */
  chordColor: string | null;
  /** The spelling selected for each enharmonic black-key pair. */
  accidentalPreferences: AccidentalPreferences;
  /** Band installations follow the Leader until the musician explicitly opts out. */
  bandFollowsLeaderAccidentals: boolean;
  language: 'ro' | 'en';
  /** `auto` follows the operating system. */
  theme: 'auto' | 'light' | 'dark';
  /** The set workspace's tools row. Collapsed during a service, expanded while building one. */
  setHeaderExpanded: boolean;
  /**
   * Width of the running-order panel, in pixels.
   *
   * Bounded rather than free: past a point the list is all whitespace and the song has
   * nowhere left to go, and a panel dragged to the far edge on a laptop is a layout
   * nobody can recover from without knowing where the divider went.
   */
  sidebarWidth: number;
}

export const DEFAULT_PREFS: Prefs = {
  showChords: true,
  cueStyle: 'full',
  capo: 0,
  transpose: 0,
  minFontPx: DEFAULT_SONG_FONT_SIZE,
  maxFontPx: MAX_FITTED_SONG_FONT_SIZE,
  lineHeight: DEFAULT_SONG_LINE_HEIGHT,
  chordColor: null,
  accidentalPreferences: DEFAULT_ACCIDENTAL_PREFERENCES,
  bandFollowsLeaderAccidentals: true,
  language: 'en',
  theme: 'auto',
  setHeaderExpanded: true,
  sidebarWidth: 288,
};

const KEY = 'worship-archive:prefs';

type StoredPrefs = Partial<Prefs> & {
  /** Preferences written before the three cue styles were introduced. */
  showBlockTitles?: boolean;
  /** Distinguishes the new ceiling from the retired pre-floor maxFontPx setting. */
  fontSizingVersion?: 2;
};

export function normalisePrefs(value: unknown): Prefs {
  if (!value || typeof value !== 'object') return DEFAULT_PREFS;
  const saved = value as StoredPrefs;
  const legacyShowBlockTitles = saved.showBlockTitles;
  const currentSaved = { ...saved };
  delete currentSaved.showBlockTitles;
  delete currentSaved.fontSizingVersion;
  const theme =
    saved.theme === 'light' || saved.theme === 'dark' || saved.theme === 'auto'
      ? saved.theme
      : DEFAULT_PREFS.theme;
  const lineHeight =
    typeof saved.lineHeight === 'number' && Number.isFinite(saved.lineHeight)
      ? Math.min(MAX_SONG_LINE_HEIGHT, Math.max(MIN_SONG_LINE_HEIGHT, saved.lineHeight))
      : DEFAULT_PREFS.lineHeight;
  const minFontPx =
    typeof saved.minFontPx === 'number' && Number.isFinite(saved.minFontPx)
      ? Math.min(MAX_SONG_FONT_SIZE, Math.max(MIN_SONG_FONT_SIZE, saved.minFontPx))
      : DEFAULT_PREFS.minFontPx;
  const maxFontPx =
    saved.fontSizingVersion === 2 &&
    typeof saved.maxFontPx === 'number' &&
    Number.isFinite(saved.maxFontPx)
      ? Math.min(MAX_FITTED_SONG_FONT_SIZE, Math.max(minFontPx, saved.maxFontPx))
      : DEFAULT_PREFS.maxFontPx;
  const cueStyle: CueStyle =
    saved.cueStyle === 'full' || saved.cueStyle === 'compact' || saved.cueStyle === 'minimal'
      ? saved.cueStyle
      : legacyShowBlockTitles === false
        ? 'compact'
        : DEFAULT_PREFS.cueStyle;
  return {
    ...DEFAULT_PREFS,
    ...currentSaved,
    // Older builds offered a separate Stage palette. Treat that retired value as
    // the normal system theme instead of leaving an unsupported data attribute.
    theme,
    lineHeight,
    minFontPx,
    maxFontPx,
    cueStyle,
    accidentalPreferences: {
      ...DEFAULT_ACCIDENTAL_PREFERENCES,
      ...(saved.accidentalPreferences ?? {}),
    },
  };
}

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return normalisePrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFS;
  }
}

function write(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...prefs, fontSizingVersion: 2 }));
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
