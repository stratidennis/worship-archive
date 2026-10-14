import { describe, expect, it, vi } from 'vitest';
import { settleSongLayout, songFontsApplied } from '../src/lib/settleSongLayout.js';

describe('settled song measurements', () => {
  it('waits for rendering even when the candidate already appears applied', async () => {
    let frames = 0;
    expect(
      await settleSongLayout(
        () => true,
        async () => {
          frames++;
          return true;
        },
      ),
    ).toBe(true);
    expect(frames).toBe(2);
  });

  it('does not accept the previous song font or column count as a new trial', async () => {
    let frames = 0;
    let font = 8;
    let columns = 1;
    expect(
      await settleSongLayout(
        () => font === 26 && columns === 2,
        async () => {
          frames++;
          if (frames === 2) font = 26;
          if (frames === 3) columns = 2;
          return true;
        },
      ),
    ).toBe(true);
    expect(frames).toBe(3);
  });

  it('stops when switching songs cancels a pending rendering frame', async () => {
    let reads = 0;
    expect(
      await settleSongLayout(
        () => {
          reads++;
          return true;
        },
        async () => false,
      ),
    ).toBe(false);
    expect(reads).toBe(0);
  });

  it('does not fit using stale metrics if the browser never applies a candidate', async () => {
    let frames = 0;
    expect(
      await settleSongLayout(
        () => false,
        async () => {
          frames++;
          return true;
        },
      ),
    ).toBe(false);
    expect(frames).toBe(32);
  });

  it('rejects an updated container when its lyrics still inherit the previous font', () => {
    const lyrics = { dataset: { songFontScale: '1' }, font: '8px' };
    const cue = { dataset: { songFontScale: '0.8' }, font: '20.8px' };
    const chord = { dataset: { songFontScale: '0.72' }, font: '18.72px' };
    const content = { querySelectorAll: () => [lyrics, cue, chord] } as unknown as HTMLElement;
    vi.stubGlobal('getComputedStyle', (text: typeof lyrics) => ({ fontSize: text.font }));
    try {
      expect(songFontsApplied(content, 26)).toBe(false);
      lyrics.font = '26px';
      expect(songFontsApplied(content, 26)).toBe(true);
      chord.font = '6px';
      expect(songFontsApplied(content, 26)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
