import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { semitonesBetween, type SessionState } from '@worship/core';
import { api, type SetSummary } from '../lib/api.js';
import { useSession } from '../lib/useSession.js';
import { useLiveSet, songAt, useSongIndices } from '../lib/useLiveSet.js';
import { usePrefs } from '../lib/settings.js';
import { useFitToScreen } from '../lib/useFitToScreen.js';
import { SongBody } from '../components/SongBody.js';
import { BeatLed } from '../components/BeatLed.js';

/**
 * The leader console.
 *
 * The one idea worth keeping wholesale from the legacy app is **Auto vs Manual**: in
 * Manual the leader can look ahead — check the next song's key, find the bridge — with
 * nothing reaching the stage until they commit. It is entirely client-side; the
 * protocol never needs to know a leader is browsing.
 */
export function LeadPage() {
  const session = useSession('leader', 'Lider');
  const { state, devices, status, clockOffset, patch, libraryRev } = session;
  const live = useLiveSet(state.setId, libraryRev);
  const [prefs, setPrefs] = usePrefs();

  const [sets, setSets] = useState<SetSummary[]>([]);
  const [auto, setAuto] = useState(true);
  /** Where the leader is looking, which in Manual mode is not where the service is. */
  const [cursor, setCursor] = useState<{ itemIndex: number; blockId: string | null }>({
    itemIndex: 0,
    blockId: null,
  });

  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const songIndices = useSongIndices(live.set);

  useEffect(() => {
    api.sets().then(setSets).catch(() => setSets([]));
  }, []);

  // In Auto the cursor simply mirrors the live position.
  useEffect(() => {
    if (auto) setCursor({ itemIndex: state.itemIndex, blockId: state.blockId });
  }, [auto, state.itemIndex, state.blockId]);

  const viewing = songAt(live.set, live.songs, cursor.itemIndex);
  const isLiveView = cursor.itemIndex === state.itemIndex && cursor.blockId === state.blockId;

  const go = (next: Partial<typeof cursor>): void => {
    const target = { ...cursor, ...next };
    setCursor(target);
    if (auto) patch(target);
  };

  const goLive = (): void => patch(cursor);

  const step = (delta: 1 | -1): void => {
    const position = songIndices.indexOf(cursor.itemIndex);
    const nextIndex =
      position === -1
        ? (songIndices[0] ?? 0)
        : (songIndices[Math.min(Math.max(position + delta, 0), songIndices.length - 1)] ??
          cursor.itemIndex);
    go({ itemIndex: nextIndex, blockId: null });
  };

  const blocks = viewing?.song.blocks ?? [];

  const stepBlock = (delta: 1 | -1): void => {
    if (blocks.length === 0) return;
    const current = blocks.findIndex((b) => b.id === cursor.blockId);
    const next = Math.min(Math.max(current + delta, 0), blocks.length - 1);
    go({ blockId: blocks[next]?.id ?? null });
  };

  // Keyboard is the primary interface here — a leader's hands are on an instrument.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      const handlers: Record<string, () => void> = {
        ArrowRight: () => step(1),
        ArrowLeft: () => step(-1),
        ArrowDown: () => stepBlock(1),
        ArrowUp: () => stepBlock(-1),
        ' ': () => (auto ? undefined : goLive()),
        b: () => patch({ output: state.output === 'black' ? 'live' : 'black' }),
        c: () => patch({ output: state.output === 'cleared' ? 'live' : 'cleared' }),
        m: () => setAuto((v) => !v),
      };
      const handler = handlers[event.key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const fit = useFitToScreen(container, content, {
    maxFontPx: prefs.maxFontPx,
    key: `${viewing?.song.id ?? ''}:${cursor.blockId}:${prefs.showChords}:${state.transpose}:${prefs.capo}`,
  });

  const keyOfViewing = useMemo(() => {
    if (!viewing) return null;
    return (
      viewing.item.keyOverride ?? viewing.song.performanceKey ?? viewing.song.writtenKey ?? null
    );
  }, [viewing]);

  // A set-level key override on top of the song's own written→performance shift.
  const extraTranspose = useMemo(() => {
    if (!viewing?.item.keyOverride) return state.transpose;
    const native = viewing.song.performanceKey ?? viewing.song.writtenKey;
    if (!native) return state.transpose;
    return state.transpose + (semitonesBetween(native, viewing.item.keyOverride) ?? 0);
  }, [viewing, state.transpose]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--color-line) px-3 py-2">
        <Link to="/" className="text-sm text-(--color-muted)">
          ←
        </Link>
        <select
          value={state.setId ?? ''}
          onChange={(e) => patch({ setId: e.target.value || null, itemIndex: 0, blockId: null })}
          className="rounded border border-(--color-line) bg-transparent px-2 py-1 text-sm"
        >
          <option value="">— alege programul —</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
              {s.date ? ` · ${s.date}` : ''}
            </option>
          ))}
        </select>

        <Toggle on={auto} onClick={() => setAuto((v) => !v)} onLabel="Auto" offLabel="Manual" />
        <Toggle
          on={state.mode === 'block'}
          onClick={() => patch({ mode: state.mode === 'block' ? 'song' : 'block' })}
          onLabel="Pe blocuri"
          offLabel="Pe cântare"
        />
        <Btn
          onClick={() => patch({ output: state.output === 'cleared' ? 'live' : 'cleared' })}
          active={state.output === 'cleared'}
        >
          Gol
        </Btn>
        <Btn
          onClick={() => patch({ output: state.output === 'black' ? 'live' : 'black' })}
          active={state.output === 'black'}
        >
          Negru
        </Btn>

        <Tempo state={state} patch={patch} clockOffset={clockOffset} />

        <span className="ml-auto flex items-center gap-2">
          <Btn onClick={() => setPrefs({ showChords: !prefs.showChords })} active={prefs.showChords}>
            Acorduri
          </Btn>
          <StatusDot status={status} />
        </span>
      </header>

      {!auto && !isLiveView && (
        <button
          type="button"
          onClick={goLive}
          className="shrink-0 bg-(--color-chord) px-4 py-2 text-sm font-semibold text-white"
        >
          Trimite pe ecrane (Space) — te uiți înainte, nimeni nu vede încă
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-(--color-line) py-2 md:block">
          {(live.set?.items ?? []).map((item, index) => {
            const isLive = index === state.itemIndex;
            const isCursor = index === cursor.itemIndex;
            const song = item.kind === 'song' ? live.songs[item.songId] : undefined;
            return (
              <button
                key={index}
                type="button"
                onClick={() => go({ itemIndex: index, blockId: null })}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                  isLive ? 'bg-(--color-chord)/20 font-semibold' : ''
                } ${isCursor && !isLive ? 'ring-1 ring-inset ring-(--color-chord)' : ''}`}
              >
                <span className="w-4 shrink-0 text-xs text-(--color-muted)">
                  {isLive ? '▶' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {item.kind === 'song'
                    ? (song?.title ?? '…')
                    : item.kind === 'note'
                      ? item.text || 'notă'
                      : item.label || 'pauză'}
                </span>
              </button>
            );
          })}
          {!live.set && (
            <p className="px-3 py-4 text-xs text-(--color-muted)">
              Alege un program din lista de sus.
            </p>
          )}
        </nav>

        <main className="flex min-h-0 flex-1 flex-col">
          {viewing && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-(--color-line) px-3 py-1.5">
              <span className="mr-2 truncate text-sm font-semibold">{viewing.song.title}</span>
              <span className="mr-2 font-mono text-xs text-(--color-muted)">{keyOfViewing}</span>
              {blocks.map((block) => (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => go({ blockId: block.id })}
                  className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                    state.blockId === block.id && isLiveView
                      ? 'bg-(--color-chord) text-white'
                      : cursor.blockId === block.id
                        ? 'ring-1 ring-(--color-chord)'
                        : 'bg-(--color-line)'
                  }`}
                  title={block.type}
                >
                  {block.id}
                </button>
              ))}
              {cursor.blockId && (
                <button
                  type="button"
                  onClick={() => go({ blockId: null })}
                  className="rounded px-1.5 py-0.5 text-xs text-(--color-muted)"
                >
                  toată cântarea
                </button>
              )}
            </div>
          )}

          <div ref={container} className="min-h-0 flex-1 overflow-hidden px-4 py-3">
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
                  song={
                    state.mode === 'block' && cursor.blockId
                      ? {
                          ...viewing.song,
                          blocks: viewing.song.blocks.filter((b) => b.id === cursor.blockId),
                        }
                      : viewing.song
                  }
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
                {live.set ? 'Acest element nu e o cântare.' : 'Niciun program selectat.'}
              </p>
            )}
          </div>
        </main>

        <aside className="hidden w-48 shrink-0 overflow-y-auto border-l border-(--color-line) px-3 py-2 lg:block">
          <p className="mb-2 text-xs uppercase tracking-wider text-(--color-muted)">
            Conectați ({devices.length})
          </p>
          <ul className="space-y-1 text-sm">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: 'oklch(70% 0.17 150)' }}
                />
                <span className="min-w-0 flex-1 truncate">{device.name}</span>
                <span className="shrink-0 text-[0.65rem] uppercase text-(--color-muted)">
                  {device.role === 'stage' ? 'ecran' : device.role === 'leader' ? 'lider' : ''}
                </span>
              </li>
            ))}
          </ul>
          {devices.length <= 1 && (
            <p className="mt-3 text-xs text-(--color-muted)">
              Deschide <span className="font-mono">/band</span> pe telefoane și{' '}
              <span className="font-mono">/stage</span> pe ecran.
            </p>
          )}
        </aside>
      </div>
    </div>
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
  const [taps, setTaps] = useState<number[]>([]);

  // Tapping is how musicians set tempo; typing a number is a fallback.
  const tap = (): void => {
    const now = Date.now();
    const recent = [...taps, now].filter((t) => now - t < 3000).slice(-5);
    setTaps(recent);
    if (recent.length >= 2) {
      const gaps = recent.slice(1).map((t, i) => t - recent[i]!);
      const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      patch({ tempo: Math.round(60000 / average), beatEpoch: now });
    } else {
      patch({ beatEpoch: now });
    }
  };

  return (
    <span className="flex items-center gap-1">
      <Btn onClick={tap}>Tap</Btn>
      {state.tempo !== null && (
        <>
          <BeatLed state={state} clockOffset={clockOffset} size="sm" />
          <Btn onClick={() => patch({ tempo: null, beatEpoch: null })}>✕</Btn>
        </>
      )}
    </span>
  );
}

export function StatusDot({ status }: { status: 'connecting' | 'live' | 'offline' }) {
  const colour =
    status === 'live'
      ? 'oklch(70% 0.17 150)'
      : status === 'connecting'
        ? 'oklch(78% 0.15 85)'
        : 'oklch(62% 0.21 25)';
  const label = status === 'live' ? 'conectat' : status === 'connecting' ? 'se conectează' : 'deconectat';
  return (
    <span className="flex items-center gap-1.5 text-xs text-(--color-muted)" title={label}>
      <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
      {label}
    </span>
  );
}

function Toggle({
  on,
  onClick,
  onLabel,
  offLabel,
}: {
  on: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-sm font-medium ${
        on
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : 'border-(--color-line) hover:bg-(--color-line)'
      }`}
    >
      {on ? onLabel : offLabel}
    </button>
  );
}

function Btn({
  onClick,
  children,
  active,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-sm font-medium ${
        active
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : 'border-(--color-line) hover:bg-(--color-line)'
      }`}
    >
      {children}
    </button>
  );
}
