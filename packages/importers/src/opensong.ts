/**
 * Importing OpenSong XML.
 *
 * OpenSong is the most widely shared free worship-song format, so a song found online
 * is often an OpenSong file. Its lyrics body is chords-over-lyrics with two sigils:
 * a leading `.` marks a chord line, a leading space marks a lyric line, and `[V1]`
 * starts a section.
 *
 * ```xml
 * <song>
 *   <title>Amazing Grace</title>
 *   <key>G</key>
 *   <lyrics>[V1]
 * .G          C      G
 *  Amazing grace how sweet the sound
 * </lyrics>
 * </song>
 * ```
 *
 * The one trap: because the lyric sigil is a single leading space, that space is
 * *not* part of the words but *is* part of the column arithmetic — chord at column 1
 * of `.G` belongs over character 0 of the lyric. Getting this off by one puts every
 * chord one letter late, which is subtle enough to survive review and wrong enough to
 * matter on stage.
 */

import {
  BLOCK_ID_PREFIX,
  emptyBlock,
  emptyLine,
  type Block,
  type BlockType,
  type Song,
} from '@worship/core';
import { decodeEntities, tagText } from './xml.js';
import { anchorsFromChordLine } from './plain-text.js';

export interface OpenSongOptions {
  filename?: string | undefined;
  id?: string | undefined;
  now?: string | undefined;
}

/** OpenSong section codes. `[V1]`, `[C]`, `[B2]`, and free-text names too. */
const SECTION_CODES: Record<string, BlockType> = {
  v: 'Verse',
  c: 'Chorus',
  b: 'Bridge',
  p: 'PreChorus',
  t: 'Tag',
  e: 'Ending',
  i: 'Intro',
  s: 'Solo',
};

const SECTION_WORDS: Record<string, BlockType> = {
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  prechorus: 'PreChorus',
  'pre-chorus': 'PreChorus',
  tag: 'Tag',
  ending: 'Ending',
  outro: 'Ending',
  intro: 'Intro',
  instrumental: 'Instrumental',
  interlude: 'Instrumental',
  solo: 'Solo',
};

function sectionType(name: string): BlockType {
  const trimmed = name.trim().toLowerCase();
  const word = SECTION_WORDS[trimmed.replace(/\s*\d+\s*$/, '')];
  if (word) return word;
  const code = SECTION_CODES[trimmed.charAt(0)];
  if (code && /^[a-z]\s*\d*$/.test(trimmed)) return code;
  return 'Verse';
}

export function looksLikeOpenSong(source: string): boolean {
  return /<song[\s>]/i.test(source) && /<lyrics[\s>]/i.test(source);
}

export function importOpenSong(source: string, options: OpenSongOptions = {}): Song {
  const now = options.now ?? new Date().toISOString();
  const lyrics = decodeEntities(
    /<lyrics[^>]*>([\s\S]*?)<\/lyrics>/i.exec(source)?.[1] ?? '',
  );

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

  const lines = lyrics.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.trim() === '') continue;
    // `;` is an OpenSong comment — a note to whoever maintains the file, not a lyric.
    if (line.startsWith(';')) continue;
    // `---` is a page break in OpenSong. This app does not paginate, so it is noise.
    if (/^-{3,}$/.test(line.trim())) continue;

    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      const name = section[1] ?? '';
      const type = sectionType(name);
      current = startBlock(type, /^[a-z]\s*\d*$/i.test(name.trim()) ? null : name.trim());
      continue;
    }

    current ??= startBlock('Verse', null);

    if (line.startsWith('.')) {
      // The sigil occupies column 0 of both lines, so both keep it during the column
      // arithmetic and it is stripped from the lyric afterwards.
      const next = lines[i + 1] ?? '';
      const hasLyric = next.startsWith(' ') && next.trim() !== '';
      const lyricWithSigil = hasLyric ? next.replace(/\s+$/, '') : '';
      // Replace the sigil with a space rather than removing it: the column arithmetic
      // depends on it still occupying column 0. Removing it shifts every chord left by
      // one, which is exactly the off-by-one this file warns about.
      const chordLine = ' ' + line.slice(1);
      const anchors = anchorsFromChordLine(chordLine, lyricWithSigil).map((a) => ({
        ...a,
        at: Math.max(0, a.at - 1),
      }));
      current.lines.push({
        ...emptyLine(lyricWithSigil.slice(1)),
        chords: anchors,
      });
      if (hasLyric) i++;
      continue;
    }

    current.lines.push(emptyLine(line.replace(/^ /, '').replace(/\s+$/, '')));
  }

  const tempoText = tagText(source, 'tempo');
  const tempo = tempoText && Number.isFinite(Number(tempoText)) ? Number(tempoText) : null;
  const themes = [...source.matchAll(/<theme>([\s\S]*?)<\/theme>/gi)]
    .map((m) => decodeEntities(m[1] ?? '').trim())
    .filter(Boolean);
  const author = tagText(source, 'author');
  const fallbackTitle = options.filename
    ? options.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
    : '';

  return {
    id: options.id ?? crypto.randomUUID(),
    legacyUuid: null,
    title: (tagText(source, 'title') ?? '').trim() || fallbackTitle || 'Fără titlu',
    writtenKey: (tagText(source, 'key') ?? '').trim() || null,
    performanceKey: null,
    tempo,
    timeSignature: (tagText(source, 'time_sig') ?? '').trim() || null,
    authors: author ? author.split(/\s*[,;/]\s*/).filter(Boolean) : [],
    copyright: (tagText(source, 'copyright') ?? '').trim() || null,
    ccli: (tagText(source, 'ccli') ?? '').trim() || null,
    tags: themes,
    collectionIds: [],
    blocks: blocks.filter((b) => b.lines.length > 0),
    arrangement: null,
    lang: null,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };
}
