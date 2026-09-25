import { describe, expect, it } from 'vitest';
import { emptyBlock, emptyLine, replaceBlockWithBlocks, type Song } from '@worship/core';
import { importPlainText, looksLikeStructuredSongText } from '@worship/importers';

function existingSong(): Song {
  const first = emptyBlock('V1', 'Verse');
  first.lines = [emptyLine('This section stays')];
  const target = emptyBlock('V2', 'Verse');
  target.lines = [emptyLine('Paste here')];
  const ending = emptyBlock('E1', 'Ending');
  ending.lines = [emptyLine('This ending stays')];
  return {
    id: 'song',
    legacyUuid: null,
    title: 'Existing title',
    writtenKey: 'C',
    performanceKey: 'D',
    tempo: null,
    timeSignature: null,
    authors: ['Paul'],
    copyright: null,
    ccli: null,
    tags: ['worship'],
    collectionIds: [],
    blocks: [first, target, ending],
    arrangement: ['V1', 'V2', 'E1'],
    lang: 'ro',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 3,
  };
}

describe('direct structured paste in the song editor', () => {
  it('turns one paste into sections at the target while preserving the rest of the song', () => {
    const source = `1. First verse line
Second verse line

R: /: Chorus line
Another chorus line :/`;
    expect(looksLikeStructuredSongText(source)).toBe(true);

    const original = existingSong();
    const pasted = importPlainText(source, { title: original.title });
    const result = replaceBlockWithBlocks(original, 'V2', pasted.blocks);

    expect(result.title).toBe('Existing title');
    expect(result.writtenKey).toBe('C');
    expect(result.performanceKey).toBe('D');
    expect(result.authors).toEqual(['Paul']);
    expect(result.blocks.map((block) => block.type)).toEqual([
      'Verse',
      'Verse',
      'Chorus',
      'Ending',
    ]);
    expect(result.blocks.map((block) => block.id)).toEqual(['V1', 'V2', 'C1', 'E1']);
    expect(result.blocks[0]!.lines[0]!.text).toBe('This section stays');
    expect(result.blocks[1]!.lines.map((line) => line.text)).toEqual([
      'First verse line',
      'Second verse line',
    ]);
    expect(result.blocks[2]!.repeat).toBe(2);
    expect(result.blocks[3]!.lines[0]!.text).toBe('This ending stays');
    expect(result.arrangement).toBeNull();
  });

  it('keeps an ordinary multiline lyric paste in its current section', () => {
    expect(looksLikeStructuredSongText('First line\nSecond line')).toBe(false);
  });
});
