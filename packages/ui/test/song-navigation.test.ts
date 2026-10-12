import { expect, it } from 'vitest';
import { adjacentSong } from '../src/lib/songNavigation.js';

it('follows the visible list order in either direction', () => {
  const filtered = ['c', 'a', 'f'];
  expect(adjacentSong(filtered, 'a', 1)).toBe('f');
  expect(adjacentSong(filtered, 'a', -1)).toBe('c');
});

it('does not wrap at either end or navigate an empty list', () => {
  expect(adjacentSong(['a', 'b'], 'b', 1)).toBeUndefined();
  expect(adjacentSong(['a', 'b'], 'a', -1)).toBeUndefined();
  expect(adjacentSong([], null, 1)).toBeUndefined();
  expect(adjacentSong(['a'], 'a', 1)).toBeUndefined();
});

it('starts at the first song only when moving forward without a selection', () => {
  expect(adjacentSong(['a', 'b'], null, 1)).toBe('a');
  expect(adjacentSong(['a', 'b'], null, -1)).toBeUndefined();
});
