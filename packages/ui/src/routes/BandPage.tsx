import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  isMinorKey,
  noteToPitchClass,
  pitchClassToPreferredNote,
  preferredKeyName,
  preferredKeyNames,
  semitonesBetween,
  signedSemitonesBetween,
} from '@worship/core';
import { useSession } from '../lib/useSession.js';
import { useLiveSet, songAt, useSongIndices } from '../lib/useLiveSet.js';
import { usePrefs } from '../lib/settings.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { useHotkeys } from '../lib/useHotkeys.js';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { clientDesktop, type ClientDesktopState } from '../lib/clientDesktop.js';
import { SongBody } from '../components/SongBody.js';
import { BeatLed } from '../components/BeatLed.js';
import { Shortcuts } from '../components/Shortcuts.js';
import { StatusDot } from '../components/StatusDot.js';
import { Button, Checkbox, IconButton, Input, Select } from '../components/ui.js';
import { Sheet } from '../components/Sheet.js';
import {
  AccidentalChoice,
  ChordColour,
  ChordSample,
  FontSize,
  LanguageChoice,
} from '../components/DisplaySettings.js';
import { IconMusic, IconSets, IconSettings } from '../components/icons.js';
import { Logo } from '../components/Logo.js';
import { WaitingForLeader } from '../components/Waiting.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { PerformanceInfo } from '../components/PerformanceInfo.js';

const SHORTCUTS: { keys: string; label: TranslationKey }[] = [
  { keys: '→', label: 'keys.nextSong' },
  { keys: '←', label: 'keys.prevSong' },
  { keys: 'Esc', label: 'keys.backToLeader' },
  { keys: 'c', label: 'keys.chords' },
  { keys: '+', label: 'keys.transposeUp' },
  { keys: '-', label: 'keys.transposeDown' },
  { keys: '?', label: 'keys.help' },
];

const NAME_KEY = 'worship-archive:device-name';

/**
 * The band member view.
 *
 * Follows the leader by default, but any local navigation breaks away — that is the
 * whole point of the legacy SongFollower, and the thing musicians actually rely on:
 * checking the bridge chords while the leader is still on verse two.
 *
 * Breaking away is never silent. A "back to the leader" pill appears the moment the
 * view diverges, so nobody is ever confused about why they are seeing a different verse.
 */
export function BandPage() {
  const { t, lang, setLang } = useT();
  const [params] = useSearchParams();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? params.get('name')?.trim() ?? '';
    } catch {
      return params.get('name')?.trim() ?? '';
    }
  });
  const session = useSession(
    'band',
    name || t('band.defaultName'),
    true,
    params.get('device') ?? undefined,
  );
  const { state, status, clockOffset, libraryRev } = session;
  const live = useLiveSet(state.active ? state.setId : null, libraryRev);
  const [prefs, setPrefs] = usePrefs();

  const [local, setLocal] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clientState, setClientState] = useState<ClientDesktopState | null>(null);
  const [clientName, setClientName] = useState(name);
  const [help, setHelp] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const songIndices = useSongIndices(live.set);

  useEffect(() => {
    if (!settingsOpen) return;
    const native = clientDesktop();
    if (!native) return;
    void native.state().then((value) => {
      setClientState(value);
      setClientName(value.name);
    });
  }, [settingsOpen]);

  // Following again whenever the leader moves would yank the page away mid-glance, so
  // breaking away is sticky until the musician chooses to come back.
  const itemIndex = local ?? state.itemIndex;
  const following = local === null;

  const viewing = songAt(live.set, live.songs, itemIndex);

  /*
    Key and capo: the leader's, unless this musician has said otherwise since.

    Both are the leader's to set — they are properties of how the song is being played
    this Sunday, not of this phone — so they arrive with the set and apply everywhere.
    But a capoed guitar and a bass are not playing the same shapes, so anyone can
    disagree locally.

    The disagreement lasts until the leader decides something. Any change they make to
    this song, or moving to another one, puts every device back on what they said:
    otherwise a guitarist who transposed up two in the first song spends the rest of
    the service two semitones away from the room, and nothing on their screen explains
    why. Held in component state rather than in prefs for the same reason — this is an
    opinion about one song in one service, not a setting.
  */
  const accidentalPreferences = prefs.bandFollowsLeaderAccidentals
    ? (state.host?.accidentalPreferences ?? prefs.accidentalPreferences)
    : prefs.accidentalPreferences;
  const nativeKey = viewing?.song.performanceKey ?? viewing?.song.writtenKey ?? null;
  const usingLiveInstruction = following && itemIndex === state.itemIndex;
  const intendedKey = usingLiveInstruction
    ? (state.performanceKey ??
      viewing?.item.keyOverride ??
      viewing?.song.performanceKey ??
      viewing?.song.writtenKey ??
      null)
    : (viewing?.item.keyOverride ??
      viewing?.song.performanceKey ??
      viewing?.song.writtenKey ??
      null);
  const leaderTranspose = usingLiveInstruction
    ? (state.transpose ?? viewing?.item.transposeOverride ?? 0)
    : (viewing?.item.transposeOverride ?? 0);
  const leaderCapo = usingLiveInstruction
    ? (state.capo ?? viewing?.item.capoOverride ?? 0)
    : (viewing?.item.capoOverride ?? 0);

  const keyAt = (key: string | null, shift: number): string | null => {
    if (!key) return null;
    const pitch = noteToPitchClass(key.replace(/m$/, ''));
    if (pitch === null) return null;
    return `${pitchClassToPreferredNote(pitch + shift, accidentalPreferences)}${isMinorKey(key) ? 'm' : ''}`;
  };
  const leaderDisplayedKey = keyAt(intendedKey, -leaderTranspose - leaderCapo);

  const leaderSays = `${state.leaderRevision}:${itemIndex}`;
  const [heard, setHeard] = useState(leaderSays);
  const [displayedKeyOverride, setDisplayedKeyOverride] = useState<string | null>(null);
  if (heard !== leaderSays) {
    setHeard(leaderSays);
    setDisplayedKeyOverride(null);
  }

  const displayedKey = displayedKeyOverride ?? leaderDisplayedKey;
  const localOverride = displayedKeyOverride !== null;
  const transpose = localOverride
    ? nativeKey && displayedKey
      ? (semitonesBetween(nativeKey, displayedKey) ?? 0)
      : 0
    : nativeKey && intendedKey
      ? (semitonesBetween(nativeKey, intendedKey) ?? 0) - leaderTranspose
      : -leaderTranspose;
  const capoFret = localOverride ? 0 : leaderCapo;
  const instrumentTranspose =
    localOverride && displayedKey && intendedKey
      ? signedSemitonesBetween(displayedKey, intendedKey)
      : null;
  const instrumentCapo =
    localOverride && displayedKey && intendedKey
      ? semitonesBetween(displayedKey, intendedKey)
      : null;
  const selectableKeys = preferredKeyNames(accidentalPreferences).map(
    (key) => `${key}${intendedKey && isMinorKey(intendedKey) ? 'm' : ''}`,
  );

  const shiftDisplayedKey = (delta: number): void => {
    const base = displayedKey ?? intendedKey;
    const next = keyAt(base, delta);
    if (next) setDisplayedKeyOverride(next);
  };

  /**
   * Stop following, right where you are.
   *
   * Freezing on the current item rather than jumping anywhere: "I want to look at
   * something else" starts from what is in front of you.
   */
  const setFollowing = (follow: boolean): void => setLocal(follow ? null : itemIndex);

  const step = (delta: 1 | -1): void => {
    const at = songIndices.indexOf(itemIndex);
    const next =
      at === -1
        ? (songIndices[0] ?? 0)
        : (songIndices[Math.min(Math.max(at + delta, 0), songIndices.length - 1)] ?? itemIndex);
    setLocal(next);
  };

  useHotkeys({
    ArrowRight: () => step(1),
    ArrowLeft: () => step(-1),
    // Escape means "stop looking ahead" first and "close the help" second, because
    // during a service the first is the one people press without thinking.
    Escape: () => (help ? setHelp(false) : setLocal(null)),
    c: () => setPrefs({ showChords: !prefs.showChords }),
    '+': () => shiftDisplayedKey(1),
    '=': () => shiftDisplayedKey(1),
    '-': () => shiftDisplayedKey(-1),
    // Back to the leader, both of them, which is what "0" means on this screen.
    '0': () => {
      setDisplayedKeyOverride(null);
    },
    '?': () => setHelp((open) => !open),
  });

  // Phones lock their screens mid-song otherwise.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async (): Promise<void> => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        // Unsupported, or denied in the background — not worth telling anyone about.
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

  const fit = useFitToScreen(container, content, {
    maxFontPx: prefs.maxFontPx,
    key: `${viewing?.song.id ?? ''}:${prefs.showChords}:${transpose}:${capoFret}:${displayedKey}:${JSON.stringify(accidentalPreferences)}`,
  });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-(--color-line) bg-(--color-surface) px-3 py-1.5">
        {/*
          The mark, and nothing behind it.

          Not a link, on purpose — this view has no way out and should not have one. A
          musician two bars into a song who taps the corner of their phone must not
          find themselves on the archive, with the service still running on the screen
          they can no longer see. It says whose app this is; that is its whole job.
        */}
        <Logo className="h-[17px] shrink-0 text-(--color-chord)" label={t('app.name')} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {viewing?.song.title ?? (live.set ? '—' : t('band.noLiveSet'))}
        </span>
        <BeatLed state={state} clockOffset={clockOffset} size="sm" />
        <StatusDot status={status} />
        <ThemeToggle size="sm" />
        <IconButton
          size="sm"
          label={t('band.songList')}
          active={listOpen}
          aria-expanded={listOpen}
          onClick={() => setListOpen((open) => !open)}
        >
          <IconSets size={14} />
        </IconButton>
        {/*
          Settings, here rather than through the settings page.

          This view has no navigation on purpose — a musician following the leader
          should not be one stray tap from somewhere else mid-service — and leaving to
          change the theme would drop the session. So the handful that matter on a
          phone in a dark room come to it: how it looks, and how big.
        */}
        <IconButton
          size="sm"
          label={t('settings.title')}
          active={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        >
          <IconSettings size={14} />
        </IconButton>

        {/*
          On a phone held upright — which is what most of the band is holding — the
          controls get their own row. In one row they took the width from the title,
          which truncated to "A..", and the one thing a musician glancing down needs to
          know is which song everyone is on.
        */}
        <div className="order-last flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:w-auto">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-(--color-muted)">{t('band.key')}</span>
            <Select
              tight
              className="w-36"
              value={displayedKeyOverride ?? ''}
              onChange={(event) => setDisplayedKeyOverride(event.target.value || null)}
              aria-label={t('band.key')}
            >
              <option value="">
                {t('band.asLeader')}
                {leaderDisplayedKey ? ` - ${leaderDisplayedKey}` : ''}
              </option>
              {selectableKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>
          </label>
          {localOverride && instrumentTranspose !== null && instrumentCapo !== null && (
            <span className="rounded-md bg-(--color-line) px-2 py-1 text-[0.68rem] leading-tight text-(--color-muted)">
              {t('performance.shortSetup', {
                transpose:
                  instrumentTranspose > 0 ? `+${instrumentTranspose}` : instrumentTranspose,
                capo: instrumentCapo,
              })}
            </span>
          )}
          <IconButton
            size="sm"
            label={t('song.chords')}
            active={prefs.showChords}
            onClick={() => setPrefs({ showChords: !prefs.showChords })}
          >
            <IconMusic size={14} />
          </IconButton>

          {/*
            Following, or reading on your own.

            This was a "back to the leader" bar that appeared once you had already
            wandered off. A switch says the same thing before you touch anything and
            stays where it is — and it is the whole point of this view: a musician
            checking the bridge while the leader is still on verse two changes nothing
            for anybody else.
          */}
          <Button size="sm" active={following} onClick={() => setFollowing(!following)}>
            {following ? t('band.following') : t('band.onYourOwn')}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
          The running order, for looking ahead.

          Full width on a phone, where it stands in for the song while it is open, and a
          column beside it on anything wider — the same swap the set workspace makes,
          for the same reason: there is no room for both on a phone and no reason to
          hide either on a laptop.
        */}
        {listOpen && (
          <nav
            aria-label={t('band.songList')}
            className="scroll-slim w-full shrink-0 overflow-y-auto border-r border-(--color-line) py-1 md:w-60"
          >
            {(live.set?.items ?? []).map((item, index) => {
              const song = item.kind === 'song' ? live.songs[item.songId] : undefined;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    // Choosing one is choosing to read on your own; the leader is not
                    // told, and nobody else's screen moves.
                    //
                    // The list stays open. It used to close itself, which is the right
                    // reflex for a menu and the wrong one for a running order: looking
                    // ahead is rarely one glance, and having to reopen the list for
                    // every song made the one thing this panel is for feel like work.
                    setLocal(index);
                    /*
                      Closing depends on whether the list is beside the song or on top
                      of it. Below `md` it takes the whole width and the song is behind
                      it, so choosing one is the end of the errand; beside it, it stays
                      open, because looking ahead is rarely one glance.
                    */
                    if (!window.matchMedia('(min-width: 768px)').matches) setListOpen(false);
                  }}
                  aria-current={index === itemIndex ? 'true' : undefined}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${
                    index === itemIndex ? 'bg-(--color-chord)/15 font-semibold' : ''
                  }`}
                >
                  <span className="w-4 shrink-0 text-right text-xs tabular-nums text-(--color-muted)">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.kind === 'song'
                      ? (song?.title ?? '…')
                      : item.kind === 'note'
                        ? item.text || t('sets.note')
                        : item.label || t('sets.gap')}
                  </span>
                  {index === state.itemIndex && (
                    <span className="shrink-0 text-[0.7rem] text-(--color-chord)">
                      {t('band.hereNow')}
                    </span>
                  )}
                </button>
              );
            })}
            {!live.set && (
              <p className="px-3 py-4 text-xs text-(--color-muted)">{t('band.noLiveSet')}</p>
            )}
          </nav>
        )}

        <main
          id="main"
          ref={container}
          className={`min-h-0 flex-1 px-3 py-3 ${listOpen ? 'hidden md:block' : ''} ${
            fit.fits ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
          onTouchStart={(e) => {
            const x = e.touches[0]?.clientX ?? 0;
            const handler = (end: TouchEvent): void => {
              const dx = (end.changedTouches[0]?.clientX ?? 0) - x;
              if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
              window.removeEventListener('touchend', handler);
            };
            window.addEventListener('touchend', handler);
          }}
        >
          {viewing ? (
            <div
              ref={content}
              style={{
                fontSize: `${fit.fontPx}px`,
                columnCount: fit.columns,
                columnGap: '2.5em',
                visibility: fit.measuring ? 'hidden' : 'visible',
              }}
            >
              {prefs.showChords && (
                <PerformanceInfo
                  intendedKey={preferredKeyName(intendedKey, accidentalPreferences)}
                  transpose={leaderTranspose}
                  capo={leaderCapo}
                  {...(localOverride
                    ? {
                        displayedKey,
                        instrumentTranspose,
                        instrumentCapo,
                      }
                    : {})}
                />
              )}
              <SongBody
                song={viewing.song}
                options={{
                  showChords: prefs.showChords,
                  showBass: false,
                  capo: capoFret,
                  transpose,
                  accidentalPreferences,
                }}
              />
            </div>
          ) : live.set ? (
            <p className="mt-10 text-center text-sm text-(--color-muted)">
              {t('band.leaderNotOnSong')}
            </p>
          ) : (
            <div className="flex h-full items-center justify-center">
              <WaitingForLeader compact />
            </div>
          )}
        </main>
      </div>

      {name === '' && (
        <form
          className="shrink-0 border-t border-(--color-line) px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get('name');
            if (typeof value === 'string' && value.trim()) {
              try {
                localStorage.setItem(NAME_KEY, value.trim());
              } catch {
                // Fine — the name is only a convenience for the leader's device list.
              }
              setName(value.trim());
            }
          }}
        >
          <Input
            name="name"
            required
            placeholder={t('band.yourName')}
            aria-label={t('band.yourName')}
          />
        </form>
      )}

      {settingsOpen && (
        <Sheet title={t('settings.title')} onClose={() => setSettingsOpen(false)}>
          {clientState && (
            <div className="mb-5 grid gap-2 border-b border-(--color-line) pb-5">
              <label className="grid gap-1 text-sm">
                <span className="text-(--color-muted)">{t('band.yourName')}</span>
                <Input
                  value={clientName}
                  required
                  onChange={(event) => setClientName(event.target.value)}
                />
              </label>
              <Button
                size="sm"
                className="justify-self-start"
                disabled={!clientName.trim()}
                onClick={() => {
                  const trimmed = clientName.trim();
                  if (!trimmed) return;
                  void clientDesktop()
                    ?.updateSettings({ name: trimmed })
                    .then((value) => {
                      setClientState(value);
                      setName(value.name);
                    });
                }}
              >
                {t('app.save')}
              </Button>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={clientState.autoStart}
                  onChange={(event) => {
                    void clientDesktop()
                      ?.updateSettings({ autoStart: event.target.checked })
                      .then(setClientState);
                  }}
                />
                <span className="min-w-0">{t('settings.autoStart')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={clientState.fullscreen}
                  onChange={(event) => {
                    void clientDesktop()
                      ?.updateSettings({ fullscreen: event.target.checked })
                      .then(setClientState);
                  }}
                />
                <span className="min-w-0">{t('settings.fullscreen')}</span>
              </label>
            </div>
          )}
          <LanguageChoice label={t('settings.language')} value={lang} onChange={setLang} />
          <FontSize value={prefs.maxFontPx} onChange={(maxFontPx) => setPrefs({ maxFontPx })} />
          <ChordColour
            value={prefs.chordColor}
            onChange={(chordColor) => setPrefs({ chordColor })}
          />
          <ChordSample colour={prefs.chordColor} />
          <div className="mt-5 border-t border-(--color-line) pt-4">
            <span className="mb-2 block text-sm">{t('settings.accidentals')}</span>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={prefs.bandFollowsLeaderAccidentals}
                onChange={(event) =>
                  setPrefs({ bandFollowsLeaderAccidentals: event.target.checked })
                }
              />
              <span>{t('settings.followLeaderNotation')}</span>
            </label>
            {!prefs.bandFollowsLeaderAccidentals && (
              <div className="mt-4">
                <AccidentalChoice
                  value={prefs.accidentalPreferences}
                  onChange={(accidentalPreferences) => setPrefs({ accidentalPreferences })}
                />
              </div>
            )}
          </div>
        </Sheet>
      )}

      {help && <Shortcuts rows={SHORTCUTS} onClose={() => setHelp(false)} />}
    </div>
  );
}
