import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, normalisePrefs } from '../src/lib/settings.js';

describe('display preference migration', () => {
  it('starts existing devices with the new minimum rather than reusing the old maximum', () => {
    const prefs = normalisePrefs({ maxFontPx: 26, showBlockTitles: true });
    expect(prefs.minFontPx).toBe(DEFAULT_PREFS.minFontPx);
    expect(prefs.maxFontPx).toBe(DEFAULT_PREFS.maxFontPx);
    expect(prefs.cueStyle).toBe('full');
    expect(prefs).not.toHaveProperty('showBlockTitles');
  });

  it('restores and clamps a maximum written by the new font-sizing controls', () => {
    expect(normalisePrefs({ fontSizingVersion: 2, maxFontPx: 40 }).maxFontPx).toBe(40);
    expect(normalisePrefs({ fontSizingVersion: 2, maxFontPx: 100 }).maxFontPx).toBe(72);
    expect(
      normalisePrefs({ fontSizingVersion: 2, minFontPx: 24, maxFontPx: 20 }).maxFontPx,
    ).toBe(24);
  });

  it('maps a hidden-title preference to the colour-preserving compact style', () => {
    expect(normalisePrefs({ showBlockTitles: false }).cueStyle).toBe('compact');
  });

  it('clamps a saved minimum to the supported readable range', () => {
    expect(normalisePrefs({ minFontPx: 2 }).minFontPx).toBe(8);
    expect(normalisePrefs({ minFontPx: 90 }).minFontPx).toBe(32);
  });

  it('allows line spacing up to 2 and clamps anything larger', () => {
    expect(normalisePrefs({ lineHeight: 2 }).lineHeight).toBe(2);
    expect(normalisePrefs({ lineHeight: 3 }).lineHeight).toBe(2);
  });
});
