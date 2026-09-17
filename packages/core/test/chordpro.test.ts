import { describe, expect, it } from 'vitest';
import { parseChordPro, splitChords } from '../src/chordpro/parse.js';
import { joinChords, serialiseChordPro } from '../src/chordpro/serialise.js';
import { emptyBlock, emptyLine, type Song } from '../src/types.js';

const FIXED = { now: '2026-01-01T00:00:00.000Z', makeId: () => 'fixed-id' };

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'fixed-id',
    legacyUuid: null,
    title: 'Test',
    writtenKey: null,
    performanceKey: null,
    tempo: null,
    timeSignature: null,
    authors: [],
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: [],
    arrangement: null,
    lang: null,
    createdAt: FIXED.now,
    updatedAt: FIXED.now,
    rev: 0,
    ...overrides,
  };
}

describe('chord position splitting', () => {
  it('extracts chords and leaves clean lyrics', () => {
    const r = splitChords('Eu Te iu[G]besc, mila [C]Ta');
    expect(r.text).toBe('Eu Te iubesc, mila Ta');
    expect(r.chords).toEqual([
      { at: 8, raw: 'G' },
      { at: 19, raw: 'C' },
    ]);
  });

  it('handles a chord at the very start', () => {
    const r = splitChords('[C]Căci Tu mereu');
    expect(r.text).toBe('Căci Tu mereu');
    expect(r.chords).toEqual([{ at: 0, raw: 'C' }]);
  });

  it('handles adjacent chords', () => {
    const r = splitChords('su[G]flar[Em]e');
    expect(r.chords).toEqual([
      { at: 2, raw: 'G' },
      { at: 6, raw: 'Em' },
    ]);
  });

  it('keeps an unclosed bracket as literal text', () => {
    expect(splitChords('a [b c').text).toBe('a [b c');
  });

  it('respects escaped brackets', () => {
    const r = splitChords('a \\[not a chord\\] b');
    expect(r.text).toBe('a [not a chord] b');
    expect(r.chords).toEqual([]);
  });

  it('round-trips through joinChords', () => {
    for (const source of [
      'Eu Te iu[G]besc, mila [C]Ta',
      '[C]Căci Tu mereu',
      'su[G]flar[Em]e',
      'no chords at all',
      '[G]',
      'trailing chord[D]',
    ]) {
      const { text, chords } = splitChords(source);
      const line = emptyLine(text);
      line.chords = chords;
      expect(joinChords(line)).toBe(source);
    }
  });
});

describe('round-trip', () => {
  it('survives parse → serialise → parse with everything populated', () => {
    const block = emptyBlock('V1', 'Verse');
    block.singers = 'Leader';
    block.repeat = 2;
    block.linkToPrevious = true;
    block.bandOnly = false;
    const line = emptyLine('Eu Te iubesc');
    line.chords = [{ at: 8, raw: 'G' }];
    line.bass = [{ at: 0, raw: 'G' }];
    line.singers = 'Women';
    line.indent = 1;
    line.color = '#ff0000';
    block.lines.push(line);

    const solo = emptyBlock('S1', 'Solo');
    solo.label = 'Dennis';
    solo.bandOnly = true;
    solo.lines.push(emptyLine('opt 1'));

    const original = song({
      title: 'Bunatatea Ta',
      writtenKey: 'G',
      performanceKey: 'Bb',
      tempo: 72,
      timeSignature: '4/4',
      authors: ['Cineva'],
      copyright: '2024',
      ccli: '12345',
      tags: ['inchinare', 'comuniune'],
      arrangement: ['V1', 'S1', 'V1'],
      legacyUuid: 'legacy-1',
      blocks: [block, solo],
      rev: 3,
    });

    const text = serialiseChordPro(original);
    const reparsed = parseChordPro(text, FIXED);
    expect(reparsed).toEqual(original);
  });

  it('is byte-stable: serialise → parse → serialise', () => {
    const block = emptyBlock('C1', 'Chorus');
    block.lines.push(emptyLine('Căci Tu mereu ai fost cu mine'));
    const s = song({ title: 'X', writtenKey: 'G', blocks: [block] });
    const once = serialiseChordPro(s);
    const twice = serialiseChordPro(parseChordPro(once, FIXED));
    expect(twice).toBe(once);
  });

  it('preserves malformed chords exactly', () => {
    const block = emptyBlock('V1', 'Verse');
    const line = emptyLine('test line');
    line.chords = [
      { at: 0, raw: 'Cm#' },
      { at: 5, raw: 'A\\Fm#' },
      { at: 9, raw: 'instr.' },
    ];
    block.lines.push(line);
    const s = song({ blocks: [block] });
    const reparsed = parseChordPro(serialiseChordPro(s), FIXED);
    expect(reparsed.blocks[0]!.lines[0]!.chords).toEqual(line.chords);
  });

  it('escapes braces and brackets in lyrics', () => {
    const block = emptyBlock('V1', 'Verse');
    block.lines.push(emptyLine('a [bracket] and a {brace}'));
    const s = song({ blocks: [block] });
    const reparsed = parseChordPro(serialiseChordPro(s), FIXED);
    expect(reparsed.blocks[0]!.lines[0]!.text).toBe('a [bracket] and a {brace}');
  });
});

describe('reading generic ChordPro from elsewhere', () => {
  it('understands short aliases', () => {
    const s = parseChordPro('{t: Amazing Grace}\n{k: G}\n{a: Newton}\nline', FIXED);
    expect(s.title).toBe('Amazing Grace');
    expect(s.writtenKey).toBe('G');
    expect(s.authors).toEqual(['Newton']);
  });

  it('understands {soc}/{eoc} shorthand', () => {
    const s = parseChordPro('{soc}\nchorus line\n{eoc}', FIXED);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]!.type).toBe('Chorus');
  });

  it('splits on blank lines when there are no environments at all', () => {
    const s = parseChordPro('verse one\nline two\n\nverse two\nline two', FIXED);
    expect(s.blocks).toHaveLength(2);
    expect(s.blocks.map((b) => b.id)).toEqual(['V1', 'V2']);
    expect(s.blocks[0]!.lines).toHaveLength(2);
  });

  it('turns a standalone comment into a Note block', () => {
    const s = parseChordPro('{c: INTRO: C F}\nline', FIXED);
    expect(s.blocks[0]!.type).toBe('Note');
    expect(s.blocks[0]!.lines[0]!.text).toBe('INTRO: C F');
  });

  it('ignores unknown directives rather than failing', () => {
    const s = parseChordPro('{title: X}\n{some_future_thing: 1}\nline', FIXED);
    expect(s.title).toBe('X');
    expect(s.blocks).toHaveLength(1);
  });

  it('skips # comment lines', () => {
    const s = parseChordPro('# a comment\n{title: X}\nline', FIXED);
    expect(s.blocks[0]!.lines).toHaveLength(1);
  });

  it('never produces colliding block ids', () => {
    const s = parseChordPro(
      '{start_of_verse: V2}\na\n{end_of_verse}\n{start_of_verse}\nb\n{end_of_verse}',
      FIXED,
    );
    const ids = s.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops empty blocks', () => {
    const s = parseChordPro('{start_of_verse: V1}\n{end_of_verse}\n', FIXED);
    expect(s.blocks).toHaveLength(0);
  });

  it('mints an id when the file has none', () => {
    expect(parseChordPro('line', FIXED).id).toBe('fixed-id');
  });

  it('never throws on hostile input', () => {
    for (const bad of ['', '{', '}', '{}', '{:}', '[[[', '{start_of_}', '\n\n\n']) {
      expect(() => parseChordPro(bad, FIXED)).not.toThrow();
    }
  });
});
