import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { semitonesBetween } from '@worship/core';
import { useSession } from '../lib/useSession.js';
import { useLiveSet, songAt, useSongIndices } from '../lib/useLiveSet.js';
import { usePrefs } from '../lib/settings.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { useHotkeys } from '../lib/useHotkeys.js';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { SongBody } from '../components/SongBody.js';
import { BeatLed } from '../components/BeatLed.js';
import { Shortcuts } from '../components/Shortcuts.js';
import { StatusDot } from './LeadPage.js';

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
  const { t } = useT();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const session = useSession('band', name || t('band.defaultName'));
  const { state, status, clockOffset, libraryRev } = session;
  const live = useLiveSet(state.setId, libraryRev);
  const [prefs, setPrefs] = usePrefs();

  const [local, setLocal] = useState<{ itemIndex: number; blockId: string | null } | null>(
    null,
  );
  const [help, setHelp] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const songIndices = useSongIndices(live.set);

  // Following again whenever the leader moves would yank the page away mid-glance, so
  // breaking away is sticky until the musician chooses to come back.
  const position = local ?? { itemIndex: state.itemIndex, blockId: state.blockId };
  const following = local === null;

  const viewing = songAt(live.set, live.songs, position.itemIndex);

  const step = (delta: 1 | -1): void => {
    const at = songIndices.indexOf(position.itemIndex);
    const next =
      at === -1
        ? (songIndices[0] ?? 0)
        : (songIndices[Math.min(Math.max(at + delta, 0), songIndices.length - 1)] ??
          position.itemIndex);
    setLocal({ itemIndex: next, blockId: null });
  };

  useHotkeys({
    ArrowRight: () => step(1),
    ArrowLeft: () => step(-1),
    // Escape means "stop looking ahead" first and "close the help" second, because
    // during a service the first is the one people press without thinking.
    Escape: () => (help ? setHelp(false) : setLocal(null)),
    c: () => setPrefs({ showChords: !prefs.showChords }),
    '+': () => setPrefs({ transpose: prefs.transpose + 1 }),
    '=': () => setPrefs({ transpose: prefs.transpose + 1 }),
    '-': () => setPrefs({ transpose: prefs.transpose - 1 }),
    '0': () => setPrefs({ transpose: 0 }),
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

  const extraTranspose = useMemo(() => {
    if (!viewing?.item.keyOverride) return state.transpose + prefs.transpose;
    const native = viewing.song.performanceKey ?? viewing.song.writtenKey;
    if (!native) return state.transpose + prefs.transpose;
    return (
      state.transpose +
      prefs.transpose +
      (semitonesBetween(native, viewing.item.keyOverride) ?? 0)
    );
  }, [viewing, state.transpose, prefs.transpose]);

  const fit = useFitToScreen(container, content, {
    maxFontPx: prefs.maxFontPx,
    key: `${viewing?.song.id ?? ''}:${position.blockId}:${prefs.showChords}:${prefs.showBass}:${extraTranspose}:${prefs.capo}`,
  });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--color-line) px-3 py-1.5">
        <Link
          to="/"
          className="rounded border border-(--color-line) px-1.5 py-1 text-xs hover:bg-(--color-line)"
          aria-label={t('nav.homeHint')}
          title={t('nav.homeHint')}
        >
          ⌂
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {viewing?.song.title ?? (live.set ? '—' : t('band.noLiveSet'))}
        </span>
        <BeatLed state={state} clockOffset={clockOffset} size="sm" />

        <Small
          onClick={() => setPrefs({ transpose: prefs.transpose - 1 })}
          label={t('song.transposeDown')}
        >
          ♭
        </Small>
        <Small onClick={() => setPrefs({ transpose: 0 })} label={t('song.transposeReset')}>
          {prefs.transpose > 0 ? `+${prefs.transpose}` : prefs.transpose}
        </Small>
        <Small
          onClick={() => setPrefs({ transpose: prefs.transpose + 1 })}
          label={t('song.transposeUp')}
        >
          ♯
        </Small>
        <Small
          onClick={() => setPrefs({ capo: prefs.capo > 0 ? prefs.capo - 1 : 0 })}
          label={t('song.capoDown')}
        >
          {t('sets.capo')} {prefs.capo}
        </Small>
        <Small
          onClick={() => setPrefs({ capo: Math.min(11, prefs.capo + 1) })}
          label={t('song.capoUp')}
        >
          +
        </Small>
        <Small
          onClick={() => setPrefs({ showChords: !prefs.showChords })}
          active={prefs.showChords}
          label={t('song.chords')}
        >
          ♪
        </Small>
        <StatusDot status={status} />
      </header>

      {!following && (
        <button
          type="button"
          onClick={() => setLocal(null)}
          className="shrink-0 bg-(--color-chord) px-4 py-1.5 text-sm font-semibold text-white"
        >
          {t('band.backToLeader')}
        </button>
      )}

      <main
        id="main"
        ref={container}
        className={`min-h-0 flex-1 px-3 py-2 ${fit.fits ? 'overflow-hidden' : 'overflow-y-auto'}`}
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
            <SongBody
              song={viewing.song}
              options={{
                showChords: prefs.showChords,
                showBass: prefs.showBass,
                capo: viewing.item.capoOverride ?? prefs.capo,
                transpose: extraTranspose,
              }}
            />
          </div>
        ) : (
          <p className="mt-10 text-center text-sm text-(--color-muted)">
            {live.set ? t('band.leaderNotOnSong') : t('band.waiting')}
          </p>
        )}
      </main>

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
          <input
            name="name"
            placeholder={t('band.yourName')}
            aria-label={t('band.yourName')}
            className="w-full rounded border border-(--color-line) bg-transparent px-2 py-1.5 text-sm outline-none"
          />
        </form>
      )}

      {help && <Shortcuts rows={SHORTCUTS} onClose={() => setHelp(false)} />}
    </div>
  );
}

function Small({
  onClick,
  children,
  active,
  label,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  /** ♭, ♯ and ♪ mean nothing read aloud. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded border px-1.5 py-1 text-xs font-medium tabular-nums ${
        active
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : 'border-(--color-line) hover:bg-(--color-line)'
      }`}
    >
      {children}
    </button>
  );
}
