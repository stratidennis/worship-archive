import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, normalisePrefs } from '../src/lib/settings.js';

describe('display preference migration', () => {
  it('starts existing devices with the new minimum rather than reusing the old maximum', () => {
    const prefs = normalisePrefs({ maxFontPx: 26, showBlockTitles: true });
    expect(prefs.minFontPx).toBe(DEFAULT_PREFS.minFontPx);
    expect(prefs.cueStyle).toBe('full');
    expect(prefs).not.toHaveProperty('maxFontPx');
    expect(prefs).not.toHaveProperty('showBlockTitles');
  });

  it('maps a hidden-title preference to the colour-preserving compact style', () => {
    expect(normalisePrefs({ showBlockTitles: false }).cueStyle).toBe('compact');
  });

  it('clamps a saved minimum to the supported readable range', () => {
    expect(normalisePrefs({ minFontPx: 2 }).minFontPx).toBe(8);
    expect(normalisePrefs({ minFontPx: 90 }).minFontPx).toBe(32);
  });
});
