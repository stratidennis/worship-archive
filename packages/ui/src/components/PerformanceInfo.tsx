import type { CueStyle } from '@worship/core';
import { useT } from '../lib/i18n.js';
import { readingSectionStyle, SETUP_ACCENT, SETUP_BACKGROUND } from '../lib/readingColors.js';

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** The musical setup, rendered as the first song block on Band and Stage screens. */
export function PerformanceInfo({
  performanceKey,
  transpose,
  capo,
  displayedKey,
  instrumentTranspose,
  instrumentCapo,
  cueStyle = 'full',
}: {
  performanceKey: string | null;
  transpose: number;
  capo: number;
  displayedKey?: string | null;
  instrumentTranspose?: number | null;
  instrumentCapo?: number | null;
  cueStyle?: CueStyle;
}) {
  const { t } = useT();
  const leader = [
    performanceKey ? t('performance.performanceKey', { key: performanceKey }) : null,
    capo !== 0 ? t('performance.capo', { fret: capo }) : null,
    transpose !== 0 ? t('performance.transpose', { amount: signed(transpose) }) : null,
  ].filter(Boolean);
  const mine = [
    displayedKey ? t('performance.yourChords', { key: displayedKey }) : null,
    instrumentCapo !== null && instrumentCapo !== undefined
      ? t('performance.capoOption', { fret: instrumentCapo })
      : null,
    instrumentTranspose !== null && instrumentTranspose !== undefined
      ? t('performance.pianoTranspose', { amount: signed(instrumentTranspose) })
      : null,
  ].filter(Boolean);

  if (leader.length === 0 && mine.length === 0) return null;
  const leaderScale = cueStyle === 'full' ? 0.8 : cueStyle === 'compact' ? 0.7 : 0.6;
  const mineScale = cueStyle === 'full' ? 0.69 : cueStyle === 'compact' ? 0.61 : 0.52;
  return (
    <section
      data-song-font-scale={leaderScale}
      className={`mb-[var(--song-section-gap,0.9em)] ${
        cueStyle === 'minimal' ? '' : 'rounded-md border-l px-[0.45em] py-[0.24em]'
      }`}
      style={{
        breakInside: 'avoid',
        fontSize: `${leaderScale}em`,
        ...readingSectionStyle('info', cueStyle, {
          border: SETUP_ACCENT,
          background: SETUP_BACKGROUND,
        }),
      }}
    >
      {cueStyle === 'full' && (
        <h2
          data-song-font-scale={0.58}
          className="font-semibold uppercase tracking-wider text-[color:var(--reading-titles,var(--color-muted))]"
          style={{ fontSize: `${0.58 / leaderScale}em` }}
        >
          {t('performance.title')}
        </h2>
      )}
      <p data-song-font-scale={leaderScale} className="font-normal leading-snug">
        {leader.join(' · ')}
      </p>
      {mine.length > 0 && (
        <p
          data-song-font-scale={mineScale}
          className="mt-[0.18em] leading-snug"
          style={{
            fontSize: `${mineScale / leaderScale}em`,
            color:
              cueStyle === 'minimal'
                ? 'var(--reading-infoDetails, inherit)'
                : 'var(--reading-infoDetails, var(--color-muted))',
          }}
        >
          {mine.join(' · ')}
        </p>
      )}
    </section>
  );
}
