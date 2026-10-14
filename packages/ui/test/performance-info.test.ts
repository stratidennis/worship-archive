import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PerformanceInfo } from '../src/components/PerformanceInfo.js';
import { I18nProvider } from '../src/lib/i18n.js';

function render(showBlockTitles?: boolean): string {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(PerformanceInfo, {
        performanceKey: 'G',
        transpose: 0,
        capo: 2,
        showBlockTitles,
      }),
    ),
  );
}

describe('Song setup section title', () => {
  it('is shown by default and when section titles are enabled', () => {
    expect(render()).toContain('Song setup');
    expect(render(true)).toContain('<h2');
  });

  it('hides only the title, keeping the key and capo information', () => {
    const html = render(false);
    expect(html).not.toContain('Song setup');
    expect(html).not.toContain('<h2');
    expect(html).toContain('Performance key G');
    expect(html).toContain('Capo 2');
  });
});
