import { useMemo, useState } from 'react';
import {
  chordForCapo,
  formatChord,
  parseChord,
  parseChordPro,
  semitonesBetween,
  transposeChord,
  type Block,
  type Line,
} from '@worship/core';

/**
 * Phase 0/1 smoke test.
 *
 * Not the real app — it exists to prove the core package works end-to-end in a browser:
 * ChordPro parses, chords transpose, capo shapes are independent, and written vs
 * performance key does what it should. The real library, editor and live session arrive
 * in phases 2–5.
 */

const SAMPLE = `{title: Amazing Grace}
{key: G}
{x_performance_key: A}
{tempo: 72}
{time: 3/4}

{start_of_verse: V1}
A[G]mazing grace how [C]sweet the [G]sound
That saved a wretch like [D]me
{end_of_verse}

{start_of_chorus: C1}
{x_singers: All}
I [G]once was lost, but [C]now am [G]found
Was blind but [D]now I [G]see
{end_of_chorus}
`;

function ChordedLine({
  line,
  semitones,
  capo,
  targetKey,
  showChords,
}: {
  line: Line;
  semitones: number;
  capo: number;
  targetKey: string | null;
  showChords: boolean;
}) {
  // Slice the lyric at each chord position so a chord can sit above its own syllable.
  const segments = useMemo(() => {
    const anchors = [...line.chords].sort((a, b) => a.at - b.at);
    const out: { chord: string | null; text: string }[] = [];
    let cursor = 0;

    if (anchors.length === 0 || (anchors[0]?.at ?? 0) > 0) {
      out.push({ chord: null, text: line.text.slice(0, anchors[0]?.at ?? line.text.length) });
      cursor = anchors[0]?.at ?? line.text.length;
    }
    anchors.forEach((anchor, i) => {
      const next = anchors[i + 1]?.at ?? line.text.length;
      let token = parseChord(anchor.raw);
      token = transposeChord(token, semitones, targetKey);
      token = chordForCapo(token, capo, targetKey);
      out.push({ chord: formatChord(token), text: line.text.slice(Math.max(cursor, anchor.at), next) });
      cursor = next;
    });
    return out;
  }, [line, semitones, capo, targetKey]);

  if (line.text === '' && line.chords.length === 0) return <div className="h-4" />;

  return (
    <div className="flex flex-wrap items-end" style={{ paddingLeft: `${(line.indent ?? 0) * 1.5}rem` }}>
      {segments.map((seg, i) => (
        <span key={i} className="whitespace-pre">
          {showChords && (
            <span className="block text-sm font-semibold leading-tight text-(--color-chord)">
              {seg.chord ?? ' '}
            </span>
          )}
          <span className="block leading-snug">{seg.text}</span>
        </span>
      ))}
    </div>
  );
}

function BlockView({ block, ...rest }: { block: Block } & Omit<Parameters<typeof ChordedLine>[0], 'line'>) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--color-muted)">
        {block.type}
        {block.label ? ` — ${block.label}` : ''}
        {block.repeat ? ` ×${block.repeat}` : ''}
        {block.singers ? ` · ${block.singers}` : ''}
      </h2>
      {block.lines.map((line, i) => (
        <ChordedLine key={i} line={line} {...rest} />
      ))}
    </section>
  );
}

export function App() {
  const song = useMemo(() => parseChordPro(SAMPLE), []);
  const [extraTranspose, setExtraTranspose] = useState(0);
  const [capo, setCapo] = useState(0);
  const [showChords, setShowChords] = useState(true);

  // The written key is what the chords say; the performance key is what the band plays.
  const baseShift = useMemo(
    () =>
      song.writtenKey && song.performanceKey
        ? (semitonesBetween(song.writtenKey, song.performanceKey) ?? 0)
        : 0,
    [song],
  );
  const semitones = baseShift + extraTranspose;
  const targetKey = song.performanceKey ?? song.writtenKey;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 border-b border-(--color-line) pb-4">
        <p className="text-xs uppercase tracking-widest text-(--color-muted)">Worship Archive</p>
        <h1 className="text-2xl font-bold">{song.title}</h1>
        <p className="text-sm text-(--color-muted)">
          written in {song.writtenKey ?? '—'} · played in {song.performanceKey ?? '—'}
          {song.tempo ? ` · ${song.tempo} bpm` : ''}
          {song.timeSignature ? ` · ${song.timeSignature}` : ''}
          {capo > 0 ? ` · capo ${capo}` : ''}
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Control label="Transpose −" onClick={() => setExtraTranspose((n) => n - 1)} />
        <Control label="Transpose +" onClick={() => setExtraTranspose((n) => n + 1)} />
        <Control label="Capo −" onClick={() => setCapo((n) => Math.max(0, n - 1))} />
        <Control label="Capo +" onClick={() => setCapo((n) => Math.min(11, n + 1))} />
        <Control
          label={showChords ? 'Words only' : 'Show chords'}
          onClick={() => setShowChords((v) => !v)}
        />
      </div>

      {song.blocks.map((block) => (
        <BlockView
          key={block.id}
          block={block}
          semitones={semitones}
          capo={capo}
          targetKey={targetKey}
          showChords={showChords}
        />
      ))}
    </div>
  );
}

function Control({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-(--color-line) px-3 py-1.5 font-medium hover:bg-(--color-line)"
    >
      {label}
    </button>
  );
}
