import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_STAGE_DISPLAY } from '@worship/core';
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
