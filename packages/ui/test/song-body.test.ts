import { describe, expect, it } from 'vitest';
import { hasVisibleChordRow } from '../src/components/SongBody.js';
import { cueAppearance } from '../src/lib/cueAppearance.js';

describe('song line chord spacing', () => {
  it('does not reserve a chord row for a lyric-only line', () => {
    expect(
      hasVisibleChordRow({ chords: [], bass: [] }, { showChords: true, showBass: true }),
    ).toBe(false);
  });

  it('reserves the row only when a populated layer is visible', () => {
    const line = {
      chords: [{ at: 0, raw: 'G' }],
      bass: [{ at: 2, raw: 'E' }],
    };
    expect(hasVisibleChordRow(line, { showChords: true, showBass: false })).toBe(true);
    expect(hasVisibleChordRow(line, { showChords: false, showBass: true })).toBe(true);
    expect(hasVisibleChordRow(line, { showChords: false, showBass: false })).toBe(false);
  });
});

describe('song cue blocks', () => {
  it('gives every cue type its own colour and slightly smaller text', () => {
    const appearances = ['Intro', 'Instrumental', 'Solo', 'Note'].map(cueAppearance);
    expect(appearances.every((appearance) => appearance?.fontScale === 0.8)).toBe(true);
    expect(new Set(appearances.map((appearance) => appearance?.background)).size).toBe(4);
    expect(cueAppearance('Verse')).toBeNull();
  });
});
