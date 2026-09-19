import { useEffect, useState } from 'react';
import type { HostDisplay } from '@worship/core';
import { usePrefs } from './settings.js';
import { useLeading } from './leading.js';
import { desktop } from './desktop.js';

/**
 * Telling the screens what this device looks like.
 *
 * The stage settings are layered: a screen's own, then all screens, then *this*
 * device. That last layer is what people actually mean by leaving a setting alone —
 * "the same as what I am looking at" — and it is the layer that was missing, so a
 * leader working in English with the screens set to follow watched them stay in
 * Romanian and reasonably concluded the setting was broken.
 *
 * Two things this gets right that the obvious version does not:
 *
 *  - **The theme is resolved before it is sent.** Publishing `auto` would mean "match
 *    the system" on the television, which is the same misunderstanding one level down:
 *    a laptop in dark mode and a TV whose OS is light would still disagree.
 *  - **Not every device may speak.** Every phone in the room runs this same app, and a
 *    guitarist switching their own screen to dark must not repaint the wall. Only the
 *    device the service is being run from does: the machine hosting it, or whoever is
 *    leading right now.
 */

/** Which devices are allowed to speak for the room. */
function isHost(leading: boolean): boolean {
  if (leading) return true;
  // The desktop app *is* the host machine, and a browser on that machine reaches it
  // by a loopback address. Everything else on the WiFi is somebody's phone.
  if (desktop()) return true;
  return /^(localhost|127\.|\[?::1)/.test(location.hostname);
}

export function useHostAppearance(): void {
  const [prefs] = usePrefs();
  const { setId } = useLeading();
  const leading = setId !== null;

  /*
    The system's own preference, watched rather than read once.

    Without this, a laptop on "match the system" that goes dark at sunset publishes
    nothing — the setting did not change, only its answer did — and the screens stay
    light for the rest of the evening.
  */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme = prefs.theme === 'auto' ? (systemDark ? 'dark' : 'light') : prefs.theme;
  const language = prefs.language;
  const chordColor = prefs.chordColor;
  const accidentalPreferences = prefs.accidentalPreferences;

  useEffect(() => {
    if (!isHost(leading)) return;
    const controller = new AbortController();
    void fetch('/api/session/host', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        theme,
        language,
        chordColor,
        accidentalPreferences,
      } satisfies HostDisplay),
      signal: controller.signal,
    }).catch(() => {
      // No host to tell, or it went away mid-request. The screens keep what they have,
      // which is the right failure: nothing on a wall should change because a fetch
      // did not land.
    });
    return () => controller.abort();
  }, [leading, theme, language, chordColor, accidentalPreferences]);
}
