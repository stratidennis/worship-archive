import { useEffect, useMemo, useState } from 'react';
import type { Song } from '@worship/core';
import { api, type PowerPointReport } from '../lib/api.js';
import { clientDesktop } from '../lib/clientDesktop.js';
import { desktop } from '../lib/desktop.js';
import { useT } from '../lib/i18n.js';
import { Button } from './ui.js';
import { IconCheck, IconClose, IconPresentation } from './icons.js';
import { useOverlay } from './Modal.js';

/**
 * One review step between a set and the operating system.
 *
 * The Band app deliberately uses its own native folder and generator. It never asks
 * the Leader for presentation files; only the song documents already mirrored for the
 * live set cross the network. A browser cannot own a persistent local folder, so the
 * Band action explains that the installed app is required there.
 */
export function PowerPointDialog({
  songs,
  role,
  onDismiss,
}: {
  songs: Song[];
  role: 'leader' | 'band';
  onDismiss: () => void;
}) {
  const { t } = useT();
  const panel = useOverlay(onDismiss);
  const band = role === 'band' ? clientDesktop() : null;
  const [report, setReport] = useState<PowerPointReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useMemo(() => songs.map((song) => song.id), [songs]);
  const supported = role === 'leader' || band !== null;

  useEffect(() => {
    if (!supported || ids.length === 0) return;
    let cancelled = false;
    const request = band ? band.findPowerPoints(songs) : api.findPowerPoints(ids);
    void request
      .then((value) => {
        if (!cancelled) setReport(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [band, ids, songs, supported]);

  const found = report?.results.filter((result) => result.status === 'found') ?? [];
  const missing = report?.results.filter((result) => result.status === 'missing') ?? [];

  const createMissing = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setReport(band ? await band.createPowerPoints(songs) : await api.createPowerPoints(ids));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const createOne = async (songId: string): Promise<void> => {
    const selected = songs.find((song) => song.id === songId);
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (band) {
        await band.createPowerPoints([selected]);
        setReport(await band.findPowerPoints(songs));
      } else {
        await api.createPowerPoints([songId]);
        setReport(await api.findPowerPoints(ids));
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const open = async (selected: typeof found): Promise<void> => {
    const files = [
      ...new Map(
        selected.flatMap((result) =>
          result.file ? [[result.file.relativePath, result.file] as const] : [],
        ),
      ).values(),
    ];
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const failed = band
        ? await band.openPowerPoints(files.map((file) => file.relativePath))
        : desktop()
          ? await desktop()!.openPowerPoints(files.map((file) => file.relativePath))
          : [];
      if (!band && !desktop()) {
        for (const file of files) {
          const link = document.createElement('a');
          link.href = `/api/powerpoints/file?path=${encodeURIComponent(file.relativePath)}`;
          link.download = file.name;
          document.body.append(link);
          link.click();
          link.remove();
        }
      }
      if (failed.length > 0) setError(t('powerpoint.openFailed'));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('powerpoint.title')}
        className="modal-panel flex max-h-[min(80vh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-(--color-line) bg-(--color-surface) shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-(--color-line) px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-(--color-chord)/15 text-(--color-chord)">
            <IconPresentation size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">{t('powerpoint.title')}</h2>
            {report && (
              <p className="text-sm text-(--color-muted)">
                {t('powerpoint.summary', { found: found.length, missing: missing.length })}
              </p>
            )}
          </div>
          <Button icon variant="ghost" aria-label={t('app.close')} onClick={onDismiss}>
            <IconClose size={17} />
          </Button>
        </header>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {ids.length === 0 ? (
            <p className="py-6 text-center text-sm text-(--color-muted)">
              {t('powerpoint.noSongs')}
            </p>
          ) : !supported ? (
            <p className="py-6 text-center text-sm text-(--color-muted)">
              {t('powerpoint.bandDesktopOnly')}
            </p>
          ) : !report && !error ? (
            <p className="py-6 text-center text-sm text-(--color-muted)">
              {t('powerpoint.scanning')}
            </p>
          ) : (
            <ul className="grid gap-2">
              {report?.results.map((result) => (
                <li
                  key={result.songId}
                  className="flex items-start gap-3 rounded-xl border border-(--color-line) px-3 py-2.5"
                >
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                      result.status === 'found'
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : 'bg-(--color-cue)/15 text-(--color-cue)'
                    }`}
                  >
                    {result.status === 'found' ? (
                      <IconCheck size={13} />
                    ) : (
                      <span className="text-xs font-bold">!</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{result.title}</p>
                    <p className="break-all text-xs text-(--color-muted)">
                      {result.file?.relativePath ?? t('powerpoint.missing')}
                    </p>
                  </div>
                  {result.status === 'found' ? (
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => void open([result])}
                    >
                      {desktop() || band ? t('powerpoint.open') : t('powerpoint.download')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => void createOne(result.songId)}
                    >
                      {t('powerpoint.createOne')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {report && (
            <code className="mt-3 block break-all text-xs text-(--color-muted)">
              {report.folder}
            </code>
          )}
          {error && (
            <p className="mt-3 rounded-lg border border-red-500/40 p-3 text-sm text-red-500">
              {error}
            </p>
          )}
          {supported && !desktop() && !band && (
            <p className="mt-3 text-xs text-(--color-muted)">{t('powerpoint.browserHint')}</p>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-(--color-line) bg-(--color-raised) px-5 py-4">
          <Button onClick={onDismiss}>{t('app.close')}</Button>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {missing.length > 0 && (
              <Button disabled={busy} onClick={() => void createMissing()}>
                {busy ? t('powerpoint.creating') : t('powerpoint.createMissing')}
              </Button>
            )}
            {found.length > 0 && (
              <Button variant="primary" disabled={busy} onClick={() => void open(found)}>
                {desktop() || band ? t('powerpoint.openAll') : t('powerpoint.downloadAll')}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
