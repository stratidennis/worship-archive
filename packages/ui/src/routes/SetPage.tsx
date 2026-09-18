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
import { setLeading, useLeading } from '../lib/leading.js';
import { useT, type TranslationKey, type Translator } from '../lib/i18n.js';
import { nextSunday } from '../lib/setName.js';
import { SongBody } from '../components/SongBody.js';
import { Scroll } from '../components/Scroll.js';
import { HeaderActions, HeaderTitle, useHeader } from '../components/header-slots.js';
import { ResizeHandle } from '../components/ResizeHandle.js';
import { DatePicker } from '../components/DatePicker.js';
import { BeatLed } from '../components/BeatLed.js';
import { Shortcuts } from '../components/Shortcuts.js';
import { StatusDot } from '../components/StatusDot.js';
import { useLeaderSession } from '../components/LeaderSession.js';
import { SaveBadge, type SaveState } from '../components/SaveBadge.js';
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
  IconFilter,
  IconGrip,
  IconLead,
  IconPeople,
  IconPlus,
} from '../components/icons.js';
import { PrintableSet } from '../components/PrintableSet.js';

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

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const SHORTCUTS: { keys: string; label: TranslationKey }[] = [
  { keys: '→', label: 'keys.nextSong' },
  { keys: '←', label: 'keys.prevSong' },
  { keys: 'Space', label: 'keys.sendLive' },
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
  /** Applied archive filters. The popover edits a draft and commits it here. */
  const [filters, setFilters] = useState<{ collection: string; key: string }>({
    collection: '',
    key: '',
  });
  const savedRef = useRef('');

  const [devicesOpen, setDevicesOpen] = useState(false);
  const [help, setHelp] = useState(false);

  useHeader({ current: 'home' });

  /*
    Leading lives above the router, not here.

    It used to be this component's state, which meant opening the QR screen to connect
    one more phone ended the session — the socket closed, the leader vanished from
    everyone's device list, and the switch was off again on the way back. Leading is not
    a property of the page you happen to be looking at. See `lib/leading.ts`.
  */
  const { setId: leadingSetId, auto } = useLeading();
  const leading = leadingSetId === id;
  const { state, devices, status, clockOffset, patch, synced } = useLeaderSession();
  const setAuto = useCallback((value: boolean) => setLeading({ auto: value }), []);

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

  // The picker shows the archive until something is typed. Unsliced, because the
  // filters run over it afterwards — trimming to the first sixty first would have made
  // "songs in G" mean "songs in G among the first sixty alphabetically".
  useEffect(() => {
    if (tab !== 'library') return;
    const timer = setTimeout(() => {
      const request = query.trim() ? repo.search(query) : repo.songs();
      request.then(setHits).catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [query, tab]);

  /*
    What there is to filter by.

    Keys are counted from the songs in view, so the list can never offer a key that
    nothing here is in — and it works with no host, because a key is part of the song.

    A collection is not. It is the folder the file sits in on the host, which the
    offline mirror has no way of knowing, so the collections come from the host and
    simply do not appear when there is none to ask. Offering a filter that would match
    nothing would be worse than not offering it.
  */
  const [collections, setCollections] = useState<[string, number][]>([]);
  const [inCollection, setInCollection] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (tab !== 'library') return;
    api
      .facets()
      .then((f) => setCollections(f.collections.map((c) => [c.name, c.count])))
      .catch(() => setCollections([]));
  }, [tab]);

  useEffect(() => {
    if (filters.collection === '') {
      setInCollection(null);
      return;
    }
    let cancelled = false;
    api
      .songs({ collection: filters.collection })
      .then((list) => !cancelled && setInCollection(new Set(list.map((song) => song.id))))
      .catch(() => !cancelled && setInCollection(new Set()))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filters.collection]);

  const facets = useMemo(() => {
    const keys = new Map<string, number>();
    for (const song of hits) {
      const key = song.performanceKey ?? song.writtenKey;
      if (key) keys.set(key, (keys.get(key) ?? 0) + 1);
    }
    return {
      collections,
      keys: [...keys].sort((a, b) => b[1] - a[1]),
    };
  }, [hits, collections]);

  const shown = useMemo(
    () =>
      hits
        .filter(
          (song) =>
            (inCollection === null || inCollection.has(song.id)) &&
            (filters.key === '' ||
              (song.performanceKey ?? song.writtenKey ?? '') === filters.key),
        )
        .slice(0, 80),
    [hits, filters.key, inCollection],
  );

  /*
    Autosave, debounced — and flushed rather than abandoned.

    The debounce used to be the whole story, and its cleanup cancelled the pending
    timer. Which meant anything changed in the last 700ms before leaving the page was
    silently thrown away: set a song's key and click the next song quickly enough and
    the key was never sent. Navigation inside the app, closing the tab, switching to
    another app on a phone — all three lost the same way, and all three look like the
    change simply not sticking.
  */
  const latest = useRef<ServiceSet | null>(null);
  latest.current = set;

  const flush = useCallback(
    (keepalive = false) => {
      const current = latest.current;
      if (!current || JSON.stringify(current) === savedRef.current) return;
      setSaveState('saving');
      api
        .saveSet(id, current, { keepalive })
        .then((stored) => {
          savedRef.current = JSON.stringify({
            ...current,
            rev: stored.rev,
            updatedAt: stored.updatedAt,
          });
          setSaveState('saved');
        })
        .catch((e: unknown) => {
          setError(String(e));
          setSaveState('error');
        });
    },
    [id],
  );

  useEffect(() => {
    if (!set) return;
    if (JSON.stringify(set) === savedRef.current) {
      setSaveState('idle');
      return;
    }
    setSaveState('dirty');
    const timer = setTimeout(() => flush(), 700);
    return () => clearTimeout(timer);
  }, [set, flush]);

  // Leaving the page, and leaving the tab. `pagehide` is the one event that fires
  // reliably on a phone, where a browser may never get an unload at all.
  useEffect(() => {
    const onHide = (): void => flush(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush(true);
    };
  }, [flush]);

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
      c: () => patch({ output: state.output === 'cleared' ? 'live' : 'cleared' }),
      m: () => setAuto(!auto),
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

  /**
   * Take a song out of the set, from the archive list rather than the running order.
   *
   * Every occurrence, not the last one: the list shows one row per song with one tick,
   * so leaving a second copy behind would leave the tick on and the button doing
   * nothing the next time it was pressed.
   */
  const removeSong = (songId: string): void => {
    const gone = (set?.items ?? []).flatMap((item, index) =>
      item.kind === 'song' && item.songId === songId ? [index] : [],
    );
    if (gone.length === 0) return;
    update((s) => ({
      ...s,
      items: s.items.filter((item) => !(item.kind === 'song' && item.songId === songId)),
    }));
    setSelection((current) => {
      if (current?.kind !== 'item') return current;
      if (gone.includes(current.index)) return null;
      const before = gone.filter((index) => index < current.index).length;
      return before === 0 ? current : { kind: 'item', index: current.index - before };
    });
  };

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
    setLeading({ setId: next ? id : null });
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

      It keeps the header, which it gets for free now: this is the one screen you can
      land on straight from launch, because it is where the app opens, and a dead end
      with no way out of it is the worst possible first thing to see.
    */
    return (
      <Scroll className="p-6">
        <p className="text-sm text-(--color-muted)">{error}</p>
        <ButtonLink to="/sets" className="mt-4">
          {t('app.sets')}
        </ButtonLink>
      </Scroll>
    );
  }
  if (!set) return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  const expanded = prefs.setHeaderExpanded;
  const selectedItem = selection?.kind === 'item' ? (set.items[selection.index] ?? null) : null;
  /** Leading this set, as opposed to leading some other one from another device. */
  const live = leading && synced && state.setId === id;
  const behind = live && !auto && cursorIndex !== null && cursorIndex !== state.itemIndex;

  return (
    <>
      <PrintableSet set={set} songs={songs} t={t} formatDate={formatDate} />

      <HeaderTitle>
        {/*
          The date *is* the name. A service is identified by when it happens, and a
          free-text title beside a date was two fields that had to agree — they did
          not, and "Program nou" sat at the top of a set for a whole Sunday.
        */}
        <DatePicker
          value={set.date}
          onChange={(date) => update((s) => ({ ...s, date, title: titleForDate(date) }))}
          label={t('sets.noDate')}
        />
      </HeaderTitle>

      <HeaderActions>
        <Button
          active={leading}
          onClick={toggleLead}
          title={leading ? t('lead.stop') : t('lead.start')}
        >
          <IconLead size={16} />
          <span className="hidden sm:inline">{t('app.lead')}</span>
        </Button>
        <IconButton
          variant="ghost"
          label={expanded ? t('set.collapseHeader') : t('set.expandHeader')}
          onClick={() => setPrefs({ setHeaderExpanded: !expanded })}
          aria-expanded={expanded}
        >
          {expanded ? <IconChevronUp size={17} /> : <IconChevronDown size={17} />}
        </IconButton>
      </HeaderActions>

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
            <span className="text-xs text-(--color-muted)">
              {t('set.itemCount', { count: set.items.length })}
            </span>
            {/* Beside the item count rather than up in the header: it is the same kind
                of fact about the set, and in the header its appearing and disappearing
                pushed the navigation onto a second row every time anything was saved. */}
            <SaveBadge state={saveState} quietWhenDirty />

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
                    onClick={(event) => {
                      // The whole row opens it, not just the title text in the middle of
                      // it. The grip and the ✕ are buttons in their own right and answer
                      // for themselves; everything else — the padding, the gaps, the key
                      // on the right — is the row.
                      if ((event.target as HTMLElement).closest('button,[role="button"]'))
                        return;
                      selectItem(index);
                    }}
                    className={`group flex cursor-pointer items-center gap-1 px-2 py-1.5 text-sm ${
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
              <ArchiveSearch
                query={query}
                onQuery={setQuery}
                facets={facets}
                value={filters}
                onChange={setFilters}
              />
              <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto">
                {shown.map((song) => (
                  <li key={song.id}>
                    <div
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button,[role="button"]'))
                          return;
                        setSelection({ kind: 'candidate', songId: song.id });
                      }}
                      className={`group flex cursor-pointer items-center gap-1 pl-3 pr-1.5 text-sm hover:bg-(--color-line)/40 ${
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
                        onRemove={() => removeSong(song.id)}
                        addLabel={t('set.addToSet')}
                        addedLabel={t('set.alreadyInSet')}
                        removeLabel={t('set.removeFromSet')}
                      />
                    </div>
                  </li>
                ))}
                {shown.length === 0 && hits.length > 0 && (
                  <li className="px-3 py-6 text-center text-sm text-(--color-muted)">
                    {t('set.noMatches')}
                  </li>
                )}
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
    </>
  );
}

/**
 * Searching the archive, and filtering it.
 *
 * Search and filters on one line, because the panel is 288px wide by default and a
 * second full row of chrome above a list of songs is most of what you came here to look
 * at. The filters are a popover for the same reason — as chips they were three rows.
 *
 * The popover is measured against the **row**, not against the button at the end of it,
 * and is exactly the row's width. Hung off the button it was anchored to a 36px box at
 * the panel's right edge and opened leftwards from there, so on a narrowed sidebar its
 * left half was off the side of the screen. Anchored to the row it cannot leave the
 * panel at any width, and it lines up with the field it filters.
 *
 * It edits a **draft**. Apply commits it; Cancel, Escape and clicking away all discard
 * it — three ways to do the same thing rather than one of them quietly meaning the
 * opposite. The button stays lit while anything is filtered, so a list that looks short
 * can always be explained without opening this.
 */
function ArchiveSearch({
  query,
  onQuery,
  facets,
  value,
  onChange,
}: {
  query: string;
  onQuery: (value: string) => void;
  facets: { collections: [string, number][]; keys: [string, number][] };
  value: { collection: string; key: string };
  onChange: (next: { collection: string; key: string }) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const wrapper = useRef<HTMLDivElement>(null);
  const active = value.collection !== '' || value.key !== '';

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  return (
    <div ref={wrapper} className="relative m-2 mt-0 shrink-0">
      <div className="flex items-center gap-1.5">
        <Input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('sets.searchSong')}
          aria-label={t('sets.searchSong')}
          autoComplete="off"
          className="min-w-0 flex-1"
        />
        <IconButton
          label={t('set.filters')}
          active={open || active}
          aria-expanded={open}
          onClick={() => {
            // Always open on what is actually applied, not on last time's abandoned draft.
            setDraft(value);
            setOpen((current) => !current);
          }}
        >
          <IconFilter size={16} />
        </IconButton>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label={t('set.filters')}
          className="modal-panel absolute inset-x-0 top-full z-30 mt-1.5 rounded-xl border border-(--color-line) bg-(--color-surface) p-3 shadow-xl"
        >
          {facets.collections.length > 0 && (
            <FilterGroup
              label={t('set.filterCollection')}
              options={facets.collections}
              value={draft.collection}
              onChange={(collection) => setDraft((d) => ({ ...d, collection }))}
              allLabel={t('library.all')}
            />
          )}
          <FilterGroup
            label={t('set.filterKey')}
            options={facets.keys}
            value={draft.key}
            onChange={(key) => setDraft((d) => ({ ...d, key }))}
            allLabel={t('library.all')}
            className={facets.collections.length > 0 ? 'mt-3' : ''}
          />

          {/* Wrapping, and the clear button keeps its own line rather than breaking in
              half: the panel can be dragged down to 220px and two words on two lines in
              a button look like a rendering fault. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="mr-auto whitespace-nowrap text-(--color-muted)"
              disabled={draft.collection === '' && draft.key === ''}
              onClick={() => setDraft({ collection: '', key: '' })}
            >
              {t('set.filtersClear')}
            </Button>
            <Button size="sm" onClick={close}>
              {t('app.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onChange(draft);
                close();
              }}
            >
              {t('app.apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One row of filter chips, with "All" always first so there is a way back. */
function FilterGroup({
  label,
  options,
  value,
  onChange,
  allLabel,
  className = '',
}: {
  label: string;
  options: [string, number][];
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-wide text-(--color-muted)">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        <Chip active={value === ''} onClick={() => onChange('')}>
          {allLabel}
        </Chip>
        {options.map(([name, count]) => (
          <Chip key={name} active={value === name} onClick={() => onChange(name)}>
            {name}
            <span className="ml-1 opacity-60 tabular-nums">{count}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 max-w-full items-center truncate rounded-full border px-2.5 text-xs font-medium transition-colors ${
        active
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : 'border-(--color-line) bg-(--color-surface) hover:bg-(--color-line)'
      }`}
    >
      {children}
    </button>
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
              style={{ background: 'var(--color-ok)' }}
            />
            <span className="min-w-0 flex-1 truncate">
              {device.name || t('lead.unnamedDevice')}
            </span>
            <span className="shrink-0 text-[0.7rem] text-(--color-muted)">
              {device.role === 'stage'
                ? t('lead.roleStage')
                : device.role === 'leader'
                  ? t('lead.roleLeader')
                  : t('lead.roleBand')}
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
 * Put a song in the set, or take it back out, without leaving the archive.
 *
 * Faint while idle so a long list reads as titles rather than a column of buttons,
 * solid on hover, and a tick once the song is in — which answers "did that work" in the
 * same place the question was asked.
 *
 * The tick used to be inert, on the reasoning that a second press had nothing useful to
 * do. It did: undoing the press you just made. Hovering the row turns it into an ✕, so
 * adding and removing are the same gesture in the same place — and the icon only
 * changes under the pointer, so a list of ticks still reads as "these are in".
 */
function AddButton({
  added,
  onAdd,
  onRemove,
  addLabel,
  addedLabel,
  removeLabel,
}: {
  added: boolean;
  onAdd: () => void;
  onRemove: () => void;
  addLabel: string;
  addedLabel: string;
  removeLabel: string;
}) {
  if (added) {
    return (
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent text-(--color-chord) transition hover:border-red-500 hover:bg-red-500 hover:text-white focus-visible:border-red-500"
      >
        <IconCheck size={16} className="group-hover:hidden" aria-label={addedLabel} />
        <IconClose size={16} className="hidden group-hover:block" />
      </button>
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
        {/* `basis-full` below `sm`: on a phone held upright the key and capo controls
            took the whole row and the title truncated to "Abba …". The title gets its
            own line there and the controls sit under it. */}
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
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
