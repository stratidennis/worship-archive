/**
 * The domain model.
 *
 * This is the in-memory shape. On disk a song is a ChordPro `.chopro` file — see
 * `chordpro/`. SQLite and IndexedDB cache this as JSON for speed, but the `.chopro`
 * file is always the source of truth.
 */

export type Uuid = string;

/**
 * Who sings a line or block. Displayed as a label, not a routing decision.
 *
 * Observed in the real library: Leader (126), Women (29), Men (18), All (12).
 * The legacy `target` axis (All/Leader/Band/Audience) is deliberately absent — it was
 * used zero times across 153 songs.
 */
export const SINGERS = [
  'Leader',
  'All',
  'Women',
  'Men',
  'Choir',
  'Children',
  'Adults',
  'Congregation',
] as const;
export type Singers = (typeof SINGERS)[number];

/**
 * Block types.
 *
 * The first six come from the legacy format. `Intro`, `Instrumental`, `Solo` and `Note`
 * replace the 303 free-text "Misc" blocks that were being used as a dumping ground for
 * performance directions.
 */
export const BLOCK_TYPES = [
  'Verse',
  'Chorus',
  'PreChorus',
  'Bridge',
  'Ending',
  'Tag',
  'Intro',
  'Instrumental',
  'Solo',
  'Note',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Single-letter prefixes used when generating block ids: V1, C2, S1… */
export const BLOCK_ID_PREFIX: Record<BlockType, string> = {
  Verse: 'V',
  Chorus: 'C',
  PreChorus: 'P',
  Bridge: 'B',
  Ending: 'E',
  Tag: 'T',
  Intro: 'I',
  Instrumental: 'N',
  Solo: 'S',
  Note: 'M',
};

/**
 * A chord or bass note anchored inside a lyric line.
 *
 * `raw` is stored EXACTLY as authored and is never rewritten on import. The legacy
 * library contains 73 distinct spellings, 13 of them malformed across 105 of the 3504
 * chords (`Cm#` for `C#m`, a lowercase root, a backslash bass separator). Silently
 * "fixing" them would change songs people have played for years, so normalisation is an
 * explicit, reviewable, revertible action instead.
 */
export interface Anchor {
  /** UTF-16 index into `Line.text`. 0 means "before the first character". */
  at: number;
  /** The chord as authored, e.g. "G", "C#/A", "G(A)", "Cm#". */
  raw: string;
}

export interface Line {
  /** Lyrics only. No markup, no chord brackets. */
  text: string;
  chords: Anchor[];
  /** Bass notes — a layer independent of `chords`, toggled separately. */
  bass: Anchor[];
  singers: Singers | null;
  /** Indentation level; 27 uses in the real library. */
  indent: number | null;
  /** Per-line colour, as a CSS colour or a theme token. */
  color: string | null;
}

export interface Block {
  /** "V1", "C2", "S1" — legacy-compatible and stable within a song. */
  id: string;
  type: BlockType;
  /** Free label: "Dennis" on a Solo, "forte" on an Instrumental. */
  label: string | null;
  singers: Singers | null;
  /** Repeat count; 37 uses in the real library. */
  repeat: number | null;
  /** Keep this block on the same page/screen as the previous one. */
  linkToPrevious: boolean;
  /** A cue for the band that must never reach a shared display. */
  bandOnly: boolean;
  lines: Line[];
}

export interface Song {
  /** Ours. Minted fresh when a legacy uuid collides — they are not unique. */
  id: Uuid;
  /** The original SwiftTec `<uuid>`, kept for traceability. Not unique. */
  legacyUuid: Uuid | null;

  title: string;
  /** The key the chords are literally written in. */
  writtenKey: string | null;
  /** The key it is actually performed in. Was previously hidden in filenames and comments. */
  performanceKey: string | null;

  tempo: number | null;
  timeSignature: string | null;
  authors: string[];
  copyright: string | null;
  ccli: string | null;
  /** Category / theme, used for search and filtering. */
  tags: string[];
  collectionIds: Uuid[];

  blocks: Block[];
  /** Block ids in play order. `null` means "play the blocks as written". */
  arrangement: string[] | null;

  lang: string | null;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

/**
 * A collection of songs, owned by a band and optionally shared.
 *
 * The real library has two: the main group's songs, and `Song files L&I` — a different
 * band's songs that the main group also uses.
 */
export interface Collection {
  id: Uuid;
  name: string;
  /** The band this collection belongs to. */
  ownerBand: string | null;
  /** Band names this collection is shared with. */
  sharedWith: string[];
}

export type SetItem =
  | {
      kind: 'song';
      songId: Uuid;
      /** Overrides live on the set — changing Sunday's key must not edit the library. */
      keyOverride: string | null;
      /** Keyboard transpose: played shapes are shifted this far to sound in the key. */
      transposeOverride?: number | null;
      capoOverride: number | null;
      arrangementOverride: string[] | null;
    }
  | { kind: 'note'; text: string }
  | { kind: 'gap'; label: string; minutes: number | null };

export interface ServiceSet {
  id: Uuid;
  title: string;
  /** ISO date of the service, if it has one. */
  date: string | null;
  items: SetItem[];
  createdAt: string;
  updatedAt: string;
  rev: number;
}

/** Create an empty line with all optional fields explicit. */
export function emptyLine(text = ''): Line {
  return { text, chords: [], bass: [], singers: null, indent: null, color: null };
}

/** Create an empty block with all optional fields explicit. */
export function emptyBlock(id: string, type: BlockType): Block {
  return {
    id,
    type,
    label: null,
    singers: null,
    repeat: null,
    linkToPrevious: false,
    bandOnly: false,
    lines: [],
  };
}
