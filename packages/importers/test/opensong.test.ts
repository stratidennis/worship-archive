import { describe, expect, it } from 'vitest';
import { importOpenSong, looksLikeOpenSong } from '../src/opensong.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<song>
  <title>Amazing Grace</title>
  <author>John Newton</author>
  <copyright>Public domain</copyright>
  <ccli>22025</ccli>
  <key>G</key>
  <tempo>72</tempo>
  <time_sig>3/4</time_sig>
  <themes><theme>Grace</theme><theme>Salvation</theme></themes>
  <lyrics>[V1]
.G          C        G
 Amazing grace how sweet the sound
; a comment nobody sings
[C]
.D        G
 That saved a wretch like me
---
[Bridge]
 No chords on this one
</lyrics>
</song>`;

describe('recognising OpenSong', () => {
  it('needs both a song and a lyrics element', () => {
    expect(looksLikeOpenSong(SAMPLE)).toBe(true);
    expect(looksLikeOpenSong('<song><info>legacy</info></song>')).toBe(false);
    expect(looksLikeOpenSong('just words')).toBe(false);
  });
});

describe('importing OpenSong', () => {
  const song = importOpenSong(SAMPLE, { now: '2026-01-01T00:00:00.000Z' });

  it('reads the metadata', () => {
    expect(song.title).toBe('Amazing Grace');
    expect(song.writtenKey).toBe('G');
    expect(song.tempo).toBe(72);
    expect(song.timeSignature).toBe('3/4');
    expect(song.authors).toEqual(['John Newton']);
    expect(song.ccli).toBe('22025');
    expect(song.tags).toEqual(['Grace', 'Salvation']);
  });

  it('maps section codes to block types', () => {
    expect(song.blocks.map((b) => b.type)).toEqual(['Verse', 'Chorus', 'Bridge']);
  });

  it('corrects for the leading-space sigil', () => {
    // `.G` has G at column 1; the lyric's real first character is also at column 1.
    // A chord one letter late is the bug this test exists to catch.
    const line = song.blocks[0]!.lines[0]!;
    expect(line.text).toBe('Amazing grace how sweet the sound');
    expect(line.chords[0]).toEqual({ at: 0, raw: 'G' });
    expect(line.chords[1]).toEqual({ at: 11, raw: 'C' });
  });

  it('drops comments and page breaks', () => {
    const all = song.blocks.flatMap((b) => b.lines.map((l) => l.text));
    expect(all.some((t) => t.includes('comment'))).toBe(false);
    expect(all.some((t) => t.includes('---'))).toBe(false);
  });

  it('keeps a lyric line that has no chords', () => {
    expect(song.blocks[2]!.lines[0]!.text).toBe('No chords on this one');
  });

  it('does not throw on a truncated file', () => {
    expect(() => importOpenSong('<song><lyrics>[V1]')).not.toThrow();
  });
});
