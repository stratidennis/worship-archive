import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  semitonesBetween,
  type ServiceSet,
  type SessionState,
  type SetItem,
  type Song,
} from '@worship/core';
import { api, type SearchHit, type SongSummary } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { forgetSet, rememberSet } from '../lib/lastSet.js';
import { moveItem } from '../lib/reorder.js';
import { useDragList } from '../lib/useDragList.js';
import { usePrefs } from '../lib/settings.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { useHotkeys } from '../lib/useHotkeys.js';
import { useSession } from '../lib/useSession.js';
import { useT, type TranslationKey, type Translator } from '../lib/i18n.js';
import { nextSunday } from '../lib/setName.js';
import { SongBody } from '../components/SongBody.js';
import { AppHeader } from '../components/AppHeader.js';
import { Page, Scroll } from '../components/Page.js';
import { ResizeHandle } from '../components/ResizeHandle.js';
import { DatePicker } from '../components/DatePicker.js';
import { BeatLed } from '../components/BeatLed.js';
import { Shortcuts } from '../components/Shortcuts.js';
import { StatusDot } from '../components/StatusDot.js';
import {
  Button,
  ButtonLink,
  IconButton,
  Input,
  Segment,
  Segmented,
  Select,
  Textarea,
} from '../components/ui.js';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconEdit,
  IconGrip,
  IconLead,
  IconPeople,
  IconPlus,
} from '../components/icons.js';
import { PrintableRunningOrder } from '../components/PrintableRunningOrder.js';

/**
 * The set workspace — where the app opens, and where the service is both built and led.
 *
 * Three panes, and the reason for each:
 *
 *  - **The running order, on the left.** Always visible, drag to reorder. This is the
 *    thing being built, so it never hides behind a tab or a dialog.
 *  - **A preview, in the middle.** Clicking anything shows the actual song, at the size
 *    it will be led at. Adding a song to a service without reading it first is how the
 *    wrong arrangement ends up in front of a congregation, so the picker deliberately
 *    does not add on click — it shows, and adding is a second, separate decision.
 *  - **A header that collapses.** All the chrome — date, tools, lead controls — folds
 *    away, because during a service the only thing that should be on screen is the song.
 *
 * **Leading is a switch here, not a separate page.** It used to be `/lead`, and the
 * separation caused the one failure that matters: going back to add a forgotten song
 * meant leaving the console, and leaving the console looked like ending the service.
 * Now the same list you built the set with is the list you drive it from — turning the
 * switch off puts the controls away and leaves the screens exactly where they were.
 */

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const SHORTCUTS: { keys: string; label: TranslationKey }[] = [
  { keys: '→', label: 'keys.nextSong' },
  { keys: '←', label: 'keys.prevSong' },
  { keys: 'Space', label: 'keys.sendLive' },
  { keys: 'b', label: 'keys.black' },
  { keys: 'c', label: 'keys.clear' },
  { keys: 'm', label: 'keys.autoManual' },
  { keys: '?', label: 'keys.help' },
];

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

  /** Leading, or merely working on the set. Never restored from storage — see below. */
  const [leading, setLeading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [help, setHelp] = useState(false);

  /*
    The socket only exists while the switch is on.

    Not persisted across reloads on purpose. A device that came back leading would
    immediately claim whichever set it happened to reopen and move every screen in the
    building to song one of it — a silent, remote, hard-to-undo action to recover from a
    refresh. Pressing Lead again is one click and is unambiguous.
  */
  const session = useSession('leader', t('lead.roleLeader'), leading);
  const { state, devices, status, clockOffset, patch, synced } = session;

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

  /*
    Take over the service, but only once the host has actually said where it is.

    Before the first frame `state` is the *initial* session, whose `setId` is null —
    adopting on that would move the screens off a running service every time a leader's
    page reloaded.
  */
  useEffect(() => {
    if (!leading || !synced) return;
    if (state.setId !== id) patch({ setId: id, itemIndex: 0 });
  }, [leading, synced, state.setId, id, patch]);

  // In Auto, the preview is simply what the room is seeing.
  useEffect(() => {
    if (!leading || !auto || !synced) return;
    if (state.setId !== id) return;
    setSelection({ kind: 'item', index: state.itemIndex });
  }, [leading, auto, synced, state.itemIndex, state.setId, id]);

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
   * Selecting a row. While leading in Auto, that *is* the service moving.
   *
   * The same click means "show me this" when building and "put this on the screens"
   * when leading, which is the whole reason the two views are one view: the leader is
   * never translating between a running order and a separate console.
   */
  const selectItem = useCallback(
    (index: number) => {
      setSelection({ kind: 'item', index });
      if (leading && auto) patch({ itemIndex: index });
    },
    [leading, auto, patch],
  );

  const songIndices = useMemo(
    () => (set?.items ?? []).flatMap((item, index) => (item.kind === 'song' ? [index] : [])),
    [set],
  );

  const cursorIndex = selection?.kind === 'item' ? selection.index : null;

  const step = useCallback(
    (delta: 1 | -1) => {
      const from = cursorIndex ?? state.itemIndex;
      const at = songIndices.indexOf(from);
      const next =
        at === -1
          ? (songIndices[0] ?? 0)
          : (songIndices[Math.min(Math.max(at + delta, 0), songIndices.length - 1)] ?? from);
      selectItem(next);
    },
    [cursorIndex, state.itemIndex, songIndices, selectItem],
  );

  const sendLive = useCallback(() => {
    if (cursorIndex !== null) patch({ itemIndex: cursorIndex });
  }, [cursorIndex, patch]);

  // Only while leading: a leader's hands are on an instrument, but someone merely
  // editing a set should get the letter b when they press b.
  useHotkeys(
    {
      ArrowRight: () => step(1),
      ArrowLeft: () => step(-1),
      ' ': () => {
        if (!auto) sendLive();
      },
      b: () => patch({ output: state.output === 'black' ? 'live' : 'black' }),
      c: () => patch({ output: state.output === 'cleared' ? 'live' : 'cleared' }),
      m: () => setAuto((v) => !v),
      '?': () => setHelp((open) => !open),
      Escape: () => setHelp(false),
    },
    leading,
  );

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

  const inSet = useMemo(
    () =>
      new Set(
        (set?.items ?? [])
          .filter((i): i is Extract<SetItem, { kind: 'song' }> => i.kind === 'song')
          .map((i) => i.songId),
      ),
    [set],
  );

  /** Turning the switch on also opens the tools, because that is where the controls are. */
  const toggleLead = (): void => {
    const next = !leading;
    setLeading(next);
    if (next) {
      setPrefs({ setHeaderExpanded: true });
      setTab('program');
    }
  };

  const newSet = (): void => {
    const sunday = nextSunday();
    void api
      .createSet({ title: sunday, date: sunday })
      .then((created) => {
        rememberSet(created.id);
        navigate(`/sets/${encodeURIComponent(created.id)}`);
      })
      .catch((e: unknown) => setError(String(e)));
  };

  if (error && !set) {
    /*
      A set that is gone — deleted from another device, most likely.

      The full header, not a bare link: this is the one screen you can land on straight
      from launch, because it is where the app opens, and a dead end with nothing but
      "← Library" on it is the worst possible first thing to see.
    */
    return (
      <Page>
        <AppHeader current="home" />
        <Scroll className="p-6">
          <p className="text-sm text-(--color-muted)">{error}</p>
          <ButtonLink to="/sets" className="mt-4">
            {t('app.sets')}
          </ButtonLink>
        </Scroll>
      </Page>
    );
  }
  if (!set) return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  const expanded = prefs.setHeaderExpanded;
  const selectedItem = selection?.kind === 'item' ? (set.items[selection.index] ?? null) : null;
  /** Leading this set, as opposed to leading some other one from another device. */
  const live = leading && synced && state.setId === id;
  const behind = live && !auto && cursorIndex !== null && cursorIndex !== state.itemIndex;

  return (
    <div className="flex h-dvh flex-col print:h-auto">
      <PrintableRunningOrder set={set} songs={songs} t={t} formatDate={formatDate} />

      <AppHeader
        current="home"
        title={
          /*
            The date *is* the name. A service is identified by when it happens, and a
            free-text title beside a date was two fields that had to agree — they did
            not, and "Program nou" sat at the top of a set for a whole Sunday.
          */
          <DatePicker
            value={set.date}
            onChange={(date) => update((s) => ({ ...s, date, title: titleForDate(date) }))}
            label={t('sets.noDate')}
          />
        }
      >
        <SaveBadge state={saveState} />
        <Button
          active={leading}
          onClick={toggleLead}
          title={leading ? t('lead.stop') : t('lead.start')}
        >
          <IconLead size={16} />
          <span className="hidden sm:inline">{t('app.lead')}</span>
        </Button>
        <IconButton
          label={expanded ? t('set.collapseHeader') : t('set.expandHeader')}
          onClick={() => setPrefs({ setHeaderExpanded: !expanded })}
          aria-expanded={expanded}
        >
          {expanded ? <IconChevronUp size={17} /> : <IconChevronDown size={17} />}
        </IconButton>
      </AppHeader>

      {expanded && (
        <div className="shrink-0 border-b border-(--color-line) bg-(--color-raised) px-3 py-2 print:hidden sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {/* Starting a service is a first-class action, so it sits first rather than
                hiding behind the sets list. Deleting one does not: it lives on that
                list, where you can see what you are about to lose. */}
            <Button size="sm" onClick={newSet}>
              <IconPlus size={14} />
              {t('sets.new')}
            </Button>
            <span className="mx-1 h-5 w-px shrink-0 bg-(--color-line)" />
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

            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {/* Whether chords are showing is a view preference, not a leading
                  control. It used to appear only once the switch was on, which left a
                  guitarist reading through Sunday's set on a Tuesday with no way to
                  turn them off. */}
              <Button
                size="sm"
                active={prefs.showChords}
                onClick={() => setPrefs({ showChords: !prefs.showChords })}
              >
                {t('song.chords')}
              </Button>

              {leading && (
                <LeadControls
                  state={state}
                  patch={patch}
                  clockOffset={clockOffset}
                  status={status}
                  auto={auto}
                  onAuto={setAuto}
                  devices={devices.length}
                  devicesOpen={devicesOpen}
                  onDevices={() => setDevicesOpen((open) => !open)}
                />
              )}
            </span>
          </div>
        </div>
      )}

      {behind && (
        <Button
          variant="primary"
          onClick={sendLive}
          className="shrink-0 rounded-none border-x-0 border-t-0"
        >
          {t('lead.sendToScreens')}
        </Button>
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
          <Segmented className="m-2 shrink-0 self-stretch">
            {(
              [
                ['program', t('set.tabProgram')],
                ['library', t('set.tabLibrary')],
              ] as const
            ).map(([value, label]) => (
              <Segment
                key={value}
                active={tab === value}
                onClick={() => setTab(value)}
                aria-current={tab === value ? 'true' : undefined}
                className="flex-1"
              >
                {label}
              </Segment>
            ))}
          </Segmented>

          {tab === 'program' ? (
            <ol className="scroll-slim min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
              {/* The horizontal padding is for the lifted row: it is outlined and scaled up
                  slightly while dragging, and a list with no inset clips both against
                  its own overflow. */}
              {set.items.map((item, index) => {
                const onAir = live && index === state.itemIndex;
                const chosen =
                  drag.dragging !== index &&
                  selection?.kind === 'item' &&
                  selection.index === index;
                return (
                  <li
                    key={index}
                    {...drag.rowProps(index)}
                    aria-current={onAir ? 'true' : undefined}
                    className={`group flex items-center gap-1 px-2 py-1.5 text-sm ${
                      onAir
                        ? 'rounded-md bg-(--color-chord)/25 font-semibold ring-1 ring-(--color-chord)'
                        : chosen
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
                      onClick={() => selectItem(index)}
                      className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                    >
                      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-(--color-muted)">
                        {index + 1}
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
                );
              })}

              {set.items.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-(--color-muted)">
                  {t('sets.addFirst')}
                </li>
              )}
            </ol>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('sets.searchSong')}
                aria-label={t('sets.searchSong')}
                autoComplete="off"
                className="mx-2 mb-2 w-[calc(100%-1rem)] shrink-0"
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
              <Button
                variant="primary"
                disabled={inSet.has(selection.songId)}
                onClick={() => addSong(selection.songId)}
              >
                {inSet.has(selection.songId) ? t('set.alreadyInSet') : t('set.addToSet')}
              </Button>
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
              <Textarea
                value={selectedItem.text}
                onChange={(e) =>
                  selection?.kind === 'item' &&
                  replaceItem(selection.index, { kind: 'note', text: e.target.value })
                }
                rows={4}
                placeholder={t('sets.notePlaceholder')}
                className="mt-1"
              />
            </div>
          ) : selectedItem?.kind === 'gap' ? (
            <div className="grid max-w-md gap-3 p-4 sm:grid-cols-[1fr_6rem]">
              <label className="block">
                <span className="block text-xs uppercase tracking-wide text-(--color-muted)">
                  {t('set.gapLabel')}
                </span>
                <Input
                  value={selectedItem.label}
                  onChange={(e) =>
                    selection?.kind === 'item' &&
                    replaceItem(selection.index, { ...selectedItem, label: e.target.value })
                  }
                  placeholder={t('sets.gapPlaceholder')}
                  className="mt-1"
                />
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-wide text-(--color-muted)">
                  {t('set.gapMinutes')}
                </span>
                <Input
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
                  className="mt-1"
                />
              </label>
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-(--color-muted)">
              {tab === 'library' ? t('set.searchToAdd') : t('set.pickSomething')}
            </p>
          )}
        </main>

        {leading && devicesOpen && (
          <DevicesPanel devices={devices} onClose={() => setDevicesOpen(false)} />
        )}
      </div>

      {help && <Shortcuts rows={SHORTCUTS} onClose={() => setHelp(false)} />}
    </div>
  );
}

/**
 * Everything that reaches the other screens, in one strip.
 *
 * On the right of the tools row, deliberately far from the buttons that edit the set:
 * `Black` in the middle of `Add note` and `Duplicate` is a mis-click with an audience.
 */
function LeadControls({
  state,
  patch,
  clockOffset,
  status,
  auto,
  onAuto,
  devices,
  devicesOpen,
  onDevices,
}: {
  state: SessionState;
  patch: (p: Partial<Omit<SessionState, 'rev'>>) => void;
  clockOffset: number;
  status: 'connecting' | 'live' | 'offline';
  auto: boolean;
  onAuto: (value: boolean) => void;
  devices: number;
  devicesOpen: boolean;
  onDevices: () => void;
}) {
  const { t } = useT();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {/*
        Auto and Manual, the one idea worth keeping wholesale from the legacy app: in
        Manual the leader can look ahead — check the next song's key, find the bridge —
        with nothing reaching the stage until they commit.
      */}
      <Segmented label={t('lead.follow')}>
        <Segment size="sm" active={auto} onClick={() => onAuto(true)}>
          {t('lead.auto')}
        </Segment>
        <Segment size="sm" active={!auto} onClick={() => onAuto(false)}>
          {t('lead.manual')}
        </Segment>
      </Segmented>

      <Button
        size="sm"
        active={state.output === 'cleared'}
        onClick={() => patch({ output: state.output === 'cleared' ? 'live' : 'cleared' })}
      >
        {t('lead.clear')}
      </Button>
      <Button
        size="sm"
        active={state.output === 'black'}
        onClick={() => patch({ output: state.output === 'black' ? 'live' : 'black' })}
      >
        {t('lead.black')}
      </Button>

      <Tempo state={state} patch={patch} clockOffset={clockOffset} />

      <Button size="sm" active={devicesOpen} onClick={onDevices} aria-expanded={devicesOpen}>
        <IconPeople size={14} />
        <span className="tabular-nums">{devices}</span>
      </Button>

      <StatusDot status={status} />
    </span>
  );
}

function Tempo({
  state,
  patch,
  clockOffset,
}: {
  state: SessionState;
  patch: (p: Partial<Omit<SessionState, 'rev'>>) => void;
  clockOffset: number;
}) {
  const { t } = useT();
  const [taps, setTaps] = useState<number[]>([]);

  // Tapping is how musicians set tempo; typing a number is a fallback.
  const tap = (): void => {
    const now = Date.now();
    const recent = [...taps, now].filter((at) => now - at < 3000).slice(-5);
    setTaps(recent);
    if (recent.length >= 2) {
      const gaps = recent.slice(1).map((at, i) => at - recent[i]!);
      const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      patch({ tempo: Math.round(60000 / average), beatEpoch: now });
    } else {
      patch({ beatEpoch: now });
    }
  };

  return (
    <span className="flex items-center gap-1">
      <Button size="sm" onClick={tap}>
        {t('lead.tap')}
      </Button>
      {state.tempo !== null && (
        <>
          <BeatLed state={state} clockOffset={clockOffset} size="sm" />
          <IconButton
            size="sm"
            label={t('lead.stopTempo')}
            onClick={() => patch({ tempo: null, beatEpoch: null })}
          >
            <IconClose size={14} />
          </IconButton>
        </>
      )}
    </span>
  );
}

/** Who is connected — opened and closed from the tools row, like a chat sidebar. */
function DevicesPanel({
  devices,
  onClose,
}: {
  devices: { id: string; name: string; role: string }[];
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <aside
      aria-label={t('lead.connected', { count: devices.length })}
      className="scroll-slim hidden w-52 shrink-0 flex-col overflow-y-auto border-l border-(--color-line) bg-(--color-surface) px-3 py-2 sm:flex"
    >
      <div className="mb-2 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs uppercase tracking-wider text-(--color-muted)">
          {t('lead.connected', { count: devices.length })}
        </p>
        <IconButton size="sm" label={t('app.close')} variant="ghost" onClick={onClose}>
          <IconClose size={14} />
        </IconButton>
      </div>
      <ul className="space-y-1 text-sm">
        {devices.map((device) => (
          <li key={device.id} className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: 'oklch(70% 0.17 150)' }}
            />
            <span className="min-w-0 flex-1 truncate">
              {device.name || t('lead.unnamedDevice')}
            </span>
            <span className="shrink-0 text-[0.65rem] uppercase text-(--color-muted)">
              {device.role === 'stage'
                ? t('lead.roleStage')
                : device.role === 'leader'
                  ? t('lead.roleLeader')
                  : ''}
            </span>
          </li>
        ))}
      </ul>
      <ButtonLink to="/join" size="sm" className="mt-3 w-full">
        {t('lead.qr')}
      </ButtonLink>
    </aside>
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
 * The middle pane: the song exactly as it will look when it is led.
 *
 * Same fit-to-one-screen renderer as `/band` and `/stage`, and that matters more than it
 * sounds. The decision being made here is "does this song work in this service" — and
 * part of that is whether it is legible, whether it needs three columns, whether it is
 * one of the few that does not fit at all. A preview at a comfortable reading size would
 * answer a question nobody is asking.
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
        <ButtonLink
          to={`/edit/${encodeURIComponent(song.id)}`}
          size="sm"
          aria-label={t('song.edit')}
          title={t('song.edit')}
        >
          <IconEdit size={15} />
          <span className="hidden lg:inline">{t('song.edit')}</span>
        </ButtonLink>
        {children}
      </div>
      <div
        ref={container}
        className={`min-h-0 flex-1 px-3 py-3 sm:px-4 ${
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

/**
 * Key and capo for this set only — changing Sunday's key must not edit the library.
 *
 * Both are the shared controls now. They were a bare `<select>` and a bare number box
 * with hand-written borders, sitting beside buttons that had none of the same
 * proportions; a capo of 3 could also be typed as 300.
 */
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
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5">
        <span className="text-(--color-muted)">{t('sets.key')}</span>
        <Select
          value={item.keyOverride ?? ''}
          onChange={(e) => onPatch({ keyOverride: e.target.value || null })}
          aria-label={t('sets.key')}
          tight
          className="w-24"
        >
          <option value="">{nativeKey ?? '—'}</option>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-(--color-muted)">{t('sets.capo')}</span>
        <Select
          value={item.capoOverride === null ? '' : String(item.capoOverride)}
          onChange={(e) =>
            onPatch({ capoOverride: e.target.value === '' ? null : Number(e.target.value) })
          }
          aria-label={t('sets.capo')}
          tight
          className="w-20"
        >
          <option value="">—</option>
          {Array.from({ length: 12 }, (_, fret) => (
            <option key={fret} value={fret}>
              {fret}
            </option>
          ))}
        </Select>
      </label>
    </span>
  );
}

/** The tools row's buttons, which are just the shared control with a shorter name. */
function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" onClick={onClick}>
      {children}
    </Button>
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
