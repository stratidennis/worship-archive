import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Dialog } from 'electron';
import { emptyBlock, emptyLine, type Song } from '@worship/core';
import { exportPresentation } from '../src/presentation-export.js';
import { generatedPowerPointName } from '../../server/src/powerpoints.js';
let dir: string, root: string, outside: string;
const song = (): Song =>
  ({
    id: 's',
    title: 'CON',
    blocks: [{ ...emptyBlock('V1', 'Verse'), lines: [emptyLine('Lyrics')], repeat: 3 }],
    arrangement: ['V1', 'V1', 'V1'],
    arrangementSource: 'reviewed',
  }) as Song;
const save = vi.fn(),
  message = vi.fn();
const dialog = { showSaveDialog: save, showMessageBox: message } as unknown as Pick<
  Dialog,
  'showSaveDialog' | 'showMessageBox'
>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'native-export-'));
  root = join(dir, 'presentations');
  outside = join(dir, 'outside');
  await mkdir(root);
  await mkdir(outside);
  save.mockReset();
  message.mockReset();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const run = (
  action: 'saveAs' | 'regenerate' = 'saveAs',
  candidate?: string,
  selected = song(),
) =>
  exportPresentation(
    dialog,
    root,
    selected,
    { repeatMode: 'compact' },
    action,
    candidate,
    join(dir, 'memory'),
  );

it('cancels without generating or writing and suggests safe PPTX names', async () => {
  save.mockResolvedValue({ canceled: true });
  expect(await run()).toEqual({ status: 'cancelled' });
  expect(save.mock.calls[0]![0].defaultPath).toBe(join(root, generatedPowerPointName(song())));
  expect(await readdir(root)).toEqual([]);
  const reserved = song();
  reserved.blocks[0]!.lines = [emptyLine('CON')];
  expect(generatedPowerPointName(reserved)).toBe('_CON.pptx');
});

it('saves a complete shared-generator package inside the folder', async () => {
  save.mockResolvedValue({ canceled: false, filePath: join(root, 'song.pptx') });
  expect(await run()).toEqual({
    status: 'saved',
    name: 'song.pptx',
    relativePath: 'song.pptx',
  });
  // Both Leader and Band invoke this shared function with the same reviewed Song.
  const actual = await readFile(join(root, 'song.pptx'));
  expect(actual.subarray(0, 2).toString()).toBe('PK');
  expect(actual.byteLength).toBeGreaterThan(10000);
});

it.each([0, 1, 2])(
  'handles outside-folder choice %i and never returns an HTTP relative path',
  async (choice) => {
    const target = join(outside, 'song');
    save
      .mockResolvedValueOnce({ canceled: false, filePath: target })
      .mockResolvedValueOnce({ canceled: true });
    message.mockResolvedValue({ response: choice });
    const result = await run();
    expect(message.mock.calls[0]![0].buttons).toEqual([
      'Continue',
      'Choose another location',
      'Cancel',
    ]);
    expect(result).toEqual(
      choice === 0
        ? { status: 'external', name: 'song.pptx', path: target + '.pptx' }
        : { status: 'cancelled' },
    );
    expect(await readdir(outside)).toEqual(choice === 0 ? ['song.pptx'] : []);
    if (choice === 0) {
      save.mockResolvedValue({ canceled: true });
      await run();
      expect(save.mock.lastCall![0].defaultPath).toBe(
        join(outside, generatedPowerPointName(song())),
      );
    }
  },
);

it('recognizes symlinked external destinations', async () => {
  await symlink(
    outside,
    join(root, 'alias'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  save.mockResolvedValue({ canceled: false, filePath: join(root, 'alias', 'song.pptx') });
  message.mockResolvedValue({ response: 2 });
  expect(await run()).toEqual({ status: 'cancelled' });
  expect(message).toHaveBeenCalledOnce();
});

it('confirms replacement and leaves manual edits untouched on cancellation or invalid generation', async () => {
  const target = join(root, 'existing.pptx');
  await writeFile(target, 'manual edits');
  message.mockResolvedValueOnce({ response: 0 });
  expect(await run('regenerate', 'existing.pptx')).toEqual({ status: 'cancelled' });
  expect(await readFile(target, 'utf8')).toBe('manual edits');
  message.mockResolvedValue({ response: 1 });
  const invalid = song();
  invalid.blocks = [];
  await expect(run('regenerate', 'existing.pptx', invalid)).rejects.toThrow();
  expect(await readFile(target, 'utf8')).toBe('manual edits');
  expect(await run('regenerate', 'existing.pptx')).toEqual({
    status: 'saved',
    name: 'existing.pptx',
    relativePath: 'existing.pptx',
  });
  expect(message.mock.calls[0]![0].message).toContain('Manual edits');
});

it.each(['ppt', 'odp', 'key', 'potx'])(
  'preserves existing .%s and offers Save As',
  async (extension) => {
    const name = 'original.' + extension;
    await writeFile(join(root, name), 'original');
    message.mockResolvedValue({ response: 1 });
    save.mockResolvedValue({ canceled: false, filePath: join(root, 'new.pptx') });
    await run('regenerate', name);
    expect(await readFile(join(root, name), 'utf8')).toBe('original');
    expect(save).toHaveBeenCalledOnce();
  },
);

it('confirms the actual filename if adding the PPTX extension finds an existing file', async () => {
  await writeFile(join(root, 'existing.pptx'), 'original');
  save.mockResolvedValue({ canceled: false, filePath: join(root, 'existing') });
  message.mockResolvedValue({ response: 0 });
  expect(await run()).toEqual({ status: 'cancelled' });
  expect(await readFile(join(root, 'existing.pptx'), 'utf8')).toBe('original');
});

it.each(['CON.txt', 'LPT1.test', 'COM¹.txt'])(
  'sanitizes Windows reserved first lyrics: %s',
  (lyric) => {
    const selected = song();
    selected.title = 'Safe title';
    selected.blocks[0]!.lines = [emptyLine(lyric)];
    expect(generatedPowerPointName(selected)).toBe('_' + lyric + ' — Safe title.pptx');
  },
);
