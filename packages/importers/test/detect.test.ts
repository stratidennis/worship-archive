import { describe, expect, it } from 'vitest';
import { detectFormat, importAny } from '../src/detect.js';

describe('working out what a file is', () => {
  it('recognises ChordPro by a directive', () => {
    expect(detectFormat('{title: Bunatatea Ta}\n{key: G}\n')).toBe('chordpro');
  });

  it('recognises ChordPro by an inline chord', () => {
    expect(detectFormat('Eu Te iu[G]besc')).toBe('chordpro');
  });

  it('recognises OpenSong', () => {
    expect(detectFormat('<song><title>x</title><lyrics>[V1]\n words\n</lyrics></song>')).toBe(
      'opensong',
    );
  });

  it('recognises the legacy SwiftTec format', () => {
    expect(detectFormat('<song xmlns="swifttec/song"><info></info></song>')).toBe(
      'legacy-song',
    );
  });

  it('falls back to plain text', () => {
    expect(detectFormat('Verse 1\nG   C\nwords here\n')).toBe('plain-text');
  });

  it('uses the extension only when the content says nothing', () => {
    expect(detectFormat('just words with no markup', 'song.chopro')).toBe('chordpro');
    expect(detectFormat('just words with no markup', 'notes.txt')).toBe('plain-text');
  });

  it('prefers content over a lying extension', () => {
    // ChordPro saved as .txt is the single most common case.
    expect(detectFormat('{title: X}\nwords', 'song.txt')).toBe('chordpro');
  });
});

describe('importing whatever arrives', () => {
  it('returns a song and the format it used, for every kind', () => {
    const cases: [string, string, string][] = [
      ['{title: A}\nEu Te iu[G]besc', 'a.chopro', 'chordpro'],
      ['<song><title>B</title><lyrics>[V1]\n words\n</lyrics></song>', 'b', 'opensong'],
      ['Titlu\n\nVerse\nG  C\nwords\n', 'c.txt', 'plain-text'],
    ];
    for (const [source, filename, format] of cases) {
      const result = importAny(source, { filename });
      expect(result.format).toBe(format);
      expect(result.song.title).not.toBe('');
    }
  });

  it('names an untitled ChordPro file after the file', () => {
    const result = importAny('Eu Te iu[G]besc', { filename: 'Bunatatea Ta.chopro' });
    expect(result.song.title).toBe('Bunatatea Ta');
    expect(result.notes.map((n) => n.kind)).toContain('title-from-filename');
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of ['', '\0\0\0', '<<<>>>', '{{{{']) {
      expect(() => importAny(bad, { filename: 'x' })).not.toThrow();
    }
  });
});
