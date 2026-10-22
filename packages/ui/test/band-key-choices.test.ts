import { describe, expect, it } from 'vitest';
import {
  EMPTY_BAND_KEY_CHOICES,
  rememberBandKey,
  rememberedBandKey,
  resolveBandDisplayedKey,
} from '../src/lib/bandKeyChoices.js';

describe('Band session key choices', () => {
  it('remembers a different manual key for every song while navigating a set', () => {
    let choices = rememberBandKey(EMPTY_BAND_KEY_CHOICES, 'service-1', 'song-a', 'C');
    choices = rememberBandKey(choices, 'service-1', 'song-b', 'F');

    expect(rememberedBandKey(choices, 'service-1', 'song-a')).toBe('C');
    expect(rememberedBandKey(choices, 'service-1', 'song-b')).toBe('F');
  });

  it('drops all manual choices when a new Leader session starts', () => {
    const rehearsal = rememberBandKey(EMPTY_BAND_KEY_CHOICES, 'rehearsal', 'song-a', 'C');
    const service = rememberBandKey(rehearsal, 'service', 'song-b', 'G');

    expect(rememberedBandKey(service, 'service', 'song-a')).toBeNull();
    expect(rememberedBandKey(service, 'service', 'song-b')).toBe('G');
  });

  it('can clear one song without changing the other remembered songs', () => {
    let choices = rememberBandKey(EMPTY_BAND_KEY_CHOICES, 'service', 'song-a', 'C');
    choices = rememberBandKey(choices, 'service', 'song-b', 'F');
    choices = rememberBandKey(choices, 'service', 'song-a', null);

    expect(rememberedBandKey(choices, 'service', 'song-a')).toBeNull();
    expect(rememberedBandKey(choices, 'service', 'song-b')).toBe('F');
  });

  it('lets a manual key override both the preference and the Leader', () => {
    expect(
      resolveBandDisplayedKey({
        manualKey: 'C',
        alwaysUsePerformanceKey: true,
        performanceKey: 'D',
        leaderDisplayedKey: 'A',
      }),
    ).toBe('C');
  });

  it('uses the performance key only as the preferred default', () => {
    expect(
      resolveBandDisplayedKey({
        manualKey: null,
        alwaysUsePerformanceKey: true,
        performanceKey: 'D',
        leaderDisplayedKey: 'A',
      }),
    ).toBe('D');
    expect(
      resolveBandDisplayedKey({
        manualKey: null,
        alwaysUsePerformanceKey: false,
        performanceKey: 'D',
        leaderDisplayedKey: 'A',
      }),
    ).toBe('A');
  });
});
