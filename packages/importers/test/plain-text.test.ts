import { describe, expect, it } from 'vitest';
import {
  analysePlainText,
  anchorsFromChordLine,
  importPlainText,
  looksLikeStructuredSongText,
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

describe('Romanian website paste', () => {
  const numbered = `1. Mi-e dor, mi-e dor de casa mea
S-ajung acolo eu aş vrea
Mi-e dor, mi-e dor de Tatăl meu
Aş vrea să-l vad pe Fiul Său.

R: /:Eu nu sunt de pe pământ,
Eu nu sunt de-aici de jos
Ţara mea e-acolo sus
Eu mă duc după Isus. :/

2. Aş vrea, aş vrea s-ajung degrab\`
Să mă aplec, la piept să-I cad
Să-I spun atunci c-am biruit
Să-I mulţumesc că m-a iubit.

3. Să plec, să plec de-aici de jos
S-ajung în ţara lui Hristos
Că eu aici am suspinat
Acolo voi fi mângâiat.

4. Eu simt, eu simt pe cineva
E Domnul în inima mea
Îi simt susurul Lui cel bland
Îi simt fiorul Lui cel Sfânt.

5. Mai ai puţin, mai ai puţin
Şi după tine, Eu vin
Mai rabdă până s-amplini
Cuvântul Sfânt din prorocii.

6. Nu sunt, nu sunt de pe pământ
Eu sunt din oastea celui Sfânt
Am ochii aţintiţi spre cer
Şi de necazuri nu mă tem.`;

  const withChords = ` C
 Mi-e dor, mi-e dor de casa mea
                     Dm
 S-ajung acolo eu as vrea
                C
 Mi-e dor, mi-e dor de Tatal meu
    F         G           C
 As vrea sa-L vad pe fiul Sau

 C                   F
 %Eu nu sunt de pe pamant
                        C
 Eu nu sunt de-aici de jos
                  G
 Tara mea-i acolo sus
                 C
 Eu ma duc dupa Isus % x2

 As vrea, as vrea s-ajung degrab'
 Sa ma aplec la piept sa-I cad
 Sa-i spun atunci cam-biruit
 Sa-I multumesc ca m-a iubit

 Sa plec, sa plec de-aici de jos
 S-ajung in tara lui Cristos
 Ca eu aici am suspinat
 Acolo voi fi mangaiat.

 Eu nu ma tem de cineva
 E Domnul in inima mea
 Ii simt susurul lui cel sfant
 Ii simt fiorul celui bland.

 Mai ai putin, mai ai putin
 Si dupa tine eu vin
 Mai rabda pana sa-mplini
 Cuvintele din proroci.

 Nu sunt, nu sunt de pe pamant
 Eu sunt din oastea celui sfant,
 Acolo lacrimi nu-s pe veci
 Si de ne cazuri nu ma tem.`;

  it('turns numbered paragraphs and an inline refrain into typed blocks', () => {
    const { song, warnings } = analysePlainText(numbered, { title: 'Mi-e dor' });
    expect(warnings).toEqual([]);
    expect(song.blocks.map((block) => [block.id, block.type, block.repeat])).toEqual([
      ['V1', 'Verse', null],
      ['C1', 'Chorus', 2],
      ['V2', 'Verse', null],
      ['V3', 'Verse', null],
      ['V4', 'Verse', null],
      ['V5', 'Verse', null],
      ['V6', 'Verse', null],
    ]);
    expect(song.blocks[0]!.lines[0]!.text).toBe('Mi-e dor, mi-e dor de casa mea');
    expect(song.blocks[1]!.lines.map((line) => line.text)).toEqual([
      'Eu nu sunt de pe pământ,',
      'Eu nu sunt de-aici de jos',
      'Ţara mea e-acolo sus',
      'Eu mă duc după Isus.',
    ]);
    expect(song.blocks[2]!.lines[0]!.text).toBe('Aş vrea, aş vrea s-ajung degrab`');
    expect(
      song.blocks.flatMap((block) => block.lines).every((line) => line.chords.length === 0),
    ).toBe(true);
  });

  it('suggests the first lyric as a pasted song title without removing that lyric', () => {
    const song = importPlainText(numbered);
    expect(song.title).toBe('Mi-e dor, mi-e dor de casa mea');
    expect(song.blocks[0]!.lines[0]!.text).toBe(song.title);
  });

  it('reads single and multiple chord rows without making them lyrics or a title', () => {
    const { song, warnings } = analysePlainText(withChords, { title: 'Mi-e dor' });
    expect(warnings).toEqual([]);
    expect(song.title).toBe('Mi-e dor');
    expect(song.blocks).toHaveLength(7);
    expect(song.blocks.map((block) => block.type)).toEqual([
      'Verse',
      'Chorus',
      'Verse',
      'Verse',
      'Verse',
      'Verse',
      'Verse',
    ]);
    expect(song.blocks[1]!.repeat).toBe(2);
    expect(song.blocks[0]!.lines.map((line) => line.chords.map((chord) => chord.raw))).toEqual([
      ['C'],
      ['Dm'],
      ['C'],
      ['F', 'G', 'C'],
    ]);
    expect(song.blocks[0]!.lines[1]!.chords[0]).toEqual({ at: 20, raw: 'Dm' });
    expect(song.blocks[0]!.lines[3]!.chords).toEqual([
      { at: 3, raw: 'F' },
      { at: 13, raw: 'G' },
      { at: 25, raw: 'C' },
    ]);
    expect(song.blocks[1]!.lines[0]!.text).toBe('Eu nu sunt de pe pamant');
    expect(song.blocks[1]!.lines[3]!.text).toBe('Eu ma duc dupa Isus');
    expect(song.blocks.flatMap((block) => block.lines).map((line) => line.text)).not.toContain(
      'C',
    );
  });

  it('recognises both examples as document-level pastes', () => {
    expect(looksLikeStructuredSongText(numbered)).toBe(true);
    expect(looksLikeStructuredSongText(withChords)).toBe(true);
    expect(looksLikeStructuredSongText('one line\ntwo lines')).toBe(false);
  });

  it('keeps an ambiguous one-letter lyric instead of deleting it', () => {
    const result = analysePlainText('Titlu\n\nA\nThis remains a lyric\n', {
      title: 'Existing title',
    });
    expect(result.song.blocks.flatMap((block) => block.lines.map((line) => line.text))).toEqual(
      ['Titlu', 'A', 'This remains a lyric'],
    );
    expect(result.warnings).toEqual([{ kind: 'ambiguous-chord-line', line: 3, text: 'A' }]);
  });
});
