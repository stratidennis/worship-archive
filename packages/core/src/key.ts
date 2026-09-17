/**
 * Pitch classes, key names and enharmonic spelling.
 *
 * The rule that matters: when transposing, whether a note is spelled F# or Gb depends
 * on the *target key*, not on a fixed lookup table. Getting this wrong is the classic
 * transposition bug — you end up showing guitarists a Cb.
 */

export const SHARP_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

export type Spelling = 'sharp' | 'flat';

const NATURAL_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Keys conventionally written with flats. Everything else gets sharps. */
const FLAT_KEYS = new Set([
  'F',
  'Bb',
  'Eb',
  'Ab',
  'Db',
  'Gb',
  'Cb',
  'Dm',
  'Gm',
  'Cm',
  'Fm',
  'Bbm',
  'Ebm',
  'Abm',
]);

/** Normalise an accidental to ASCII `#` / `b`. */
function normaliseAccidental(acc: string): string {
  if (acc === '♯') return '#';
  if (acc === '♭') return 'b';
  return acc;
}

/**
 * Parse a note name to a pitch class (0–11).
 *
 * Accepts lowercase roots (`c#`, `b`) — the real library has 27 of them, and they are
 * shift-key slips rather than the German convention for minor.
 */
export function noteToPitchClass(name: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]{0,2})$/.exec(name.trim());
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const base = NATURAL_PC[letter];
  if (base === undefined) return null;

  let pc = base;
  for (const ch of normaliseAccidental(m[2] ?? '')) {
    if (ch === '#') pc += 1;
    else if (ch === 'b') pc -= 1;
  }
  return ((pc % 12) + 12) % 12;
}

/** Spell a pitch class using the given preference. */
export function pitchClassToNote(pc: number, spelling: Spelling): string {
  const i = ((pc % 12) + 12) % 12;
  return spelling === 'flat' ? FLAT_NAMES[i]! : SHARP_NAMES[i]!;
}

/**
 * Decide whether a key is written with sharps or flats.
 *
 * Unknown or malformed keys default to sharps, which is the safer guess for guitar.
 */
export function spellingForKey(key: string | null): Spelling {
  if (!key) return 'sharp';
  const cleaned = cleanKeyName(key);
  if (!cleaned) return 'sharp';
  return FLAT_KEYS.has(cleaned) ? 'flat' : 'sharp';
}

/**
 * Tidy a key as written into a canonical form, or return null if it isn't a key.
 *
 * The real library contains `b`, `c#`, `C-D` and `G - A` in the key field — the last
 * two being written-key/performance-key pairs crammed into one field. Callers that
 * care about those should use {@link splitKeyPair} first.
 */
export function cleanKeyName(key: string): string | null {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(m|min|minor)?\s*$/.exec(key);
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const acc = normaliseAccidental(m[2] ?? '');
  const minor = m[3] ? 'm' : '';
  return `${letter}${acc}${minor}`;
}

/**
 * Split a key field that contains two keys.
 *
 * The legacy library expresses "written in C, played in D" three different ways —
 * a `TRANSPOSE:` comment, a filename suffix, and this: `C-D` or `G - A`.
 */
export function splitKeyPair(key: string): { written: string; performance: string } | null {
  const m = /^\s*([A-Ga-g][#b♯♭]?m?)\s*[-–—>]+\s*([A-Ga-g][#b♯♭]?m?)\s*$/.exec(key);
  if (!m) return null;
  const written = cleanKeyName(m[1]!);
  const performance = cleanKeyName(m[2]!);
  if (!written || !performance) return null;
  return { written, performance };
}

/** Semitone distance from `from` to `to`, in the range 0–11. */
export function semitonesBetween(from: string, to: string): number | null {
  const a = noteToPitchClass(stripMinor(from));
  const b = noteToPitchClass(stripMinor(to));
  if (a === null || b === null) return null;
  return ((b - a) % 12 + 12) % 12;
}

function stripMinor(key: string): string {
  return key.replace(/\s*(m|min|minor)\s*$/, '').trim();
}

/** True if the key is minor, e.g. `Em`. */
export function isMinorKey(key: string): boolean {
  return /(m|min|minor)\s*$/.test(key.trim());
}
