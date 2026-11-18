import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseChordPro, type CueStyle } from '@worship/core';
import { I18nProvider } from '../src/lib/i18n.js';
import { hasVisibleChordRow, SongBody } from '../src/components/SongBody.js';
import { cueAppearance } from '../src/lib/cueAppearance.js';

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
    const appearances = ['Intro', 'Instrumental', 'Solo', 'Note'].map(cueAppearance);
    expect(appearances.every((appearance) => appearance?.fontScale === 0.8)).toBe(true);
    expect(appearances.every((appearance) => appearance?.coloured)).toBe(true);
    expect(new Set(appearances.map((appearance) => appearance?.background)).size).toBe(4);
    expect(cueAppearance('Verse')).toBeNull();
  });

  it('makes compact cues smaller and keeps minimal cues colour-coded through text', () => {
    expect(cueAppearance('Note', 'compact')).toMatchObject({
      fontScale: 0.7,
      coloured: true,
      text: null,
    });
    expect(cueAppearance('Note', 'minimal')).toMatchObject({
      fontScale: 0.6,
      coloured: false,
      text: 'var(--color-cue-note)',
    });
  });
});

describe('performance markings', () => {
  const render = (cueStyle: CueStyle, highlightBridges = false, highlightSolos = false) => {
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
            highlightBridges,
            highlightSolos,
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

  it('inherits section singers, respects line assignments, and highlights bridges only when enabled', () => {
    const html = render('full', true);
    expect(html).toMatch(/color:var\(--color-singers-women\)[^>]*>.*?Women\. .*?>First /);
    expect(html).toMatch(/color:var\(--color-singers-men\)[^>]*>.*?Men\. .*?>Second /);
    expect(html.match(/color:var\(--color-singers-women\)/g)).toHaveLength(2);
    expect(html).toContain('color:var(--color-bridge-ink)');
    expect(render('full')).not.toContain('color:var(--color-bridge-ink)');
  });

  it.each(['full', 'compact', 'minimal'] as const)(
    'highlights solos independently of bridges in %s',
    (style) => {
      expect(render(style, true)).not.toContain('color:var(--color-solo-ink)');
      const highlighted = render(style, false, true);
      expect(highlighted).toMatch(/<section[^>]*color:var\(--color-solo-ink\)[^>]*>.*?Guitar /);
      expect(highlighted).not.toContain('color:var(--color-bridge-ink)');
    },
  );
});
