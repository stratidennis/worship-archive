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
import { useT } from '../lib/i18n.js';

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

interface Part {
  chord: string | null;
  bass: string | null;
  text: string;
}

/** One word, plus any trailing whitespace. Never broken across lines. */
type Chunk = Part[];

/**
 * Lay a line out as words, each carrying the chords that fall inside it.
 *
 * Two constraints pull against each other, and both matter:
 *
 *  - a chord must sit exactly above the character it is anchored to, which means the
 *    text has to be cut at every anchor;
 *  - a word must never break across lines, which means those cuts must not become
 *    wrapping opportunities. Cutting naively gives "să Te sl / ăvesc".
 *
 * Resolved by making the *word* the unit of layout: cuts happen inside a word, but the
 * word wraps as one. Whitespace stays at the end of a word, so lines still break in the
 * ordinary places.
 */
function chunksOf(
  line: Line,
  options: RenderOptions,
  semitones: number,
  targetKey: string | null,
): Chunk[] {
  const render = (raw: string): string => {
    let token = parseChord(raw);
    token = transposeChord(token, semitones, targetKey);
    token = chordForCapo(token, options.capo, targetKey);
    return formatChord(token);
  };

  const anchors = new Map<number, { chord: string | null; bass: string | null }>();
  if (options.showChords) {
    for (const a of line.chords) {
      anchors.set(a.at, { ...(anchors.get(a.at) ?? { chord: null, bass: null }), chord: render(a.raw) });
    }
  }
  if (options.showBass) {
    for (const a of line.bass) {
      anchors.set(a.at, { ...(anchors.get(a.at) ?? { chord: null, bass: null }), bass: render(a.raw) });
    }
  }
  const positions = [...anchors.keys()].sort((a, b) => a - b);

  const chunks: Chunk[] = [];
  // Each token is a word with its trailing spaces, or a run of leading spaces.
  for (const match of line.text.matchAll(/\S+\s*|\s+/g)) {
    const from = match.index;
    const to = from + match[0].length;
    const inside = positions.filter((p) => p >= from && p < to);
    const parts: Chunk = [];

    if (inside.length === 0 || inside[0]! > from) {
      parts.push({ chord: null, bass: null, text: line.text.slice(from, inside[0] ?? to) });
    }
    inside.forEach((at, i) => {
      const next = inside[i + 1] ?? to;
      const anchor = anchors.get(at)!;
      parts.push({ chord: anchor.chord, bass: anchor.bass, text: line.text.slice(at, next) });
    });
    chunks.push(parts);
  }

  // A chord placed past the end of the text — "play this here" at the line's close.
  for (const at of positions.filter((p) => p >= line.text.length)) {
    const anchor = anchors.get(at)!;
    chunks.push([{ chord: anchor.chord, bass: anchor.bass, text: '' }]);
  }

  if (chunks.length === 0) chunks.push([{ chord: null, bass: null, text: line.text }]);
  return chunks;
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
  const chunks = useMemo(
    () => chunksOf(line, options, semitones, targetKey),
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
      {chunks.map((chunk, c) => (
        <span key={c} className="flex items-end">
          {chunk.map((part, i) => (
            <span key={i} className="whitespace-pre">
              {anyChords && (
                <span className="block text-[0.72em] font-semibold leading-[1.1] text-(--color-chord)">
                  {part.chord ?? ' '}
                  {part.bass && <span className="ml-1 text-(--color-bass)">{part.bass}</span>}
                </span>
              )}
              <span className="block leading-[1.25]">{part.text}</span>
            </span>
          ))}
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
  // Block types and singers are stored in English — that is the file format — but this
  // heading sits directly above the words on a stage display, and a Romanian song with
  // an English "CHORUS" over it reads as someone else's software.
  const { blockName, singerName } = useT();
  const isCue = CUE_TYPES.has(block.type);
  const label = [
    blockName(block.type),
    block.label ? `— ${block.label}` : null,
    block.repeat ? `×${block.repeat}` : null,
    block.singers ? `· ${singerName(block.singers)}` : null,
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
