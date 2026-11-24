import { describe, expect, it } from 'vitest';
import { emptyBlock, emptyLine, type BlockType, type Song } from '@worship/core';
import { resolvePerformedOrder } from '../src/performed-order.js';
import { slideGroups } from '../src/powerpoints.js';

function make(spec: [string, BlockType, string][]): Song {
  return {
    blocks: spec.map(([id, type, text]) => ({
      ...emptyBlock(id, type),
      lines: text.split('\n').map(emptyLine),
    })),
    arrangement: null,
  } as Song;
}
const base = () =>
  make([
    ['V1', 'Verse', 'First verse'],
    ['C1', 'Chorus', 'Sung chorus'],
    ['V2', 'Verse', 'Second verse'],
  ]);
const order = (song: Song) => resolvePerformedOrder(song).sections.map((s) => s.id);
const text = (song: Song) =>
  resolvePerformedOrder(song).sections.map((s) => s.lines.join('\n'));

describe('performed order before pagination', () => {
  it('defaults to V1 C1 V2 C1 without mutating the song', () => {
    const song = base();
    const before = JSON.stringify(song);
    expect(order(song)).toEqual(['V1', 'C1', 'V2', 'C1']);
    expect(text(song)).toEqual(['First verse', 'Sung chorus', 'Second verse', 'Sung chorus']);
    expect(JSON.stringify(song)).toBe(before);
  });
  it('does not interpret unrelated notes or source order as chorus suppression', () => {
    const song = base();
    song.blocks.push({ ...emptyBlock('M1', 'Note'), lines: [emptyLine('Soft piano')] });
    song.arrangement = song.blocks.map((b) => b.id);
    expect(order(song)).toEqual(['V1', 'C1', 'V2', 'C1']);
  });
  it('honours explicit order, suppression, opening chorus and reordering', () => {
    const song = base();
    song.arrangement = ['C1', 'V2', 'C1', 'V1', 'C1'];
    expect(order(song)).toEqual(song.arrangement);
    song.arrangement = ['V2', 'V1'];
    expect(order(song)).toEqual(['V2', 'V1']);
    song.arrangement = ['V1', 'C1', 'V2'];
    song.arrangementSource = 'reviewed';
    expect(order(song)).toEqual(['V1', 'C1', 'V2']);
    song.arrangement = null;
    delete song.arrangementSource;
    song.blocks.push({ ...emptyBlock('M1', 'Note'), lines: [emptyLine('Fără refren')] });
    expect(order(song)).toEqual(['V1', 'V2']);
  });
  it('keeps prechoruses and variant choruses with verses, then sung ending and tag', () => {
    const song = make([
      ['C1', 'Chorus', 'Opening'],
      ['V1', 'Verse', 'One'],
      ['P1', 'PreChorus', 'Prepare'],
      ['C2', 'Chorus', 'Variant'],
      ['V2', 'Verse', 'Two'],
      ['P2', 'PreChorus', 'Prepare again'],
      ['B1', 'Bridge', 'Bridge lyric'],
      ['E1', 'Ending', 'Final: Forever!'],
      ['T1', 'Tag', 'Amen!'],
    ]);
    expect(order(song)).toEqual(['C1', 'V1', 'P1', 'C2', 'V2', 'P2', 'C2', 'B1', 'E1', 'T1']);
    expect(text(song).slice(-2)).toEqual(['Forever!', 'Amen!']);
  });
  it('repeats complete long verses before adding a chorus', () => {
    const song = base();
    song.blocks[0]!.repeat = 2;
    song.blocks[0]!.lines = Array.from({ length: 7 }, (_, i) => emptyLine(`Lyric ${i + 1}`));
    const pages = resolvePerformedOrder(song).sections.flatMap((s) => slideGroups(s.lines));
    expect(pages).toEqual([
      ['Lyric 1', 'Lyric 2', 'Lyric 3', 'Lyric 4'],
      ['Lyric 5', 'Lyric 6', 'Lyric 7'],
      ['Lyric 1', 'Lyric 2', 'Lyric 3', 'Lyric 4'],
      ['Lyric 5', 'Lyric 6', 'Lyric 7'],
      ['Sung chorus'],
      ['Second verse'],
      ['Sung chorus'],
    ]);
  });
  it('supports bridge, ending, block and inline span repeats', () => {
    const song = make([
      ['B1', 'Bridge', '/:Sing\nWith joy :/ x3'],
      ['E1', 'Ending', 'Start /:Holy :/ x2\nForever'],
    ]);
    song.blocks[0]!.repeat = 3;
    expect(text(song)).toEqual([
      'Sing\nWith joy',
      'Sing\nWith joy',
      'Sing\nWith joy',
      'Start Holy\nHoly\nForever',
    ]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
  });
  it('does not multiply repeated arrangement IDs by block and note repeats', () => {
    const song = base();
    song.blocks[1]!.repeat = 2;
    song.blocks.push({ ...emptyBlock('M1', 'Note'), lines: [emptyLine('Refren x2')] });
    song.arrangement = ['V1', 'C1', 'C1', 'V2', 'C1', 'C1'];
    expect(order(song)).toEqual(song.arrangement);
  });
  it('uses each chorus repeat cue where it appears, including after a bridge', () => {
    const song = make([
      ['V1', 'Verse', 'First verse'],
      ['C1', 'Chorus', 'Sung chorus'],
      ['V2', 'Verse', 'Second verse'],
      ['M1', 'Note', 'Refren x1'],
      ['V3', 'Verse', 'Third verse'],
      ['M2', 'Note', 'Refren x2'],
      ['B1', 'Bridge', 'Sung bridge'],
      ['M3', 'Note', 'Refren x1'],
    ]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(order(song)).toEqual(['V1', 'C1', 'V2', 'C1', 'V3', 'C1', 'C1', 'B1', 'C1']);
  });
  it('plays numbered chorus cues and reference-only sections using their lyric blocks', () => {
    const song = make([
      ['V1', 'Verse', 'First verse'],
      ['V7', 'Chorus', 'First chorus'],
      ['V2', 'Verse', 'Second verse'],
      ['C1', 'Chorus', 'Alternate chorus'],
      ['M1', 'Note', 'Refren 1'],
      ['E1', 'Ending', 'Final: Refren x2'],
    ]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(text(song)).toEqual([
      'First verse',
      'First chorus',
      'Second verse',
      'Alternate chorus',
      'First chorus',
      'First chorus',
      'First chorus',
    ]);
  });
  it('applies a reference section repeat in an explicit order with distinct section IDs', () => {
    const song = make([
      ['V1', 'Verse', 'First verse'],
      ['C1', 'Chorus', 'Sung chorus'],
      ['C2', 'Chorus', 'Refren x2'],
    ]);
    song.arrangement = ['C1', 'C2', 'V1'];
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(order(song)).toEqual(['C1', 'C1', 'C1', 'V1']);
  });
  it('recognizes a legacy repeat bracket written backwards at the end of a lyric', () => {
    const song = make([['V1', 'Verse', 'Opening\n/: Sing\nWith joy /:']]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(text(song)).toEqual(['Opening\nSing\nWith joy\nSing\nWith joy']);
  });
  it.each([': /', ':\\', '/:'])('accepts the legacy %s closing mark', (close) => {
    const song = make([['B1', 'Bridge', '/: Sing\nWith joy ' + close + ' x3']]);
    const result = resolvePerformedOrder(song);
    expect(result.issues).toEqual([]);
    expect(result.sections.map(({ lines }) => lines)).toEqual(
      Array(3).fill(['Sing', 'With joy']),
    );
  });
  it('keeps a bracketed range together across verses, a bridge and a chorus', () => {
    const song = make([
      ['V1', 'Verse', '/: Opening line'],
      ['V2', 'Verse', 'Next verse'],
      ['B1', 'Bridge', 'Through the bridge'],
      ['C1', 'Chorus', 'Sung chorus : / x3'],
      ['E1', 'Ending', 'Final word'],
    ]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(order(song)).toEqual([...Array(3).fill(['V1', 'V2', 'B1', 'C1']).flat(), 'E1']);
    song.arrangement = ['C1', 'V1'];
    song.arrangementSource = 'reviewed';
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(text(song)).toEqual(['Sung chorus', 'Opening line']);
  });
  it('applies a trailing lyric count separately from an earlier bracketed repeat', () => {
    const song = make([['B1', 'Bridge', '/: Sing\nWith joy :/\nWith joy x2']]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(text(song)).toEqual(['Sing\nWith joy\nSing\nWith joy\nWith joy\nWith joy']);
  });
  it('keeps numeric percentages and words ending in x followed by a number', () => {
    const song = make([['V1', 'Verse', 'Give 100%\nTrack mix 2']]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(text(song)).toEqual(['Give 100%\nTrack mix 2']);
  });
  it('recognizes compact, prefixed and ordinal cues and honors ordered cue sequences', () => {
    const song = make([
      ['M1', 'Note', 'Început: 1xRef'],
      ['V1', 'Verse', 'Opening verse'],
      ['C1', 'Chorus', 'First chorus'],
      ['C2', 'Chorus', 'Second chorus'],
      ['B1', 'Bridge', 'Sung bridge'],
      ['M2', 'Note', 'Repetăm: Bridge + Al 2-lea Refren'],
      ['M3', 'Note', 'REFX2 (Forte)'],
    ]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(order(song)).toEqual(['C1', 'V1', 'C1', 'C2', 'B1', 'B1', 'C2', 'C2', 'C2']);
  });
  it('repeats the performed lyrics up to an explicit repeat-all cue', () => {
    const song = make([
      ['V1', 'Verse', 'Opening verse'],
      ['C1', 'Chorus', '/: Chorus lyrics :/'],
      ['M1', 'Note', 'Se repetă tot încă o dată'],
      ['E1', 'Ending', 'Sung ending'],
    ]);
    expect(resolvePerformedOrder(song).issues).toEqual([]);
    expect(order(song)).toEqual(['V1', 'C1', 'C1', 'V1', 'C1', 'C1', 'E1']);
    song.arrangement = ['V1', 'C1', 'E1'];
    song.arrangementSource = 'reviewed';
    expect(order(song)).toEqual(song.arrangement);
  });
  it('does not turn conditional or direction-only prose into projected lyrics', () => {
    const song = make([
      ['V1', 'Verse', 'Verse lyrics'],
      ['C1', 'Chorus', 'Chorus lyrics'],
      ['V2', 'Verse', 'Strofa x2 + Refren x2 (optional)'],
      ['T1', 'Tag', 'Instrumental'],
    ]);
    expect(resolvePerformedOrder(song).issues).toEqual([
      'Review ambiguous instruction: Strofa x2 + Refren x2 (optional)',
    ]);
    expect(order(song)).toEqual(['V1', 'C1']);
  });
  it('still flags different repeat counts for the same chorus appearance', () => {
    const song = base();
    song.blocks.splice(2, 0, {
      ...emptyBlock('M1', 'Note'),
      lines: [emptyLine('Refren x1'), emptyLine('Refren x2')],
    });
    expect(resolvePerformedOrder(song).issues).toContain('Conflicting repeats: C1');
  });
  it('reads clear notes, keeps inferred provenance and flags ambiguity', () => {
    const song = base();
    song.blocks.push({
      ...emptyBlock('M1', 'Note'),
      lines: [emptyLine('STRUCTURA: V2 -> C1 x2 -> V1')],
    });
    song.arrangementSource = 'inferred';
    song.arrangement = ['V2', 'C1', 'C1', 'V1'];
    expect(order(song)).toEqual(song.arrangement);
    song.blocks.at(-1)!.lines = [emptyLine('Repeat chorus maybe twice')];
    expect(resolvePerformedOrder(song).issues).toEqual([
      'Review ambiguous instruction: Repeat chorus maybe twice',
    ]);
  });
  it('removes metadata while preserving meaningful numbers and punctuation', () => {
    const song = make([
      ['V1', 'Verse', 'V1\n1. Sing 1000 praises!\nG Am D\n[Band only]\n/:Holy, holy! :/'],
    ]);
    expect(text(song)).toEqual(['Sing 1000 praises!\nHoly, holy!\nHoly, holy!']);
  });
});

it('deduplicates expanded percent spans and reports conflicting repeat counts', () => {
  const song = make([['B1', 'Bridge', '%Sing\nWith joy% x3\nSing\nWith joy\nSing\nWith joy']]);
  expect(text(song)).toEqual(['Sing\nWith joy', 'Sing\nWith joy', 'Sing\nWith joy']);
  song.blocks[0]!.repeat = 2;
  expect(resolvePerformedOrder(song).issues).toEqual(['B1: conflicting repeat counts']);
});
it('applies standalone verse and ending repeat notes to all sung sections', () => {
  const song = make([
    ['V1', 'Verse', 'Verse lyric'],
    ['E1', 'Ending', 'Ending lyric'],
    ['M1', 'Note', 'V1 x2\nEnding x3'],
  ]);
  expect(text(song)).toEqual([
    'Verse lyric',
    'Verse lyric',
    'Ending lyric',
    'Ending lyric',
    'Ending lyric',
  ]);
});
it('does not export a source instruction as lyric text', () => {
  const song = make([['V1', 'Verse', 'Sing :/ x2']]);
  expect(resolvePerformedOrder(song).issues).toEqual([
    'V1: unmatched or unsupported lyric repeat; review the source',
  ]);
});

it('distinguishes returning to a chorus from an adjacent expanded repeat', () => {
  const song = base();
  song.blocks[1]!.repeat = 2;
  song.arrangement = ['V1', 'C1', 'V2', 'C1'];
  expect(order(song)).toEqual(['V1', 'C1', 'C1', 'V2', 'C1', 'C1']);
});

it('recognises exact expanded whole-block copies with retained repeat metadata', () => {
  const song = make([
    ['B1', 'Bridge', 'Sing\nWith joy\nSing\nWith joy'],
    ['M1', 'Note', 'B1 x2'],
  ]);
  song.blocks[0]!.repeat = 2;
  expect(text(song)).toEqual(['Sing\nWith joy', 'Sing\nWith joy']);
  song.arrangement = ['B1', 'B1'];
  expect(text(song)).toEqual(['Sing\nWith joy', 'Sing\nWith joy']);
});

it('gives reviewed occurrence order precedence over legacy section repeat metadata', () => {
  const song = base();
  song.blocks[1]!.repeat = 2;
  song.arrangement = ['V1', 'C1', 'V2', 'C1'];
  song.arrangementSource = 'reviewed';
  expect(order(song)).toEqual(song.arrangement);
});
