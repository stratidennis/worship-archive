import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importAny, type ImportFormat } from '@worship/importers';
import type { Song } from '@worship/core';
import { adminApi } from '../lib/api.js';
import { pickTextFiles } from '../lib/desktop.js';
import { useT, type TranslationKey } from '../lib/i18n.js';
import { Scroll } from '../components/Scroll.js';
import { useHeader } from '../components/header-slots.js';
import { Button, IconButton, Textarea } from '../components/ui.js';
import { IconClose } from '../components/icons.js';

/**
 * Bringing songs in.
 *
 * Parsing happens **in the browser, before anything is saved**, and every song is shown
 * with what was understood from it — how many sections, how many chords, which format
 * it was read as. That preview is the feature. A file that looked like a song and
 * imported as one block of 40 unparsed lines is easy to spot here and very hard to spot
 * later, once it is one of 153 songs in a list.
 *
 * `no chords found` is called out in particular: it is what a chords-over-lyrics file
 * looks like when the alignment convention was not what we assumed.
 */

interface Candidate {
  id: string;
  filename: string;
  song: Song;
  format: ImportFormat;
  chords: number;
}

const FORMAT_LABEL: Record<ImportFormat, TranslationKey> = {
  chordpro: 'import.formatChordpro',
  opensong: 'import.formatOpensong',
  'legacy-song': 'import.formatLegacy',
  'plain-text': 'import.formatPlain',
};

function countChords(song: Song): number {
  return song.blocks.reduce(
    (total, block) =>
      total + block.lines.reduce((n, line) => n + line.chords.length + line.bass.length, 0),
    0,
  );
}

export function ImportPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ done: number; failed: number; ids: string[] } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  useHeader({ current: 'library', back: true });

  const add = (files: { name: string; text: string }[]): void => {
    const parsed = files
      .filter((file) => file.text.trim() !== '')
      .map((file, index) => {
        const imported = importAny(file.text, { filename: file.name });
        return {
          id: `${Date.now()}-${index}-${file.name}`,
          filename: file.name,
          song: imported.song,
          format: imported.format,
          chords: countChords(imported.song),
        };
      });
    setCandidates((current) => [...current, ...parsed]);
    setResult(null);
  };

  const importAll = async (): Promise<void> => {
    setBusy(true);
    const ids: string[] = [];
    let failed = 0;
    for (const candidate of candidates) {
      try {
        // One write, not create-then-save: the server mints the id and owns `rev`, and
        // an imported song should start with an empty revision history rather than a
        // snapshot of the empty song it was for a few milliseconds.
        const created = await adminApi.createSong(candidate.song);
        ids.push(created.id);
      } catch {
        failed++;
      }
    }
    setBusy(false);
    setCandidates([]);
    setResult({ done: ids.length, failed, ids });
  };

  return (
    <Scroll>
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-5">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">{t('import.title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-(--color-muted)">
            {t('import.subtitle')}
          </p>
        </header>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const files = [...event.dataTransfer.files];
            void Promise.all(
              files.map(async (f) => ({ name: f.name, text: await f.text() })),
            ).then(add);
          }}
          className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            dragging ? 'border-(--color-chord) bg-(--color-chord)/5' : 'border-(--color-line)'
          }`}
        >
          <p className="text-sm text-(--color-muted)">{t('import.dropHere')}</p>
          <Button
            variant="primary"
            className="mt-3"
            onClick={() => {
              void pickTextFiles('.chopro,.cho,.chordpro,.pro,.song,.xml,.txt,text/*').then(
                add,
              );
            }}
          >
            {t('import.pickFiles')}
          </Button>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium" htmlFor="paste">
            {t('import.pasteLabel')}
          </label>
          <Textarea
            id="paste"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder={t('import.pastePlaceholder')}
            rows={6}
            spellCheck={false}
            className="mt-1 font-mono text-xs"
          />
          <Button
            className="mt-1"
            disabled={paste.trim() === ''}
            onClick={() => {
              add([{ name: '', text: paste }]);
              setPaste('');
            }}
          >
            {t('import.pasteButton')}
          </Button>
        </div>

        {result && (
          <p className="mt-6 rounded-lg border border-(--color-line) p-3 text-sm" role="status">
            {t('import.done', { count: result.done })}
            {result.failed > 0 && ` ${t('import.failed', { count: result.failed })}`}
            {result.ids.length === 1 && (
              <button
                type="button"
                onClick={() => navigate(`/song/${encodeURIComponent(result.ids[0]!)}`)}
                className="ml-2 underline"
              >
                {t('import.openAfter')}
              </button>
            )}
          </p>
        )}

        {candidates.length > 0 && (
          <section className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {t('import.readyCount', { count: candidates.length })}
              </h2>
              <Button variant="primary" disabled={busy} onClick={() => void importAll()}>
                {busy ? t('import.importing') : t('import.importAll')}
              </Button>
            </div>

            <ul className="divide-y divide-(--color-line)">
              {candidates.map((candidate) => (
                <li key={candidate.id} className="flex items-start gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {candidate.song.title || t('app.untitled')}
                    </span>
                    <span className="block text-xs text-(--color-muted)">
                      {t(FORMAT_LABEL[candidate.format])} ·{' '}
                      {t('import.blocks', { count: candidate.song.blocks.length })} ·{' '}
                      {candidate.chords === 0 ? (
                        <span className="text-(--color-cue)">{t('import.noChords')}</span>
                      ) : (
                        t('import.chords', { count: candidate.chords })
                      )}
                      {candidate.song.writtenKey ? ` · ${candidate.song.writtenKey}` : ''}
                    </span>
                  </span>
                  <IconButton
                    size="sm"
                    label={t('import.remove')}
                    className="shrink-0"
                    onClick={() =>
                      setCandidates((current) => current.filter((c) => c.id !== candidate.id))
                    }
                  >
                    <IconClose size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        )}

        {candidates.length === 0 && !result && (
          <p className="mt-8 text-center text-sm text-(--color-muted)">{t('import.nothing')}</p>
        )}
      </div>
    </Scroll>
  );
}
