import { useEffect } from 'react';
import { usePrefs, type Prefs } from './settings.js';

/**
 * Applying the chosen theme.
 *
 * The attribute goes on `<html>` rather than a wrapper, so the page background is
 * painted before React has rendered anything — a white flash on the way to a stage
 * display is exactly the kind of thing a congregation notices.
 *
 * `auto` deliberately writes no attribute at all, leaving the `prefers-color-scheme`
 * rules in the stylesheet in charge. An explicit `data-theme` beats them on specificity.
 */
export function applyTheme(theme: Prefs['theme']): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * The chord colour, as an override on the token the songs read.
 *
 * An inline property on `<html>`, which is what makes it beat every theme's own value
 * without needing one rule per theme. Printing overrides it back with `!important`,
 * because a colour chosen to stand out on a dark screen is usually invisible on paper.
 */
export function applyChordColor(colour: string | null): void {
  const root = document.documentElement;
  if (colour) root.style.setProperty('--color-chord-ink', colour);
  else root.style.removeProperty('--color-chord-ink');
}

export function useTheme(): void {
  const [prefs] = usePrefs();
  useEffect(() => applyTheme(prefs.theme), [prefs.theme]);
  useEffect(() => applyChordColor(prefs.chordColor), [prefs.chordColor]);
}
