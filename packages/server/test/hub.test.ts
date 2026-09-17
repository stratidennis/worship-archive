import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@worship/core';
import { SessionHub } from '../src/hub.js';

let server: Server;
let hub: SessionHub;
let port: number;
let dir: string;

/**
 * A client that records everything it receives.
 *
 * Buffering from the moment the socket opens matters: the hub sends the session state
 * as its very first act, so a listener attached after connecting would miss it and the
 * test would hang rather than fail usefully.
 */
interface Client {
  ws: WebSocket;
  received: ServerMessage[];
}

async function connect(): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const received: ServerMessage[] = [];
  ws.on('message', (raw) => received.push(JSON.parse(String(raw)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, received };
}

/** Wait until a received message of this type satisfies the predicate. */
async function waitFor<T extends ServerMessage['t']>(
  client: Client,
  type: T,
  predicate: (message: Extract<ServerMessage, { t: T }>) => boolean = () => true,
  timeout = 2000,
): Promise<Extract<ServerMessage, { t: T }>> {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (let i = client.received.length - 1; i >= 0; i--) {
      const message = client.received[i]!;
      if (message.t === type && predicate(message as Extract<ServerMessage, { t: T }>)) {
        return message as Extract<ServerMessage, { t: T }>;
      }
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function send(client: Client, message: ClientMessage): void {
  client.ws.send(JSON.stringify(message));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'worship-hub-'));
  server = createServer();
  hub = new SessionHub(server, { statePath: join(dir, 'session.json') });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('joining', () => {
  it('sends the current state immediately, with nothing to re-select', async () => {
    hub.patch({ setId: 'set-1', itemIndex: 3, blockId: 'C2' });
    const client = await connect();
    const frame = await waitFor(client, 'session');
    expect(frame.state).toMatchObject({ setId: 'set-1', itemIndex: 3, blockId: 'C2' });
    client.ws.close();
  });

  it('announces the device to everyone', async () => {
    const leader = await connect();
    send(leader, { t: 'hello', role: 'leader', name: 'Lider', deviceId: 'a' });

    const stage = await connect();
    send(stage, { t: 'hello', role: 'stage', name: 'Ecran', deviceId: 'b' });

    // A device is announced on connect and again on hello, so wait for the frame that
    // reflects both identities rather than just the count.
    const frame = await waitFor(
      leader,
      'devices',
      (m) => m.devices.length === 2 && m.devices.some((d) => d.role === 'stage'),
    );
    expect(frame.devices.map((d) => d.role).sort()).toEqual(['leader', 'stage']);
    leader.ws.close();
    stage.ws.close();
  });

  it('replaces a reconnecting device rather than listing it twice', async () => {
    const first = await connect();
    send(first, { t: 'hello', role: 'band', name: 'Dennis', deviceId: 'same' });
    await waitFor(first, 'devices', (m) => m.devices.some((d) => d.name === 'Dennis'));

    // The same device comes back — a WiFi drop, a reload — before the heartbeat has
    // reaped the old socket.
    const second = await connect();
    send(second, { t: 'hello', role: 'band', name: 'Dennis', deviceId: 'same' });

    const frame = await waitFor(second, 'devices', (m) => m.devices.length === 1);
    expect(frame.devices[0]!.name).toBe('Dennis');
    second.ws.close();
  });

  it('keeps two tabs on one machine separate', async () => {
    const a = await connect();
    send(a, { t: 'hello', role: 'leader', name: 'Lider', deviceId: 'tab-1' });
    const b = await connect();
    send(b, { t: 'hello', role: 'stage', name: 'Ecran', deviceId: 'tab-2' });
    const frame = await waitFor(
      b,
      'devices',
      (m) => m.devices.length === 2 && m.devices.every((d) => d.name !== 'dispozitiv'),
    );
    expect(frame.devices.map((d) => d.name).sort()).toEqual(['Ecran', 'Lider']);
    a.ws.close();
    b.ws.close();
  });

  it('removes a device when it disconnects', async () => {
    const watcher = await connect();
    send(watcher, { t: 'hello', role: 'leader', name: 'Lider', deviceId: 'w' });
    const other = await connect();
    send(other, { t: 'hello', role: 'band', name: 'Altul', deviceId: 'o' });
    await waitFor(watcher, 'devices', (m) => m.devices.some((d) => d.name === 'Altul'));

    other.ws.close();
    await waitFor(watcher, 'devices', (m) => m.devices.every((d) => d.name !== 'Altul'));
    watcher.ws.close();
  });
});

describe('driving the service', () => {
  it('pushes a patch to every device', async () => {
    const leader = await connect();
    const stage = await connect();

    send(leader, { t: 'patch', patch: { itemIndex: 5, blockId: 'V2' } });
    const frame = await waitFor(stage, 'session', (m) => m.state.itemIndex === 5);

    expect(frame.state).toMatchObject({ itemIndex: 5, blockId: 'V2' });
    leader.ws.close();
    stage.ws.close();
  });

  it('bumps rev on every change, so stale frames can be ignored', async () => {
    const before = hub.getState().rev;
    hub.patch({ output: 'black' });
    hub.patch({ output: 'live' });
    expect(hub.getState().rev).toBe(before + 2);
  });

  it('will not let a client set rev itself', async () => {
    const client = await connect();
    send(client, { t: 'patch', patch: { itemIndex: 1, rev: 9999 } as never });
    await waitFor(client, 'session', (m) => m.state.itemIndex === 1);
    // The client asked for rev 9999; the hub set its own.
    expect(hub.getState().rev).toBeLessThan(9999);
    client.ws.close();
  });

  it('answers a ping with both clocks, for offset estimation', async () => {
    const client = await connect();
    const sentAt = Date.now();
    send(client, { t: 'ping', clientTime: sentAt });
    const pong = await waitFor(client, 'pong');
    expect(pong.clientTime).toBe(sentAt);
    expect(typeof pong.serverTime).toBe('number');
    client.ws.close();
  });

  it('ignores malformed input instead of disturbing the service', async () => {
    const client = await connect();
    await waitFor(client, 'session');
    client.ws.send('not json at all');
    client.ws.send(JSON.stringify({ t: 'nonsense' }));

    // Still working afterwards.
    send(client, { t: 'patch', patch: { itemIndex: 9 } });
    const frame = await waitFor(client, 'session', (m) => m.state.itemIndex === 9);
    expect(frame.state.itemIndex).toBe(9);
    client.ws.close();
  });
});

describe('surviving a host restart', () => {
  it('reloads the session from disk, so nobody jumps back to song one', async () => {
    hub.patch({ setId: 'set-9', itemIndex: 4, blockId: 'B1', tempo: 96 });
    // Let the debounced write land.
    await new Promise((resolve) => setTimeout(resolve, 400));
    hub.close();

    const revived = new SessionHub(server, { statePath: join(dir, 'session.json') });
    expect(revived.getState()).toMatchObject({
      setId: 'set-9',
      itemIndex: 4,
      blockId: 'B1',
      tempo: 96,
    });
    // rev moves forward, so reconnecting clients accept the restored frame.
    expect(revived.getState().rev).toBeGreaterThan(0);
    revived.close();
    hub = new SessionHub(server, {});
  });

  it('starts clean rather than refusing to run when the file is corrupt', async () => {
    const path = join(dir, 'broken.json');
    rmSync(path, { force: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, '{ not json', 'utf8');
    const revived = new SessionHub(server, { statePath: path });
    expect(revived.getState().itemIndex).toBe(0);
    revived.close();
  });
});
