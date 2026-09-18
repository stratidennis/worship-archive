import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INITIAL_SESSION,
  estimateClockOffset,
  randomId,
  type ClientMessage,
  type DeviceInfo,
  type DeviceRole,
  type ServerMessage,
  type SessionState,
} from '@worship/core';

/**
 * The live session, as seen by one device.
 *
 * The legacy app handled this badly and it is the thing most worth getting right:
 * connection loss was a sleep-poll loop and a countdown modal, so a dropped WiFi packet
 * turned into a dialog box on a stage monitor mid-worship.
 *
 * Here, reconnection is silent and unbounded. There is no modal, no prompt, and nothing
 * to re-select — the first frame after reconnecting carries the whole session state, so
 * the device lands exactly where the service has got to.
 */

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

export interface Session {
  state: SessionState;
  devices: DeviceInfo[];
  /** This tab's own id, so it can find itself in `devices`. */
  deviceId: string;
  status: ConnectionStatus;
  /** serverTime − clientTime, so the metronome agrees across devices. */
  clockOffset: number;
  patch: (patch: Partial<Omit<SessionState, 'rev'>>) => void;
  /** Bumped when the host says the library changed on disk. */
  libraryRev: number;
  /**
   * True once the host's state has actually arrived.
   *
   * Before the first frame, `state` is the *initial* session — no set, item zero — and
   * acting on it would be acting on a guess. The leader switch uses this to decide
   * whether the service is already somewhere before it moves it.
   */
  synced: boolean;
}

const MIN_BACKOFF = 500;
const MAX_BACKOFF = 10_000;
const DEVICE_ID_KEY = 'worship-archive:device-id';

/**
 * An id identifying this *tab*, surviving reconnects and reloads.
 *
 * sessionStorage, not localStorage, and the distinction matters: localStorage is shared
 * by every tab of the same origin, so the leader console and a stage display open on
 * one machine would claim the same identity and each would kick the other off. Per-tab
 * is exactly the right granularity — a reload keeps it, a second tab gets its own.
 */
function deviceId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = randomId();
    sessionStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private window or blocked storage: an in-memory id still de-duplicates
    // reconnects for this page's lifetime, which is the case that matters.
    return randomId();
  }
}

/**
 * @param enabled Whether to hold a connection at all. Leading is a switch on the set
 * page now, so the page is mounted long before — and long after — anyone is leading
 * from it. A socket that opened on mount would put a phantom "leader" in everyone's
 * device list for the whole time the set was merely being edited.
 */
export function useSession(role: DeviceRole, name: string, enabled = true): Session {
  const [state, setState] = useState<SessionState>(INITIAL_SESSION);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [clockOffset, setClockOffset] = useState(0);
  const [libraryRev, setLibraryRev] = useState(0);
  const [synced, setSynced] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  const backoff = useRef(MIN_BACKOFF);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(false);
  const identity = useRef({ role, name });
  identity.current = { role, name };
  const myDeviceId = useRef<string>('');
  if (!myDeviceId.current) myDeviceId.current = deviceId();

  useEffect(() => {
    if (!enabled) {
      setStatus('offline');
      setDevices([]);
      setSynced(false);
      setState(INITIAL_SESSION);
      return;
    }
    closed.current = false;

    const connect = (): void => {
      if (closed.current) return;
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        schedule();
        return;
      }
      socket.current = ws;

      // Every handler checks that this socket is still the current one. A socket that
      // has been replaced can still deliver a late close event, and without this guard
      // it would flip the UI to "disconnected", null out the live socket so commands
      // silently stop being sent, and schedule a second connection. All while the real
      // socket sits there, open and working.
      ws.onopen = () => {
        if (socket.current !== ws) return;
        backoff.current = MIN_BACKOFF;
        setStatus('live');
        ws.send(
          JSON.stringify({
            t: 'hello',
            role: identity.current.role,
            name: identity.current.name,
            deviceId: myDeviceId.current,
          } satisfies ClientMessage),
        );
        ws.send(JSON.stringify({ t: 'ping', clientTime: Date.now() } satisfies ClientMessage));
      };

      ws.onmessage = (event) => {
        if (socket.current !== ws) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        switch (message.t) {
          case 'session':
            // Ignore a frame that lost a race with a newer one.
            setState((current) => (message.state.rev >= current.rev ? message.state : current));
            setSynced(true);
            break;
          case 'devices':
            setDevices(message.devices);
            break;
          case 'pong':
            setClockOffset(
              estimateClockOffset(message.clientTime, message.serverTime, Date.now()),
            );
            break;
          case 'reload':
            setLibraryRev((n) => n + 1);
            break;
        }
      };

      ws.onclose = () => {
        if (socket.current !== ws) return;
        socket.current = null;
        setStatus('offline');
        schedule();
      };
      ws.onerror = () => ws.close();
    };

    const schedule = (): void => {
      if (closed.current) return;
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(connect, backoff.current);
      // Exponential, capped. Never gives up: a service can outlast a router reboot.
      backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF);
    };

    connect();

    // Coming back from a locked phone should not wait out the backoff.
    const onWake = (): void => {
      if (document.visibilityState === 'visible' && socket.current === null) {
        backoff.current = MIN_BACKOFF;
        if (retry.current) clearTimeout(retry.current);
        connect();
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);

    return () => {
      closed.current = true;
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      if (retry.current) clearTimeout(retry.current);
      const ws = socket.current;
      socket.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [enabled]);

  /*
    Say who we are again when that changes.

    `hello` was only sent on connect, so a musician who typed their name *after* joining
    — which is what everybody does, because the field is at the bottom of the page they
    just opened — stayed "Muzician" in the leader's list until they reloaded. The one
    thing the name is for is the leader knowing who is in the room.
  */
  useEffect(() => {
    const ws = socket.current;
    if (!enabled || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        t: 'hello',
        role,
        name,
        deviceId: myDeviceId.current,
      } satisfies ClientMessage),
    );
  }, [enabled, role, name, status]);

  // Re-measure the clock offset periodically; laptops drift, and phones adjust theirs.
  useEffect(() => {
    const timer = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'ping', clientTime: Date.now() } satisfies ClientMessage));
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const patch = useCallback((value: Partial<Omit<SessionState, 'rev'>>) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: 'patch', patch: value } satisfies ClientMessage));
  }, []);

  return {
    state,
    devices,
    deviceId: myDeviceId.current,
    status,
    clockOffset,
    patch,
    libraryRev,
    synced,
  };
}
