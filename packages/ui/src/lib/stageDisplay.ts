import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_STAGE_DISPLAY,
  isStageDisplayEmpty,
  patchStageDisplay,
  type DeviceInfo,
  type SessionState,
  type StageDisplay,
} from '@worship/core';

/**
 * How the stage screens are set up, read and written over HTTP.
 *
 * Over HTTP rather than the session socket because the person changing it is at the
 * settings page and is not necessarily leading anything — making them start a service
 * in order to make the text on a television bigger would be an odd price. The host
 * still broadcasts the change, so the screens themselves pick it up at once through
 * the session they already have.
 *
 * Polled, because the useful thing to see here is *which screens are on*. A leader
 * setting up a hall switches a television on and expects it to appear in the list a
 * moment later, and holding a second socket open for the settings page — one that
 * would show up in everyone else's device list as a phantom — is a poor trade for
 * three seconds of latency on a page that is rarely open.
 */

export interface StageScreen {
  /** The name in that screen's own address; also what the leader sees in the list. */
  name: string;
  /** How many screens are connected under this name — usually one, never zero here. */
  connected: number;
  /** Whether it has settings of its own, rather than only the shared ones. */
  configured: boolean;
}

export interface StageSettings {
  /** What every screen gets unless it says otherwise. */
  shared: StageDisplay;
  byScreen: Record<string, StageDisplay>;
  /** Named screens, whether connected now or only remembered. */
  screens: StageScreen[];
  /** Screens connected without a name of their own; they can only take the shared set. */
  unnamed: number;
  /** `null` writes the shared settings, a name writes that one screen's. */
  save: (screen: string | null, patch: Partial<StageDisplay>) => void;
  reachable: boolean;
}

const POLL_MS = 3000;
/**
 * How long a write silences the poll.
 *
 * Without it, a reply that was already in flight when you moved the slider lands a
 * moment later carrying the old value, and the control jumps back under your finger.
 */
const SETTLE_MS = 1500;

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function useStageDisplay(): StageSettings {
  const [shared, setShared] = useState<StageDisplay>(DEFAULT_STAGE_DISPLAY);
  const [byScreen, setByScreen] = useState<Record<string, StageDisplay>>({});
  const [connected, setConnected] = useState<string[]>([]);
  const [unnamed, setUnnamed] = useState(0);
  const [reachable, setReachable] = useState(true);
  const quietUntil = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const read = (): void => {
      fetch('/api/session', { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
        .then((body: { state: SessionState | null; devices: DeviceInfo[] }) => {
          if (cancelled) return;
          setReachable(true);

          const stages = (body.devices ?? []).filter((device) => device.role === 'stage');
          const names = stages.map((device) => device.name.trim()).filter(Boolean);
          setConnected((current) => (same(current, names) ? current : names));
          setUnnamed(stages.length - names.length);

          if (Date.now() < quietUntil.current) return;
          setShared(body.state?.stage ?? DEFAULT_STAGE_DISPLAY);
          setByScreen(body.state?.stageBy ?? {});
        })
        .catch(() => {
          if (!cancelled) setReachable(false);
        });
    };

    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const screens = useMemo<StageScreen[]>(() => {
    const counts = new Map<string, number>();
    for (const name of connected) counts.set(name, (counts.get(name) ?? 0) + 1);
    // Remembered screens stay in the list even while switched off, so a setting made
    // for the screen at the back can be found and undone on a Tuesday.
    for (const name of Object.keys(byScreen)) if (!counts.has(name)) counts.set(name, 0);
    return [...counts.entries()]
      .map(([name, count]) => ({
        name,
        connected: count,
        configured: byScreen[name] !== undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [connected, byScreen]);

  const save = useCallback((screen: string | null, patch: Partial<StageDisplay>) => {
    // Optimistic: the control should move under the finger, and a screen at the other
    // end of a hall is not where you find out whether the request landed.
    quietUntil.current = Date.now() + SETTLE_MS;
    if (screen) {
      setByScreen((current) => {
        const next = patchStageDisplay(current[screen] ?? DEFAULT_STAGE_DISPLAY, patch);
        const merged = { ...current };
        if (isStageDisplayEmpty(next)) delete merged[screen];
        else merged[screen] = next;
        return merged;
      });
    } else {
      setShared((current) => patchStageDisplay(current, patch));
    }

    // The patch itself, not the merged result: `undefined` disappears in JSON, which
    // is exactly "leave that one alone", while an explicit null survives and clears.
    void fetch('/api/session/stage', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(screen ? { ...patch, screen } : patch),
    })
      .then((response) => setReachable(response.ok))
      .catch(() => setReachable(false));
  }, []);

  return { shared, byScreen, screens, unnamed, save, reachable };
}
