import { expect, it } from 'vitest';
import { parseChordPro } from '@worship/core';
import { analysePlainText, importOpenSong, parseArrangementText } from '@worship/importers';
import { resolvePerformedOrder } from '../src/performed-order.js';
import { presentationPages } from '../src/powerpoints.js';

function parse(body: string) {
  return parseChordPro('{title: Future inputs}\n' + body);
}

const styles = [
  ['/:', ':/'],
  ['||:', ':||'],
  ['𝄆', '𝄇'],
  ['%', '%'],
] as const;
const numbers = ['x3', '× 3', '(x3)', '3x', '(3×)', '\n3x'];

it.each(
  styles.flatMap(([open, close]) => numbers.map((number) => [open, close, number] as const)),
)('reads %s … %s with a %j count in both export modes', (open, close, number) => {
  const song = parse(`{sov: V1}\n${open} First line\nSecond line ${close} ${number}\n{eov}`);
  const original = JSON.stringify(song);
  expect(presentationPages(song)).toEqual(Array(3).fill(['First line', 'Second line']));
  expect(presentationPages(song, { repeatMode: 'compact' })).toEqual([
    ['/: First line', 'Second line :/ x3'],
  ]);
  expect(JSON.stringify(song)).toBe(original);
});

it.each(
  styles.flatMap(([outerOpen, outerClose]) =>
    styles
      .filter(([innerOpen]) => outerOpen !== '%' || innerOpen !== '%')
      .map(
        ([innerOpen, innerClose]) => [outerOpen, outerClose, innerOpen, innerClose] as const,
      ),
  ),
)(
  'keeps the counts and lyric order when %s … %s contains %s … %s',
  (outerOpen, outerClose, innerOpen, innerClose) => {
    const song = parse(
      `{sov: V1}\n${outerOpen} Outside one\n${innerOpen} Inside ${innerClose} 3x\nOutside two ${outerClose} (x2)\n{eov}`,
    );
    const onePass = ['Outside one', 'Inside', 'Inside', 'Inside', 'Outside two'];
    const result = resolvePerformedOrder(song);
    expect(result.issues).toEqual([]);
    expect(result.sections.map((section) => section.lines)).toEqual([onePass, onePass]);
    expect(presentationPages(song).flat()).toEqual([...onePass, ...onePass]);
  },
);

it.each(styles)(
  'keeps an inner lyric repeat inside a cross-section %s … %s repeat',
  (open, close) => {
    const song = parse(
      `{sov: V1}\n${open} Start\n{eov}\n{sob: B1}\n/: Middle :/ (2x)\n{eob}\n{soc: C1}\nClose ${close} x2\n{eoc}`,
    );
    const result = resolvePerformedOrder(song);
    expect(result.issues).toEqual([]);
    expect(result.sections.flatMap((section) => section.lines)).toEqual([
      'Start',
      'Middle',
      'Middle',
      'Close',
      'Start',
      'Middle',
      'Middle',
      'Close',
    ]);
  },
);

it('accepts a count-only row and an English ordinal cue in a written arrangement', () => {
  expect(parseArrangementText('V1 -> 2nd Chorus (2×) -> 1st Chorus')).toEqual([
    'V1',
    'C2',
    'C2',
    'C1',
  ]);
  const song = parse('{sov: V1}\nFirst line\nSecond line\n(2x)\n{eov}');
  expect(presentationPages(song)).toEqual([
    ['First line', 'Second line'],
    ['First line', 'Second line'],
  ]);
});

it('keeps nested cross-section ranges in performed order', () => {
  const song = parse(
    '{sov: V1}\n/: First lyric\n{eov}\n{sob: B1}\n/: Second lyric\n{eob}\n' +
      '{soc: C1}\nThird lyric :/ x2\n{eoc}\n{x_type: Ending}\n{sov: E1}\nLast lyric :/ x2\n{eov}',
  );
  const result = resolvePerformedOrder(song);
  expect(result.issues).toEqual([]);
  expect(result.sections.map((section) => section.id)).toEqual([
    'V1',
    'B1',
    'C1',
    'B1',
    'C1',
    'E1',
    'V1',
    'B1',
    'C1',
    'B1',
    'C1',
    'E1',
  ]);
});

it('preserves nested and unmatched syntax when importing plain text', () => {
  const nested = analysePlainText(
    'Verse 1\n/: Outside one\n% Middle % (2x)\nOutside two :/ x2',
    { title: 'Nested repeat' },
  );
  const pass = ['Outside one', 'Middle', 'Middle', 'Outside two'];
  expect(nested.warnings).toEqual([]);
  expect(presentationPages(nested.song)).toEqual([pass, pass]);

  const unmatched = analysePlainText('Verse 1\n/: Keep the sung words', {
    title: 'Unmatched repeat',
  });
  expect(unmatched.warnings[0]?.kind).toBe('unpaired-repeat-marker');
  expect(() => presentationPages(unmatched.song)).toThrow(
    'unmatched or unsupported lyric repeat',
  );
  expect(presentationPages(unmatched.song, { allowDraft: true }).at(-1)).toEqual([
    'Keep the sung words',
  ]);
});

it('uses the same bracket and count rules for OpenSong imports', () => {
  const song = importOpenSong(
    '<song><title>OpenSong input</title><lyrics>[V1]\n ||: Sun and sky\n Here with us :|| (3x)\n</lyrics></song>',
  );
  expect(presentationPages(song)).toEqual(Array(3).fill(['Sun and sky', 'Here with us']));
});

it('resolves forward alias chains without multiplying their counts and reports cycles', () => {
  const forwards = parse(
    '{soc: C1}\nA sung chorus\n{eoc}\n{x_type: Tag}\n{sov: T1}\nE1 (2x)\n{eov}\n{x_type: Ending}\n{sov: E1}\nC1 (x3)\n{eov}',
  );
  expect(resolvePerformedOrder(forwards).issues).toEqual([]);
  expect(presentationPages(forwards)).toEqual(Array(6).fill(['A sung chorus']));

  const cycle = parse(
    '{sov: V1}\nA sung verse\n{eov}\n{soc: C1}\nC2\n{eoc}\n{soc: C2}\nC1\n{eoc}',
  );
  expect(() => presentationPages(cycle)).toThrow('circular section reference');
  expect(presentationPages(cycle, { allowDraft: true }).at(-1)).toEqual(['A sung verse']);
});

it.each([
  ['/: Keep the words :/ x0', 'unsupported repeat count 0'],
  ['/: Keep the words :/ (2.5x)', 'unsupported repeat count 2.5'],
  ['/: Keep the words :/ x-2', 'unsupported repeat count -2'],
  ['% Keep the words :/ x2', 'unmatched or unsupported lyric repeat'],
  ['Keep the words\n/: :/', 'empty lyric repeat'],
  [
    '/:'.repeat(6) + ' Keep the words ' + ':/ x20 '.repeat(6),
    'expanded lyric repeat is too large',
  ],
])('keeps lyrics editable in a draft when %j needs review', (lyrics, warning) => {
  const song = parse(`{sov: V1}\n${lyrics}\n{eov}`);
  expect(() => presentationPages(song)).toThrow(warning);
  expect(presentationPages(song, { allowDraft: true })).toEqual([
    ['DRAFT', 'Review the song arrangement before presenting.'],
    ['Keep the words'],
  ]);
});

it('turns clear returns into occurrences and warns about unsupported musical jumps', () => {
  const song = parse(
    '{sov: V1}\nFirst verse\n{eov}\n{soc: C1}\nFirst chorus\n{eoc}\n{soc: C2}\nSecond chorus\n{eoc}\n' +
      '{x_type: Note}\n{sov: M1}\nReturn to 1st Chorus\nD.S. al Coda\n{eov}',
  );
  const result = resolvePerformedOrder(song);
  expect(result.sections.map((section) => section.id)).toEqual(['V1', 'C1', 'C2', 'C1']);
  expect(result.issues).toEqual(['Review ambiguous instruction: D.S. al Coda']);
});

it('keeps a musical jump written in a lyric section off the lyric slides', () => {
  const song = parse('{sov: V1}\nKeep the sung words\nD.C. al Fine\n{eov}');
  expect(() => presentationPages(song)).toThrow('review musical jump');
  expect(presentationPages(song, { allowDraft: true }).at(-1)).toEqual(['Keep the sung words']);
});
