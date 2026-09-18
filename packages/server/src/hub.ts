/**
 * The live session hub.
 *
 * The host owns the session state; every connected device receives the whole thing on
 * every change. Deliberately unprotected — the LAN is the trust boundary, and whoever
 * is at the leader screen leads. A PIN would only add something to forget mid-service.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  INITIAL_SESSION,
  type ClientMessage,
  type DeviceInfo,
  type ServerMessage,
  type SessionState,
} from '@worship/core';

interface Client {
  socket: WebSocket;
  device: DeviceInfo;
  alive: boolean;
  /** Stable across reconnects; supplied by the client and persisted in its storage. */
  deviceId: string | null;
}

export interface HubOptions {
  path?: string;
  /** Where to persist session state, so a host restart does not lose the service. */
  statePath?: string | undefined;
}

export class SessionHub {
  private state: SessionState = { ...INITIAL_SESSION };
  private readonly clients = new Map<string, Client>();
  private readonly wss: WebSocketServer;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly statePath: string | undefined;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(server: Server, options: HubOptions = {}) {
    this.statePath = options.statePath;
    this.restore();
    this.wss = new WebSocketServer({ server, path: options.path ?? '/ws' });
    this.wss.on('connection', (socket) => this.onConnection(socket));

    // A browser that goes to sleep, or a device carried out of range, does not close
    // its socket — it simply stops answering. Without this the leader's device list
    // would fill with phones that left the building.
    this.heartbeat = setInterval(() => {
      for (const [id, client] of this.clients) {
        if (!client.alive) {
          client.socket.terminate();
          this.clients.delete(id);
          this.broadcastDevices();
          continue;
        }
        client.alive = false;
        try {
          client.socket.ping();
        } catch {
          // Terminated between the check and the ping; the next sweep removes it.
        }
      }
    }, 5000);
  }

  /**
   * Reload the session from disk.
   *
   * Without this, restarting the host — a crash, a laptop lid closed too long, an
   * update — drops the whole congregation back to the first song of the service. The
   * clients reconnect silently and then find themselves in the wrong place, which is
   * worse than an obvious failure.
   */
  private restore(): void {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<SessionState>;
      this.state = { ...INITIAL_SESSION, ...saved, rev: (saved.rev ?? 0) + 1 };
    } catch {
      // A corrupt file must not stop the host from starting. A fresh session is a far
      // better outcome than no server at all.
    }
  }

  private persist(): void {
    if (!this.statePath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        writeFileSync(this.statePath!, JSON.stringify(this.state), 'utf8');
      } catch {
        // Losing the ability to persist must never interrupt a running service.
      }
    }, 250);
  }

  close(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    clearInterval(this.heartbeat);
    for (const client of this.clients.values()) client.socket.terminate();
    this.wss.close();
  }

  getState(): SessionState {
    return this.state;
  }

  getDevices(): DeviceInfo[] {
    return [...this.clients.values()].map((c) => c.device);
  }

  /** Apply a patch and push the result. `rev` is the hub's to set. */
  patch(patch: Partial<Omit<SessionState, 'rev'>>): SessionState {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 };
    this.broadcast({ t: 'session', state: this.state });
    this.persist();
    return this.state;
  }

  /** Tell every device the library changed, so it can refetch what it is showing. */
  notifyLibraryChanged(): void {
    this.broadcast({ t: 'reload', reason: 'library' });
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.send(payload);
      }
    }
  }

  private broadcastDevices(): void {
    this.broadcast({ t: 'devices', devices: this.getDevices() });
  }

  private onConnection(socket: WebSocket): void {
    const id = randomUUID();
    const client: Client = {
      socket,
      // Empty rather than a placeholder word: the server has no language, and this is
      // only visible for the few milliseconds before the device says hello. The client
      // renders its own translated fallback.
      device: { id, name: '', role: 'band', since: new Date().toISOString() },
      alive: true,
      deviceId: null,
    };
    this.clients.set(id, client);

    socket.on('pong', () => {
      client.alive = true;
    });

    // Send the state immediately. A device that reconnects mid-song lands exactly where
    // the service is, with no modal and nothing to re-select.
    socket.send(JSON.stringify({ t: 'session', state: this.state } satisfies ServerMessage));

    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return; // Malformed input from one device must not disturb the service.
      }

      switch (message.t) {
        case 'hello': {
          // A device that reconnects — after a WiFi drop, a phone waking up, a page
          // reload — must replace its old entry rather than appear twice. Waiting for
          // the heartbeat to reap the stale socket would leave phantoms in the leader's
          // list for up to ten seconds, exactly when they are looking at it.
          if (message.deviceId) {
            for (const [otherId, other] of this.clients) {
              if (otherId !== id && other.deviceId === message.deviceId) {
                this.clients.delete(otherId);
                other.socket.terminate();
              }
            }
            client.deviceId = message.deviceId;
          }
          client.device = {
            ...client.device,
            name: message.name?.slice(0, 60) || '',
            role: message.role,
          };
          this.broadcastDevices();
          break;
        }

        case 'patch':
          this.patch(message.patch);
          break;

        case 'ping':
          socket.send(
            JSON.stringify({
              t: 'pong',
              clientTime: message.clientTime,
              serverTime: Date.now(),
            } satisfies ServerMessage),
          );
          break;
      }
    });

    const drop = (): void => {
      this.clients.delete(id);
      this.broadcastDevices();
    };
    socket.on('close', drop);
    socket.on('error', drop);

    this.broadcastDevices();
  }
}
