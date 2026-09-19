/**
 * The live session hub.
 *
 * The host owns the session state; every connected device receives the whole thing on
 * every change. Deliberately unprotected — the LAN is the trust boundary, and whoever
 * is at the leader screen leads. A PIN would only add something to forget mid-service.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  INITIAL_SESSION,
  SESSION_PROTOCOL_VERSION,
  type ClientMessage,
  type DeviceInfo,
  type SessionPatch,
  type ServerMessage,
  type SessionState,
} from '@worship/core';
import { isLoopbackAddress } from './network.js';

interface Client {
  socket: WebSocket;
  device: DeviceInfo;
  alive: boolean;
  identified: boolean;
  canLead: boolean;
}

export interface HubOptions {
  path?: string;
  /** Where to persist session state, so a host restart does not lose the service. */
  statePath?: string | undefined;
  /** Stable identity supplied by the Leader installation. */
  leaderId?: string | undefined;
}

export class SessionHub {
  private state: SessionState = { ...INITIAL_SESSION };
  private readonly clients = new Map<string, Client>();
  private readonly wss: WebSocketServer;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly statePath: string | undefined;
  private readonly leaderId: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(server: Server, options: HubOptions = {}) {
    this.statePath = options.statePath;
    this.leaderId = options.leaderId ?? '';
    this.restore();
    this.state = {
      ...this.state,
      // A process restart never silently resumes a service. The set stays cached, but
      // every remote screen waits for the Leader to deliberately switch Lead on.
      active: false,
      sessionEpoch: null,
      leaderId: this.leaderId,
    };
    this.wss = new WebSocketServer({ server, path: options.path ?? '/ws' });
    this.wss.on('connection', (socket, request) => this.onConnection(socket, request));

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
      // Only the fields the protocol still has. A file written by an older version
      // carries keys that have since been removed — `mode` and `blockId`, from when a
      // leader could push a single section — and spreading it whole would put them back
      // into every frame sent to every device, for as long as the file survived.
      const known = Object.fromEntries(
        Object.keys(INITIAL_SESSION)
          .filter((key) => key in saved)
          .map((key) => [key, saved[key as keyof SessionState]]),
      ) as Partial<SessionState>;
      this.state = { ...INITIAL_SESSION, ...known, rev: (saved.rev ?? 0) + 1 };
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

  async close(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    clearInterval(this.heartbeat);
    // Use the WebSocketServer's set as the source of truth. A peer can already have
    // emitted `close` (and therefore left our device map) while Node still owns the
    // upgraded socket for one more turn of the event loop.
    for (const socket of this.wss.clients) socket.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  getState(): SessionState {
    return this.state;
  }

  getDevices(): DeviceInfo[] {
    return [...this.clients.values()].map((c) => c.device);
  }

  /** Apply a patch and push the result. `rev` is the hub's to set. */
  patch(patch: SessionPatch): SessionState {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 };
    this.broadcast({ t: 'session', state: this.state });
    this.persist();
    return this.state;
  }

  /** Apply a command from an identified Leader, deriving host-owned revision fields. */
  private patchFromLeader(patch: SessionPatch): SessionState {
    // TypeScript protects our own clients; this destructuring protects the network
    // boundary from hand-written JSON that tries to set host-owned fields.
    const {
      rev: _rev,
      leaderId: _leaderId,
      sessionEpoch: _sessionEpoch,
      leaderRevision: _leaderRevision,
      ...safe
    } = patch as Partial<SessionState>;
    const activates = safe.active === true && !this.state.active;
    this.state = {
      ...this.state,
      ...safe,
      sessionEpoch: activates ? randomUUID() : this.state.sessionEpoch,
      leaderRevision: this.state.leaderRevision + 1,
      rev: this.state.rev + 1,
    };
    this.broadcast({ t: 'session', state: this.state });
    this.persist();
    return this.state;
  }

  /** A service cannot remain live after its last Leader console disappears. */
  private stopIfLeaderless(): void {
    const hasLeader = [...this.clients.values()].some(
      (client) => client.identified && client.device.role === 'leader',
    );
    if (this.state.active && !hasLeader) this.patch({ active: false });
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

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const id = randomUUID();
    const client: Client = {
      socket,
      // Empty rather than a placeholder word: the server has no language, and this is
      // only visible for the few milliseconds before the device says hello. The client
      // renders its own translated fallback.
      device: {
        id,
        deviceId: null,
        name: '',
        role: 'band',
        protocolVersion: SESSION_PROTOCOL_VERSION,
        since: new Date().toISOString(),
      },
      alive: true,
      identified: false,
      canLead: isLoopbackAddress(request.socket.remoteAddress),
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
          if (message.protocolVersion !== SESSION_PROTOCOL_VERSION) {
            socket.send(
              JSON.stringify({
                t: 'incompatible',
                serverProtocol: SESSION_PROTOCOL_VERSION,
                clientProtocol: message.protocolVersion,
              } satisfies ServerMessage),
            );
            socket.close(1002, 'incompatible protocol');
            break;
          }
          if (message.role === 'leader' && !client.canLead) {
            socket.close(1008, 'Leader controls are local to the host');
            break;
          }
          // A device that reconnects — after a WiFi drop, a phone waking up, a page
          // reload — must replace its old entry rather than appear twice. Waiting for
          // the heartbeat to reap the stale socket would leave phantoms in the leader's
          // list for up to ten seconds, exactly when they are looking at it.
          if (message.deviceId) {
            for (const [otherId, other] of this.clients) {
              if (otherId !== id && other.device.deviceId === message.deviceId) {
                this.clients.delete(otherId);
                other.socket.terminate();
              }
            }
          }
          client.device = {
            ...client.device,
            deviceId: message.deviceId ?? client.device.deviceId,
            name: message.name?.slice(0, 60) || '',
            role: message.role,
            protocolVersion: message.protocolVersion,
          };
          client.identified = true;
          this.broadcastDevices();
          break;
        }

        case 'patch':
          // Band and Stage screens can disagree locally, but they can never drive the
          // shared room. A patch before hello is equally unauthorised.
          if (client.identified && client.device.role === 'leader') {
            this.patchFromLeader(message.patch);
          }
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
      this.stopIfLeaderless();
    };
    socket.on('close', drop);
    socket.on('error', drop);

    this.broadcastDevices();
  }
}
