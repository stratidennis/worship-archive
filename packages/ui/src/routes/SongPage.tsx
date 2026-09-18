import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Song } from '@worship/core';
import { repo } from '../lib/repo.js';
import { usePrefs } from '../lib/settings.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { useHotkeys } from '../lib/useHotkeys.js';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { SongBody, resolveKey } from '../components/SongBody.js';
import { AppHeader } from '../components/AppHeader.js';
import { Button, ButtonLink, IconButton, Stepper } from '../components/ui.js';
import { IconEdit, IconPrint } from '../components/icons.js';
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
    key: `${song?.id ?? 'loading'}:${song?.rev ?? 0}:${prefs.showChords}:${prefs.transpose}:${prefs.capo}`,
  });

  if (error) {
    return (
      <div className="p-6">
        <Link to="/archive" className="text-sm underline">
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
    <div className="flex h-dvh flex-col print:block print:h-auto">
      <AppHeader
        back
        title={
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight">{song.title}</h1>
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
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Stepper
            caption={t('song.pitch')}
            value={prefs.transpose}
            display={prefs.transpose > 0 ? `+${prefs.transpose}` : String(prefs.transpose)}
            onChange={(transpose) => setPrefs({ transpose })}
            min={-11}
            max={11}
            resetTo={0}
            labels={{
              down: t('song.transposeDown'),
              up: t('song.transposeUp'),
              reset: t('song.transposeReset'),
            }}
          />
          <Stepper
            caption={t('song.capoLabel')}
            value={prefs.capo}
            onChange={(capo) => setPrefs({ capo })}
            min={0}
            max={11}
            resetTo={0}
            labels={{
              down: t('song.capoDown'),
              up: t('song.capoUp'),
              reset: t('song.capoLabel'),
            }}
          />
          <Button
            active={prefs.showChords}
            onClick={() => setPrefs({ showChords: !prefs.showChords })}
          >
            {t('song.chords')}
          </Button>
          <IconButton label={t('app.print')} onClick={() => window.print()}>
            <IconPrint size={16} />
          </IconButton>
          <ButtonLink
            to={`/edit/${encodeURIComponent(id)}`}
            aria-label={t('song.edit')}
            title={t('song.edit')}
          >
            <IconEdit size={15} />
            <span className="hidden lg:inline">{t('song.edit')}</span>
          </ButtonLink>
        </div>
      </AppHeader>

      {/*
        The container is the measuring frame: exactly the space a song must fit into.
        When a song genuinely cannot fit even at the minimum size, it becomes scrollable
        rather than clipped. Truncating a song is never acceptable — a musician reaching
        the bridge and finding it missing is a far worse failure than having to scroll.
      */}
      <main
        id="main"
        ref={container}
        className={`min-h-0 flex-1 px-3 py-3 print:overflow-visible sm:px-4 ${
          fit.fits ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        <div
          ref={content}
          className="w-full"
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
              showBass: false,
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
