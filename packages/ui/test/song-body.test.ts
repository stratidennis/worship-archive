import { describe, expect, it } from 'vitest';
import { hasVisibleChordRow } from '../src/components/SongBody.js';

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
