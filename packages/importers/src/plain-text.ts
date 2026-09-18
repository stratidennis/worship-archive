/**
 * Importing chords-over-lyrics text.
 *
 * This is the format the internet is written in: a line of chords, then the line of
 * words it sits above, aligned by spaces in a monospace font. It is not a format so
 * much as a convention, so this importer is built to **fail visibly rather than guess**.
 * A line becomes a chord line only if *every* token on it parses as a chord; one
 * unparseable token and the line is treated as lyrics, which is the recoverable
 * mistake. The other direction — swallowing a lyric line as chords — deletes words.
 *
 * ```
 * Verse 1
 * G          C        G
 * Amazing grace how sweet the sound
 * ```
 */

import {
  BLOCK_ID_PREFIX,
  emptyBlock,
  emptyLine,
  parseChord,
  type Anchor,
  type Block,
  type BlockType,
  type Line,
  type Song,
} from '@worship/core';

export interface TextImportOptions {
  /** Used for the title when the text carries none. */
  filename?: string | undefined;
  /** Overrides any title found in the text. */
  title?: string | undefined;
  id?: string | undefined;
  now?: string | undefined;
}

/** `Verse 1`, `Chorus:`, `[Bridge]`, `Pre-Chorus 2`, `Refren`, `Strofa 1`. */
const SECTION_RE =
  /^\s*\[?\s*(verse|chorus|refrain|bridge|pre[\s-]?chorus|intro|outro|ending|tag|instrumental|interlude|solo|coda|vamp|strofa|strofă|refren|pod|final|introducere)\s*([0-9]*)\s*\]?\s*:?\s*$/i;

const SECTION_TYPES: Record<string, BlockType> = {
  verse: 'Verse',
  strofa: 'Verse',
  strofă: 'Verse',
  chorus: 'Chorus',
  refrain: 'Chorus',
  refren: 'Chorus',
  bridge: 'Bridge',
  pod: 'Bridge',
  'pre-chorus': 'PreChorus',
  prechorus: 'PreChorus',
  'pre chorus': 'PreChorus',
  intro: 'Intro',
  introducere: 'Intro',
  outro: 'Ending',
  ending: 'Ending',
  final: 'Ending',
  coda: 'Ending',
  tag: 'Tag',
  instrumental: 'Instrumental',
  interlude: 'Instrumental',
  vamp: 'Instrumental',
  solo: 'Solo',
};

/**
 * Is this line chords rather than words?
 *
 * Every token must parse, and there must be at least one. `parseChord` returning
 * `unparsed` for a single token is enough to reject the whole line — see the module
 * comment for why that asymmetry is deliberate.
 */
export function looksLikeChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  // Words happen to be chords surprisingly often ("A", "Am", "Do", "Be"), so a single
  // short token on its own is not enough to call a line chords.
  if (tokens.length === 1 && line.trim().length <= 2 && !/[#b/]/.test(line)) return false;
  return tokens.every((token) => {
    // A trailing repeat marker is common and is not part of the chord.
    const cleaned = token.replace(/^\(|\)$/g, '').replace(/^x\d+$/i, '');
    if (cleaned === '' || /^x\d+$/i.test(token) || /^[|/]+$/.test(token)) return true;
    return parseChord(cleaned).kind !== 'unparsed';
  });
}

/**
 * Attach a chord line to the lyric line below it.
 *
 * Column position is the whole meaning here: the chord lands at the character index it
 * was drawn over. When the lyric line is shorter than the chord line — the usual case
 * for a trailing chord — the anchor is clamped to the end rather than dropped.
 */
export function anchorsFromChordLine(chordLine: string, lyric: string): Anchor[] {
  const anchors: Anchor[] = [];
  for (const match of chordLine.matchAll(/\S+/g)) {
    const raw = match[0];
    if (/^[|/]+$/.test(raw)) continue;
    anchors.push({ at: Math.min(match.index, lyric.length), raw });
  }
  return anchors;
}

function sectionOf(line: string): { type: BlockType; label: string | null } | null {
  const match = SECTION_RE.exec(line);
  if (!match) return null;
  const name = (match[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
  const type = SECTION_TYPES[name] ?? SECTION_TYPES[name.replace(/\s/g, '-')] ?? 'Verse';
  return { type, label: null };
}

/** `{title: X}` / `Title: X` at the top, before any lyrics. */
function headerValue(line: string, keys: string[]): string | null {
  const match = /^\s*([A-Za-z_ ]+)\s*[:=]\s*(.+?)\s*$/.exec(line);
  if (!match) return null;
  const key = (match[1] ?? '').trim().toLowerCase();
  return keys.includes(key) ? (match[2] ?? '').trim() : null;
}

export function importPlainText(source: string, options: TextImportOptions = {}): Song {
  const now = options.now ?? new Date().toISOString();
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');

  let title = options.title ?? null;
  let key: string | null = null;
  let tempo: number | null = null;
  let authors: string[] = [];

  // Headers only count before any content — "Key: G" halfway down is a lyric.
  let cursor = 0;
  let seenContent = false;
  for (; cursor < rawLines.length && !seenContent; cursor++) {
    const line = rawLines[cursor] ?? '';
    if (line.trim() === '') continue;
    const titleValue = headerValue(line, ['title', 'titlu', 'song']);
    const keyValue = headerValue(line, ['key', 'gama', 'tonalitate']);
    const tempoValue = headerValue(line, ['tempo', 'bpm']);
    const authorValue = headerValue(line, ['author', 'authors', 'artist', 'by', 'autor']);
    if (titleValue !== null) {
      if (title === null) title = titleValue;
      continue;
    }
    if (keyValue !== null) {
      key = keyValue;
      continue;
    }
    if (tempoValue !== null) {
      const n = Number(tempoValue);
      if (Number.isFinite(n)) tempo = n;
      continue;
    }
    if (authorValue !== null) {
      authors = authorValue.split(/\s*[,;/]\s*/).filter(Boolean);
      continue;
    }
    // The first non-header line: a bare first line is conventionally the title, but only
    // if it is not already a section heading or a chord line.
    if (title === null && !sectionOf(line) && !looksLikeChordLine(line)) {
      title = line.trim();
      continue;
    }
    // `break` skips the loop's own increment, so `cursor` already points at this line.
    seenContent = true;
    break;
  }

  const blocks: Block[] = [];
  const counters = new Map<BlockType, number>();
  let current: Block | null = null;

  const startBlock = (type: BlockType, label: string | null): Block => {
    const n = (counters.get(type) ?? 0) + 1;
    counters.set(type, n);
    const block = emptyBlock(`${BLOCK_ID_PREFIX[type]}${n}`, type);
    block.label = label;
    blocks.push(block);
    return block;
  };

  const push = (line: Line): void => {
    current ??= startBlock('Verse', null);
    current.lines.push(line);
  };

  for (let i = Math.max(cursor, 0); i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';

    if (line.trim() === '') {
      // A blank line ends the block, so the next one starts fresh rather than running on.
      if (current && current.lines.length > 0) current = null;
      continue;
    }

    const section = sectionOf(line);
    if (section) {
      current = startBlock(section.type, section.label);
      continue;
    }

    if (looksLikeChordLine(line)) {
      const next = rawLines[i + 1] ?? '';
      // Chords above words: consume both. Chords alone (an intro riff, a turnaround):
      // keep them on an empty lyric line so they still render.
      const hasLyric = next.trim() !== '' && !looksLikeChordLine(next) && !sectionOf(next);
      const lyric = hasLyric ? next.replace(/\s+$/, '') : '';
      push({ ...emptyLine(lyric), chords: anchorsFromChordLine(line, lyric) });
      if (hasLyric) i++;
      continue;
    }

    push(emptyLine(line.replace(/\s+$/, '')));
  }

  const fallbackTitle = options.filename
    ? options.filename
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim()
    : '';

  return {
    id: options.id ?? crypto.randomUUID(),
    legacyUuid: null,
    title: (title ?? '').trim() || fallbackTitle || 'Fără titlu',
    writtenKey: key,
    performanceKey: null,
    tempo,
    timeSignature: null,
    authors,
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: blocks.filter((b) => b.lines.length > 0),
    arrangement: null,
    lang: null,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };
}
