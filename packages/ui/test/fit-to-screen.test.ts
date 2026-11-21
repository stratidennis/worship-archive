import { describe, expect, it, vi } from 'vitest';
import {
  chooseFit,
  canFitSongRows,
  columnCandidates,
  crossesColumnBoundary,
  exceedsAvailableSpace,
  fittedSongOverflowClass,
  fittedSongStyle,
  failedFit,
  isPhoneScreen,
  NARROW_SCREEN_WIDTH,
  usesConstrainedColumnFlow,
} from '../src/lib/useFitToScreen.js';

describe('fit-to-screen font floor', () => {
  it('never preserves an old font below a newly selected floor after measurement fails', () => {
    expect(
      failedFit(
        {
          fontPx: 26,
          columns: 2,
          heightPx: 700,
          phone: false,
          fits: true,
          measuring: true,
        },
        32,
        40,
      ),
    ).toMatchObject({ fontPx: 32, columns: 1, fits: false, measuring: false });
  });

  it('never preserves an old font above a newly selected ceiling after measurement fails', () => {
    expect(
      failedFit(
        {
          fontPx: 60,
          columns: 2,
          heightPx: 700,
          phone: false,
          fits: true,
          measuring: true,
        },
        12,
        34,
      ),
    ).toMatchObject({ fontPx: 34, columns: 1, fits: false, measuring: false });
  });

  it('treats a compact Android tablet as a fit-to-screen display', () => {
    expect(NARROW_SCREEN_WIDTH).toBeLessThan(600);
    expect(isPhoneScreen(600, 960)).toBe(false);
    expect(columnCandidates(600, false)).toEqual([1, 2]);
  });

  it('does not mistake a narrow song pane on a laptop for a phone', () => {
    expect(isPhoneScreen(1366, 768)).toBe(false);
    expect(columnCandidates(507, false)).toEqual([1, 2]);
  });

  it('recognizes a phone in either orientation', () => {
    expect(isPhoneScreen(390, 844)).toBe(true);
    expect(isPhoneScreen(844, 390)).toBe(true);
  });

  it('does not turn a 600px tablet into a phone when browser chrome reduces the viewport', () => {
    // The fitter receives the stable screen dimensions; a transient 1000x480 viewport
    // is deliberately irrelevant to this decision.
    expect(isPhoneScreen(1200, 2000)).toBe(false);
    expect(isPhoneScreen(600, 1000)).toBe(false);
    expect(isPhoneScreen(1000, 600)).toBe(false);
  });

  it('keeps heavily scaled desktop displays out of the phone layout', () => {
    expect(isPhoneScreen(853, 480, false)).toBe(false);
  });
});

describe('largest readable fit', () => {
  it('does not lay out sizes that cannot fit even one row per lyric line', async () => {
    const groups = Array.from({ length: 8 }, () => ({ heightInEm: 12, rows: 6 }));
    const measure = vi.fn(
      async (font: number, columns: number) => columns === 1 || (font > 12 && font !== 18),
    );
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 72,
      columns: [1, 2],
      canFit: (font, columns) => canFitSongRows(groups, font, 840, columns),
      overflows: measure,
    });
    expect(result).toEqual({ fontPx: 18, columns: 2, fits: true });
    expect(measure.mock.calls.every(([font, columns]) => font <= 18 && columns === 2)).toBe(
      true,
    );
    expect(measure.mock.calls.length).toBeLessThan(12);
  });

  it('does not prune layouts without known row heights', () => {
    expect(canFitSongRows([], 72, 840, 2)).toBe(true);
  });

  it('accounts for the additional rows a long line needs in a narrow column', () => {
    const groups = [
      { heightInEm: 2, rows: 1, wrappedLines: [{ heightInEm: 2, widthInEm: 72, words: 12 }] },
    ];
    expect(canFitSongRows(groups, 20, 72, 1, 490)).toBe(false);
    expect(canFitSongRows(groups, 20, 76, 1, 740)).toBe(true);
  });

  it('rules out a layout that needs to split a group across columns', () => {
    const groups = Array.from({ length: 3 }, () => ({ heightInEm: 16, rows: 8 }));
    expect(canFitSongRows(groups, 20, 500, 2)).toBe(false);
    expect(canFitSongRows(groups, 20, 500, 3)).toBe(true);
    expect(canFitSongRows(groups, 16, 500, 2)).toBe(true);
  });

  it('stops desktop measurements as soon as the first ranked layout fits', async () => {
    const measure = vi.fn(async (_font: number, columns: number) => columns === 1);
    expect(
      await chooseFit({ minFontPx: 12, columns: [1, 2, 3], batchSize: 1, overflows: measure }),
    ).toEqual({ fontPx: 72, columns: 2, fits: true });
    expect(measure.mock.calls).toEqual([
      [72, 1, undefined],
      [72, 2, undefined],
    ]);
  });

  it('finds the largest size even across an intermediate range that overflows', async () => {
    const result = await chooseFit({
      minFontPx: 32,
      maxFittedFontPx: 72,
      columns: [1, 2],
      overflows: async (font, columns) => columns === 1 || (font > 32 && font < 54),
    });
    expect(result).toEqual({ fontPx: 72, columns: 2, fits: true });
  });
  it('uses a larger two-column fit even when a wide reader can fit in one at 18 px', async () => {
    const result = await chooseFit({
      minFontPx: 18,
      maxFittedFontPx: 72,
      columns: columnCandidates(1750, false),
      overflows: async (font, columns) => font > (columns === 1 ? 22 : columns === 2 ? 39 : 31),
    });
    expect(result).toEqual({ fontPx: 39, columns: 2, fits: true });
  });

  it('uses a third column when it fits larger text than the first readable layout', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 11 : columns === 2 ? 34 : 39),
    });
    expect(result).toEqual({ fontPx: 39, columns: 3, fits: true });
  });

  it('keeps one column when extra columns cannot improve the font size', async () => {
    const result = await chooseFit({
      minFontPx: 18,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 38 : columns === 2 ? 38 : 28),
    });
    expect(result).toEqual({ fontPx: 38, columns: 1, fits: true });
  });

  it('uses fewer columns when they fit at the same largest font', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 11 : 38),
    });
    expect(result).toEqual({ fontPx: 38, columns: 2, fits: true });
  });

  it('uses a third column even when it only adds one pixel above the minimum', async () => {
    const result = await chooseFit({
      minFontPx: 22,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 21 : columns === 2 ? 22 : 23),
    });
    expect(result).toEqual({ fontPx: 23, columns: 3, fits: true });
  });

  it.each([22, 23, 24])(
    'finds the largest compact fit with a %i px minimum',
    async (minFontPx) => {
      const result = await chooseFit({
        minFontPx,
        columns: [1, 2, 3],
        overflows: async (font, columns, compactSpacing?: boolean) =>
          font >
          (columns === 1
            ? 21
            : columns === 2
              ? compactSpacing
                ? 23
                : 22
              : compactSpacing
                ? 24
                : 23),
      });
      expect(result).toEqual({
        fontPx: 24,
        columns: 3,
        fits: true,
        compactSpacing: true,
      });
    },
  );

  it('prefers compact spacing in fewer columns at the same size', async () => {
    const result = await chooseFit({
      minFontPx: 22,
      columns: [1, 2, 3, 4],
      overflows: async (font, columns, compactSpacing) =>
        font > (columns < 2 || (columns === 2 && !compactSpacing) ? 24 : 25),
    });
    expect(result).toEqual({ fontPx: 25, columns: 2, fits: true, compactSpacing: true });
  });

  it('uses three columns when one and two cannot preserve the minimum', async () => {
    const result = await chooseFit({
      minFontPx: 23,
      maxFittedFontPx: 72,
      columns: [1, 2, 3],
      overflows: async (font, columns) => font > (columns === 1 ? 22 : columns === 2 ? 22 : 31),
    });
    expect(result).toEqual({ fontPx: 31, columns: 3, fits: true });
  });

  it('never enlarges text beyond the selected maximum', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      maxFittedFontPx: 28,
      columns: [1, 2, 3],
      overflows: async () => false,
    });
    expect(result).toEqual({ fontPx: 28, columns: 1, fits: true });
  });

  it('reports an honest failure at the minimum when no allowed layout fits', async () => {
    const result = await chooseFit({
      minFontPx: 12,
      columns: [1, 2],
      overflows: async () => true,
    });
    expect(result).toEqual({ fontPx: 12, columns: 1, fits: false });
  });
});

describe('phone font-size control', () => {
  it('honours both phone font bounds and scrolls at the floor when needed', async () => {
    const columns = columnCandidates(390, isPhoneScreen(390, 844));
    const overflows = async (font: number) => font > 22;
    expect(await chooseFit({ minFontPx: 12, maxFittedFontPx: 32, columns, overflows })).toEqual(
      { fontPx: 22, columns: 1, fits: true },
    );
    expect(await chooseFit({ minFontPx: 12, maxFittedFontPx: 18, columns, overflows })).toEqual(
      { fontPx: 18, columns: 1, fits: true },
    );
    expect(await chooseFit({ minFontPx: 26, maxFittedFontPx: 32, columns, overflows })).toEqual(
      { fontPx: 26, columns: 1, fits: false },
    );
  });

  it('never offers columns on a phone', () => {
    expect(columnCandidates(390, true)).toEqual([1]);
  });
});

describe('fit overflow measurement', () => {
  it('rejects a split chorus or linked group even when both fragments are visible', async () => {
    const result = await chooseFit({
      minFontPx: 20,
      maxFittedFontPx: 30,
      columns: [1, 2, 3],
      overflows: async (font, columns) =>
        columns < 3 ||
        crossesColumnBoundary(
          font > 27
            ? [
                { left: 320, height: 375 },
                { left: 640, height: 110 },
              ]
            : [{ left: 320, height: 365 }],
        ),
    });
    expect(result).toEqual({ fontPx: 27, columns: 3, fits: true });
  });

  it('ignores empty fragments at a column break', () => {
    expect(
      crossesColumnBoundary([
        { left: 10, height: 180 },
        { left: 300, height: 0 },
      ]),
    ).toBe(false);
  });

  it('scrolls an unfitted interactive song on any device but keeps Stage clipped', () => {
    expect(fittedSongOverflowClass(false, true)).toContain('overflow-y-auto');
    expect(fittedSongOverflowClass(false, false)).toContain('overflow-hidden');
    expect(fittedSongOverflowClass(true, true)).toContain('overflow-hidden');
  });

  it('rejects content that a mobile column layout flows beyond the right edge', () => {
    expect(
      exceedsAvailableSpace({ scrollHeight: 560, scrollWidth: 1940, clientWidth: 960 }, 560),
    ).toBe(true);
  });

  it('accepts content only when it stays inside both viewport axes', () => {
    expect(
      exceedsAvailableSpace({ scrollHeight: 560, scrollWidth: 960, clientWidth: 960 }, 560),
    ).toBe(false);
  });

  it('constrains multi-column flow so mobile browsers do not need to balance it', () => {
    expect(usesConstrainedColumnFlow(1)).toBe(false);
    expect(usesConstrainedColumnFlow(2)).toBe(true);
  });

  it('keeps phone content unconstrained but gives larger displays deterministic columns', () => {
    expect(
      fittedSongStyle({
        fontPx: 26,
        columns: 1,
        heightPx: 560,
        phone: true,
        fits: false,
        measuring: false,
      }),
    ).toMatchObject({
      columnCount: 1,
      height: undefined,
      columnFill: undefined,
      visibility: 'visible',
    });
    expect(
      fittedSongStyle({
        fontPx: 20,
        columns: 2,
        heightPx: 560,
        phone: false,
        fits: true,
        measuring: false,
      }),
    ).toMatchObject({
      columnCount: 2,
      height: '560px',
      columnFill: 'auto',
      visibility: 'visible',
    });
  });

  it('keeps charts out of document flow until the first layout is ready', () => {
    const fit = { fontPx: 26, columns: 2, heightPx: 560, phone: false, fits: true };
    expect(fittedSongStyle({ ...fit, measuring: true }).display).toBe('none');
    expect(fittedSongStyle({ ...fit, measuring: false }).display).toBeUndefined();
  });
});
