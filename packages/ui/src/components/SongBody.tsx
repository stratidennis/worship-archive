import { useMemo } from 'react';
import {
  chordForCapo,
  DEFAULT_SONG_LINE_HEIGHT,
  formatChord,
  parseChord,
  respellChord,
  semitonesBetween,
  transposeChord,
  type Block,
  type CueStyle,
  type AccidentalPreferences,
  type Line,
  type Song,
} from '@worship/core';
import { useT } from '../lib/i18n.js';
import { cueAppearance } from '../lib/cueAppearance.js';
import { LYRIC_INK } from '../lib/readingColors.js';

const INDENTED_TYPES = new Set(['Chorus', 'PreChorus', 'Bridge', 'Ending']);

export interface RenderOptions {
  showChords: boolean;
  showBass: boolean;
  /** Full, compact or minimal treatment for section labels and coloured cues. */
  cueStyle?: CueStyle;
  capo: number;
  /** Unitless lyric line-height multiplier. */
  lineHeight?: number;
  /** Extra semitones on top of the song's own written→performance shift. */
  transpose: number;
  /** When present, every enharmonic chord is displayed in this device's notation. */
  accidentalPreferences?: AccidentalPreferences;
}

/** The total shift applied to a song's chords, and the key that results. */
export function resolveKey(
  song: Song,
  extra: number,
): { semitones: number; key: string | null } {
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

/** Whether this line needs the small row above its lyric for a visible music layer. */
export function hasVisibleChordRow(
  line: Pick<Line, 'chords' | 'bass'>,
  options: Pick<RenderOptions, 'showChords' | 'showBass'>,
): boolean {
  return (
    (options.showChords && line.chords.length > 0) || (options.showBass && line.bass.length > 0)
  );
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
    if (options.accidentalPreferences) {
      token = respellChord(token, options.accidentalPreferences, targetKey);
    }
    return formatChord(token);
  };

  const anchors = new Map<number, { chord: string | null; bass: string | null }>();
  if (options.showChords) {
    for (const a of line.chords) {
      anchors.set(a.at, {
        ...(anchors.get(a.at) ?? { chord: null, bass: null }),
        chord: render(a.raw),
      });
    }
  }
  if (options.showBass) {
    for (const a of line.bass) {
      anchors.set(a.at, {
        ...(anchors.get(a.at) ?? { chord: null, bass: null }),
        bass: render(a.raw),
      });
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

export function singerInk(
  singer: Line['singers'],
  fallback?: string | null,
): string | undefined {
  if (!singer) return fallback ?? undefined;
  if (singer === 'Women') return 'var(--reading-Women, var(--color-singers-women))';
  if (singer === 'Men') return 'var(--reading-Men, var(--color-singers-men))';
  return `var(--reading-${singer}, ${fallback ?? 'inherit'})`;
}

function LineView({
  line,
  options,
  semitones,
  targetKey,
  fontScale,
  singers,
}: {
  line: Line;
  options: RenderOptions;
  semitones: number;
  targetKey: string | null;
  fontScale: number;
  singers: Block['singers'];
}) {
  const { singerName } = useT();
  const singer = line.singers ?? singers;
  const chunks = useMemo(
    () => chunksOf(line, options, semitones, targetKey),
    [line, options, semitones, targetKey],
  );

  if (line.text === '' && line.chords.length === 0 && line.bass.length === 0) {
    return <div style={{ height: '0.6em' }} />;
  }

  const showChordRow = hasVisibleChordRow(line, options);

  return (
    <div
      className="flex flex-wrap items-end"
      style={{
        paddingLeft: `${(line.indent ?? 0) * 1.5}em`,
        color: singerInk(singer, line.color),
      }}
    >
      {(singer === 'Women' || singer === 'Men') && (
        <span className="sr-only">{singerName(singer)}. </span>
      )}
      {chunks.map((chunk, c) => (
        <span key={c} className="flex items-end">
          {chunk.map((part, i) => (
            <span key={i} className="whitespace-pre">
              {showChordRow && (
                <span
                  data-song-font-scale={fontScale * 0.72}
                  className="block text-[0.72em] font-semibold leading-[1.1] reading-chord-ink"
                >
                  {part.chord ?? ' '}
                  {part.bass && (
                    <span className="ml-1 text-[color:var(--reading-bass,var(--color-bass))]">
                      {part.bass}
                    </span>
                  )}
                </span>
              )}
              <span
                data-song-font-scale={fontScale}
                className="block"
                style={{ lineHeight: options.lineHeight ?? DEFAULT_SONG_LINE_HEIGHT }}
              >
                {part.text}
              </span>
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
  const { blockName, singerName, t } = useT();
  const isIndented = INDENTED_TYPES.has(block.type);
  const cueStyle = options.cueStyle ?? 'full';
  const cue = cueAppearance(block.type, cueStyle);
  const label = block.label
    ? `${blockName(block.type)} — ${block.label}`
    : blockName(block.type);
  const repeat = block.repeat ?? 1;
  return (
    <section
      data-song-font-scale={cue?.fontScale ?? 1}
      className={`mb-[0.9em] rounded-md ${isIndented ? 'ml-[1.3em]' : ''} ${
        cue ? 'border-l px-[0.4em] py-[0.18em]' : ''
      }`}
      // Never let a block be split down the middle by a column break.
      style={{
        breakInside: 'avoid',
        color: LYRIC_INK,
        fontSize: cue ? `${cue.fontScale}em` : undefined,
        borderColor: cue ? `var(--reading-${block.type}-edge, ${cue.border})` : undefined,
        backgroundColor: `var(--reading-${block.type}, ${cue?.background ?? 'transparent'})`,
      }}
    >
      {cueStyle === 'full' && (
        <h2
          data-song-font-scale={(cue?.fontScale ?? 1) * 0.62}
          className="text-[0.62em] font-semibold uppercase tracking-wider text-[color:var(--reading-titles,var(--color-muted))]"
        >
          {label}
          {block.singers && block.singers !== 'Women' && block.singers !== 'Men' && (
            <span className="ml-1.5">· {singerName(block.singers)}</span>
          )}
        </h2>
      )}
      <div
        className={repeat > 1 ? 'flex w-fit max-w-full items-stretch gap-[0.4em]' : undefined}
      >
        <div className={repeat > 1 ? 'min-w-0 flex-1' : undefined}>
          {block.lines.map((line, i) => (
            <LineView
              key={i}
              line={line}
              singers={block.singers}
              options={options}
              semitones={semitones}
              targetKey={targetKey}
              fontScale={cue?.fontScale ?? 1}
            />
          ))}
        </div>
        {repeat > 1 && (
          <div className="flex shrink-0 items-stretch gap-[0.2em] pr-[0.15em] text-[color:var(--reading-repeats,var(--reading-lyrics,var(--color-stage-fg)))]">
            <span aria-hidden="true" className="my-[0.1em] w-[0.26em] border-y border-r" />
            <span className="sr-only">{t('song.repeatSection', { count: repeat })}</span>
            <span
              aria-hidden="true"
              data-song-font-scale={(cue?.fontScale ?? 1) * 0.75}
              className="self-center whitespace-nowrap text-[0.75em] font-semibold tabular-nums"
            >
              ×{repeat}
            </span>
          </div>
        )}
      </div>
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
    const blocks: Block[] = [];
    for (let i = 0; i < song.arrangement.length; i++) {
      const id = song.arrangement[i];
      const block = id ? byId.get(id) : undefined;
      if (!block) continue;
      let count = 1;
      while (song.arrangement[i + 1] === id) {
        i++;
        count++;
      }
      blocks.push(count > 1 ? { ...block, repeat: count } : block);
    }
    return blocks;
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
