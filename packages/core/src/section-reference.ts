import type { BlockType } from './types.js';

const SECTION_NAMES = new Map<string, BlockType>([
  ['verse', 'Verse'],
  ['vers', 'Verse'],
  ['strofa', 'Verse'],
  ['chorus', 'Chorus'],
  ['refrain', 'Chorus'],
  ['refren', 'Chorus'],
  ['ref', 'Chorus'],
  ['cor', 'Chorus'],
  ['prechorus', 'PreChorus'],
  ['prerefren', 'PreChorus'],
  ['bridge', 'Bridge'],
  ['punte', 'Bridge'],
  ['ending', 'Ending'],
  ['final', 'Ending'],
  ['incheiere', 'Ending'],
  ['tag', 'Tag'],
  ['coda', 'Tag'],
  ['intro', 'Intro'],
  ['intrare', 'Intro'],
  ['instrumental', 'Instrumental'],
  ['solo', 'Solo'],
]);

export const MAX_SECTION_REPEAT = 20;

const MULTIPLIER = String.raw`(?:[x×][ \t]*[+-]?\d+(?:\.\d+)?|[+-]?\d+(?:\.\d+)?[ \t]*[x×])`;
export const REPEAT_MULTIPLIER = String.raw`(?:\([ \t]*${MULTIPLIER}[ \t]*\)|${MULTIPLIER})`;

export function multiplierValue(notation: string): number {
  return Number(notation.replace(/[x×()\s]/gi, ''));
}

const PREFIX_MULTIPLIER = new RegExp(`^(${REPEAT_MULTIPLIER})\\s*`);
const SECTION_TOKEN = new RegExp(
  String.raw`^([a-z]+?(?:[- ](?:chorus|refren))?)\s*(\d+)?(?:(?:[ \t]+|(?=[x×(]))(${REPEAT_MULTIPLIER}))?$`,
);

export interface SectionReference {
  target: { id: string } | { type: BlockType; ordinal: number | undefined };
  repeat: number | undefined;
}

/** The same reference token can occur in a standalone cue or a written arrangement. */
export function parseSectionReference(source: string): SectionReference | null {
  const text = source.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const prefix = PREFIX_MULTIPLIER.exec(text);
  const afterPrefix = text.slice(prefix?.[0].length ?? 0);
  const frontOrdinal = /^(?:al?\s+(\d+)\s*-\s*(?:lea|a)|(\d+)(?:st|nd|rd|th))\s+/.exec(
    afterPrefix,
  );
  const name = afterPrefix.slice(frontOrdinal?.[0].length ?? 0);
  // Lazy name matching keeps a compact suffix such as REFX2 out of the name.
  const match = SECTION_TOKEN.exec(name);
  if (!match || (prefix && match[3]) || (frontOrdinal && match[2])) return null;

  const word = match[1]!;
  const type = SECTION_NAMES.get(word.replace(/[- ]/g, ''));
  const ordinal = frontOrdinal?.[1] ?? frontOrdinal?.[2] ?? match[2];
  const repeat = prefix?.[1] ?? match[3];
  if (ordinal !== undefined && (!Number.isSafeInteger(Number(ordinal)) || Number(ordinal) < 1))
    return null;
  const target = type
    ? { type, ordinal: ordinal === undefined ? undefined : Number(ordinal) }
    : match[2] !== undefined && /^[vcpbetinsm]$/.test(word) && !frontOrdinal
      ? { id: word.toUpperCase() + match[2] }
      : null;
  return target
    ? { target, repeat: repeat === undefined ? undefined : multiplierValue(repeat) }
    : null;
}
