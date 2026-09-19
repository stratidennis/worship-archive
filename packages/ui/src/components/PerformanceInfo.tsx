import { useT } from '../lib/i18n.js';

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
}: {
  performanceKey: string | null;
  transpose: number;
  capo: number;
  displayedKey?: string | null;
  instrumentTranspose?: number | null;
  instrumentCapo?: number | null;
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
  return (
    <section
      className="mb-[0.9em] rounded-md border-l-2 border-(--color-chord) bg-(--color-chord)/8 px-[0.65em] py-[0.4em]"
      style={{ breakInside: 'avoid' }}
    >
      <h2 className="text-[0.58em] font-semibold uppercase tracking-wider text-(--color-muted)">
        {t('performance.title')}
      </h2>
      <p className="text-[0.78em] font-semibold leading-snug">{leader.join(' · ')}</p>
      {mine.length > 0 && (
        <p className="mt-[0.18em] text-[0.68em] leading-snug text-(--color-muted)">
          {mine.join(' · ')}
        </p>
      )}
    </section>
  );
}
