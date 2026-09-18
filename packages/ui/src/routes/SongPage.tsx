import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Song } from '@worship/core';
import { repo } from '../lib/repo.js';
import { usePrefs } from '../lib/settings.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { useHotkeys } from '../lib/useHotkeys.js';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { SongBody, resolveKey } from '../components/SongBody.js';
import { Shortcuts } from '../components/Shortcuts.js';

const SHORTCUTS: { keys: string; label: TranslationKey }[] = [
  { keys: '+', label: 'keys.transposeUp' },
  { keys: '-', label: 'keys.transposeDown' },
  { keys: 'c', label: 'keys.chords' },
  { keys: 'p', label: 'keys.print' },
  { keys: '?', label: 'keys.help' },
];

export function SongPage() {
  const { t } = useT();
  const { id = '' } = useParams();
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [help, setHelp] = useState(false);

  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSong(null);
    repo
      .song(id)
      .then((loaded) => {
        if (loaded) setSong(loaded);
        else setError(t('song.notLocal'));
      })
      .catch((e: unknown) => setError(String(e)));
  }, [id, t]);

  useHotkeys({
    '+': () => setPrefs({ transpose: prefs.transpose + 1 }),
    '=': () => setPrefs({ transpose: prefs.transpose + 1 }),
    '-': () => setPrefs({ transpose: prefs.transpose - 1 }),
    '0': () => setPrefs({ transpose: 0, capo: 0 }),
    c: () => setPrefs({ showChords: !prefs.showChords }),
    b: () => setPrefs({ showBass: !prefs.showBass }),
    p: () => window.print(),
    '?': () => setHelp((open) => !open),
    Escape: () => setHelp(false),
  });

  // Anything that changes what is on screen must trigger a re-fit: transposing changes
  // chord widths, and toggling chords changes every line's height.
  // `song?.id` is part of the key on purpose: on the first render the song is still
  // loading, so the refs are null and there is nothing to measure. Without it the
  // effect would never re-run once the content arrived, and the page would stay blank.
  const fit = useFitToScreen(container, content, {
    maxFontPx: prefs.maxFontPx,
    key: `${song?.id ?? 'loading'}:${song?.rev ?? 0}:${prefs.showChords}:${prefs.showBass}:${prefs.transpose}:${prefs.capo}`,
  });

  if (error) {
    return (
      <div className="p-6">
        <Link to="/" className="text-sm underline">
          ← {t('app.library')}
        </Link>
        <p className="mt-4 text-sm text-(--color-muted)">{t('song.loadError', { error })}</p>
      </div>
    );
  }
  if (!song) return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  const { key } = resolveKey(song, prefs.transpose);
  const soundingKey = key ?? '—';

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-(--color-line) px-4 py-2 print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5">
          <Link
            to="/"
            className="text-sm text-(--color-muted) hover:underline"
            aria-label={t('app.library')}
          >
            ←
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight">{song.title}</h1>
            <p className="truncate text-xs text-(--color-muted)">
              {song.writtenKey && song.performanceKey && song.writtenKey !== song.performanceKey
                ? t('song.writtenPlayed', {
                    written: song.writtenKey,
                    performance: song.performanceKey,
                  })
                : t('song.key', { key: soundingKey })}
              {prefs.transpose !== 0 &&
                ` · ${t('song.transposed', {
                  amount: `${prefs.transpose > 0 ? '+' : ''}${prefs.transpose}`,
                })}`}
              {prefs.capo > 0 && ` · ${t('song.capo', { fret: prefs.capo })}`}
              {song.tempo && ` · ${song.tempo} bpm`}
              {song.timeSignature && ` · ${song.timeSignature}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-sm">
            <Group label={t('song.pitch')}>
              <Btn
                onClick={() => setPrefs({ transpose: prefs.transpose - 1 })}
                label={t('song.transposeDown')}
              >
                −
              </Btn>
              <Btn onClick={() => setPrefs({ transpose: 0 })} muted label={t('song.transposeReset')}>
                {prefs.transpose > 0 ? `+${prefs.transpose}` : prefs.transpose}
              </Btn>
              <Btn
                onClick={() => setPrefs({ transpose: prefs.transpose + 1 })}
                label={t('song.transposeUp')}
              >
                +
              </Btn>
            </Group>
            <Group label={t('song.capoLabel')}>
              <Btn
                onClick={() => setPrefs({ capo: Math.max(0, prefs.capo - 1) })}
                label={t('song.capoDown')}
              >
                −
              </Btn>
              <Btn onClick={() => setPrefs({ capo: 0 })} muted label={t('song.capoLabel')}>
                {prefs.capo}
              </Btn>
              <Btn
                onClick={() => setPrefs({ capo: Math.min(11, prefs.capo + 1) })}
                label={t('song.capoUp')}
              >
                +
              </Btn>
            </Group>
            <Btn onClick={() => setPrefs({ showChords: !prefs.showChords })} active={prefs.showChords}>
              {t('song.chords')}
            </Btn>
            <Btn onClick={() => setPrefs({ showBass: !prefs.showBass })} active={prefs.showBass}>
              {t('song.bass')}
            </Btn>
            <Btn onClick={() => window.print()}>{t('app.print')}</Btn>
            <Link
              to={`/edit/${encodeURIComponent(id)}`}
              className="min-w-8 rounded-md border border-(--color-line) px-2 py-1 text-sm font-medium hover:bg-(--color-line) sm:px-2.5 sm:py-1.5"
            >
              {t('song.edit')}
            </Link>
          </div>
        </div>
      </header>

      {/*
        The container is the measuring frame: exactly the space a song must fit into.
        When a song genuinely cannot fit even at the minimum size, it becomes scrollable
        rather than clipped. Truncating a song is never acceptable — a musician reaching
        the bridge and finding it missing is a far worse failure than having to scroll.
      */}
      <main
        id="main"
        ref={container}
        className={`min-h-0 flex-1 px-4 py-3 print:overflow-visible ${
          fit.fits ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        <div
          ref={content}
          className="mx-auto max-w-6xl"
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
              showChords: prefs.showChords,
              showBass: prefs.showBass,
              capo: prefs.capo,
              transpose: prefs.transpose,
            }}
          />
        </div>
      </main>

      {!fit.fits && (
        <p className="shrink-0 border-t border-(--color-line) px-4 py-1.5 text-center text-xs text-(--color-muted) print:hidden">
          {t('song.doesNotFit')}
        </p>
      )}

      {help && <Shortcuts rows={SHORTCUTS} onClose={() => setHelp(false)} />}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-0.5">
      <span className="mr-1 text-xs text-(--color-muted)">{label}</span>
      {children}
    </span>
  );
}

function Btn({
  onClick,
  children,
  active,
  muted,
  label,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  muted?: boolean;
  /** A symbol like − or + is meaningless to a screen reader on its own. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`min-w-8 rounded-md border px-2 py-1 text-sm font-medium tabular-nums transition-colors sm:min-w-9 sm:px-2.5 sm:py-1.5 ${
        active
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : muted
            ? 'border-transparent text-(--color-muted)'
            : 'border-(--color-line) hover:bg-(--color-line)'
      }`}
    >
      {children}
    </button>
  );
}
