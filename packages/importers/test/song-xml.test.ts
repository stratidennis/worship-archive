import { describe, expect, it } from 'vitest';
import { importSongXml, parseFilenameKeys, parseLineContent } from '../src/song-xml.js';
import { classifyMisc, parseArrangementText } from '../src/misc-blocks.js';

const OPTS = { now: '2026-01-01T00:00:00.000Z', makeId: () => 'fixed-id' };

function wrap(body: string, info = '<title>T</title>'): string {
  return `<?xml version="1.0"?>
<song xmlns="swifttec/song">
<uuid>u-1</uuid><updated>20241119205837</updated>
<info>${info}</info>
${body}
</song>`;
}

describe('line content', () => {
  it('extracts chords with correct offsets', () => {
    const r = parseLineContent('Eu Te iu<chord>G</chord>besc, mila <chord>C</chord>Ta');
    expect(r.text).toBe('Eu Te iubesc, mila Ta');
    expect(r.chords).toEqual([
      { at: 8, raw: 'G' },
      { at: 19, raw: 'C' },
    ]);
  });

  it('decodes entities', () => {
    expect(parseLineContent('a &amp; b &lt;c&gt; &#65;').text).toBe('a & b <c> A');
  });

  it('preserves malformed chords verbatim', () => {
    const r = parseLineContent('x<chord>Cm#</chord>y<chord>A\\Fm#</chord>');
    expect(r.chords.map((c) => c.raw)).toEqual(['Cm#', 'A\\Fm#']);
  });

  it('keeps text when a chord tag is unclosed', () => {
    expect(() => parseLineContent('a <chord>G b')).not.toThrow();
  });
});

describe('filenames', () => {
  it('reads written and performance keys around the title', () => {
    expect(parseFilenameKeys('C - Dumnezeu e dragostea mea - D.song')).toEqual({
      title: 'Dumnezeu e dragostea mea',
      writtenKey: 'C',
      performanceKey: 'D',
    });
  });

  it('reads a prefix-only filename', () => {
    expect(parseFilenameKeys('Bb - Bunatatea Ta.song')).toEqual({
      title: 'Bunatatea Ta',
      writtenKey: 'Bb',
      performanceKey: null,
    });
  });

  it('ignores a filename with no key prefix', () => {
    expect(parseFilenameKeys('Vino Isus esti atat de asteptat.song').writtenKey).toBeNull();
  });
});

describe('Misc block classification', () => {
  it('extracts a key change and drops the block', () => {
    const c = classifyMisc(['TRANSPOSE: G+3=>Bb']);
    expect(c.keyChange).toEqual({ written: 'G', performance: 'Bb', semitones: 3 });
    expect(c.redundant).toBe(true);
  });

  it('accepts the GAMA spelling and spaces', () => {
    expect(classifyMisc(['GAMA: D+1 => Eb']).keyChange).toEqual({
      written: 'D',
      performance: 'Eb',
      semitones: 1,
    });
  });

  it('still classifies what is left after a key change', () => {
    // The real "Bunatatea Ta" block holds both lines.
    const c = classifyMisc(['TRANSPOSE: G+3=>Bb', 'INTRO chitara: G C G x2']);
    expect(c.keyChange?.performance).toBe('Bb');
    expect(c.type).toBe('Intro');
    expect(c.redundant).toBe(false);
    expect(c.lines).toEqual(['INTRO chitara: G C G x2']);
  });

  it('recognises intro cues', () => {
    for (const line of [
      'INTRO: C F (de cate ori e nevoie)',
      'INTRO: (A Bm G) x2',
      'INTRO: primele 2 versuri din strofa',
      'INTRARE: ceva',
    ]) {
      expect(classifyMisc([line]).type).toBe('Intro');
    }
  });

  it('recognises instrumental breaks', () => {
    expect(classifyMisc(['INSTRUMENTAL: D A Bm G - forte']).type).toBe('Instrumental');
    expect(classifyMisc(['Instrumental: A Bm G']).type).toBe('Instrumental');
    expect(classifyMisc(['INSTR: x']).type).toBe('Instrumental');
  });

  it('recognises a solo and names the person', () => {
    expect(classifyMisc(['SOLO Dennis:'])).toMatchObject({ type: 'Solo', label: 'Dennis' });
    expect(classifyMisc(['SOLO: Dennis'])).toMatchObject({ type: 'Solo', label: 'Dennis' });
    expect(classifyMisc(['SOLO'])).toMatchObject({ type: 'Solo', label: null });
  });

  it('turns "everyone" markers into a singers hint', () => {
    const c = classifyMisc(['TOTI:']);
    expect(c.singersHint).toBe('All');
    expect(c.redundant).toBe(true);
  });

  it('keeps anything it does not understand as a note', () => {
    const c = classifyMisc(['Refren x2']);
    expect(c.type).toBe('Note');
    expect(c.lines).toEqual(['Refren x2']);
  });
});

describe('arrangement text', () => {
  it('reads a full structure line', () => {
    expect(parseArrangementText('Strofa -> Refren x1 -> Strofa -> Refren x2 -> Final')).toEqual(
      ['V1', 'C1', 'V2', 'C2', 'C2', 'E1'],
    );
  });

  it('honours explicit numbers', () => {
    expect(parseArrangementText('Strofa 1 -> Bridge -> Refren x2')).toEqual([
      'V1',
      'B1',
      'C1',
      'C1',
    ]);
  });

  it('refuses a partially understood structure rather than guessing', () => {
    expect(parseArrangementText('Strofa -> something odd -> Final')).toBeNull();
    expect(parseArrangementText('Refren')).toBeNull();
  });
});

describe('importing a whole file', () => {
  it('reads blocks, lines, chords and attributes', () => {
    const { song } = importSongXml(
      wrap(
        `<block type="Verse" id="V1">
<line singers="Leader">Eu Te iu<chord>G</chord>besc</line>
<line indent="1">A doua linie</line>
</block>
<block type="Chorus" id="C1" repeat="2">
<line>Refren</line>
</block>`,
        '<title>Bunatatea Ta</title><key>G</key><tempo>72</tempo>',
      ),
      OPTS,
    );

    expect(song.title).toBe('Bunatatea Ta');
    expect(song.writtenKey).toBe('G');
    expect(song.tempo).toBe(72);
    expect(song.legacyUuid).toBe('u-1');
    expect(song.createdAt).toBe('2024-11-19T20:58:37.000Z');
    expect(song.blocks).toHaveLength(2);
    expect(song.blocks[0]!.lines[0]!.singers).toBe('Leader');
    expect(song.blocks[0]!.lines[0]!.chords).toEqual([{ at: 8, raw: 'G' }]);
    expect(song.blocks[0]!.lines[1]!.indent).toBe(1);
    expect(song.blocks[1]!.repeat).toBe(2);
  });

  it('always mints a fresh id — legacy uuids are not unique', () => {
    const a = importSongXml(wrap('<block type="Verse" id="V1"><line>x</line></block>'), {
      makeId: () => 'new-1',
    });
    expect(a.song.id).toBe('new-1');
    expect(a.song.legacyUuid).toBe('u-1');
  });

  it('lets an explicit TRANSPOSE override the key field', () => {
    // The chords are written in G; <key> holds the key they perform in.
    const { song } = importSongXml(
      wrap(
        `<block type="Misc" id="M1"><line>TRANSPOSE: G+3=&gt;Bb</line></block>
<block type="Verse" id="V1"><line>x</line></block>`,
        '<title>T</title><key>Bb</key>',
      ),
      OPTS,
    );
    expect(song.writtenKey).toBe('G');
    expect(song.performanceKey).toBe('Bb');
  });

  it('splits a key pair crammed into the key field', () => {
    const { song } = importSongXml(
      wrap(
        '<block type="Verse" id="V1"><line>x</line></block>',
        '<title>T</title><key>C-D</key>',
      ),
      OPTS,
    );
    expect(song.writtenKey).toBe('C');
    expect(song.performanceKey).toBe('D');
  });

  it('recovers the performance key from a filename suffix', () => {
    const { song } = importSongXml(
      wrap(
        '<block type="Verse" id="V1"><line>x</line></block>',
        '<title>T</title><key>C</key>',
      ),
      { ...OPTS, filename: 'C - Dumnezeu e dragostea mea - D.song' },
    );
    expect(song.writtenKey).toBe('C');
    expect(song.performanceKey).toBe('D');
  });

  it('applies an "everyone" marker to the block that follows', () => {
    const { song } = importSongXml(
      wrap(
        `<block type="Misc" id="M1"><line>TOTI:</line></block>
<block type="Chorus" id="C1"><line>Refren</line></block>`,
      ),
      OPTS,
    );
    expect(song.blocks).toHaveLength(1);
    expect(song.blocks[0]!.singers).toBe('All');
  });

  it('drops blocks that end up empty but keeps everything else', () => {
    const { song } = importSongXml(
      wrap(`<block type="Misc" id="M1"><line>TRANSPOSE: G+2=&gt;A</line></block>`),
      OPTS,
    );
    expect(song.blocks).toHaveLength(0);
    expect(song.writtenKey).toBe('G');
  });

  it('never throws on damaged input', () => {
    for (const bad of ['', '<song>', '<song><block></block></song>', '<<<>>>']) {
      expect(() => importSongXml(bad, OPTS)).not.toThrow();
    }
  });
});
