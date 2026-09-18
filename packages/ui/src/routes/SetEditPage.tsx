import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { semitonesBetween, type ServiceSet, type SetItem, type Song } from '@worship/core';
import { api, type SearchHit, type SongSummary } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { useT, type Translator } from '../lib/i18n.js';
import { confirmAction } from '../lib/desktop.js';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function SetEditPage() {
  const { t, date: formatDate } = useT();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [set, setSet] = useState<ServiceSet | null>(null);
  const [songs, setSongs] = useState<Record<string, Song>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | SongSummary[]>([]);
  const savedRef = useRef('');

  useEffect(() => {
    repo
      .setFull(id)
      .then((result) => {
        if (!result) {
          setError(t('sets.notLocal'));
          return;
        }
        savedRef.current = JSON.stringify(result.set);
        setSet(result.set);
        setSongs(result.songs);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [id, t]);

  // Song picker: show recent songs until something is typed.
  useEffect(() => {
    const timer = setTimeout(() => {
      const request = query.trim() ? repo.search(query) : repo.songs();
      request.then((r) => setHits(r.slice(0, 40))).catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [query]);

  // Autosave, same shape as the song editor.
  useEffect(() => {
    if (!set) return;
    const serialised = JSON.stringify(set);
    if (serialised === savedRef.current) {
      setSaveState('idle');
      return;
    }
    setSaveState('dirty');
    const timer = setTimeout(() => {
      setSaveState('saving');
      api
        .saveSet(id, set)
        .then((stored) => {
          savedRef.current = JSON.stringify({
            ...set,
            rev: stored.rev,
            updatedAt: stored.updatedAt,
          });
          setSaveState('saved');
        })
        .catch((e: unknown) => {
          setError(String(e));
          setSaveState('error');
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [set, id]);

  const update = useCallback((fn: (s: ServiceSet) => ServiceSet) => {
    setSet((current) => (current ? fn(current) : current));
  }, []);

  const addSong = (song: SongSummary): void => {
    if (!songs[song.id]) {
      void repo.song(song.id).then((full) => {
        if (full) setSongs((s) => ({ ...s, [song.id]: full }));
      });
    }
    update((s) => ({
      ...s,
      items: [
        ...s.items,
        {
          kind: 'song',
          songId: song.id,
          keyOverride: null,
          capoOverride: null,
          arrangementOverride: null,
        },
      ],
    }));
  };

  const addItem = (item: SetItem): void => update((s) => ({ ...s, items: [...s.items, item] }));

  const patchItem = (index: number, patch: Partial<Extract<SetItem, { kind: 'song' }>>): void =>
    update((s) => ({
      ...s,
      items: s.items.map((item, i) =>
        i === index ? ({ ...item, ...patch } as SetItem) : item,
      ),
    }));

  const move = (index: number, direction: -1 | 1): void =>
    update((s) => {
      const target = index + direction;
      if (target < 0 || target >= s.items.length) return s;
      const items = [...s.items];
      const [moved] = items.splice(index, 1);
      items.splice(target, 0, moved!);
      return { ...s, items };
    });

  const remove = (index: number): void =>
    update((s) => ({ ...s, items: s.items.filter((_, i) => i !== index) }));

  // Songs are numbered among themselves, not by position in the running order. A list
  // that reads 1, _, 3, _ looks broken; musicians say "the third song", not
  // "the fifth item".
  const songNumbers = useMemo(() => {
    const map = new Map<number, number>();
    let n = 0;
    set?.items.forEach((item, index) => {
      if (item.kind === 'song') map.set(index, ++n);
    });
    return map;
  }, [set]);

  const totalMinutes = useMemo(
    () =>
      set?.items.reduce(
        (sum, item) => sum + (item.kind === 'gap' ? (item.minutes ?? 0) : 0),
        0,
      ) ?? 0,
    [set],
  );

  if (error && !set) {
    return (
      <div className="p-6">
        <Link to="/sets" className="text-sm underline">
          ← {t('app.sets')}
        </Link>
        <p className="mt-4 text-sm text-(--color-muted)">{error}</p>
      </div>
    );
  }
  if (!set) return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-5 print:max-w-none print:pt-0">
      <header className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        <Link to="/sets" className="text-sm text-(--color-muted)" aria-label={t('app.sets')}>
          ←
        </Link>
        <input
          value={set.title}
          onChange={(e) => update((s) => ({ ...s, title: e.target.value }))}
          className="min-w-48 flex-1 bg-transparent text-xl font-bold outline-none focus:bg-(--color-chord)/5"
          placeholder={t('sets.name')}
          aria-label={t('sets.name')}
        />
        <input
          type="date"
          value={set.date ?? ''}
          onChange={(e) => update((s) => ({ ...s, date: e.target.value || null }))}
          aria-label={t('sets.noDate')}
          className="rounded border border-(--color-line) bg-transparent px-2 py-1 text-sm"
        />
        <SaveBadge state={saveState} />
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-(--color-line) px-2.5 py-1.5 text-sm hover:bg-(--color-line)"
        >
          {t('app.print')}
        </button>
        <button
          type="button"
          onClick={() => {
            void confirmAction({
              message: t('sets.deleteConfirm', { title: set.title }),
              confirmLabel: t('app.delete'),
            }).then((ok) => {
              if (ok) void api.deleteSet(id).then(() => navigate('/sets'));
            });
          }}
          className="rounded-md border border-(--color-line) px-2.5 py-1.5 text-sm text-(--color-muted) hover:text-red-500"
        >
          {t('app.delete')}
        </button>
      </header>

      <PrintableRunningOrder
        set={set}
        songs={songs}
        songNumbers={songNumbers}
        t={t}
        formatDate={formatDate}
      />

      <div className="grid gap-6 print:hidden lg:grid-cols-[1fr_20rem]">
        <ol id="main" className="space-y-2">
          {set.items.map((item, index) => (
            <li key={index} className="rounded-lg border border-(--color-line) px-3 py-2">
              {item.kind === 'song' ? (
                <SongRow
                  item={item}
                  song={songs[item.songId]}
                  number={songNumbers.get(index) ?? 0}
                  onPatch={(patch) => patchItem(index, patch)}
                  onMove={(d) => move(index, d)}
                  onRemove={() => remove(index)}
                />
              ) : item.kind === 'note' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase text-(--color-muted)">
                    {t('sets.note')}
                  </span>
                  <input
                    value={item.text}
                    onChange={(e) =>
                      update((s) => ({
                        ...s,
                        items: s.items.map((it, i) =>
                          i === index ? { kind: 'note', text: e.target.value } : it,
                        ),
                      }))
                    }
                    className="flex-1 bg-transparent outline-none"
                    placeholder={t('sets.notePlaceholder')}
                    aria-label={t('sets.note')}
                  />
                  <RowButtons onMove={(d) => move(index, d)} onRemove={() => remove(index)} />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase text-(--color-muted)">
                    {t('sets.gap')}
                  </span>
                  <input
                    value={item.label}
                    onChange={(e) =>
                      update((s) => ({
                        ...s,
                        items: s.items.map((it, i) =>
                          i === index && it.kind === 'gap'
                            ? { ...it, label: e.target.value }
                            : it,
                        ),
                      }))
                    }
                    className="flex-1 bg-transparent outline-none"
                    placeholder={t('sets.gapPlaceholder')}
                    aria-label={t('sets.gap')}
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.minutes ?? ''}
                    onChange={(e) =>
                      update((s) => ({
                        ...s,
                        items: s.items.map((it, i) =>
                          i === index && it.kind === 'gap'
                            ? { ...it, minutes: e.target.value ? Number(e.target.value) : null }
                            : it,
                        ),
                      }))
                    }
                    className="w-16 rounded border border-(--color-line) bg-transparent px-1 py-0.5 text-sm"
                    placeholder={t('sets.minutes')}
                    aria-label={t('sets.minutes')}
                  />
                  <RowButtons onMove={(d) => move(index, d)} onRemove={() => remove(index)} />
                </div>
              )}
            </li>
          ))}

          {set.items.length === 0 && (
            <li className="rounded-lg border border-dashed border-(--color-line) px-3 py-6 text-center text-sm text-(--color-muted)">
              {t('sets.addFirst')}
            </li>
          )}
        </ol>

        <aside className="print:hidden">
          <div className="mb-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => addItem({ kind: 'note', text: '' })}
              className="flex-1 rounded-md border border-(--color-line) px-2 py-1.5 text-xs hover:bg-(--color-line)"
            >
              {t('sets.addNote')}
            </button>
            <button
              type="button"
              onClick={() => addItem({ kind: 'gap', label: '', minutes: null })}
              className="flex-1 rounded-md border border-(--color-line) px-2 py-1.5 text-xs hover:bg-(--color-line)"
            >
              {t('sets.addGap')}
            </button>
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sets.searchSong')}
            aria-label={t('sets.searchSong')}
            className="w-full rounded-lg border border-(--color-line) bg-transparent px-3 py-2 text-sm outline-none focus:border-(--color-chord)"
          />

          <ul className="mt-2 max-h-[60vh] overflow-y-auto divide-y divide-(--color-line)">
            {hits.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  onClick={() => addSong(song)}
                  className="flex w-full items-baseline gap-2 py-1.5 text-left hover:bg-(--color-line)/40"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{song.title}</span>
                  <span className="shrink-0 font-mono text-xs text-(--color-muted)">
                    {song.performanceKey ?? song.writtenKey ?? ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {totalMinutes > 0 && (
            <p className="mt-3 text-xs text-(--color-muted)">
              {t('sets.plannedGaps', { minutes: totalMinutes })}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function SongRow({
  item,
  song,
  number,
  onPatch,
  onMove,
  onRemove,
}: {
  item: Extract<SetItem, { kind: 'song' }>;
  song: Song | undefined;
  number: number;
  onPatch: (patch: Partial<Extract<SetItem, { kind: 'song' }>>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const nativeKey = song?.performanceKey ?? song?.writtenKey ?? null;
  const key = item.keyOverride ?? nativeKey;
  const shifted = item.keyOverride && nativeKey && item.keyOverride !== nativeKey;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-(--color-muted)">
        {number}
      </span>
      <Link
        to={song ? `/song/${encodeURIComponent(song.id)}` : '#'}
        className="min-w-0 flex-1 truncate font-medium hover:underline"
      >
        {song?.title ?? t('sets.missingSong')}
      </Link>

      <label className="flex items-center gap-1 text-xs print:hidden">
        <span className="text-(--color-muted)">{t('sets.key')}</span>
        <select
          value={item.keyOverride ?? ''}
          onChange={(e) => onPatch({ keyOverride: e.target.value || null })}
          className="rounded border border-(--color-line) bg-transparent px-1 py-0.5"
        >
          <option value="">{nativeKey ?? '—'}</option>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1 text-xs print:hidden">
        <span className="text-(--color-muted)">{t('sets.capo')}</span>
        <input
          type="number"
          min={0}
          max={11}
          value={item.capoOverride ?? ''}
          onChange={(e) =>
            onPatch({ capoOverride: e.target.value ? Number(e.target.value) : null })
          }
          className="w-12 rounded border border-(--color-line) bg-transparent px-1 py-0.5"
        />
      </label>

      <span
        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs ${
          shifted ? 'bg-(--color-chord) text-white' : ''
        }`}
        style={shifted ? undefined : { background: 'var(--color-line)' }}
        title={
          shifted && song
            ? t('sets.keyShifted', {
                native: nativeKey ?? '',
                override: item.keyOverride ?? '',
                semitones: semitonesBetween(nativeKey!, item.keyOverride!) ?? 0,
              })
            : undefined
        }
      >
        {key ?? '—'}
      </span>

      <RowButtons onMove={onMove} onRemove={onRemove} />
    </div>
  );
}

function RowButtons({
  onMove,
  onRemove,
}: {
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  return (
    <span className="flex shrink-0 gap-0.5 print:hidden">
      <Small onClick={() => onMove(-1)} title={t('edit.moveUp')}>
        ↑
      </Small>
      <Small onClick={() => onMove(1)} title={t('edit.moveDown')}>
        ↓
      </Small>
      <Small onClick={onRemove} title={t('sets.removeFromSet')}>
        ✕
      </Small>
    </span>
  );
}

function Small({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="rounded border border-(--color-line) px-1.5 py-0.5 text-xs hover:bg-(--color-line)"
    >
      {children}
    </button>
  );
}

/**
 * The running order as it prints.
 *
 * A separate view rather than the editor with its controls hidden: printed inputs
 * render as empty boxes, and a set list handed to the band should read as a list, not
 * as a form someone forgot to fill in. This is also the PDF export — the browser's own
 * "Save as PDF" is the whole feature, with nothing to install.
 */
function PrintableRunningOrder({
  set,
  songs,
  songNumbers,
  t,
  formatDate,
}: {
  set: ServiceSet;
  songs: Record<string, Song>;
  songNumbers: Map<number, number>;
  t: Translator['t'];
  formatDate: Translator['date'];
}) {
  const date = set.date
    ? formatDate(set.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="hidden print:block">
      <h1 className="mb-0.5 text-xl font-bold">{set.title}</h1>
      {date && <p className="mb-4 text-sm">{date}</p>}

      <ol className="space-y-1">
        {set.items.map((item, index) => {
          if (item.kind === 'song') {
            const song = songs[item.songId];
            const key = item.keyOverride ?? song?.performanceKey ?? song?.writtenKey ?? null;
            return (
              <li key={index} className="flex items-baseline gap-2 break-inside-avoid">
                <span className="w-5 shrink-0 text-right tabular-nums">
                  {songNumbers.get(index)}.
                </span>
                <span className="font-medium">{song?.title ?? t('sets.missingSong')}</span>
                <span className="flex-1 border-b border-dotted border-black/30" />
                <span className="shrink-0 font-mono text-sm">
                  {key ?? '—'}
                  {item.capoOverride ? ` · ${t('sets.capo')} ${item.capoOverride}` : ''}
                  {song?.tempo ? ` · ${song.tempo}` : ''}
                </span>
              </li>
            );
          }
          if (item.kind === 'note') {
            return (
              <li key={index} className="break-inside-avoid pl-7 text-sm italic">
                {item.text}
              </li>
            );
          }
          return (
            <li key={index} className="break-inside-avoid pl-7 text-sm">
              {item.label || t('sets.gap')}
              {item.minutes ? ` — ${item.minutes} ${t('sets.minutes')}` : ''}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useT();
  const text: Record<SaveState, string> = {
    idle: '',
    dirty: t('save.dirty'),
    saving: t('save.saving'),
    saved: t('save.saved'),
    error: t('save.error'),
  };
  if (!text[state]) return null;
  return (
    <span className={`text-xs ${state === 'error' ? 'text-red-500' : 'text-(--color-muted)'}`}>
      {text[state]}
    </span>
  );
}
