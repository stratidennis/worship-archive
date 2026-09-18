/**
 * ChordPro → Song.
 *
 * Deliberately lenient. It has to read two quite different things:
 *
 *  - files this app wrote, with full fidelity including our `x_` extensions
 *  - arbitrary ChordPro found on the internet or exported from another app, which may
 *    use short aliases, omit environments entirely, or put chords in odd places
 *
 * Anything it cannot interpret is preserved rather than dropped.
 */

import {
  BLOCK_ID_PREFIX,
  SINGERS,
  emptyBlock,
  emptyLine,
  type Anchor,
  type Block,
  type BlockType,
  type Line,
  type Singers,
  type Song,
} from '../types.js';
import { DIRECTIVE_ALIASES, ENVIRONMENT_BLOCKS, unescapeLyric } from './directives.js';

const DIRECTIVE_RE = /^\s*\{\s*([a-zA-Z_][\w]*)\s*(?::\s*([\s\S]*?))?\s*\}\s*$/;

function asSingers(value: string | null): Singers | null {
  if (!value) return null;
  const found = SINGERS.find((s) => s.toLowerCase() === value.trim().toLowerCase());
  return found ?? null;
}

function asNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a lyric line into plain text plus positioned chord anchors.
 *
 * `Eu Te iu[G]besc` becomes `{ text: 'Eu Te iubesc', chords: [{ at: 8, raw: 'G' }] }`.
 * A backslash escapes a literal bracket.
 */
export function splitChords(source: string): { text: string; chords: Anchor[] } {
  let text = '';
  const chords: Anchor[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\' && i + 1 < source.length) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '[') {
      const close = source.indexOf(']', i + 1);
      if (close !== -1) {
        chords.push({ at: text.length, raw: source.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  return { text, chords };
}

/** Parse `4:G 11:D` into bass anchors. */
function parseBass(value: string | null): Anchor[] {
  if (!value) return [];
  const out: Anchor[] = [];
  for (const part of value.trim().split(/\s+/)) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const at = Number(part.slice(0, idx));
    const raw = part.slice(idx + 1);
    if (Number.isFinite(at) && raw) out.push({ at, raw });
  }
  return out;
}

interface PendingLine {
  singers: Singers | null;
  indent: number | null;
  color: string | null;
  bass: Anchor[];
}

function freshPending(): PendingLine {
  return { singers: null, indent: null, color: null, bass: [] };
}

interface PendingBlock {
  type: BlockType | null;
  id: string | null;
  label: string | null;
  singers: Singers | null;
  repeat: number | null;
  linkToPrevious: boolean;
  bandOnly: boolean;
}

function freshBlock(): PendingBlock {
  return {
    type: null,
    id: null,
    label: null,
    singers: null,
    repeat: null,
    linkToPrevious: false,
    bandOnly: false,
  };
}

export interface ParseOptions {
  /** Used for `id`, `createdAt` and `updatedAt` when the file carries none. */
  now?: string;
  /** Supplies an id when the file has no `{x_id:}`. */
  makeId?: () => string;
}

/**
 * Parse ChordPro text into a Song.
 *
 * Never throws. A file with no directives at all still yields a song with one block
 * per blank-line-separated group, which is what generic ChordPro from the web looks like.
 */
export function parseChordPro(source: string, options: ParseOptions = {}): Song {
  const now = options.now ?? new Date().toISOString();
  const makeId = options.makeId ?? (() => crypto.randomUUID());

  const song: Song = {
    id: '',
    legacyUuid: null,
    title: '',
    writtenKey: null,
    performanceKey: null,
    tempo: null,
    timeSignature: null,
    authors: [],
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: [],
    arrangement: null,
    lang: null,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  const counters = new Map<string, number>();
  const nextBlockId = (type: BlockType): string => {
    const prefix = BLOCK_ID_PREFIX[type];
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}${n}`;
  };

  let current: Block | null = null;
  let pendingBlock = freshBlock();
  let pendingLine = freshPending();
  /**
   * True between `{start_of_*}` and `{end_of_*}`.
   *
   * Inside an explicit environment a blank line is a real empty lyric line — spacing
   * the author put there deliberately. Outside one it separates implicit blocks, which
   * is how generic ChordPro from the web is written. Conflating the two silently
   * deletes blank lines on every save.
   */
  let inEnvironment = false;

  const openBlock = (type: BlockType, idHint: string | null): void => {
    closeBlock();
    const id = pendingBlock.id ?? idHint ?? nextBlockId(type);
    // Keep generated ids ahead of any explicit ones, so a later auto id cannot collide.
    const m = /^([A-Z])(\d+)$/.exec(id);
    if (m) {
      const prefix = m[1]!;
      counters.set(prefix, Math.max(counters.get(prefix) ?? 0, Number(m[2])));
    }
    const block = emptyBlock(id, pendingBlock.type ?? type);
    block.label = pendingBlock.label;
    block.singers = pendingBlock.singers;
    block.repeat = pendingBlock.repeat;
    block.linkToPrevious = pendingBlock.linkToPrevious;
    block.bandOnly = pendingBlock.bandOnly;
    pendingBlock = freshBlock();
    current = block;
  };

  const closeBlock = (): void => {
    if (current && current.lines.some((l) => l.text !== '' || l.chords.length > 0)) {
      song.blocks.push(current);
    }
    current = null;
  };

  const addLine = (raw: string): void => {
    if (!current) openBlock('Verse', null);
    const { text, chords } = splitChords(raw);
    const line: Line = emptyLine(unescapeLyric(text));
    line.chords = chords;
    line.bass = pendingLine.bass;
    line.singers = pendingLine.singers;
    line.indent = pendingLine.indent;
    line.color = pendingLine.color;
    pendingLine = freshPending();
    current!.lines.push(line);
  };

  for (const rawLine of source.split(/\r\n|\r|\n/)) {
    const directive = DIRECTIVE_RE.exec(rawLine);

    if (!directive) {
      if (rawLine.trim() === '') {
        if (inEnvironment) {
          addLine('');
          continue;
        }
        // Outside an environment a blank line ends an implicit block. Repeated blank
        // lines are harmless: closeBlock discards anything with no content.
        closeBlock();
        continue;
      }
      if (rawLine.trimStart().startsWith('#')) continue; // comment
      addLine(rawLine);
      continue;
    }

    const nameRaw = directive[1]!.toLowerCase();
    const name = DIRECTIVE_ALIASES[nameRaw] ?? nameRaw;
    const value = directive[2] ?? null;

    switch (name) {
      case 'title':
        song.title = value ?? '';
        break;
      case 'artist':
      case 'composer':
      case 'lyricist':
        if (value) song.authors.push(value);
        break;
      case 'key':
        song.writtenKey = value;
        break;
      case 'tempo':
        song.tempo = asNumber(value);
        break;
      case 'time':
        song.timeSignature = value;
        break;
      case 'copyright':
        song.copyright = value;
        break;
      case 'ccli':
        song.ccli = value;
        break;
      case 'lang':
        song.lang = value;
        break;

      // ---- our extensions -------------------------------------------------
      case 'x_id':
        song.id = value ?? '';
        break;
      case 'x_legacy_uuid':
        song.legacyUuid = value;
        break;
      case 'x_performance_key':
        song.performanceKey = value;
        break;
      case 'x_tags':
        song.tags = (value ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case 'x_collections':
        song.collectionIds = (value ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case 'x_arrangement':
        song.arrangement = (value ?? '').trim() ? (value ?? '').trim().split(/\s+/) : null;
        break;
      case 'x_created':
        if (value) song.createdAt = value;
        break;
      case 'x_updated':
        if (value) song.updatedAt = value;
        break;
      case 'x_rev':
        song.rev = asNumber(value) ?? 0;
        break;

      // block-level, applied to the next start_of_*
      case 'x_type': {
        const t = value?.trim();
        if (t && t in BLOCK_ID_PREFIX) pendingBlock.type = t as BlockType;
        break;
      }
      case 'x_block_id':
        pendingBlock.id = value;
        break;
      case 'x_label':
        pendingBlock.label = value;
        break;
      case 'x_repeat':
        pendingBlock.repeat = asNumber(value);
        break;
      case 'x_link_prev':
        pendingBlock.linkToPrevious = true;
        break;
      case 'x_band_only':
        pendingBlock.bandOnly = true;
        break;
      case 'x_block_singers':
        pendingBlock.singers = asSingers(value);
        break;

      // line-level, applied to the next lyric line
      case 'x_singers':
        pendingLine.singers = asSingers(value);
        break;
      case 'x_indent':
        pendingLine.indent = asNumber(value);
        break;
      case 'x_color':
        pendingLine.color = value;
        break;
      case 'x_bass':
        pendingLine.bass = parseBass(value);
        break;

      default: {
        if (name.startsWith('start_of_')) {
          const env = name.slice('start_of_'.length);
          openBlock(ENVIRONMENT_BLOCKS[env] ?? 'Verse', value?.trim() || null);
          inEnvironment = true;
        } else if (name.startsWith('end_of_')) {
          closeBlock();
          inEnvironment = false;
        } else if (name === 'comment' || name === 'comment_italic' || name === 'comment_box') {
          // A standalone comment becomes a Note block — that is what it means.
          closeBlock();
          const note = emptyBlock(nextBlockId('Note'), 'Note');
          note.lines.push(emptyLine(value ?? ''));
          song.blocks.push(note);
        }
        // Unknown directives are ignored, per the ChordPro spec.
        break;
      }
    }
  }
  closeBlock();

  if (!song.id) song.id = makeId();
  return song;
}
