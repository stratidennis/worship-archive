/**
 * Import the loose text format used by lyrics websites and shared documents.
 *
 * The parser is deliberately contextual. A row containing `C` could be a chord row,
 * but it could also be a lyric. Multiple chords, indentation, neighbouring chord rows,
 * section markers and the following lyric provide enough evidence to make that choice
 * without silently eating ordinary words.
 */

import {
  BLOCK_ID_PREFIX,
  emptyBlock,
  emptyLine,
  multiplierValue,
  parseChord,
  REPEAT_MULTIPLIER,
  type Anchor,
  type Block,
  type BlockType,
  type Line,
  type Song,
} from '@worship/core';

export interface TextImportOptions {
  /** Used for the title when the text carries none. */
  filename?: string | undefined;
  /** Overrides any title found in the text. An empty string is still an override. */
  title?: string | undefined;
  id?: string | undefined;
  now?: string | undefined;
}

export interface TextImportWarning {
  kind: 'ambiguous-chord-line' | 'unpaired-repeat-marker';
  line: number;
  text: string;
}

export interface TextImportAnalysis {
  song: Song;
  warnings: TextImportWarning[];
}

interface SourceLine {
  text: string;
  line: number;
}

interface Section {
  type: BlockType;
  number: number | null;
}

interface Group {
  section: Section | null;
  rows: SourceLine[];
}

interface ChordToken {
  at: number;
  raw: string;
}

interface ParsedLine {
  source: SourceLine;
  chordLine: SourceLine | null;
  tokens: ChordToken[];
}

/** `Verse 1`, `Chorus:`, `[Bridge]`, `Refren`, `Strofa 1`. */
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

const NUMBERED_VERSE_RE = /^\s*(\d{1,2})\s*[-.):]\s*(\S[\s\S]*)$/;
const INLINE_CHORUS_RE = /^\s*(?:r|ref|refren|refrain|chorus)\s*[-:.)]\s*/i;
const REPEAT_OPEN = /^(\/:|\|\|:|𝄆|%)\s*/u;
const REPEAT_CLOSE = new RegExp(
  String.raw`(?:[ \t]*)(:[ \t]*[/\\]|:\|\||𝄇|(?<!\d)%)(?:[ \t]*(${REPEAT_MULTIPLIER}))?[ \t]*$`,
  'iu',
);
const TEXT_REPEAT_COUNT = new RegExp(
  String.raw`(?:[ \t]+|(?=\())(${REPEAT_MULTIPLIER})[ \t]*$`,
  'i',
);
const STRUCTURAL_TOKEN_RE = /^(?:[|/]+|\/:|:\/|%|[x×]\s*\d+)$/i;

function expandTabs(value: string, size = 4): string {
  let column = 0;
  let out = '';
  for (const character of value) {
    if (character === '\t') {
      const spaces = size - (column % size);
      out += ' '.repeat(spaces);
      column += spaces;
    } else {
      out += character;
      column++;
    }
  }
  return out;
}

function normaliseLines(source: string): SourceLine[] {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((text, index) => ({ text: expandTabs(text).replace(/\s+$/, ''), line: index + 1 }));
  while (lines[0]?.text.trim() === '') lines.shift();
  while (lines.at(-1)?.text.trim() === '') lines.pop();
  const indents = lines
    .filter((line) => line.text.trim() !== '')
    .map((line) => /^ */.exec(line.text)?.[0].length ?? 0);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return commonIndent > 0
    ? lines.map((line) => ({ ...line, text: line.text.slice(commonIndent) }))
    : lines;
}

function cleanChordToken(token: string): string | null {
  if (STRUCTURAL_TOKEN_RE.test(token)) return null;
  const cleaned = token.replace(/^[([{]+/, '').replace(/[\])},;]+$/, '');
  return cleaned && parseChord(cleaned).kind !== 'unparsed' ? cleaned : null;
}

function chordTokens(line: string): ChordToken[] | null {
  const matches = [...line.matchAll(/\S+/g)];
  if (matches.length === 0) return null;
  const tokens: ChordToken[] = [];
  for (const match of matches) {
    const token = match[0];
    if (STRUCTURAL_TOKEN_RE.test(token)) continue;
    const raw = cleanChordToken(token);
    if (!raw) return null;
    tokens.push({ at: match.index, raw });
  }
  return tokens.length > 0 ? tokens : null;
}

/**
 * Conservative standalone chord-row test retained for callers that do not have the
 * surrounding document. The full importer can recognise ambiguous single chords from
 * context as well.
 */
export function looksLikeChordLine(line: string): boolean {
  const tokens = chordTokens(line);
  if (!tokens) return false;
  if (tokens.length > 1) return true;
  const raw = tokens[0]!.raw;
  return line.length > line.trimStart().length || !/^[A-G]$/i.test(raw);
}

/** Attach already validated chord tokens to their source columns. */
export function anchorsFromChordLine(chordLine: string, lyric: string): Anchor[] {
  return (chordTokens(chordLine) ?? []).map((token) => ({
    at: Math.min(token.at, lyric.length),
    raw: token.raw,
  }));
}

function sectionOf(line: string): Section | null {
  const match = SECTION_RE.exec(line);
  if (!match) return null;
  const name = (match[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
  const type = SECTION_TYPES[name] ?? SECTION_TYPES[name.replace(/\s/g, '-')] ?? 'Verse';
  const number = match[2] ? Number(match[2]) : null;
  return { type, number };
}

function beginsInlineSection(line: string): boolean {
  return NUMBERED_VERSE_RE.test(line) || INLINE_CHORUS_RE.test(line);
}

/** `{title: X}` / `Title: X` at the top, before any lyrics. */
function headerValue(line: string, keys: string[]): string | null {
  const match = /^\s*([A-Za-z_ ]+)\s*[:=]\s*(.+?)\s*$/.exec(line);
  if (!match) return null;
  const key = (match[1] ?? '').trim().toLowerCase();
  return keys.includes(key) ? (match[2] ?? '').trim() : null;
}

function sourceHasStrongChordRows(lines: SourceLine[]): boolean {
  return lines.some((line) => (chordTokens(line.text)?.length ?? 0) > 1);
}

function singleChordPairCount(lines: SourceLine[]): number {
  let count = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const tokens = chordTokens(lines[i]!.text);
    const next = lines[i + 1]!;
    if (
      tokens?.length === 1 &&
      next.text.trim() !== '' &&
      !chordTokens(next.text) &&
      !sectionOf(next.text)
    ) {
      count++;
    }
  }
  return count;
}

function isChordRow(
  lines: SourceLine[],
  index: number,
  strongDocument: boolean,
  repeatedSingles: boolean,
  section: Section | null,
): boolean {
  const row = lines[index];
  const tokens = row ? chordTokens(row.text) : null;
  if (!row || !tokens) return false;
  if (tokens.length > 1) return true;
  const next = lines[index + 1];
  const hasFollowingLyric =
    Boolean(next?.text.trim()) && !chordTokens(next!.text) && !sectionOf(next!.text);
  if (!hasFollowingLyric) return section !== null && section.type !== 'Verse';
  const raw = tokens[0]!.raw;
  return (
    strongDocument ||
    repeatedSingles ||
    row.text.length > row.text.trimStart().length ||
    !/^[A-G]$/i.test(raw)
  );
}

function groupsFrom(lines: SourceLine[]): Group[] {
  const groups: Group[] = [];
  let rows: SourceLine[] = [];
  let section: Section | null = null;
  let pendingSection: Section | null = null;

  const flush = (): void => {
    if (rows.length > 0) groups.push({ section, rows });
    rows = [];
    section = null;
  };

  for (const row of lines) {
    const heading = sectionOf(row.text);
    if (heading) {
      flush();
      pendingSection = heading;
      continue;
    }
    if (row.text.trim() === '') {
      flush();
      continue;
    }
    if (rows.length > 0 && beginsInlineSection(row.text)) flush();
    if (rows.length === 0) {
      section = pendingSection;
      pendingSection = null;
    }
    rows.push(row);
  }
  flush();
  return groups;
}

function parsedLines(
  group: Group,
  strongDocument: boolean,
  repeatedSingles: boolean,
  warnings: TextImportWarning[],
): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (let i = 0; i < group.rows.length; i++) {
    const row = group.rows[i]!;
    const tokens = chordTokens(row.text);
    if (tokens && isChordRow(group.rows, i, strongDocument, repeatedSingles, group.section)) {
      const next = group.rows[i + 1];
      const nextIsChord = next
        ? isChordRow(group.rows, i + 1, strongDocument, repeatedSingles, group.section)
        : false;
      if (next && next.text.trim() !== '' && !nextIsChord && !sectionOf(next.text)) {
        lines.push({ source: next, chordLine: row, tokens });
        i++;
      } else {
        lines.push({ source: { text: '', line: row.line }, chordLine: row, tokens });
      }
      continue;
    }
    if (tokens?.length === 1 && group.rows[i + 1]?.text.trim()) {
      warnings.push({ kind: 'ambiguous-chord-line', line: row.line, text: row.text.trim() });
    }
    lines.push({ source: row, chordLine: null, tokens: [] });
  }
  return lines;
}

function removePrefix(
  value: string,
  expression: RegExp,
): { text: string; removed: number; matched: boolean; match: RegExpExecArray | null } {
  const match = expression.exec(value);
  if (!match) return { text: value, removed: 0, matched: false, match: null };
  return {
    text: value.slice(match[0].length),
    removed: match[0].length,
    matched: true,
    match,
  };
}

function nextBlockId(
  type: BlockType,
  wanted: number | null,
  counters: Map<BlockType, number>,
  used: Set<string>,
): string {
  const prefix = BLOCK_ID_PREFIX[type];
  if (wanted && wanted > 0) {
    const preferred = `${prefix}${wanted}`;
    if (!used.has(preferred)) {
      used.add(preferred);
      counters.set(type, Math.max(counters.get(type) ?? 0, wanted));
      return preferred;
    }
  }
  let number = (counters.get(type) ?? 0) + 1;
  while (used.has(`${prefix}${number}`)) number++;
  counters.set(type, number);
  const id = `${prefix}${number}`;
  used.add(id);
  return id;
}

function blockFromGroup(
  group: Group,
  strongDocument: boolean,
  repeatedSingles: boolean,
  counters: Map<BlockType, number>,
  used: Set<string>,
  warnings: TextImportWarning[],
): Block | null {
  const parsed = parsedLines(group, strongDocument, repeatedSingles, warnings);
  const lyricIndices = parsed
    .map((line, index) => (line.source.text.trim() !== '' ? index : -1))
    .filter((index) => index >= 0);
  const firstIndex = lyricIndices[0] ?? -1;
  const lastIndex = lyricIndices.at(-1) ?? -1;

  let type = group.section?.type ?? 'Verse';
  let wantedNumber = group.section?.number ?? null;
  let repeat: number | null = null;

  const lines: Line[] = parsed.map((parsedLine, index) => {
    let text = parsedLine.source.text;
    let removed = 0;
    const whitespace = removePrefix(text, /^\s+/);
    text = whitespace.text;
    removed += whitespace.removed;

    if (index === firstIndex) {
      const numbered = removePrefix(text, /^(\d{1,2})\s*[-.):]\s*/);
      if (numbered.matched) {
        type = 'Verse';
        wantedNumber = Number(numbered.match?.[1] ?? 0) || wantedNumber;
        text = numbered.text;
        removed += numbered.removed;
      } else {
        const chorus = removePrefix(text, INLINE_CHORUS_RE);
        if (chorus.matched) {
          type = 'Chorus';
          text = chorus.text;
          removed += chorus.removed;
        }
      }
    }

    const line = emptyLine(text);
    line.chords = parsedLine.tokens.map((token) => ({
      at: Math.max(0, Math.min(token.at - removed, text.length)),
      raw: token.raw,
    }));
    return line;
  });

  const first = lines[firstIndex];
  const last = lines[lastIndex];
  if (first && last) {
    const opening = REPEAT_OPEN.exec(first.text);
    const closing = REPEAT_CLOSE.exec(last.text);
    const marks = lines.flatMap((line) => [
      ...line.text.matchAll(/\/:|\|\|:|𝄆|:[ \t]*[/\\]|:\|\||𝄇|(?<!\d)%/gu),
    ]);
    if (opening?.[1] === '%') type = 'Chorus';
    // Convert only a simple pair covering the entire block. Preserve nested and
    // cross-block notation, including an unmatched mark, for presentation review.
    if (
      opening &&
      closing &&
      marks.length === 2 &&
      (opening[1] === '%') === (closing[1] === '%')
    ) {
      repeat = closing[2] ? multiplierValue(closing[2]) : 2;
      last.text = last.text.slice(0, closing.index).trimEnd();
      first.text = first.text.slice(opening[0].length);
      first.chords = first.chords.map((anchor) => ({
        ...anchor,
        at: Math.max(0, anchor.at - opening[0].length),
      }));
    } else if (!marks.length) {
      const count = TEXT_REPEAT_COUNT.exec(last.text);
      if (count) {
        repeat = multiplierValue(count[1]!);
        last.text = last.text.slice(0, count.index).trimEnd();
      }
    } else if (marks.length === 1 && (opening || closing)) {
      const source = parsed[opening ? firstIndex : lastIndex]!.source;
      warnings.push({
        kind: 'unpaired-repeat-marker',
        line: source.line,
        text: source.text.trim(),
      });
    }
    last.chords = last.chords.map((anchor) => ({
      ...anchor,
      at: Math.min(anchor.at, last.text.length),
    }));
  }

  const usable = lines.filter((line) => line.text !== '' || line.chords.length > 0);
  if (usable.length === 0) return null;
  const block = emptyBlock(nextBlockId(type, wantedNumber, counters, used), type);
  block.repeat = repeat;
  block.lines = usable;
  return block;
}

/** True when a multiline paste contains document-level structure worth formatting. */
export function looksLikeStructuredSongText(source: string): boolean {
  const lines = normaliseLines(source);
  const blankSeparators = lines.filter((line) => line.text.trim() === '').length;
  return (
    blankSeparators > 0 ||
    lines.some((line) => sectionOf(line.text) !== null || beginsInlineSection(line.text)) ||
    sourceHasStrongChordRows(lines)
  );
}

export function analysePlainText(
  source: string,
  options: TextImportOptions = {},
): TextImportAnalysis {
  const now = options.now ?? new Date().toISOString();
  const rawLines = normaliseLines(source);
  const strongDocument = sourceHasStrongChordRows(rawLines);
  const repeatedSingles = singleChordPairCount(rawLines) >= 2;

  let title = options.title ?? null;
  let key: string | null = null;
  let tempo: number | null = null;
  let authors: string[] = [];
  let cursor = 0;
  let seenContent = false;

  for (; cursor < rawLines.length && !seenContent; cursor++) {
    const row = rawLines[cursor]!;
    const line = row.text;
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
      const number = Number(tempoValue);
      if (Number.isFinite(number)) tempo = number;
      continue;
    }
    if (authorValue !== null) {
      authors = authorValue.split(/\s*[,;/]\s*/).filter(Boolean);
      continue;
    }
    const contextualChord = isChordRow(rawLines, cursor, strongDocument, repeatedSingles, null);
    if (title === null && !sectionOf(line) && !beginsInlineSection(line) && !contextualChord) {
      title = line.trim();
      continue;
    }
    seenContent = true;
    break;
  }

  const warnings: TextImportWarning[] = [];
  const counters = new Map<BlockType, number>();
  const used = new Set<string>();
  const blocks = groupsFrom(rawLines.slice(Math.max(cursor, 0))).flatMap((group) => {
    const block = blockFromGroup(
      group,
      strongDocument,
      repeatedSingles,
      counters,
      used,
      warnings,
    );
    return block ? [block] : [];
  });

  const fallbackTitle = options.filename
    ? options.filename
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim()
    : '';
  const firstLyric = blocks
    .flatMap((block) => block.lines)
    .map((line) => line.text.trim())
    .find(Boolean);

  return {
    song: {
      id: options.id ?? crypto.randomUUID(),
      legacyUuid: null,
      // When the source starts directly with a numbered verse or a chord row, use the
      // first lyric as a title suggestion without consuming it from the song.
      title: (title ?? '').trim() || fallbackTitle || firstLyric || 'Fără titlu',
      writtenKey: key,
      performanceKey: null,
      tempo,
      timeSignature: null,
      authors,
      copyright: null,
      ccli: null,
      tags: [],
      collectionIds: [],
      blocks,
      arrangement: null,
      lang: null,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    },
    warnings,
  };
}

export function importPlainText(source: string, options: TextImportOptions = {}): Song {
  return analysePlainText(source, options).song;
}
