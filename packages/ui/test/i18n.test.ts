import { describe, expect, it } from 'vitest';
import { translate } from '../src/lib/i18n.js';

/**
 * The dictionaries are checked by the compiler — `en` is typed over `ro`, so a missing
 * key does not build. What the compiler cannot check is that the *shapes* match: a key
 * that is a plural in one language and a plain string in the other, or an English
 * string that forgot a `{count}` the Romanian one interpolates.
 */
describe('the two dictionaries agree', () => {
  // Reached through the public function, so this exercises exactly what the app calls.
  const keys = [
    'library.count',
    'cleanup.occurrences',
    'import.readyCount',
    'import.blocks',
    'import.chords',
    'cleanup.songsAffected',
  ] as const;

  it('pluralises in both languages without leaving a placeholder behind', () => {
    for (const key of keys) {
      for (const count of [0, 1, 2, 19, 20, 101, 153]) {
        for (const lang of ['ro', 'en'] as const) {
          const text = translate(lang, key, { count });
          expect(text, `${lang} ${key} ${count}`).not.toContain('{');
          expect(text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('Romanian plurals', () => {
  // The rule that catches people out: above nineteen, Romanian inserts "de".
  it('uses the singular for one', () => {
    expect(translate('ro', 'library.count', { count: 1 })).toBe('1 cântare');
  });

  it('uses the plain plural from two to nineteen', () => {
    expect(translate('ro', 'library.count', { count: 2 })).toBe('2 cântări');
    expect(translate('ro', 'library.count', { count: 19 })).toBe('19 cântări');
  });

  it('inserts "de" from twenty up', () => {
    expect(translate('ro', 'library.count', { count: 20 })).toBe('20 de cântări');
    expect(translate('ro', 'library.count', { count: 153 })).toBe('153 de cântări');
  });

  it('drops back to the plain plural for 101–119', () => {
    expect(translate('ro', 'library.count', { count: 101 })).toBe('101 cântări');
  });

  it('treats zero as a plural, not a singular', () => {
    expect(translate('ro', 'library.count', { count: 0 })).toBe('0 cântări');
  });
});

describe('interpolation', () => {
  it('substitutes named values', () => {
    expect(translate('en', 'song.capo', { fret: 3 })).toBe('capo 3');
  });

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    // A blank in the middle of a sentence looks like a rendering bug and hides the
    // cause; the placeholder name says exactly what was not supplied.
    expect(translate('en', 'song.capo')).toBe('capo {fret}');
  });

  it('handles several values in one string', () => {
    expect(
      translate('en', 'sets.keyShifted', { native: 'G', override: 'Bb', semitones: 3 }),
    ).toBe('G in the library, Bb in this set (3 semitones)');
  });
});

describe('block names', () => {
  it('translates the stored English type names', () => {
    expect(translate('ro', 'block.Chorus')).toBe('Refren');
    expect(translate('en', 'block.Chorus')).toBe('Chorus');
  });
});
