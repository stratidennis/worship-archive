/**
 * Legacy SwiftTec `.song` XML → Song.
 *
 * The format, confirmed against all 153 real files:
 *
 * ```xml
 * <song xmlns="swifttec/song">
 * <uuid>…</uuid><updated>20241119205837</updated>
 * <info><title>…</title><key>Bb</key><defaulttranspose>0</defaulttranspose>…</info>
 * <block type="Verse" id="V1">
 *   <line singers="Leader">Eu Te iu<chord>G</chord>besc</line>
 * </block>
 * </song>
 * ```
 */

import {
  BLOCK_ID_PREFIX,
  SINGERS,
  cleanKeyName,
  emptyBlock,
  emptyLine,
  splitKeyPair,
  type Anchor,
  type Block,
  type BlockType,
  type Line,
  type Singers,
  type Song,
} from '@worship/core';
import { classifyMisc } from './misc-blocks.js';
import { decodeEntities, findElements, tagText } from './xml.js';

/** Legacy block type names → ours. `Misc` is resolved separately by {@link classifyMisc}. */
const LEGACY_TYPES: Record<string, BlockType> = {
  verse: 'Verse',
  chorus: 'Chorus',
  prechorus: 'PreChorus',
  bridge: 'Bridge',
  ending: 'Ending',
  tag: 'Tag',
  intro: 'Intro',
  instrumental: 'Instrumental',
  solo: 'Solo',
  misc: 'Note',
};

export interface ImportNote {
  kind:
    | 'key-change'
    | 'misc-classified'
    | 'arrangement-hint'
    | 'singers-hint'
    | 'unknown-block-type'
    | 'title-from-filename'
    | 'key-from-filename'
    | 'key-pair-in-key-field'
    | 'malformed-key';
  detail: string;
}

export interface ImportResult {
  song: Song;
  notes: ImportNote[];
}

function asSingers(value: string | undefined): Singers | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  // The old string table said "Ladies" where the menu said "Women".
  if (v === 'ladies') return 'Women';
  return SINGERS.find((s) => s.toLowerCase() === v) ?? null;
}

function asNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** `20241119205837` → ISO. */
function parseLegacyTimestamp(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

/**
 * Split `<line>` mixed content into plain text plus positioned chord anchors.
 *
 * `Eu Te iu<chord>G</chord>besc` → text `Eu Te iubesc`, chord `G` at index 8.
 */
export function parseLineContent(inner: string): { text: string; chords: Anchor[] } {
  const chords: Anchor[] = [];
  let text = '';
  let i = 0;

  while (i < inner.length) {
    const open = inner.indexOf('<', i);
    if (open === -1) {
      text += decodeEntities(inner.slice(i));
      break;
    }
    text += decodeEntities(inner.slice(i, open));

    const close = inner.indexOf('>', open);
    if (close === -1) {
      text += decodeEntities(inner.slice(open));
      break;
    }

    const tag = inner.slice(open + 1, close);
    const name = /^\/?\s*([\w:-]+)/.exec(tag)?.[1]?.toLowerCase();

    if (name === 'chord' && !tag.startsWith('/')) {
      const end = inner.indexOf('</chord>', close);
      if (end !== -1) {
        chords.push({ at: text.length, raw: decodeEntities(inner.slice(close + 1, end)) });
        i = end + '</chord>'.length;
        continue;
      }
    }
    if (name === 'br') text += '\n';
    i = close + 1;
  }
  return { text, chords };
}

export interface SongXmlOptions {
  /** Original filename, used to recover the written/performance keys. */
  filename?: string;
  makeId?: () => string;
  now?: string;
}

/** `C - Dumnezeu e dragostea mea - D.song` → written C, performance D, title in between. */
export function parseFilenameKeys(filename: string): {
  title: string | null;
  writtenKey: string | null;
  performanceKey: string | null;
} {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  const m = /^([A-Ga-g][#b]?m?)\s*-\s*(.+?)(?:\s*-\s*([A-Ga-g][#b]?m?))?$/.exec(base);
  if (!m) return { title: null, writtenKey: null, performanceKey: null };
  return {
    title: m[2]?.trim() ?? null,
    writtenKey: cleanKeyName(m[1]!),
    performanceKey: m[3] ? cleanKeyName(m[3]) : null,
  };
}

/**
 * Import one legacy `.song` file.
 *
 * Nothing is discarded: unrecognised block types become Notes, malformed keys are kept
 * verbatim, and every interpretation is recorded in `notes` for the migration report.
 */
export function importSongXml(source: string, options: SongXmlOptions = {}): ImportResult {
  const now = options.now ?? new Date().toISOString();
  const makeId = options.makeId ?? (() => crypto.randomUUID());
  const notes: ImportNote[] = [];

  const legacyUuid = tagText(source, 'uuid')?.trim() || null;
  const updated = parseLegacyTimestamp(tagText(source, 'updated')) ?? now;
  const infoMatch = /<info>([\s\S]*?)<\/info>/i.exec(source);
  const info = infoMatch?.[1] ?? '';

  const rawKey = (tagText(info, 'key') ?? '').trim();
  let writtenKey: string | null = null;
  let performanceKey: string | null = null;

  const pair = rawKey ? splitKeyPair(rawKey) : null;
  if (pair) {
    // `C-D` and `G - A` are a written/performance pair crammed into one field.
    writtenKey = pair.written;
    performanceKey = pair.performance;
    notes.push({
      kind: 'key-pair-in-key-field',
      detail: `key field "${rawKey}" read as written ${pair.written} → performance ${pair.performance}`,
    });
  } else if (rawKey) {
    writtenKey = cleanKeyName(rawKey);
    if (writtenKey === null) {
      notes.push({
        kind: 'malformed-key',
        detail: `key "${rawKey}" is not a key; kept as written`,
      });
    }
  }

  const song: Song = {
    id: '',
    legacyUuid,
    title: (tagText(info, 'title') ?? '').trim(),
    writtenKey,
    performanceKey,
    tempo: asNumber(tagText(info, 'tempo')),
    timeSignature: (tagText(info, 'timesignature') ?? '').trim() || null,
    authors: [],
    copyright: (tagText(info, 'copyright') ?? '').trim() || null,
    ccli: (tagText(info, 'cclinumber') ?? '').trim() || null,
    tags: [],
    collectionIds: [],
    blocks: [],
    arrangement: null,
    lang: null,
    createdAt: updated,
    updatedAt: updated,
    rev: 0,
  };

  const author = (tagText(info, 'author') ?? '').trim();
  if (author) song.authors.push(author);
  const category = (tagText(info, 'category') ?? '').trim();
  if (category) song.tags.push(category);

  // Filename keys and title.
  if (options.filename) {
    const fromName = parseFilenameKeys(options.filename);
    if (!song.title) {
      // Fall back to the filename stem even when it carries no key prefix — a song
      // with no title at all is unfindable, which is worse than a slightly untidy one.
      const fallback = fromName.title ?? options.filename.replace(/\.[^.]+$/, '').trim() ?? '';
      if (fallback) {
        song.title = fallback;
        notes.push({ kind: 'title-from-filename', detail: `title taken from the filename` });
      }
    }
    if (fromName.performanceKey && !song.performanceKey) {
      song.performanceKey = fromName.performanceKey;
      notes.push({
        kind: 'key-from-filename',
        detail: `performance key ${fromName.performanceKey} taken from the filename suffix`,
      });
    } else if (
      fromName.writtenKey &&
      !song.performanceKey &&
      song.writtenKey &&
      fromName.writtenKey !== song.writtenKey
    ) {
      // Prefix disagrees with <key>: the prefix is how the band files it, so it is the
      // key they perform in.
      song.performanceKey = fromName.writtenKey;
      notes.push({
        kind: 'key-from-filename',
        detail: `filename prefix ${fromName.writtenKey} differs from key ${song.writtenKey}; read as the performance key`,
      });
    }
  }

  // Blocks.
  const counters = new Map<string, number>();
  const nextId = (type: BlockType): string => {
    const prefix = BLOCK_ID_PREFIX[type];
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}${n}`;
  };

  let pendingSingers: Singers | null = null;
  const arrangementHints: string[][] = [];

  for (const el of findElements(source, 'block')) {
    const attrs = el.attrs;
    const legacyType = (attrs['type'] ?? '').toLowerCase();
    let type = LEGACY_TYPES[legacyType];
    if (!type) {
      type = 'Note';
      if (legacyType) {
        notes.push({
          kind: 'unknown-block-type',
          detail: `block type "${attrs['type']}" not recognised; kept as a Note`,
        });
      }
    }

    const lineEls = findElements(el.inner, 'line');
    const rawTexts = lineEls.map((l) => parseLineContent(l.inner).text);

    let label: string | null = null;
    let lineFilter: ((index: number) => boolean) | null = null;

    if (legacyType === 'misc') {
      const c = classifyMisc(rawTexts);
      type = c.type;
      label = c.label;

      if (c.keyChange) {
        const written = cleanKeyName(c.keyChange.written);
        const performance = cleanKeyName(c.keyChange.performance);
        // An explicit `TRANSPOSE: G+3 => Bb` wins over the <key> field. It states both
        // keys unambiguously, whereas <key> holds sometimes one and sometimes the other
        // — in this library it is usually the key they perform in, not the one the
        // chords are written in.
        if (written) song.writtenKey = written;
        if (performance) song.performanceKey = performance;
        notes.push({
          kind: 'key-change',
          detail: `"${rawTexts.join(' / ')}" → written ${written ?? '?'} → performance ${performance ?? '?'}`,
        });
      }
      if (c.arrangementHint) {
        arrangementHints.push(c.arrangementHint);
        notes.push({
          kind: 'arrangement-hint',
          detail: `suggested arrangement: ${c.arrangementHint.join(' ')}`,
        });
      }
      if (c.singersHint) {
        pendingSingers = c.singersHint;
        notes.push({
          kind: 'singers-hint',
          detail: `"${rawTexts.join(' ')}" → singers ${c.singersHint}`,
        });
      }
      if (c.reason !== 'kept as a note') {
        notes.push({ kind: 'misc-classified', detail: `${c.reason} → ${type}` });
      }
      if (c.redundant) continue;

      const keep = new Set(c.lines);
      lineFilter = (i) => keep.has(rawTexts[i] ?? '');
    }

    const id = (attrs['id'] ?? '').trim() || nextId(type);
    const m = /^([A-Z])(\d+)$/.exec(id);
    if (m) {
      const prefix = m[1]!;
      counters.set(prefix, Math.max(counters.get(prefix) ?? 0, Number(m[2])));
    }

    const block: Block = emptyBlock(id, type);
    block.label = label;
    block.singers = asSingers(attrs['singers']) ?? pendingSingers;
    pendingSingers = null;
    block.repeat = asNumber(attrs['repeat']);

    lineEls.forEach((lineEl, index) => {
      if (lineFilter && !lineFilter(index)) return;
      const { text, chords } = parseLineContent(lineEl.inner);
      const line: Line = emptyLine(text);
      line.chords = chords;
      line.singers = asSingers(lineEl.attrs['singers']);
      line.indent = asNumber(lineEl.attrs['indent']);
      block.lines.push(line);
    });

    if (block.lines.length > 0) song.blocks.push(block);
  }

  // Only adopt an arrangement when exactly one was found and every id exists.
  if (arrangementHints.length === 1) {
    const hint = arrangementHints[0]!;
    const known = new Set(song.blocks.map((b) => b.id));
    if (hint.every((id) => known.has(id))) song.arrangement = hint;
  }

  song.id = makeId();
  return { song, notes };
}
