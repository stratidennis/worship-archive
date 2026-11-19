import { useEffect, useRef, useState } from 'react';
import type { Song } from '@worship/core';
import { ArchiveBrowser } from '../routes/Library.js';
import { readArchiveState } from '../lib/archiveState.js';
import { useT } from '../lib/i18n.js';
import { repo } from '../lib/repo.js';
import { usePrefs } from '../lib/settings.js';
import { IconClose } from './icons.js';
import {
  fittedSongOverflowClass,
  fittedSongStyle,
  useFitToScreen,
} from '../lib/useFitToScreen.js';
import { SongBody } from './SongBody.js';
import { Button, IconButton } from './ui.js';

/** Browse and read without navigating away from the active Band session. */
export function BandArchive({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [prefs] = usePrefs();
  const reader = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const lastSongButton = useRef<HTMLElement | null>(null);
  const [params, setParams] = useState(() => readArchiveState('band-library'));
  const [songId, setSongId] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; song: Song | null } | null>(null);

  useEffect(() => {
    const overlay = dialog.current;
    overlay?.showModal();
    return () => overlay?.close();
  }, []);

  useEffect(() => {
    if (!songId) return;
    back.current?.focus();
    let current = true;
    const receive = (song: Song | null): void => {
      if (current) setResult({ id: songId, song });
    };
    void repo.song(songId).then(receive, () => receive(null));
    return () => {
      current = false;
    };
  }, [songId]);

  const returnToList = (): void => {
    setSongId(null);
    setResult(null);
    requestAnimationFrame(() => lastSongButton.current?.focus());
  };
  const song = result?.id === songId ? result?.song : null;
  const fit = useFitToScreen(reader, content, {
    minFontPx: prefs.minFontPx,
    maxFittedFontPx: prefs.maxFontPx,
    key: song,
  });
  return (
    <dialog
      ref={dialog}
      data-band-archive
      aria-labelledby="band-archive-title"
      onCancel={(event) => {
        event.preventDefault();
        if (songId) returnToList();
        else onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-(--color-stage-bg) text-(--color-stage-fg)"
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--color-line) bg-(--color-surface) px-3 py-2 sm:px-5">
          {songId && (
            <Button ref={back} size="sm" onClick={returnToList}>
              {t('band.backToArchive')}
            </Button>
          )}
          <h1 id="band-archive-title" className="min-w-0 flex-1 truncate font-semibold">
            {song?.title || t('app.library')}
          </h1>
          <IconButton label={t('app.close')} onClick={onClose}>
            <IconClose size={18} />
          </IconButton>
        </header>
        <div className={songId ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
          <ArchiveBrowser
            params={params}
            onFiltersChange={setParams}
            active={!songId}
            onOpenSong={(id) => {
              lastSongButton.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setSongId(id);
            }}
          />
        </div>
        {songId && (
          <div
            ref={reader}
            className={`reading-surface min-h-0 flex-1 px-4 py-5 ${fittedSongOverflowClass(fit.fits, true)}`}
          >
            {song ? (
              <div
                key={`${song.id}:${fit.fontPx}:${fit.columns}:${fit.heightPx}`}
                ref={content}
                style={fittedSongStyle(fit)}
              >
                <SongBody
                  song={song}
                  options={{
                    showChords: prefs.showChords,
                    showBass: false,
                    cueStyle: prefs.cueStyle,
                    capo: prefs.capo,
                    transpose: prefs.transpose,
                    lineHeight: prefs.lineHeight,
                    accidentalPreferences: prefs.accidentalPreferences,
                  }}
                />
              </div>
            ) : (
              <p role="status" className="text-sm text-(--color-muted)">
                {result?.id === songId
                  ? t('band.archiveSongUnavailable')
                  : t('library.loading')}
              </p>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
