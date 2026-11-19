import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PerformanceInfo } from '../src/components/PerformanceInfo.js';
import { I18nProvider } from '../src/lib/i18n.js';
import type { CueStyle } from '@worship/core';

function render(cueStyle?: CueStyle): string {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(PerformanceInfo, {
        performanceKey: 'G',
        displayedKey: 'D',
        transpose: 0,
        capo: 2,
        cueStyle,
      }),
    ),
  );
}

describe('Song setup cue styles', () => {
  it('uses the complete treatment by default', () => {
    const html = render('full');
    expect(html).toContain('Song setup');
    expect(html).toContain('<h2');
    expect(html).toContain('background-color:var(--reading-info,');
    expect(html).toContain('class="font-normal leading-snug"');
  });

  it('keeps the colour but hides the title in compact mode', () => {
    const html = render('compact');
    expect(html).not.toContain('Song setup');
    expect(html).not.toContain('<h2');
    expect(html).toContain('background-color:var(--reading-info,');
    expect(html).toContain('Performance key G');
    expect(html).toContain('Capo 2');
  });

  it('keeps the background in minimal and colors setup text separately', () => {
    const html = render('minimal');
    expect(html).not.toContain('Song setup');
    expect(html).toContain('background-color:var(--reading-info,');
    expect(html).toContain('data-song-font-scale="0.6"');
    expect(html).toContain('color:var(--reading-lyrics, var(--color-stage-fg))');
    expect(html).toContain('color:var(--reading-infoDetails, var(--color-muted))');
    expect(html).not.toMatch(/(?:^|[;" ])color:var\(--reading-info,/);
    expect(html).toContain('Performance key G');
  });
});
