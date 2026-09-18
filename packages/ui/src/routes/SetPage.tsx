import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { semitonesBetween, type ServiceSet, type SetItem, type Song } from '@worship/core';
import { api, type SearchHit, type SongSummary } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { forgetSet, rememberSet } from '../lib/lastSet.js';
import { moveItem } from '../lib/reorder.js';
import { useDragList } from '../lib/useDragList.js';
import { usePrefs } from '../lib/settings.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { useT, type Translator } from '../lib/i18n.js';
import { confirmAction } from '../lib/desktop.js';
import { SongBody } from '../components/SongBody.js';
import { AppHeader } from '../components/AppHeader.js';
import { ResizeHandle } from '../components/ResizeHandle.js';
import { setName } from '../lib/setName.js';
import {
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconEdit,
  IconGrip,
  IconPlus,
  IconClose,
} from '../components/icons.js';
import { PrintableRunningOrder } from '../components/PrintableRunningOrder.js';

/**
 * The set workspace — where the app opens and where most of the work happens.
 *
 * Three panes, and the reason for each:
 *
 *  - **The running order, on the left.** Always visible, drag to reorder. This is the
 *    thing being built, so it never hides behind a tab or a dialog.
 *  - **A preview, in the middle.** Clicking anything shows the actual song. Adding a
 *    song to a service without reading it first is how the wrong arrangement ends up in
 *    front of a congregation, so the picker deliberately does not add on click —
 *    it shows, and adding is a second, separate decision.
 *  - **A header that collapses.** All the chrome — title, date, tools, navigation —
 *    folds away, because during a service the only thing that should be on screen is
 *    the song.
 */

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * The stored title, derived from the date.
 *
 * It still exists because the sets list, the print view and the delete confirmation all
 * name a set — but it is no longer something to keep in step by hand.
 */
function titleForDate(date: string | null): string {
  return date ?? '';
}

/** What the middle pane is showing. */
type Selection =
  | { kind: 'item'; index: number }
  /** A search result being read before any decision to add it. */
  | { kind: 'candidate'; songId: string }
  | null;

export function SetPage() {
  const { t, date: formatDate, blockName } = useT();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [prefs, setPrefs] = usePrefs();

  const [set, setSet] = useState<ServiceSet | null>(null);
  const [songs, setSongs] = useState<Record<string, Song>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'program' | 'library'>('program');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<(SearchHit | SongSummary)[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const savedRef = useRef('');

  // This device came back here, so this is the set it reopens next time.
  useEffect(() => {
    if (id) rememberSet(id);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    repo
      .setFull(id)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          // Deleted on the host, most likely. Forget it so the next launch does not
          // send this device straight back to a page that cannot load.
          forgetSet(id);
          setError(t('sets.notLocal'));
          return;
        }
        savedRef.current = JSON.stringify(result.set);
        setSet(result.set);
        setSongs(result.songs);
        setSelection(result.set.items.length > 0 ? { kind: 'item', index: 0 } : null);
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  // The picker shows the library until something is typed.
  useEffect(() => {
    if (tab !== 'library') return;
    const timer = setTimeout(() => {
      const request = query.trim() ? repo.search(query) : repo.songs();
      request.then((r) => setHits(r.slice(0, 60))).catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [query, tab]);

  // Autosave, debounced, comparing against what was last persisted.
  useEffect(() => {
    if (!set) return;
    if (JSON.stringify(set) === savedRef.current) {
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

  /**
   * Reorder, keeping the selection on the same *item* rather than the same slot.
   *
   * Dragging the song you are reading must not switch the preview to whatever landed
   * in its old position.
   */
  const reorder = useCallback(
    (from: number, to: number) => {
      update((s) => ({ ...s, items: moveItem(s.items, from, to) }));
      setSelection((current) => {
        if (current?.kind !== 'item') return current;
        if (current.index === from)
          return { kind: 'item', index: Math.max(0, Math.min(to, 9999)) };
        return current;
      });
    },
    [update],
  );

  const drag = useDragList(reorder);

  /**
   * `stay` is for the `+` beside a row in the library list.
   *
   * Adding from there is usually the start of building a set, not the end of one
   * decision — jumping to the running order after every song would mean going back to
   * the library five separate times to add five songs.
   */
  const addSong = (songId: string, { stay = false }: { stay?: boolean } = {}): void => {
    if (!songs[songId]) {
      void repo.song(songId).then((full) => {
        if (full) setSongs((s) => ({ ...s, [songId]: full }));
      });
    }
    update((s) => ({
      ...s,
      items: [
        ...s.items,
        {
          kind: 'song',
          songId,
          keyOverride: null,
          capoOverride: null,
          arrangementOverride: null,
        },
      ],
    }));
    if (stay) return;
    setSelection({ kind: 'item', index: set ? set.items.length : 0 });
    setTab('program');
  };

  const addItem = (item: SetItem): void => {
    update((s) => ({ ...s, items: [...s.items, item] }));
    setSelection({ kind: 'item', index: set ? set.items.length : 0 });
  };

  const patchItem = (index: number, patch: Partial<Extract<SetItem, { kind: 'song' }>>): void =>
    update((s) => ({
      ...s,
      items: s.items.map((item, i) =>
        i === index ? ({ ...item, ...patch } as SetItem) : item,
      ),
    }));

  const replaceItem = (index: number, item: SetItem): void =>
    update((s) => ({ ...s, items: s.items.map((it, i) => (i === index ? item : it)) }));

  const removeAt = (index: number): void => {
    update((s) => ({ ...s, items: s.items.filter((_, i) => i !== index) }));
    setSelection((current) => {
      if (current?.kind !== 'item') return current;
      if (current.index === index) return null;
      return current.index > index ? { kind: 'item', index: current.index - 1 } : current;
    });
  };

  // Songs are numbered among themselves, not by position in the running order. A list
  // that reads 1, _, 3, _ looks broken; musicians say "the third song".
  const songNumbers = useMemo(() => {
    const map = new Map<number, number>();
    let n = 0;
    set?.items.forEach((item, index) => {
      if (item.kind === 'song') map.set(index, ++n);
    });
    return map;
  }, [set]);

  const inSet = useMemo(
    () =>
      new Set(
        (set?.items ?? [])
          .filter((i): i is Extract<SetItem, { kind: 'song' }> => i.kind === 'song')
          .map((i) => i.songId),
      ),
    [set],
  );

  if (error && !set) {
    return (
      <div className="p-6">
        <Link to="/library" className="text-sm underline">
          ← {t('app.library')}
        </Link>
        <p className="mt-4 text-sm text-(--color-muted)">{error}</p>
      </div>
    );
  }
  if (!set) return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  const expanded = prefs.setHeaderExpanded;
  const selectedItem = selection?.kind === 'item' ? (set.items[selection.index] ?? null) : null;

  return (
    <div className="flex h-dvh flex-col print:h-auto">
      <PrintableRunningOrder
        set={set}
        songs={songs}
        songNumbers={songNumbers}
        t={t}
        formatDate={formatDate}
      />

      <AppHeader
        current="home"
        title={
          /*
            The date *is* the name. A service is identified by when it happens, and a
            free-text title beside a date was two fields that had to agree — they did
            not, and "Program nou" sat at the top of a set for a whole Sunday.
          */
          <DateField
            value={set.date}
            onChange={(date) => update((s) => ({ ...s, date, title: titleForDate(date) }))}
            label={t('sets.noDate')}
          />
        }
      >
        <SaveBadge state={saveState} />
        <button
          type="button"
          onClick={() => setPrefs({ setHeaderExpanded: !expanded })}
          aria-expanded={expanded}
          aria-label={expanded ? t('set.collapseHeader') : t('set.expandHeader')}
          title={expanded ? t('set.collapseHeader') : t('set.expandHeader')}
          className="grid h-9 w-9 place-items-center rounded-lg border border-(--color-line) hover:bg-(--color-line)"
        >
          {expanded ? <IconChevronUp size={17} /> : <IconChevronDown size={17} />}
        </button>
      </AppHeader>

      {expanded && (
        <div className="shrink-0 border-b border-(--color-line) px-3 py-2 print:hidden sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Action onClick={() => addItem({ kind: 'note', text: '' })}>
              {t('sets.addNote')}
            </Action>
            <Action onClick={() => addItem({ kind: 'gap', label: '', minutes: null })}>
              {t('sets.addGap')}
            </Action>
            <Action onClick={() => window.print()}>{t('app.print')}</Action>
            <Action
              onClick={() => {
                void api
                  .duplicateSet(id, {})
                  .then((copy) => navigate(`/sets/${encodeURIComponent(copy.id)}`))
                  .catch((e: unknown) => setError(String(e)));
              }}
            >
              {t('sets.duplicate')}
            </Action>
            <span className="text-xs text-(--color-muted)">
              {t('set.itemCount', { count: set.items.length })}
            </span>
            <Action
              danger
              className="ml-auto"
              onClick={() => {
                void confirmAction({
                  message: t('sets.deleteConfirm', { title: setName(set, formatDate) }),
                  confirmLabel: t('app.delete'),
                }).then((ok) => {
                  if (!ok) return;
                  forgetSet(id);
                  void api.deleteSet(id).then(() => navigate('/'));
                });
              }}
            >
              {t('app.delete')}
            </Action>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 print:hidden">
        <aside
          /*
            A custom property rather than an inline `width`: an inline width would beat
            the `w-full` that makes the panel take the whole screen on a phone, and the
            list would be stuck at its desktop width there.
          */
          style={{ '--sidebar': `${prefs.sidebarWidth}px` } as React.CSSProperties}
          className={`w-full shrink-0 flex-col md:flex md:w-(--sidebar) ${
            selection === null ? 'flex' : 'hidden'
          }`}
        >
          <div className="flex shrink-0 border-b border-(--color-line) text-sm">
            {(
              [
                ['program', t('set.tabProgram')],
                ['library', t('set.tabLibrary')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                aria-current={tab === value ? 'true' : undefined}
                className={`flex-1 px-3 py-2 font-medium ${
                  tab === value
                    ? 'border-b-2 border-(--color-chord) text-(--color-chord)'
                    : 'text-(--color-muted) hover:bg-(--color-line)'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'program' ? (
            <ol className="scroll-slim min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
              {/* The horizontal padding is for the lifted row: it is outlined and scaled up
                  slightly while dragging, and a list with no inset clips both against
                  its own overflow. */}
              {set.items.map((item, index) => (
                <li
                  key={index}
                  {...drag.rowProps(index)}
                  className={`group flex items-center gap-1 px-2 py-1.5 text-sm ${
                    drag.dragging !== index &&
                    selection?.kind === 'item' &&
                    selection.index === index
                      ? 'rounded-md bg-(--color-chord)/15'
                      : ''
                  }`}
                >
                  <span
                    {...drag.handleProps(index)}
                    role="button"
                    tabIndex={-1}
                    aria-label={t('set.dragHandle')}
                    title={t('set.dragHandle')}
                    className="-my-1.5 flex shrink-0 select-none items-center py-1.5 pl-0.5 pr-1 text-(--color-muted) opacity-50 transition-opacity group-hover:opacity-100"
                  >
                    <IconGrip size={15} />
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: 'item', index })}
                    className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                  >
                    <span className="w-4 shrink-0 text-right text-xs tabular-nums text-(--color-muted)">
                      {songNumbers.get(index) ?? ''}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.kind === 'song'
                        ? (songs[item.songId]?.title ?? t('sets.missingSong'))
                        : item.kind === 'note'
                          ? item.text || t('sets.note')
                          : item.label || t('sets.gap')}
                    </span>
                    {item.kind === 'song' && (
                      <span className="shrink-0 font-mono text-xs text-(--color-muted)">
                        {item.keyOverride ??
                          songs[item.songId]?.performanceKey ??
                          songs[item.songId]?.writtenKey ??
                          ''}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    aria-label={t('set.removeItem')}
                    title={t('set.removeItem')}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-(--color-muted) opacity-0 transition-opacity focus-visible:opacity-100 hover:bg-(--color-line) group-hover:opacity-100"
                  >
                    <IconClose size={14} />
                  </button>
                </li>
              ))}

              {set.items.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-(--color-muted)">
                  {t('sets.addFirst')}
                </li>
              )}
            </ol>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('sets.searchSong')}
                aria-label={t('sets.searchSong')}
                autoComplete="off"
                className="m-2 shrink-0 rounded-lg border border-(--color-line) bg-transparent px-3 py-2 text-sm outline-none focus:border-(--color-chord)"
              />
              <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto">
                {hits.map((song) => (
                  <li key={song.id}>
                    <div
                      className={`group flex items-center gap-1 pl-3 pr-1.5 text-sm hover:bg-(--color-line)/40 ${
                        selection?.kind === 'candidate' && selection.songId === song.id
                          ? 'bg-(--color-chord)/15'
                          : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelection({ kind: 'candidate', songId: song.id })}
                        className="flex min-w-0 flex-1 items-baseline gap-2 py-1.5 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {song.title || t('app.untitled')}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-(--color-muted)">
                          {song.performanceKey ?? song.writtenKey ?? ''}
                        </span>
                      </button>
                      {/*
                        Add without leaving the list. Faint until the row is hovered, so a
                        long list reads as titles rather than a column of buttons, and a
                        tick once the song is in — which answers "did that work" in the
                        same place the question was asked.
                      */}
                      <AddButton
                        added={inSet.has(song.id)}
                        onAdd={() => addSong(song.id, { stay: true })}
                        addLabel={t('set.addToSet')}
                        addedLabel={t('set.alreadyInSet')}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        <ResizeHandle
          width={prefs.sidebarWidth}
          onWidth={(sidebarWidth) => setPrefs({ sidebarWidth })}
        />

        <main
          id="main"
          className={`min-h-0 flex-1 flex-col ${selection === null ? 'hidden md:flex' : 'flex'}`}
        >
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="shrink-0 border-b border-(--color-line) px-3 py-1.5 text-left text-sm text-(--color-muted) md:hidden"
          >
            {t('set.backToProgram')}
          </button>

          {selection?.kind === 'candidate' ? (
            <Preview
              song={songs[selection.songId]}
              songId={selection.songId}
              onLoaded={(song) => setSongs((s) => ({ ...s, [song.id]: song }))}
              blockName={blockName}
            >
              <button
                type="button"
                disabled={inSet.has(selection.songId)}
                onClick={() => addSong(selection.songId)}
                className="rounded-lg border border-(--color-chord) bg-(--color-chord) px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {inSet.has(selection.songId) ? t('set.alreadyInSet') : t('set.addToSet')}
              </button>
            </Preview>
          ) : selectedItem?.kind === 'song' ? (
            <Preview
              song={songs[selectedItem.songId]}
              songId={selectedItem.songId}
              onLoaded={(song) => setSongs((s) => ({ ...s, [song.id]: song }))}
              blockName={blockName}
              transposeTo={selectedItem.keyOverride}
              capo={selectedItem.capoOverride}
            >
              <SongControls
                item={selectedItem}
                song={songs[selectedItem.songId]}
                onPatch={(patch) =>
                  selection?.kind === 'item' && patchItem(selection.index, patch)
                }
              />
            </Preview>
          ) : selectedItem?.kind === 'note' ? (
            <div className="p-4">
              <label className="block text-xs uppercase tracking-wide text-(--color-muted)">
                {t('set.noteBody')}
              </label>
              <textarea
                value={selectedItem.text}
                onChange={(e) =>
                  selection?.kind === 'item' &&
                  replaceItem(selection.index, { kind: 'note', text: e.target.value })
                }
                rows={4}
                placeholder={t('sets.notePlaceholder')}
                className="mt-1 w-full rounded-lg border border-(--color-line) bg-transparent px-3 py-2 outline-none focus:border-(--color-chord)"
              />
            </div>
          ) : selectedItem?.kind === 'gap' ? (
            <div className="grid max-w-md gap-3 p-4 sm:grid-cols-[1fr_6rem]">
              <label className="block">
                <span className="block text-xs uppercase tracking-wide text-(--color-muted)">
                  {t('set.gapLabel')}
                </span>
                <input
                  value={selectedItem.label}
                  onChange={(e) =>
                    selection?.kind === 'item' &&
                    replaceItem(selection.index, { ...selectedItem, label: e.target.value })
                  }
                  placeholder={t('sets.gapPlaceholder')}
                  className="mt-1 w-full rounded border border-(--color-line) bg-transparent px-2 py-1.5 outline-none focus:border-(--color-chord)"
                />
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-wide text-(--color-muted)">
                  {t('set.gapMinutes')}
                </span>
                <input
                  type="number"
                  min={0}
                  value={selectedItem.minutes ?? ''}
                  onChange={(e) =>
                    selection?.kind === 'item' &&
                    replaceItem(selection.index, {
                      ...selectedItem,
                      minutes: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="mt-1 w-full rounded border border-(--color-line) bg-transparent px-2 py-1.5"
                />
              </label>
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-(--color-muted)">
              {tab === 'library' ? t('set.searchToAdd') : t('set.pickSomething')}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Add a song to the set, from the list.
 *
 * Three states in one control: faint while idle so a long list does not become a column
 * of buttons, solid on hover, and a tick once the song is in the set. The tick is not a
 * button — there is nothing useful to do with a second press, and a disabled plus would
 * have looked like a failure rather than a success.
 */
function AddButton({
  added,
  onAdd,
  addLabel,
  addedLabel,
}: {
  added: boolean;
  onAdd: () => void;
  addLabel: string;
  addedLabel: string;
}) {
  if (added) {
    return (
      <span
        aria-label={addedLabel}
        title={addedLabel}
        className="grid h-7 w-7 shrink-0 place-items-center text-(--color-chord)"
      >
        <IconCheck size={16} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={addLabel}
      title={addLabel}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent text-(--color-muted) opacity-40 transition hover:border-(--color-chord) hover:bg-(--color-chord) hover:text-white hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
    >
      <IconPlus size={16} />
    </button>
  );
}

/**
 * The set's date, which is also its name.
 *
 * The leading icon is ours; the browser draws its own picker button beside it. That one
 * used to be invisible on a dark background — `color-scheme` in `index.css` is what
 * fixes it, globally, for every native control rather than this one field.
 */
function DateField({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-(--color-line) px-2.5">
      <IconCalendar size={16} className="shrink-0 text-(--color-muted)" />
      <input
        type="date"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        aria-label={label}
        className="bg-transparent text-sm font-semibold outline-none"
      />
    </label>
  );
}

/**
 * The middle pane: the song exactly as it will look when it is led.
 *
 * Same fit-to-one-screen renderer as `/lead`, `/band` and `/stage`, and that matters
 * more than it sounds. The decision being made here is "does this song work in this
 * service" — and part of that is whether it is legible, whether it needs three columns,
 * whether it is one of the few that does not fit at all. A preview at a comfortable
 * reading size would answer a question nobody is asking.
 */
function Preview({
  song,
  songId,
  onLoaded,
  transposeTo,
  capo,
  blockName,
  children,
}: {
  song: Song | undefined;
  songId: string;
  onLoaded: (song: Song) => void;
  transposeTo?: string | null;
  capo?: number | null;
  blockName: Translator['blockName'];
  children?: React.ReactNode;
}) {
  const { t } = useT();
  const [prefs] = usePrefs();
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  // Held in a ref because it is a fresh closure on every render: as an effect
  // dependency it would refetch the song forever.
  const notify = useRef(onLoaded);
  notify.current = onLoaded;

  const missing = song === undefined;
  useEffect(() => {
    if (!missing) return;
    void repo.song(songId).then((full) => {
      if (full) notify.current(full);
    });
  }, [songId, missing]);

  const native = song?.performanceKey ?? song?.writtenKey ?? null;
  const shift = transposeTo && native ? (semitonesBetween(native, transposeTo) ?? 0) : 0;

  // `song?.id` belongs in the key: on the first render the song is still loading, so the
  // refs are null and there is nothing to measure. Without it the fit would never re-run
  // once the content arrived, and the pane would stay blank.
  const fit = useFitToScreen(container, content, {
    maxFontPx: prefs.maxFontPx,
    key: `${song?.id ?? 'loading'}:${shift}:${capo ?? 0}:${prefs.showChords}`,
  });

  if (!song) return <p className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</p>;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--color-line) px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">{song.title}</h1>
          <p className="truncate text-xs text-(--color-muted)">
            {[
              transposeTo ?? native ?? '',
              capo ? t('song.capo', { fret: capo }) : '',
              song.tempo ? `${song.tempo} bpm` : '',
              song.blocks.length > 0 ? blockName(song.blocks[0]!.type) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Link
          to={`/edit/${encodeURIComponent(song.id)}`}
          aria-label={t('song.edit')}
          title={t('song.edit')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-(--color-line) px-2 text-sm hover:bg-(--color-line)"
        >
          <IconEdit size={15} />
          <span className="hidden lg:inline">{t('song.edit')}</span>
        </Link>
        {children}
      </div>
      <div
        ref={container}
        className={`min-h-0 flex-1 px-3 py-2 sm:px-4 ${
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
              capo: capo ?? 0,
              transpose: shift,
            }}
          />
        </div>
      </div>
      {!fit.fits && (
        <p className="shrink-0 border-t border-(--color-line) px-3 py-1 text-center text-xs text-(--color-muted)">
          {t('song.doesNotFit')}
        </p>
      )}
    </>
  );
}

/** Key and capo for this set only — changing Sunday's key must not edit the library. */
function SongControls({
  item,
  song,
  onPatch,
}: {
  item: Extract<SetItem, { kind: 'song' }>;
  song: Song | undefined;
  onPatch: (patch: Partial<Extract<SetItem, { kind: 'song' }>>) => void;
}) {
  const { t } = useT();
  const nativeKey = song?.performanceKey ?? song?.writtenKey ?? null;

  return (
    <span className="flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1">
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
      <label className="flex items-center gap-1">
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
    </span>
  );
}

function Action({
  onClick,
  children,
  danger,
  className = '',
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border border-(--color-line) px-2.5 py-1 hover:bg-(--color-line) ${
        danger ? 'text-red-500 hover:bg-red-500/10' : ''
      } ${className}`}
    >
      {children}
    </button>
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
    <span
      className={`text-xs ${state === 'error' ? 'text-red-500' : 'text-(--color-muted)'}`}
      role="status"
    >
      {text[state]}
    </span>
  );
}
