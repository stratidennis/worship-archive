/**
 * The chord engine.
 *
 * Built against the real library: 3504 chord anchors, 73 distinct spellings, most of
 * them malformed in one of six recurring ways. Three rules govern everything here:
 *
 *  1. **Never throw.** Unparseable input comes back as `unparsed` and renders verbatim.
 *  2. **Never silently rewrite.** A chord renders exactly as authored until something
 *     actually transposes it. `Cm#` is *understood* as `C#m` but still *displayed* as
 *     `Cm#`; fixing the spelling is a separate, human-approved action ({@link normalise}).
 *  3. **Round-trip.** `formatChord(parseChord(x)) === x` for every chord in the library,
 *     malformed ones included.
 */

import {
  noteToPitchClass,
  pitchClassToNote,
  pitchClassToPreferredNote,
  spellingForKey,
  type AccidentalPreferences,
  type Spelling,
} from './key.js';

export interface Chord {
  /** Pitch class of the root, 0–11. Semantic: `Cm#` gives 1 (C#), not 0. */
  rootPc: number;
  /** Semantic quality, with any misplaced accidental removed: `Cm#` gives "m". */
  quality: string;
  /**
   * Slash-chord bass. Usually a plain note, but the library contains `A\Fm#` where the
   * bass is itself a chord, so this is recursive.
   */
  bass: Chord | null;
  /** The separator before the bass: `/` or `\` — both occur in the library. */
  bassSep: string;
  /** Parenthesised alternates: the A in `G(A)`, C and D in `Em(C,D)`. */
  alternates: Chord[];
  /** Separator that preceded this chord in a multi-chord anchor: " " or "-". */
  sep: string;
  /**
   * Exactly what should be rendered for this chord.
   *
   * On parse this is the original text, so display is byte-identical to the source.
   * On transpose it is recomputed canonically, because the original spelling no longer
   * describes the new pitch.
   */
  raw: string;
}

export type ChordToken =
  /** One or more chords. Several means the anchor held `G A` or `C-D`. */
  | { kind: 'chords'; chords: Chord[] }
  /** Not a chord. Preserved verbatim, rendered as-is. */
  | { kind: 'unparsed'; raw: string };

const ROOT_RE = /^([A-Ga-g])([#b♯♭]?)/;

/**
 * Everything a chord quality may be built from.
 *
 * Deliberately strict: it must reject ordinary words, or a lyric fragment beginning
 * with a–g would parse as a chord. `instr.` and `GF` both fail here, which is correct —
 * they are preserved untouched rather than silently reinterpreted.
 */
const QUALITY_RE = /^(?:maj|major|min|minor|dim|aug|sus|add|alt|m|M|°|ø|\+|-|\d+|#|b)*$/;

/**
 * A quality that is really a misplaced accidental: `Cm#` means `C#m`.
 *
 * 68 occurrences (`Cm#` ×35, `Fm#` ×30, `Gm#` ×2, `F#m#` ×1). The accidental must be
 * the final character, so `Cmaj7#11` is untouched.
 */
const MISPLACED_ACCIDENTAL_RE = /^(m|min|maj|M)?([#b])$/;

const QUALITY_ALIASES: Record<string, string> = {
  min: 'm',
  minor: 'm',
  '-': 'm',
  maj: '',
  major: '',
  M: '',
};

function parseSingle(text: string, sep: string): Chord | null {
  const raw = text.trim();
  if (!raw) return null;

  // Parenthesised alternates: G(A), Em(C,D), Am(Bm)
  let base = raw;
  let alternates: Chord[] = [];
  const paren = /^([^(]+)\(([^)]*)\)$/.exec(raw);
  if (paren) {
    base = paren[1]!.trim();
    const inner = paren[2]!
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = inner.map((s) => parseSingle(s, ''));
    if (parsed.length === 0 || parsed.some((c) => c === null)) return null;
    alternates = parsed as Chord[];
  }

  // Slash bass. The library uses both `/` and `\` — `A\Fm#`, `D\A`.
  let bass: Chord | null = null;
  let bassSep = '/';
  const slash = base.search(/[/\\]/);
  if (slash !== -1) {
    bassSep = base[slash]!;
    const bassText = base.slice(slash + 1).trim();
    base = base.slice(0, slash).trim();
    bass = parseSingle(bassText, '');
    if (bass === null) return null;
  }

  const m = ROOT_RE.exec(base);
  if (!m) return null;

  let rootText = m[1]! + (m[2] ?? '');
  let quality = base.slice(rootText.length);

  // In chord charts a lowercase root is shorthand for minor, not merely a missed
  // Shift key. Keep `raw` untouched for round-tripping, but understand `a`, `c#` and
  // `f#7` as Am, C#m and F#m7 so cleanup and transposition preserve the harmony.
  const lowercaseRoot = /^[a-g]/.test(m[1]!);
  if (
    lowercaseRoot &&
    !/^(?:m|min|minor|-)/.test(quality) &&
    !/^(?:M|maj|major)/.test(quality)
  ) {
    quality = `m${quality}`;
  }

  // `Cm#` is understood as `C#m`. The semantic root gains the accidental; `raw` keeps
  // the original text, so nothing on screen changes until the chord is transposed.
  if (!m[2]) {
    const mis = MISPLACED_ACCIDENTAL_RE.exec(quality);
    if (mis) {
      rootText = m[1]! + mis[2]!;
      quality = mis[1] ?? '';
    }
  }

  if (!QUALITY_RE.test(quality)) return null;

  const rootPc = noteToPitchClass(rootText);
  if (rootPc === null) return null;

  return { rootPc, quality, bass, bassSep, alternates, sep, raw };
}

/**
 * Split an anchor into chord parts, remembering each separator.
 *
 * Splits on whitespace (`G A`, `Bm G D A`) and on a hyphen followed by a note letter
 * (`C-D`, `Cm-D`) — but not on a trailing hyphen, which is jazz shorthand for minor.
 * Never splits inside parentheses.
 */
function splitParts(text: string): { text: string; sep: string }[] {
  const parts: { text: string; sep: string }[] = [];
  let depth = 0;
  let current = '';
  let sep = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    const atTop = depth === 0;
    const isSpace = /\s/.test(ch);
    const isDashSplit = ch === '-' && current !== '' && /[A-Ga-g]/.test(text[i + 1] ?? '');

    if (atTop && (isSpace || isDashSplit)) {
      if (current) {
        parts.push({ text: current, sep });
        current = '';
      }
      sep = isDashSplit ? '-' : ' ';
      continue;
    }
    current += ch;
  }
  if (current) parts.push({ text: current, sep });
  return parts;
}

/**
 * Parse a chord anchor. Never throws.
 *
 * Handles every form found in the library: plain chords, slash chords with `/` or `\`
 * and a chord as the bass, parenthesised alternates, accidentals typed after the
 * quality, lowercase roots, and multiple chords in one anchor.
 */
export function parseChord(raw: string): ChordToken {
  const text = raw.trim();
  if (!text) return { kind: 'unparsed', raw };

  const parts = splitParts(text);
  if (parts.length === 0) return { kind: 'unparsed', raw };

  const chords = parts.map((p) => parseSingle(p.text, p.sep));
  if (chords.some((c) => c === null)) return { kind: 'unparsed', raw };
  return { kind: 'chords', chords: chords as Chord[] };
}

/** Render a token back to text. Round-trips {@link parseChord} exactly. */
export function formatChord(token: ChordToken): string {
  if (token.kind === 'unparsed') return token.raw;
  return token.chords.map((c, i) => (i === 0 ? '' : c.sep) + c.raw).join('');
}

/** Build the canonical text for a chord at its current pitch. */
function canonicalText(c: Chord, spelling: Spelling): string {
  let out = pitchClassToNote(c.rootPc, spelling) + c.quality;
  if (c.alternates.length > 0) {
    out += `(${c.alternates.map((a) => canonicalText(a, spelling)).join(',')})`;
  }
  if (c.bass !== null) out += c.bassSep + canonicalText(c.bass, spelling);
  return out;
}

function preferredText(
  c: Chord,
  preferences: AccidentalPreferences,
  fallback: Spelling,
): string {
  let out = pitchClassToPreferredNote(c.rootPc, preferences, fallback) + c.quality;
  if (c.alternates.length > 0) {
    out += `(${c.alternates.map((a) => preferredText(a, preferences, fallback)).join(',')})`;
  }
  if (c.bass !== null) out += c.bassSep + preferredText(c.bass, preferences, fallback);
  return out;
}

function shiftChord(c: Chord, semitones: number, spelling: Spelling): Chord {
  const shifted: Chord = {
    rootPc: (((c.rootPc + semitones) % 12) + 12) % 12,
    quality: c.quality,
    bass: c.bass === null ? null : shiftChord(c.bass, semitones, spelling),
    bassSep: c.bassSep,
    alternates: c.alternates.map((a) => shiftChord(a, semitones, spelling)),
    sep: c.sep,
    raw: '',
  };
  return { ...shifted, raw: canonicalText(shifted, spelling) };
}

/**
 * Transpose by a number of semitones.
 *
 * Slash chords move on both sides and parenthesised alternates move too — `C#/A` up 2
 * is `D#/B`, not `D#/A`. `targetKey` decides sharp vs flat spelling. Unparsed tokens
 * pass through untouched, and a shift of zero leaves the original spelling alone.
 */
export function transposeChord(
  token: ChordToken,
  semitones: number,
  targetKey: string | null,
): ChordToken {
  if (token.kind === 'unparsed') return token;
  const shift = ((semitones % 12) + 12) % 12;
  if (shift === 0) return token;
  const spelling = spellingForKey(targetKey);
  return { kind: 'chords', chords: token.chords.map((c) => shiftChord(c, shift, spelling)) };
}

/**
 * The shapes a guitarist plays with a capo on a given fret.
 *
 * A capo at fret N means playing shapes N semitones below the sounding key.
 */
export function chordForCapo(
  token: ChordToken,
  capo: number,
  targetKey: string | null,
): ChordToken {
  if (capo === 0) return token;
  return transposeChord(token, -capo, targetKey);
}

/**
 * Re-spell a chord without changing its pitch.
 *
 * Unlike transposition this intentionally also acts at zero semitones, so a stored Eb
 * can be displayed as D# when that is the musician's chosen notation. The source file
 * remains untouched.
 */
export function respellChord(
  token: ChordToken,
  preferences: AccidentalPreferences,
  targetKey: string | null,
): ChordToken {
  if (token.kind === 'unparsed') return token;
  const fallback = spellingForKey(targetKey);
  return {
    kind: 'chords',
    chords: token.chords.map((chord) => ({
      ...chord,
      raw: preferredText(chord, preferences, fallback),
    })),
  };
}

export interface Normalisation {
  fixed: string;
  reason: string;
}

function normaliseChord(c: Chord, reasons: Set<string>): string {
  const rootWritten = ROOT_RE.exec(c.raw)?.[0] ?? '';
  if (/^[a-g]/.test(rootWritten)) reasons.add('lowercase root');

  let quality = c.quality;
  const alias = QUALITY_ALIASES[quality];
  if (alias !== undefined) {
    quality = alias;
    reasons.add('non-standard quality');
  }

  // Root already carried an accidental and another followed: F#m# -> F#m
  const written = c.raw.slice(rootWritten.length);
  const dup = MISPLACED_ACCIDENTAL_RE.exec(written);
  if (dup && /[#b♯♭]/.test(rootWritten)) {
    quality = dup[1] ?? '';
    reasons.add('duplicated accidental');
  } else if (MISPLACED_ACCIDENTAL_RE.test(written) && !/[#b♯♭]/.test(rootWritten)) {
    reasons.add('accidental written after the quality');
  }

  let out = pitchClassToNote(c.rootPc, 'sharp') + quality;
  if (c.alternates.length > 0) {
    out += `(${c.alternates.map((a) => normaliseChord(a, reasons)).join(',')})`;
  }
  if (c.bass !== null) {
    if (c.bassSep === '\\') reasons.add('backslash bass separator');
    out += '/' + normaliseChord(c.bass, reasons);
  }
  return out;
}

/**
 * Suggest a canonical spelling, or null if the chord is already fine.
 *
 * Powers the bulk-cleanup review UI. Never applied automatically: these are chords
 * people have read for years, and changing them unasked is a worse bug than the typo.
 */
export function normalise(raw: string): Normalisation | null {
  const token = parseChord(raw);
  if (token.kind === 'unparsed') return null;

  const reasons = new Set<string>();
  const fixed = token.chords
    .map((c, i) => (i === 0 ? '' : c.sep) + normaliseChord(c, reasons))
    .join('');

  if (fixed === raw.trim()) return null;
  if (reasons.size === 0) return null;
  return { fixed, reason: [...reasons].join(', ') };
}
