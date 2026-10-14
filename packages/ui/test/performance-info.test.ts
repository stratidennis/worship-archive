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
        transpose: 0,
        capo: 2,
        cueStyle,
      }),
    ),
  );
}

describe('Song setup cue styles', () => {
  it('uses the complete treatment by default', () => {
    expect(render()).toContain('Song setup');
    expect(render('full')).toContain('<h2');
    expect(render('full')).toContain('bg-(--color-chord)/8');
  });

  it('keeps the colour but hides the title in compact mode', () => {
    const html = render('compact');
    expect(html).not.toContain('Song setup');
    expect(html).not.toContain('<h2');
    expect(html).toContain('bg-(--color-chord)/8');
    expect(html).toContain('Performance key G');
    expect(html).toContain('Capo 2');
  });

  it('removes the title and background while keeping a colour-coded minimal setup', () => {
    const html = render('minimal');
    expect(html).not.toContain('Song setup');
    expect(html).not.toContain('bg-(--color-chord)/8');
    expect(html).toContain('data-song-font-scale="0.45"');
    expect(html).toContain('color:var(--color-chord)');
    expect(html).toContain('Performance key G');
  });
});
