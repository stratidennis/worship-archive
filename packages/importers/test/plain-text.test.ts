import { describe, expect, it } from 'vitest';
import {
  anchorsFromChordLine,
  importPlainText,
  looksLikeChordLine,
} from '../src/plain-text.js';
import { serialiseChordPro } from '@worship/core';

describe('telling chords from words', () => {
  it('accepts a line of chords', () => {
    expect(looksLikeChordLine('G          C        G')).toBe(true);
    expect(looksLikeChordLine('Am7  F#m/C#  Bb')).toBe(true);
  });

  it('rejects a line with one word that is not a chord', () => {
    // The asymmetry that protects lyrics: one unparseable token rejects the line.
    expect(looksLikeChordLine('G C love G')).toBe(false);
  });

  it('rejects lyrics that happen to start with a chord name', () => {
    expect(looksLikeChordLine('Am I the only one')).toBe(false);
    expect(looksLikeChordLine('Eu Te iubesc')).toBe(false);
  });

  it('is not fooled by a single short word', () => {
    // "A" and "Do" are chords and are also words; one of them alone proves nothing.
    expect(looksLikeChordLine('A')).toBe(false);
    expect(looksLikeChordLine('Do')).toBe(false);
    // Unless it carries chord punctuation that words do not.
    expect(looksLikeChordLine('A/C#')).toBe(true);
  });

  it('tolerates bar lines and repeat markers', () => {
    expect(looksLikeChordLine('| G | C | D | x2')).toBe(true);
  });

  it('rejects an empty line', () => {
    expect(looksLikeChordLine('   ')).toBe(false);
  });
});

describe('column alignment', () => {
  it('puts each chord at the character it was drawn over', () => {
    //                          0123456789...
    const anchors = anchorsFromChordLine('G     C', 'Amazing grace');
    expect(anchors).toEqual([
      { at: 0, raw: 'G' },
      { at: 6, raw: 'C' },
    ]);
  });

  it('clamps a chord past the end of the words rather than dropping it', () => {
    const anchors = anchorsFromChordLine('G                    D', 'Short line');
    expect(anchors[1]).toEqual({ at: 10, raw: 'D' });
  });

  it('ignores bar lines', () => {
    expect(anchorsFromChordLine('| G |', 'words')).toEqual([{ at: 2, raw: 'G' }]);
  });
});

describe('importing chords-over-lyrics text', () => {
  const source = `Amazing Grace
Key: G

Verse 1
G          C        G
Amazing grace how sweet the sound

Chorus
D        G
How sweet the sound
`;

  it('reads the title, key and sections', () => {
    const song = importPlainText(source, { now: '2026-01-01T00:00:00.000Z' });
    expect(song.title).toBe('Amazing Grace');
    expect(song.writtenKey).toBe('G');
    expect(song.blocks.map((b) => b.type)).toEqual(['Verse', 'Chorus']);
  });

  it('places the chords over the right words', () => {
    const song = importPlainText(source);
    const line = song.blocks[0]!.lines[0]!;
    expect(line.text).toBe('Amazing grace how sweet the sound');
    expect(line.chords).toEqual([
      { at: 0, raw: 'G' },
      { at: 11, raw: 'C' },
      { at: 20, raw: 'G' },
    ]);
  });

  it('keeps a chord-only line, for an intro riff', () => {
    const song = importPlainText('Intro\nG  C  D  G\n\nVerse\nwords here\n');
    const intro = song.blocks[0]!;
    expect(intro.type).toBe('Intro');
    expect(intro.lines[0]!.text).toBe('');
    expect(intro.lines[0]!.chords).toHaveLength(4);
  });

  it('understands Romanian section names', () => {
    const song = importPlainText('Titlu\n\nStrofa 1\nversuri\n\nRefren\nalte versuri\n');
    expect(song.blocks.map((b) => b.type)).toEqual(['Verse', 'Chorus']);
  });

  it('falls back to the filename when there is no title', () => {
    const song = importPlainText('Verse\nG\nwords\n', { filename: 'Bunatatea_Ta.txt' });
    expect(song.title).toBe('Bunatatea Ta');
  });

  it('never loses a lyric line, even with no sections at all', () => {
    const song = importPlainText('line one\nline two\nline three\n');
    const text = song.blocks.flatMap((b) => b.lines.map((l) => l.text));
    // The first line becomes the title by convention; the rest must all survive.
    expect(text).toEqual(['line two', 'line three']);
  });

  it('produces something that serialises to ChordPro', () => {
    const song = importPlainText(source);
    expect(serialiseChordPro(song)).toContain('Amazing gra[C]ce');
  });

  it('does not throw on nonsense', () => {
    for (const bad of ['', '\n\n\n', '....', '[[[]]]']) {
      expect(() => importPlainText(bad)).not.toThrow();
    }
  });
});
