import { describe, expect, it } from 'vitest';
import { compareRomanianText } from '../src/text.js';

describe('Romanian alphabetical ordering', () => {
  it('places Romanian letters in the alphabet instead of after Z', () => {
    const titles = [
      'Unul',
      'Țara',
      'Tatăl',
      'Șalom',
      'Speranță',
      'Înger',
      'Iosif',
      'Bucurie',
      'Ânger',
      'Ăsta',
      'Aleluia',
    ];

    expect(titles.sort(compareRomanianText)).toEqual([
      'Aleluia',
      'Ăsta',
      'Ânger',
      'Bucurie',
      'Iosif',
      'Înger',
      'Speranță',
      'Șalom',
      'Tatăl',
      'Țara',
      'Unul',
    ]);
  });
});
