import { useEffect, useState } from 'react';
import { beatAt, msToNextBeat, type SessionState } from '@worship/core';

/**
 * The metronome, as a row of lights — red on the downbeat, green on the rest.
 *
 * The beat is never broadcast. Each device derives it from `tempo` and `beatEpoch`,
 * corrected by its own measured clock offset, so network jitter cannot make it stutter
 * and two musicians cannot see different downbeats.
 *
 * Timers are scheduled to the next beat rather than run on an interval, so drift does
 * not accumulate over a five-minute song.
 */
export function BeatLed({
  state,
  clockOffset,
  size = 'md',
}: {
  state: SessionState;
  clockOffset: number;
  size?: 'sm' | 'md';
}) {
  const [beat, setBeat] = useState<number | null>(null);

  useEffect(() => {
    if (state.tempo === null || state.beatEpoch === null) {
      setBeat(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;

    const tick = (): void => {
      const now = Date.now();
      setBeat(beatAt(state, now, clockOffset)?.beat ?? null);
      const wait = msToNextBeat(state, now, clockOffset) ?? 500;
      timer = setTimeout(tick, Math.max(16, wait));
    };
    tick();
    return () => clearTimeout(timer);
  }, [state, clockOffset]);

  if (state.tempo === null) return null;

  const dot = size === 'sm' ? 'h-2 w-2' : 'h-3 w-3';

  return (
    <span className="flex items-center gap-1.5" title={`${state.tempo} bpm`}>
      {Array.from({ length: state.beatsPerBar }, (_, i) => {
        const on = beat === i;
        const downbeat = i === 0;
        return (
          <span
            key={i}
            className={`${dot} rounded-full transition-opacity duration-75`}
            style={{
              background: downbeat ? 'oklch(62% 0.21 25)' : 'oklch(70% 0.17 150)',
              opacity: on ? 1 : 0.18,
            }}
          />
        );
      })}
      <span className="ml-1 text-xs tabular-nums text-(--color-muted)">{state.tempo}</span>
    </span>
  );
}
