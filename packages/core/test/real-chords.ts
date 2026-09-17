/**
 * Every distinct chord spelling in the real library, with its occurrence count.
 *
 * Extracted from 153 `.song` files: 3504 chord anchors, 73 distinct spellings.
 * This is the specification the chord engine is written against — if a change breaks
 * one of these, it breaks a song someone plays on Sunday.
 */
export const REAL_CHORDS: Record<string, number> = {
  G: 653,
  D: 587,
  A: 462,
  C: 398,
  E: 227,
  Em: 219,
  Bm: 201,
  F: 139,
  B: 132,
  Am: 120,
  'F#m': 50,
  'C#m': 49,
  'Cm#': 35,
  'Fm#': 30,
  Dm: 29,
  A7: 18,
  b: 15,
  D7: 12,
  'c#': 12,
  Bb: 9,
  'C#/A': 6,
  'C(D)': 6,
  'G(A)': 6,
  B7: 5,
  'D(E)': 5,
  'Am(Bm)': 4,
  'C#min': 4,
  'G#': 4,
  'G/A': 4,
  Cm: 3,
  E7: 3,
  'G#m': 3,
  G7: 3,
  Gsus2: 3,
  A2: 2,
  Csus2: 2,
  'D/A': 2,
  'Em(C,D)': 2,
  'Em/D': 2,
  'F#/D': 2,
  'G/B': 2,
  'G/D': 2,
  'Gm#': 2,
  'A/C': 1,
  'A/C#': 1,
  'A/E': 1,
  'A/G': 1,
  'A\\Fm#': 1,
  'B/E': 1,
  'Bb/G': 1,
  'Bm G D A': 1,
  'Bm/D': 1,
  'C#m7': 1,
  'C-D': 1,
  'C/G': 1,
  C7: 1,
  'Cm-D': 1,
  'D A': 1,
  'D/E': 1,
  'D/F#': 1,
  'D\\A': 1,
  'F#m#': 1,
  'F#min': 1,
  Fm: 1,
  'G A': 1,
  'G#7': 1,
  'G#min': 1,
  'G(D)': 1,
  G2: 1,
  GF: 1,
  'f#': 1,
  'g#': 1,
  'instr.': 1,
};

/**
 * The only two entries that are genuinely not chords.
 *
 * `instr.` is an instruction that ended up in a chord tag. `GF` is most likely a typo
 * for `G/F` or `G F`, but guessing would be worse than leaving it alone — it renders
 * verbatim and appears in the cleanup report for a human to decide.
 */
export const EXPECTED_UNPARSED = new Set(['instr.', 'GF']);
