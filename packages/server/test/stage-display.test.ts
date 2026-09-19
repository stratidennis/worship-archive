import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_STAGE_DISPLAY, resolveStageDisplay } from '@worship/core';
import { Library } from '../src/library.js';
import { SetStore } from '../src/sets.js';
import { SessionHub } from '../src/hub.js';
import { createServer } from '../src/api.js';

/**
 * How the stage screens look is set from the settings page, over HTTP.
 *
 * Not through the session socket, and that is the point of these: the person changing
 * it is not necessarily leading anything, and making them start a service in order to
 * make a television's text bigger would be an odd price.
 */

let dir: string;
let library: Library;
let sets: SetStore;
let hub: SessionHub;
let app: FastifyInstance;
let http: ReturnType<typeof createHttpServer>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worship-stage-'));
  mkdirSync(join(dir, 'songs'), { recursive: true });
  library = new Library(dir);
  sets = new SetStore(dir, library.db);
  http = createHttpServer();
  hub = new SessionHub(http, {});
  app = createServer({ library, sets, hub });
});

afterEach(async () => {
  hub.close();
  await app.close();
  http.close();
  library.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: '/api/session/stage', payload: body as object });

describe('the stage screens’ appearance', () => {
  it('starts out entirely unset, so each screen keeps its own', () => {
    expect(hub.getState().stage).toEqual(DEFAULT_STAGE_DISPLAY);
  });

  it('takes a setting and hands it back', async () => {
    const response = await put({ theme: 'stage', maxFontPx: 48 });
    expect(response.statusCode).toBe(200);
    expect(response.json().stage).toMatchObject({ theme: 'stage', maxFontPx: 48 });
    expect(hub.getState().stage.theme).toBe('stage');
  });

  it('leaves alone what the request did not mention', async () => {
    await put({ theme: 'stage', chordColor: '#ef4444' });
    await put({ maxFontPx: 40 });
    expect(hub.getState().stage).toEqual({
      theme: 'stage',
      language: null,
      maxFontPx: 40,
      chordColor: '#ef4444',
    });
  });

  /*
    An explicit null is "give this screen its own setting back", which is a different
    request from not mentioning the field at all — and the easy way to write this
    endpoint treats them the same, leaving no way to undo a choice.
  */
  it('treats an explicit null as clearing the setting', async () => {
    await put({ theme: 'dark', chordColor: '#ef4444' });
    await put({ theme: null });
    expect(hub.getState().stage.theme).toBeNull();
    expect(hub.getState().stage.chordColor).toBe('#ef4444');
  });

  it('reaches every connected screen, because the hub pushes the whole state', async () => {
    const before = hub.getState().rev;
    await put({ maxFontPx: 52 });
    expect(hub.getState().rev).toBeGreaterThan(before);
  });

  it('is readable without a socket', async () => {
    await put({ language: 'en' });
    const response = await app.inject({ method: 'GET', url: '/api/session' });
    expect(response.json().state.stage.language).toBe('en');
  });
});

/*
  One hall, two screens.

  The television at the back and the monitor by the drums are not asking for the same
  text size, and the only thing that can tell them apart is the name each was given in
  its own address — the same name the leader reads in the connected list.
*/
describe('one screen at a time', () => {
  it('keys installed screens by stable device id rather than editable name', async () => {
    await put({ deviceId: 'stage-1', screen: 'Left', maxFontPx: 32 });
    await put({ deviceId: 'stage-1', screen: 'Stage left', theme: 'dark' });

    const remembered = hub.getState().stageByDevice['stage-1'];
    expect(remembered?.name).toBe('Stage left');
    expect(remembered?.display).toMatchObject({ maxFontPx: 32, theme: 'dark' });
    expect(resolveStageDisplay(hub.getState(), 'Anything', 'stage-1').maxFontPx).toBe(32);
  });

  it('sets a screen without touching the rest', async () => {
    await put({ maxFontPx: 60 });
    const response = await put({ screen: 'Drums', maxFontPx: 28 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ screen: 'Drums', stage: { maxFontPx: 28 } });

    const state = hub.getState();
    expect(state.stage.maxFontPx).toBe(60);
    expect(state.stageBy['Drums']?.maxFontPx).toBe(28);
    expect(resolveStageDisplay(state, 'Drums').maxFontPx).toBe(28);
    expect(resolveStageDisplay(state, 'Back').maxFontPx).toBe(60);
  });

  it('keeps two screens apart', async () => {
    await put({ screen: 'Drums', theme: 'dark' });
    await put({ screen: 'Back', theme: 'stage' });
    expect(hub.getState().stageBy['Drums']?.theme).toBe('dark');
    expect(hub.getState().stageBy['Back']?.theme).toBe('stage');
  });

  it('leaves alone what a screen\u2019s patch did not mention', async () => {
    await put({ screen: 'Drums', theme: 'dark', chordColor: '#ef4444' });
    await put({ screen: 'Drums', maxFontPx: 30 });
    expect(hub.getState().stageBy['Drums']).toEqual({
      theme: 'dark',
      language: null,
      maxFontPx: 30,
      chordColor: '#ef4444',
    });
  });

  /*
    A screen handed back every setting is forgotten, rather than kept as four nulls.
    Otherwise the settings page would go on listing a television that was tried once
    and put back exactly as it was, and there would be no way to make it stop.
  */
  it('forgets a screen once it has nothing of its own left', async () => {
    await put({ screen: 'Drums', theme: 'dark' });
    expect(Object.keys(hub.getState().stageBy)).toEqual(['Drums']);
    await put({ screen: 'Drums', theme: null });
    expect(hub.getState().stageBy).toEqual({});
  });

  it('treats a blank name as meaning all of them', async () => {
    await put({ screen: '   ', maxFontPx: 44 });
    expect(hub.getState().stage.maxFontPx).toBe(44);
    expect(hub.getState().stageBy).toEqual({});
  });

  it('is readable without a socket, so the settings page can list the screens', async () => {
    await put({ screen: 'Back', language: 'en' });
    const response = await app.inject({ method: 'GET', url: '/api/session' });
    expect(response.json().state.stageBy.Back.language).toBe('en');
  });
});

/*
  What the leader's own screen looks like.

  The layer under everything else, and the one that makes an untouched installation
  behave the way people expect: the televisions look like the laptop.
*/
describe('the leader\u2019s own appearance', () => {
  const putHost = (body: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/session/host', payload: body as object });

  it('is unknown until a leader\u2019s device says', () => {
    expect(hub.getState().host).toBeNull();
  });

  it('is what the screens fall back to', async () => {
    await putHost({ theme: 'dark', language: 'en', chordColor: '#ef4444' });
    const state = hub.getState();
    expect(state.host).toEqual({ theme: 'dark', language: 'en', chordColor: '#ef4444' });
    expect(resolveStageDisplay(state, null)).toMatchObject({ theme: 'dark', language: 'en' });
  });

  /*
    "Match the system" is a question, not a look, and the answer belongs to the device
    asking it. Sent as-is it would mean the *television's* system, which is the whole
    misunderstanding this layer exists to fix, one level down — so the device resolves
    it first and the host refuses it if it did not.
  */
  it('refuses a theme that is not a look', async () => {
    const response = await putHost({ theme: 'auto', language: 'ro' });
    expect(response.statusCode).toBe(400);
    expect(hub.getState().host).toBeNull();
  });

  it('refuses a language it does not have', async () => {
    expect((await putHost({ theme: 'dark', language: 'fr' })).statusCode).toBe(400);
    expect((await putHost({ theme: 'dark' })).statusCode).toBe(400);
  });

  it('reaches every screen, because the hub pushes the whole state', async () => {
    const before = hub.getState().rev;
    await putHost({ theme: 'light', language: 'ro', chordColor: null });
    expect(hub.getState().rev).toBeGreaterThan(before);
  });
});

describe('network diagnostics', () => {
  it('reports the addresses and discovery status used by the join page', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/host' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      port: 7374,
      mdns: 'disabled',
      servesInterface: false,
    });
    expect(response.json().interfaces).toEqual(expect.any(Array));
  });

  it('has an uncached reachability target', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/network/ping' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ ok: true, protocol: 1 });
  });
});
