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

export function useTheme(): void {
  const [prefs] = usePrefs();
  useEffect(() => applyTheme(prefs.theme), [prefs.theme]);
}

/**
 * The pre-paint theme, inlined into the page head.
 *
 * Reading the preference in React is one frame too late: the first paint would use the
 * default theme and then swap. This runs before the body exists, and it is why it reads
 * localStorage directly rather than going through `usePrefs`.
 */
export const THEME_BOOTSTRAP = `
try {
  var p = JSON.parse(localStorage.getItem('worship-archive:prefs') || '{}');
  if (p.theme && p.theme !== 'auto') document.documentElement.setAttribute('data-theme', p.theme);
} catch (e) {}
`.trim();
