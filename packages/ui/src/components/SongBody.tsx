import { useMemo } from 'react';
import {
  chordForCapo,
  formatChord,
  parseChord,
  semitonesBetween,
  transposeChord,
  type Block,
  type Line,
  type Song,
} from '@worship/core';

/** Block types that are cues rather than lyrics — rendered differently. */
const CUE_TYPES = new Set(['Intro', 'Instrumental', 'Solo', 'Note']);

export interface RenderOptions {
  showChords: boolean;
  showBass: boolean;
  capo: number;
  /** Extra semitones on top of the song's own written→performance shift. */
  transpose: number;
}

/** The total shift applied to a song's chords, and the key that results. */
export function resolveKey(song: Song, extra: number): { semitones: number; key: string | null } {
  const base =
    song.writtenKey && song.performanceKey
      ? (semitonesBetween(song.writtenKey, song.performanceKey) ?? 0)
      : 0;
  return { semitones: base + extra, key: song.performanceKey ?? song.writtenKey };
}

interface Segment {
  chord: string | null;
  bass: string | null;
  text: string;
}

/**
 * Slice a lyric line at its chord positions.
 *
 * Each segment carries the chord that lands on its first character, so the chord can be
 * stacked directly above the syllable it belongs to rather than floated approximately.
 */
function segmentsOf(
  line: Line,
  options: RenderOptions,
  semitones: number,
  targetKey: string | null,
): Segment[] {
  const positions = new Set<number>();
  if (options.showChords) for (const a of line.chords) positions.add(a.at);
  if (options.showBass) for (const a of line.bass) positions.add(a.at);

  const render = (raw: string): string => {
    let token = parseChord(raw);
    token = transposeChord(token, semitones, targetKey);
    token = chordForCapo(token, options.capo, targetKey);
    return formatChord(token);
  };

  const cuts = [...positions].sort((a, b) => a - b);
  const out: Segment[] = [];

  if (cuts.length === 0 || (cuts[0] ?? 0) > 0) {
    out.push({ chord: null, bass: null, text: line.text.slice(0, cuts[0] ?? line.text.length) });
  }
  cuts.forEach((at, i) => {
    const next = cuts[i + 1] ?? line.text.length;
    const chord = options.showChords ? line.chords.find((c) => c.at === at) : undefined;
    const bass = options.showBass ? line.bass.find((c) => c.at === at) : undefined;
    out.push({
      chord: chord ? render(chord.raw) : null,
      bass: bass ? render(bass.raw) : null,
      text: line.text.slice(at, next),
    });
  });
  return out;
}

function LineView({
  line,
  options,
  semitones,
  targetKey,
}: {
  line: Line;
  options: RenderOptions;
  semitones: number;
  targetKey: string | null;
}) {
  const segments = useMemo(
    () => segmentsOf(line, options, semitones, targetKey),
    [line, options, semitones, targetKey],
  );

  if (line.text === '' && line.chords.length === 0) return <div style={{ height: '0.6em' }} />;

  const anyChords = options.showChords || options.showBass;

  return (
    <div
      className="flex flex-wrap items-end"
      style={{
        paddingLeft: `${(line.indent ?? 0) * 1.5}em`,
        color: line.color ?? undefined,
      }}
    >
      {segments.map((segment, i) => (
        <span key={i} className="whitespace-pre-wrap">
          {anyChords && (
            <span className="block text-[0.72em] font-semibold leading-[1.1] text-(--color-chord)">
              {segment.chord ?? ' '}
              {segment.bass && (
                <span className="ml-1 text-(--color-bass)">{segment.bass}</span>
              )}
            </span>
          )}
          <span className="block leading-[1.25]">{segment.text}</span>
        </span>
      ))}
    </div>
  );
}

function BlockView({
  block,
  options,
  semitones,
  targetKey,
}: {
  block: Block;
  options: RenderOptions;
  semitones: number;
  targetKey: string | null;
}) {
  const isCue = CUE_TYPES.has(block.type);
  const label = [
    block.type,
    block.label ? `— ${block.label}` : null,
    block.repeat ? `×${block.repeat}` : null,
    block.singers ? `· ${block.singers}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={`mb-[0.9em] ${isCue ? 'rounded-md border-l-2 border-(--color-cue) bg-(--color-cue-bg) py-[0.3em] pl-[0.6em]' : ''}`}
      // Never let a block be split down the middle by a column break.
      style={{ breakInside: 'avoid' }}
    >
      <h2 className="text-[0.62em] font-semibold uppercase tracking-wider text-(--color-muted)">
        {label}
      </h2>
      {block.lines.map((line, i) => (
        <LineView
          key={i}
          line={line}
          options={options}
          semitones={semitones}
          targetKey={targetKey}
        />
      ))}
    </section>
  );
}

/**
 * The song itself.
 *
 * Sized entirely in `em` so the fit algorithm can scale the whole thing by setting one
 * font size on the container. Blocks linked with `linkToPrevious` are wrapped together
 * so a column break cannot separate a pre-chorus from its chorus.
 */
export function SongBody({
  song,
  options,
  arrangementView,
}: {
  song: Song;
  options: RenderOptions;
  arrangementView?: boolean;
}) {
  const { semitones, key } = resolveKey(song, options.transpose);

  const byId = useMemo(() => new Map(song.blocks.map((b) => [b.id, b])), [song]);
  const sequence: Block[] = useMemo(() => {
    if (!arrangementView || !song.arrangement) return song.blocks;
    return song.arrangement.map((id) => byId.get(id)).filter((b): b is Block => b !== undefined);
  }, [song, arrangementView, byId]);

  // Group linked blocks so they cannot be split across columns.
  const groups: Block[][] = [];
  for (const block of sequence) {
    if (block.linkToPrevious && groups.length > 0) groups[groups.length - 1]!.push(block);
    else groups.push([block]);
  }

  return (
    <>
      {groups.map((group, i) => (
        <div key={i} style={{ breakInside: 'avoid' }}>
          {group.map((block, j) => (
            <BlockView
              key={`${block.id}-${j}`}
              block={block}
              options={options}
              semitones={semitones}
              targetKey={key}
            />
          ))}
        </div>
      ))}
    </>
  );
}
