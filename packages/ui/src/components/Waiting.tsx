import { useT } from '../lib/i18n.js';
import { Wordmark } from './Logo.js';

/**
 * A screen with nothing on it yet.
 *
 * Between services — and in the minutes before one, while the leader is still opening
 * the laptop — the televisions are already on and pointed at the room. What they show
 * then matters: an empty screen looks like a screen that has failed, and somebody goes
 * looking for the HDMI cable.
 *
 * So: the mark, the sentence, and three dots that move. The movement is the whole
 * point. It is the difference between "this is broken" and "this is on, and waiting for
 * someone", which is a question a person standing in a hall answers from ten metres
 * away without asking anybody.
 */
export function WaitingForLeader({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Sized against the viewport rather than in points: the big variant is read
          from the back of a hall on a television nobody can walk up to. */}
      <Wordmark
        className={`max-w-[86vw] text-(--color-chord) ${compact ? 'h-9' : 'h-[min(13vh,7rem)]'}`}
        label={t('app.name')}
      />
      <p
        className={`flex items-end gap-[0.4em] text-(--color-muted) ${
          compact ? 'text-sm' : 'text-[clamp(1.25rem,4vh,3rem)]'
        }`}
      >
        <span>{t('band.waiting')}</span>
        <Dots />
      </p>
    </div>
  );
}

/**
 * Sized in `em`, so the same three dots work under a 14px line on a phone and a 24px
 * one across a hall without a second set of numbers.
 */
function Dots() {
  return (
    <span aria-hidden className="mb-[0.22em] flex items-end gap-[0.28em]">
      {[0, 180, 360].map((delay) => (
        <span
          key={delay}
          className="waiting-dot h-[0.15em] w-[0.15em] rounded-full bg-current"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
