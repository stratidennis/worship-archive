import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  archiveFiltersFromParams,
  readArchiveState,
  rememberArchiveState,
  readArchiveScroll,
  rememberArchiveScroll,
} from '../src/lib/archiveState.js';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('starts with all keys off and remembers independent archive views until explicitly cleared', () => {
  expect(archiveFiltersFromParams(readArchiveState('library'))).toEqual({
    collection: '',
    keys: [],
  });
  const params = new URLSearchParams('key=G&key=D&collection=Main&q=hope');
  rememberArchiveState('library', params);
  rememberArchiveState('workspace', new URLSearchParams('tab=library&candidate=song-1&key=Am'));
  expect(readArchiveState('library').toString()).toBe(params.toString());
  expect(readArchiveState('workspace').get('tab')).toBe('library');
  expect(readArchiveState('workspace').get('candidate')).toBe('song-1');
  expect(archiveFiltersFromParams(readArchiveState('library'))).toEqual({
    collection: 'Main',
    keys: ['G', 'D'],
  });
  rememberArchiveState('library', new URLSearchParams());
  expect(archiveFiltersFromParams(readArchiveState('library')).keys).toEqual([]);
  expect(archiveFiltersFromParams(readArchiveState('workspace')).keys).toEqual(['Am']);
});

it('normalizes old single-key links and repeated enharmonic keys', () => {
  expect(
    archiveFiltersFromParams(new URLSearchParams('key=D%23&key=Eb&key=invalid')).keys,
  ).toEqual(['Eb']);
});

it('remembers positions independently for each view and filter combination', () => {
  rememberArchiveScroll('library:key=G', 1234);
  rememberArchiveScroll('workspace:key=G', 275);
  expect(readArchiveScroll('library:key=G')).toBe(1234);
  expect(readArchiveScroll('workspace:key=G')).toBe(275);
  expect(readArchiveScroll('library:key=D')).toBe(0);
  rememberArchiveScroll('invalid', NaN);
  expect(readArchiveScroll('invalid')).toBe(0);
});

it('continues working when storage is unavailable', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  expect(readArchiveState('library').toString()).toBe('');
  expect(() => rememberArchiveScroll('library', 300)).not.toThrow();
});
