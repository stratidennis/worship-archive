import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_STAGE_DISPLAY, type StageDisplay } from '@worship/core';

/**
 * How the stage screens are set up, read and written over HTTP.
 *
 * Over HTTP rather than the session socket because the person changing it is at the
 * settings page and is not necessarily leading anything — making them start a service
 * in order to make the text on a television bigger would be an odd price. The host
 * still broadcasts the change, so the screens themselves pick it up at once through
 * the session they already have.
 */
export function useStageDisplay(): {
  stage: StageDisplay;
  save: (patch: Partial<StageDisplay>) => void;
  reachable: boolean;
} {
  const [stage, setStage] = useState<StageDisplay>(DEFAULT_STAGE_DISPLAY);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/session', { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((body: { state: { stage?: StageDisplay } | null }) => {
        if (cancelled) return;
        setStage(body.state?.stage ?? DEFAULT_STAGE_DISPLAY);
        setReachable(true);
      })
      .catch(() => !cancelled && setReachable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback((patch: Partial<StageDisplay>) => {
    // Optimistic: the control should move under the finger, and a screen at the other
    // end of a hall is not where you find out whether the request landed.
    setStage((current) => {
      const next = { ...current, ...patch };
      void fetch('/api/session/stage', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then((response) => setReachable(response.ok))
        .catch(() => setReachable(false));
      return next;
    });
  }, []);

  return { stage, save, reachable };
}
