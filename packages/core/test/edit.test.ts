import { describe, expect, it } from 'vitest';
import {
  insertBlock,
  mergeBlockUp,
  moveBlock,
  removeBlock,
  setChord,
  setLineText,
  shiftAnchors,
  splitBlock,
} from '../src/edit.js';
import { emptyBlock, emptyLine, type Anchor, type Song } from '../src/types.js';

const A = (at: number, raw = 'G'): Anchor => ({ at, raw });

function songWith(...blocks: { id: string; lines: string[] }[]): Song {
  return {
    id: 's',
    legacyUuid: null,
    title: 'T',
    writtenKey: null,
    performanceKey: null,
    tempo: null,
    timeSignature: null,
    authors: [],
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: blocks.map((b) => {
      const block = emptyBlock(b.id, 'Verse');
      block.lines = b.lines.map((t) => emptyLine(t));
      return block;
    }),
    arrangement: null,
    lang: null,
    createdAt: '',
    updatedAt: '',
    rev: 0,
  };
}

describe('shiftAnchors — chords must follow the text they sit on', () => {
  it('leaves anchors alone when nothing changed', () => {
    const anchors = [A(3), A(7)];
    expect(shiftAnchors('hello world', 'hello world', anchors)).toBe(anchors);
  });

  it('carries later chords along when text is inserted before them', () => {
    // "Eu besc" -> "Eu iubesc", chord was on "besc"
    expect(shiftAnchors('Eu besc', 'Eu iubesc', [A(3)])).toEqual([A(5)]);
  });

  it('leaves earlier chords untouched', () => {
    expect(shiftAnchors('abc def', 'abc XYZ def', [A(0), A(2)])).toEqual([A(0), A(2)]);
  });

  it('pulls chords back when text is deleted before them', () => {
    expect(shiftAnchors('Eu iubesc', 'Eu besc', [A(5)])).toEqual([A(3)]);
  });

  it('collapses a chord inside a deleted span rather than losing it', () => {
    // Deleting "iub" — a chord that sat inside it moves to where the deletion began.
    const result = shiftAnchors('Eu iubesc', 'Eu esc', [A(4)]);
    expect(result).toHaveLength(1);
    expect(result[0]!.at).toBe(3);
  });

  it('never points past the end of the new text', () => {
    for (const anchor of shiftAnchors('a long line here', 'x', [A(5), A(12)])) {
      expect(anchor.at).toBeLessThanOrEqual(1);
      expect(anchor.at).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles clearing the line entirely without dropping chords', () => {
    expect(shiftAnchors('abc', '', [A(0), A(2)])).toEqual([A(0), A(0)]);
  });

  it('handles typing into an empty line', () => {
    expect(shiftAnchors('', 'abc', [A(0)])).toEqual([A(0)]);
  });

  it('keeps the raw chord text exactly', () => {
    expect(shiftAnchors('ab', 'aXb', [A(1, 'Cm#')])[0]!.raw).toBe('Cm#');
  });
});

describe('setLineText', () => {
  it('moves chords and bass notes together', () => {
    const line = { ...emptyLine('Eu besc'), chords: [A(3, 'G')], bass: [A(3, 'D')] };
    const next = setLineText(line, 'Eu iubesc');
    expect(next.chords).toEqual([A(5, 'G')]);
    expect(next.bass).toEqual([A(5, 'D')]);
    expect(next.text).toBe('Eu iubesc');
  });

  it('does not mutate the original', () => {
    const line = { ...emptyLine('abc'), chords: [A(1)] };
    setLineText(line, 'aXbc');
    expect(line.text).toBe('abc');
    expect(line.chords).toEqual([A(1)]);
  });
});

describe('setChord', () => {
  it('adds a chord and keeps anchors sorted', () => {
    let line = emptyLine('hello world');
    line = setChord(line, 6, 'C');
    line = setChord(line, 0, 'G');
    expect(line.chords).toEqual([A(0, 'G'), A(6, 'C')]);
  });

  it('replaces a chord at the same position', () => {
    let line = setChord(emptyLine('abc'), 1, 'G');
    line = setChord(line, 1, 'Am');
    expect(line.chords).toEqual([A(1, 'Am')]);
  });

  it('removes a chord when given an empty value', () => {
    let line = setChord(emptyLine('abc'), 1, 'G');
    line = setChord(line, 1, '   ');
    expect(line.chords).toEqual([]);
  });

  it('writes to the bass layer independently', () => {
    let line = setChord(emptyLine('abc'), 1, 'G');
    line = setChord(line, 1, 'D', 'bass');
    expect(line.chords).toEqual([A(1, 'G')]);
    expect(line.bass).toEqual([A(1, 'D')]);
  });
});

describe('block operations', () => {
  it('inserts a block with a fresh id', () => {
    const song = insertBlock(songWith({ id: 'V1', lines: ['a'] }), 'Chorus');
    expect(song.blocks.map((b) => b.id)).toEqual(['V1', 'C1']);
  });

  it('never reuses an id already in the song', () => {
    const song = insertBlock(songWith({ id: 'V1', lines: ['a'] }), 'Verse');
    expect(song.blocks.map((b) => b.id)).toEqual(['V1', 'V2']);
  });

  it('inserts after a given index', () => {
    const base = songWith({ id: 'V1', lines: ['a'] }, { id: 'V2', lines: ['b'] });
    expect(insertBlock(base, 'Chorus', 0).blocks.map((b) => b.id)).toEqual(['V1', 'C1', 'V2']);
  });

  it('moves a block and refuses to move past the ends', () => {
    const base = songWith({ id: 'V1', lines: ['a'] }, { id: 'V2', lines: ['b'] });
    expect(moveBlock(base, 'V2', -1).blocks.map((b) => b.id)).toEqual(['V2', 'V1']);
    expect(moveBlock(base, 'V1', -1).blocks.map((b) => b.id)).toEqual(['V1', 'V2']);
    expect(moveBlock(base, 'V2', 1).blocks.map((b) => b.id)).toEqual(['V1', 'V2']);
  });

  it('drops a deleted block from the arrangement too', () => {
    const base = { ...songWith({ id: 'V1', lines: ['a'] }, { id: 'C1', lines: ['b'] }) };
    base.arrangement = ['V1', 'C1', 'V1'];
    const song = removeBlock(base, 'C1');
    expect(song.blocks.map((b) => b.id)).toEqual(['V1']);
    expect(song.arrangement).toEqual(['V1', 'V1']);
  });

  it('splits a block in two', () => {
    const song = splitBlock(songWith({ id: 'V1', lines: ['one', 'two', 'three'] }), 'V1', 1);
    expect(song.blocks.map((b) => b.lines.map((l) => l.text))).toEqual([
      ['one'],
      ['two', 'three'],
    ]);
    expect(song.blocks[1]!.id).toBe('V2');
  });

  it('refuses to split at an edge, which would make an empty block', () => {
    const base = songWith({ id: 'V1', lines: ['one', 'two'] });
    expect(splitBlock(base, 'V1', 0)).toBe(base);
    expect(splitBlock(base, 'V1', 2)).toBe(base);
  });

  it('merges a block into the previous one', () => {
    const song = mergeBlockUp(
      songWith({ id: 'V1', lines: ['one'] }, { id: 'V2', lines: ['two'] }),
      'V2',
    );
    expect(song.blocks).toHaveLength(1);
    expect(song.blocks[0]!.lines.map((l) => l.text)).toEqual(['one', 'two']);
  });

  it('cannot merge the first block upwards', () => {
    const base = songWith({ id: 'V1', lines: ['one'] });
    expect(mergeBlockUp(base, 'V1')).toBe(base);
  });
});
