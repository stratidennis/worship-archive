import { useT } from '../lib/i18n.js';

/**
 * A screen with nothing on it yet.
 *
 * Between services — and in the minutes before one, while the leader is still opening
 * the laptop — the televisions are already on and pointed at the room. What they show
 * then matters: an empty screen looks like a screen that has failed, and somebody goes
 * looking for the HDMI cable.
 *
 * So: the gradient mark, the name, the sentence, and a quiet spinner. The movement is
 * the whole point. It is the difference between "this is broken" and "this is on, and
 * waiting for someone", which is a question a person standing in a hall answers from
 * ten metres away without asking anybody.
 */
export function WaitingForLeader({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'gap-4' : 'gap-6'}`}>
      {/* Sized against the viewport rather than in points: the big variant is read
          from the back of a hall on a television nobody can walk up to. */}
      <div className="flex flex-col items-center gap-2" role="img" aria-label={t('app.name')}>
        <img
          src="/icon-512.png"
          alt=""
          className={`h-auto ${compact ? 'w-20' : 'w-[min(18vh,9rem)]'}`}
        />
        <span
          className={`font-bold tracking-tight ${compact ? 'text-2xl' : 'text-[clamp(2rem,5vh,4rem)]'}`}
        >
          {t('app.name')}
        </span>
      </div>
      <p
        className={`flex items-center gap-[0.65em] text-(--color-muted) ${
          compact ? 'text-lg' : 'text-[clamp(1.25rem,3vh,2.25rem)]'
        }`}
      >
        <span>{t('band.waiting')}</span>
        <Spinner compact={compact} />
      </p>
    </div>
  );
}

/**
 * Sized in `em`, so the same spinner works under a compact Band message and across a
 * hall without a second visual treatment.
 */
function Spinner({ compact }: { compact: boolean }) {
  return (
    <span
      aria-hidden
      className={`waiting-spinner inline-block shrink-0 rounded-full border-current border-r-transparent ${
        compact ? 'h-5 w-5 border-2' : 'h-[0.9em] w-[0.9em] border-[0.09em]'
      }`}
    />
  );
}
