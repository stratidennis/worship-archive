import { describe, expect, it } from 'vitest';
import {
  chordForCapo,
  formatChord,
  normalise,
  parseChord,
  transposeChord,
} from '../src/chord.js';
import { EXPECTED_UNPARSED, REAL_CHORDS } from './real-chords.js';

/** Convenience: parse, transpose, format. */
function tr(raw: string, semitones: number, key: string | null = null): string {
  return formatChord(transposeChord(parseChord(raw), semitones, key));
}

describe('the real library', () => {
  const all = Object.keys(REAL_CHORDS);

  it('covers all 73 distinct spellings and 3504 anchors', () => {
    expect(all).toHaveLength(73);
    expect(Object.values(REAL_CHORDS).reduce((a, b) => a + b, 0)).toBe(3504);
  });

  it.each(all)('round-trips %s unchanged', (raw) => {
    expect(formatChord(parseChord(raw))).toBe(raw);
  });

  it.each(all)('parses %s, or reports it as unparsed deliberately', (raw) => {
    const token = parseChord(raw);
    if (EXPECTED_UNPARSED.has(raw)) {
      expect(token.kind).toBe('unparsed');
    } else {
      expect(token.kind).toBe('chords');
    }
  });

  it.each(all)('transposes %s without throwing or losing it', (raw) => {
    for (let s = -11; s <= 11; s++) {
      const out = tr(raw, s);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('leaves only the two known non-chords unparsed', () => {
    const unparsed = all.filter((c) => parseChord(c).kind === 'unparsed');
    expect(new Set(unparsed)).toEqual(EXPECTED_UNPARSED);
  });
});

describe('roots and accidentals', () => {
  it('parses plain majors and minors', () => {
    expect(tr('G', 2)).toBe('A');
    expect(tr('Em', 2)).toBe('F#m');
    expect(tr('Bb', 1)).toBe('B');
  });

  it('accepts lowercase roots — 28 occurrences in the library', () => {
    expect(parseChord('b').kind).toBe('chords');
    expect(parseChord('c#').kind).toBe('chords');
    expect(tr('b', 1)).toBe('C');
    expect(tr('c#', 1)).toBe('D');
    expect(tr('f#', 2)).toBe('G#');
  });

  it('moves an accidental typed after the quality back onto the root', () => {
    // Cm# means C#m — 68 occurrences across the library.
    expect(tr('Cm#', 0)).toBe('Cm#'); // untouched at zero
    expect(tr('Cm#', 1)).toBe('Dm');
    expect(tr('Fm#', 1)).toBe('Gm');
    expect(tr('Gm#', 1)).toBe('Am');
  });

  it('treats Cm# and C#m as the same chord', () => {
    expect(tr('Cm#', 3)).toBe(tr('C#m', 3));
  });

  it('does not mangle an accidental inside a real quality', () => {
    const token = parseChord('Cmaj7#11');
    expect(token.kind).toBe('chords');
    expect(formatChord(token)).toBe('Cmaj7#11');
    expect(tr('Cmaj7#11', 2)).toBe('Dmaj7#11');
  });
});

describe('slash chords', () => {
  it('transposes both sides', () => {
    expect(tr('C#/A', 2)).toBe('D#/B');
    expect(tr('D/F#', 1)).toBe('D#/G');
    expect(tr('Em/D', 2)).toBe('F#m/E');
  });

  it('accepts a backslash separator and preserves it', () => {
    expect(formatChord(parseChord('D\\A'))).toBe('D\\A');
    expect(tr('D\\A', 2)).toBe('E\\B');
  });

  it('handles a backslash with a misplaced accidental after it', () => {
    // A\Fm# means A over F#m.
    expect(formatChord(parseChord('A\\Fm#'))).toBe('A\\Fm#');
    const token = parseChord('A\\Fm#');
    expect(token.kind).toBe('chords');
  });
});

describe('parenthesised alternates', () => {
  it('transposes the root and every alternate', () => {
    expect(tr('G(A)', 2)).toBe('A(B)');
    expect(tr('Em(C,D)', 2)).toBe('F#m(D,E)');
    expect(tr('Am(Bm)', 3)).toBe('Cm(Dm)');
  });

  it('preserves the original spelling at zero transposition', () => {
    for (const c of ['G(A)', 'C(D)', 'D(E)', 'Am(Bm)', 'Em(C,D)', 'G(D)']) {
      expect(formatChord(parseChord(c))).toBe(c);
    }
  });
});

describe('multiple chords in one anchor', () => {
  it('splits on spaces', () => {
    expect(tr('G A', 2)).toBe('A B');
    expect(tr('D A', 2)).toBe('E B');
    expect(tr('Bm G D A', 2)).toBe('C#m A E B');
  });

  it('splits on a hyphen followed by a note', () => {
    expect(tr('C-D', 2)).toBe('D-E');
    expect(tr('Cm-D', 2)).toBe('Dm-E');
  });

  it('keeps a trailing hyphen as a quality, not a separator', () => {
    const token = parseChord('C-');
    expect(token.kind).toBe('chords');
    expect(formatChord(token)).toBe('C-');
  });
});

describe('enharmonic spelling follows the target key', () => {
  it('uses sharps in sharp keys', () => {
    expect(tr('C', 6, 'F#')).toBe('F#');
    expect(tr('G', 3, 'A#')).toBe('A#');
  });

  it('uses flats in flat keys', () => {
    expect(tr('C', 6, 'Gb')).toBe('Gb');
    expect(tr('C', 1, 'Db')).toBe('Db');
    expect(tr('C', 3, 'Eb')).toBe('Eb');
  });

  it('uses flats for common minor flat keys', () => {
    expect(tr('C', 3, 'Cm')).toBe('Eb');
    expect(tr('C', 10, 'Gm')).toBe('Bb');
  });

  it('defaults to sharps when the key is unknown or malformed', () => {
    expect(tr('C', 1, null)).toBe('C#');
    expect(tr('C', 1, 'G - A')).toBe('C#');
  });
});

describe('capo', () => {
  it('shows shapes below the sounding key', () => {
    // Sounding in Bb, capo 3 → the guitarist plays G shapes.
    expect(formatChord(chordForCapo(parseChord('Bb'), 3, 'G'))).toBe('G');
    expect(formatChord(chordForCapo(parseChord('Eb'), 3, 'G'))).toBe('C');
  });

  it('is a no-op at fret zero', () => {
    expect(formatChord(chordForCapo(parseChord('C#/A'), 0, null))).toBe('C#/A');
  });

  it('is independent of transposition', () => {
    const played = transposeChord(parseChord('G'), 3, 'Bb'); // written G, played Bb
    expect(formatChord(played)).toBe('Bb');
    expect(formatChord(chordForCapo(played, 3, 'G'))).toBe('G');
  });
});

describe('transposition is lossless and reversible', () => {
  it.each(Object.keys(REAL_CHORDS))('round-trips %s through +n then -n', (raw) => {
    for (let s = 1; s <= 11; s++) {
      const there = transposeChord(parseChord(raw), s, null);
      const back = transposeChord(there, -s, null);
      const original = parseChord(raw);
      if (original.kind === 'unparsed') {
        expect(formatChord(back)).toBe(raw);
        continue;
      }
      // Pitch classes must survive exactly; spelling may normalise.
      expect(back.kind).toBe('chords');
      if (back.kind === 'chords' && original.kind === 'chords') {
        expect(back.chords.map((c) => c.rootPc)).toEqual(original.chords.map((c) => c.rootPc));
        expect(back.chords.map((c) => c.bass?.rootPc ?? null)).toEqual(
          original.chords.map((c) => c.bass?.rootPc ?? null),
        );
      }
    }
  });
});

describe('normalise suggests fixes without applying them', () => {
  it('fixes accidentals typed after the quality', () => {
    expect(normalise('Cm#')).toEqual({
      fixed: 'C#m',
      reason: 'accidental written after the quality',
    });
    expect(normalise('Fm#')?.fixed).toBe('F#m');
    expect(normalise('Gm#')?.fixed).toBe('G#m');
  });

  it('uppercases lowercase roots', () => {
    expect(normalise('b')?.fixed).toBe('B');
    expect(normalise('c#')?.fixed).toBe('C#');
    expect(normalise('f#')?.reason).toContain('lowercase root');
  });

  it('shortens non-standard qualities', () => {
    expect(normalise('C#min')?.fixed).toBe('C#m');
    expect(normalise('F#min')?.fixed).toBe('F#m');
    expect(normalise('G#min')?.fixed).toBe('G#m');
  });

  it('drops a duplicated accidental', () => {
    expect(normalise('F#m#')?.fixed).toBe('F#m');
    expect(normalise('F#m#')?.reason).toContain('duplicated accidental');
  });

  it('converts a backslash bass separator', () => {
    expect(normalise('D\\A')?.fixed).toBe('D/A');
  });

  it('returns null for chords that are already correct', () => {
    for (const c of ['G', 'Em', 'C#m', 'A7', 'Gsus2', 'C#/A', 'G(A)', 'Bb/G']) {
      expect(normalise(c)).toBeNull();
    }
  });

  it('returns null for things that are not chords', () => {
    expect(normalise('instr.')).toBeNull();
    expect(normalise('GF')).toBeNull();
  });

  it('flags exactly the expected share of the library', () => {
    const flagged = Object.keys(REAL_CHORDS).filter((c) => normalise(c) !== null);
    // Cm#, Fm#, Gm#, F#m#, C#min, F#min, G#min, b, c#, f#, g#, A\Fm#, D\A
    expect(flagged.sort()).toEqual(
      [
        'A\\Fm#',
        'C#min',
        'Cm#',
        'D\\A',
        'F#m#',
        'F#min',
        'Fm#',
        'G#min',
        'Gm#',
        'b',
        'c#',
        'f#',
        'g#',
      ].sort(),
    );
  });
});

describe('robustness', () => {
  it('never throws on arbitrary input', () => {
    const nasty = ['', '   ', '((', '///', 'x', '日本語', 'H', '12345', 'G/', '/G', '-'];
    for (const s of nasty) {
      expect(() => formatChord(transposeChord(parseChord(s), 5, 'D'))).not.toThrow();
    }
  });

  it('preserves unparsed input verbatim through transposition', () => {
    expect(tr('instr.', 5)).toBe('instr.');
    expect(tr('GF', 5)).toBe('GF');
  });

  it('does not mistake a lyric fragment for a chord', () => {
    for (const s of ['ad lib', 'forte', 'de cate ori', 'end']) {
      expect(parseChord(s).kind).toBe('unparsed');
    }
  });
});
