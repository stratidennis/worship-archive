import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Stable installation id. Legacy named browser screens use `legacy:<name>`. */
  id: string;
  /** Editable label shown to the leader. */
  name: string;
  connected: boolean;
  /** Whether it has settings of its own, rather than only the shared ones. */
  configured: boolean;
}

export interface StageSettings {
  /** What every screen gets unless it says otherwise. */
  shared: StageDisplay;
  /** Per-device displays keyed by stable id. */
  byScreen: Record<string, StageDisplay>;
  /** Named screens, whether connected now or only remembered. */
  screens: StageScreen[];
  /** Screens connected without a name of their own; they can only take the shared set. */
  unnamed: number;
  /** `null` writes the shared settings, an id writes that one screen's. */
  save: (screenId: string | null, patch: Partial<StageDisplay>) => void;
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

export function useStageDisplay(): StageSettings {
  const [shared, setShared] = useState<StageDisplay>(DEFAULT_STAGE_DISPLAY);
  const [byScreen, setByScreen] = useState<Record<string, StageDisplay>>({});
  const [screens, setScreens] = useState<StageScreen[]>([]);
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
          const connected = stages
            .filter((device) => device.deviceId && device.name.trim())
            .map((device) => ({ id: device.deviceId!, name: device.name.trim() }));
          setUnnamed(stages.length - connected.length);

          if (Date.now() < quietUntil.current) return;
          setShared(body.state?.stage ?? DEFAULT_STAGE_DISPLAY);
          const stable = body.state?.stageByDevice ?? {};
          const legacy = body.state?.stageBy ?? {};
          const displays: Record<string, StageDisplay> = {};
          const next = new Map<string, StageScreen>();

          for (const device of connected) {
            displays[device.id] = stable[device.id]?.display ?? DEFAULT_STAGE_DISPLAY;
            next.set(device.id, {
              ...device,
              connected: true,
              configured: stable[device.id] !== undefined,
            });
          }
          for (const [id, remembered] of Object.entries(stable)) {
            displays[id] = remembered.display;
            if (!next.has(id)) {
              next.set(id, {
                id,
                name: remembered.name || id,
                connected: false,
                configured: true,
              });
            }
          }
          for (const [name, display] of Object.entries(legacy)) {
            const id = `legacy:${name}`;
            displays[id] = display;
            if (!next.has(id)) {
              next.set(id, { id, name, connected: false, configured: true });
            }
          }
          setByScreen(displays);
          setScreens([...next.values()].sort((a, b) => a.name.localeCompare(b.name)));
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

  const save = useCallback(
    (screenId: string | null, patch: Partial<StageDisplay>) => {
      // Optimistic: the control should move under the finger, and a screen at the other
      // end of a hall is not where you find out whether the request landed.
      quietUntil.current = Date.now() + SETTLE_MS;
      if (screenId) {
        setByScreen((current) => {
          const next = patchStageDisplay(current[screenId] ?? DEFAULT_STAGE_DISPLAY, patch);
          const merged = { ...current };
          if (isStageDisplayEmpty(next)) delete merged[screenId];
          else merged[screenId] = next;
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
        body: JSON.stringify(
          screenId
            ? screenId.startsWith('legacy:')
              ? { ...patch, screen: screenId.slice('legacy:'.length) }
              : {
                  ...patch,
                  deviceId: screenId,
                  screen: screens.find((candidate) => candidate.id === screenId)?.name ?? '',
                }
            : patch,
        ),
      })
        .then((response) => setReachable(response.ok))
        .catch(() => setReachable(false));
    },
    [screens],
  );

  return { shared, byScreen, screens, unnamed, save, reachable };
}
