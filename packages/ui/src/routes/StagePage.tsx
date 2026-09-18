import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { semitonesBetween } from '@worship/core';
import { useSession } from '../lib/useSession.js';
import { useLiveSet, songAt } from '../lib/useLiveSet.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { setLanguageOverride, useT } from '../lib/i18n.js';
import { applyChordColor, applyTheme } from '../lib/theme.js';
import { usePrefs } from '../lib/settings.js';
import { SongBody } from '../components/SongBody.js';
import { BeatLed } from '../components/BeatLed.js';
import { Logo } from '../components/Logo.js';

/** What a screen uses when nobody has said otherwise: big, because it is read far away. */
export const STAGE_DEFAULT_FONT = 72;

/**
 * The stage display.
 *
 * Follows the leader exactly, with no local control — the legacy SongSlave, except it
 * is a URL rather than a separate program to install. Query parameters configure it
 * once: `?chords=0` for a singer's monitor, `?name=Ecran%20stânga` to label it in the
 * leader's device list.
 *
 * Deliberately chrome-free. Everything on this screen is either lyrics or a signal that
 * something is wrong, because anything else is a distraction on a platform.
 */
export function StagePage() {
  const { t } = useT();
  const [params] = useSearchParams();
  const showChords = params.get('chords') !== '0';
  const showBass = params.get('bass') === '1';
  const name = params.get('name') ?? t('app.stage');

  const { state, status, clockOffset, libraryRev } = useSession('stage', name);
  const live = useLiveSet(state.setId, libraryRev);
  const [prefs] = usePrefs();

  /*
    How this screen looks, as the leader set it.

    A stage display has nobody standing at it — it is a television on a bracket, and
    the person who can see that the text is too small from the back row is at the
    laptop. So the session carries these, and anything left unset here falls back to
    what this screen would have done on its own.
  */
  const stage = state.stage;
  useEffect(() => {
    applyTheme(stage.theme ?? prefs.theme);
    return () => applyTheme(prefs.theme);
  }, [stage.theme, prefs.theme]);

  useEffect(() => {
    applyChordColor(stage.chordColor ?? prefs.chordColor);
    return () => applyChordColor(prefs.chordColor);
  }, [stage.chordColor, prefs.chordColor]);

  useEffect(() => {
    setLanguageOverride(stage.language);
    return () => setLanguageOverride(null);
  }, [stage.language]);

  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  const viewing = songAt(live.set, live.songs, state.itemIndex);

  // The whole song, always. The leader can no longer push a single section, so there is
  // nothing left here that could show the room less than it is singing.
  const song = viewing?.song ?? null;

  const extraTranspose = useMemo(() => {
    if (!viewing?.item.keyOverride) return state.transpose;
    const native = viewing.song.performanceKey ?? viewing.song.writtenKey;
    if (!native) return state.transpose;
    return state.transpose + (semitonesBetween(native, viewing.item.keyOverride) ?? 0);
  }, [viewing, state.transpose]);

  const fit = useFitToScreen(container, content, {
    // A stage display is read at a distance, so it is allowed to go much larger than a
    // handheld device would — and the leader can raise or lower that ceiling for every
    // screen at once.
    maxFontPx: stage.maxFontPx ?? STAGE_DEFAULT_FONT,
    minFontPx: 14,
    key: `${song?.id ?? ''}:${showChords}:${showBass}:${extraTranspose}:${stage.maxFontPx}`,
  });

  // A TV that sleeps mid-service is the single most visible failure this screen can have.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async (): Promise<void> => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        // Unsupported or denied; nothing useful to do or say.
      }
    };
    void request();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  return (
    <div className="relative flex h-dvh flex-col bg-(--color-stage-bg)">
      <div
        id="main"
        ref={container}
        className="min-h-0 flex-1 overflow-hidden px-4 py-3 sm:px-5"
      >
        {state.output === 'cleared' ? null : song ? (
          <div
            ref={content}
            style={{
              fontSize: `${fit.fontPx}px`,
              columnCount: fit.columns,
              columnGap: '2.5em',
              visibility: fit.measuring ? 'hidden' : 'visible',
            }}
          >
            <SongBody
              song={song}
              options={{
                showChords,
                showBass,
                capo: viewing?.item.capoOverride ?? 0,
                transpose: extraTranspose,
              }}
            />
          </div>
        ) : (
          /* A screen at the front of a room with nothing on it yet. Better that it look
             like a thing that is on and waiting than like a thing that failed. */
          <div className="mt-[22vh] flex flex-col items-center gap-6">
            <Logo className="h-20 text-(--color-chord) opacity-25" />
            <p className="text-center text-lg text-(--color-muted)">
              {live.set ? '' : t('band.waiting')}
            </p>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 right-4 flex items-center gap-3">
        <BeatLed state={state} clockOffset={clockOffset} />
        {status !== 'live' && (
          <span
            className="rounded-full px-2 py-0.5 text-xs"
            style={{ background: 'oklch(62% 0.21 25)', color: 'white' }}
          >
            {status === 'connecting' ? t('status.reconnecting') : t('status.offline')}
          </span>
        )}
      </div>
    </div>
  );
}
