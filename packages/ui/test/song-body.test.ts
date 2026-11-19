import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseChordPro, type CueStyle } from '@worship/core';
import { I18nProvider } from '../src/lib/i18n.js';
import { hasVisibleChordRow, SongBody } from '../src/components/SongBody.js';
import { cueAppearance, songSectionFontScale } from '../src/lib/cueAppearance.js';
import { readingColorStyle } from '../src/lib/readingColors.js';

describe('song line chord spacing', () => {
  it('does not reserve a chord row for a lyric-only line', () => {
    expect(
      hasVisibleChordRow({ chords: [], bass: [] }, { showChords: true, showBass: true }),
    ).toBe(false);
  });

  it('reserves the row only when a populated layer is visible', () => {
    const line = {
      chords: [{ at: 0, raw: 'G' }],
      bass: [{ at: 2, raw: 'E' }],
    };
    expect(hasVisibleChordRow(line, { showChords: true, showBass: false })).toBe(true);
    expect(hasVisibleChordRow(line, { showChords: false, showBass: true })).toBe(true);
    expect(hasVisibleChordRow(line, { showChords: false, showBass: false })).toBe(false);
  });
});

describe('song cue blocks', () => {
  it('gives every cue type its own colour in the full style', () => {
    const appearances = ['Intro', 'Instrumental', 'Solo', 'Note', 'Bridge'].map((type) =>
      cueAppearance(type),
    );
    expect(new Set(appearances.map((appearance) => appearance?.background)).size).toBe(5);
    expect(cueAppearance('Verse')).toBeNull();
  });

  it.each([
    ['full', 0.8],
    ['compact', 0.7],
    ['minimal', 0.6],
  ] as const)('scales only the four small cues in %s', (style, scale) => {
    for (const type of ['Intro', 'Instrumental', 'Note', 'Tag'] as const) {
      expect(songSectionFontScale(type, style)).toBe(scale);
    }
    for (const type of ['Verse', 'Chorus', 'PreChorus', 'Bridge', 'Ending', 'Solo'] as const) {
      expect(songSectionFontScale(type, style)).toBe(1);
    }
  });

  it('derives the cue edge from a custom fill and keeps a transparent override readable', () => {
    expect(readingColorStyle({ Bridge: '#3c74af', Solo: 'transparent' })).toMatchObject({
      '--reading-Bridge-edge': 'color-mix(in oklab, #3c74af 65%, var(--color-stage-fg))',
      '--reading-Bridge-ink': '#3c74af',
      '--reading-Solo-edge': 'transparent',
      '--reading-Solo-ink': 'var(--reading-lyrics, var(--color-stage-fg))',
    });
  });
});

describe('performance markings', () => {
  const render = (cueStyle: CueStyle) => {
    const song = parseChordPro(`
{title: Example}
{x_block_singers: Women}
{x_repeat: 2}
{start_of_bridge: B1}
First phrase
{x_singers: Men}
Second phrase
{x_singers: All}
Third phrase
{end_of_bridge}
{start_of_verse: V1}
Other verse
{end_of_verse}
{x_type: Solo}
{start_of_verse: S1}
Guitar solo
{end_of_verse}
`);
    // Use the same section consecutively and again after the verse.
    song.arrangement = ['B1', 'B1', 'B1', 'V1', 'B1', 'S1'];
    return renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(SongBody, {
          song,
          arrangementView: true,
          options: {
            showChords: false,
            showBass: false,
            transpose: 0,
            capo: 0,
            cueStyle,
          },
        }),
      ),
    );
  };

  it.each(['full', 'compact', 'minimal'] as const)(
    'shows repeat counts beside each lyric run in %s',
    (style) => {
      const html = render(style);
      expect(html).toContain('Repeat section 3 times');
      expect(html).toContain('Repeat section 2 times');
      expect(html.match(/>First /g)).toHaveLength(2);
      expect(html).not.toMatch(/<h2[^>]*>[^<]*×/);
    },
  );

  it('inherits section singers and respects line assignments over a Bridge background', () => {
    const html = render('full');
    expect(html).toMatch(
      /color:var\(--reading-Women, var\(--color-singers-women\)\)[^>]*>.*?Women\. .*?>First /,
    );
    expect(html).toMatch(
      /color:var\(--reading-Men, var\(--color-singers-men\)\)[^>]*>.*?Men\. .*?>Second /,
    );
    expect(
      html.match(/color:var\(--reading-Women, var\(--color-singers-women\)\)/g),
    ).toHaveLength(2);
    expect(html).toMatch(
      /<section[^>]*background-color:var\(--reading-Bridge, var\(--color-cue-bridge-bg\)\)[^>]*>.*?color:var\(--reading-Men,/,
    );
  });

  it.each(['full', 'compact'] as const)(
    'applies section colors only as backgrounds in %s',
    (style) => {
      const html = render(style);
      expect(html).toContain(
        'background-color:var(--reading-Bridge, var(--color-cue-bridge-bg))',
      );
      expect(html).toContain('background-color:var(--reading-Solo, var(--color-cue-solo-bg))');
      expect(html).toContain('background-color:var(--reading-Verse, transparent)');
      expect(html).not.toMatch(/(?:^|[;" ])color:var\(--reading-(Bridge|Solo|Verse)/);
      expect(html).toMatch(
        /<section[^>]*color:var\(--reading-lyrics, var\(--color-stage-fg\)\)[^>]*background-color:var\(--reading-Solo,[^>]*>.*?Guitar /,
      );
    },
  );
  it('uses section ink without panels or headings in Minimal and keeps singer assignments', () => {
    const html = render('minimal');
    expect(html).toContain('color:var(--reading-Bridge-ink,');
    expect(html).toContain('color:var(--reading-Solo-ink,');
    expect(html).toContain('color:var(--reading-Men, var(--color-singers-men))');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('background-color:');
    expect(html).not.toContain('border-color:');
  });
});
