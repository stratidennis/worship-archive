import { describe, expect, it } from 'vitest';
import { canonicalFilterKey, compareFilterKeys, filterKeyAliases } from '../src/key.js';

describe('key filters', () => {
  it('merges enharmonic spellings into the customary chart name', () => {
    expect(canonicalFilterKey('D#')).toBe('Eb');
    expect(canonicalFilterKey('A#')).toBe('Bb');
    expect(canonicalFilterKey('Dbm')).toBe('C#m');
    expect(filterKeyAliases('Eb')).toEqual(['D#', 'Eb']);
  });

  it('sorts chromatically from A with major keys before minor keys', () => {
    const keys = ['F#', 'C', 'Bb', 'Ab', 'A', 'Eb', 'B', 'D', 'E', 'G', 'C#', 'F'];
    expect(keys.sort(compareFilterKeys)).toEqual([
      'A',
      'Bb',
      'B',
      'C',
      'C#',
      'D',
      'Eb',
      'E',
      'F',
      'F#',
      'G',
      'Ab',
    ]);
    expect(['Am', 'A', 'C#m', 'C'].sort(compareFilterKeys)).toEqual(['A', 'C', 'Am', 'C#m']);
  });
});
