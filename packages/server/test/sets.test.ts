import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServiceSet } from '@worship/core';
import { Library } from '../src/library.js';
import { SetStore } from '../src/sets.js';

let dir: string;
let library: Library;
let sets: SetStore;

function newSet(overrides: Partial<ServiceSet> = {}): ServiceSet {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: crypto.randomUUID(),
    title: 'Duminică',
    date: '2026-09-20',
    items: [],
    createdAt: now,
    updatedAt: now,
    rev: 0,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worship-sets-'));
  library = new Library(dir);
  sets = new SetStore(dir, library.db);
});

afterEach(() => {
  library.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('storing sets', () => {
  it('writes a file and indexes it', () => {
    const stored = sets.save(newSet({ title: 'Prima' }));
    expect(sets.list()).toHaveLength(1);
    expect(sets.get(stored.id)?.title).toBe('Prima');
  });

  it('names the file after the service date, so the folder reads as a calendar', () => {
    sets.save(newSet({ date: '2026-09-20' }));
    expect(readdirSync(join(dir, 'sets'))[0]).toMatch(/^2026-09-20-/);
  });

  it('falls back to the title when a set has no date', () => {
    sets.save(newSet({ date: null, title: 'Șablon repetiție' }));
    expect(readdirSync(join(dir, 'sets'))[0]).toMatch(/^sablon-repetitie-/);
  });

  it('bumps the revision on every save, and owns the timestamps', () => {
    const first = sets.save(newSet({ updatedAt: '2001-01-01T00:00:00.000Z' }));
    expect(first.rev).toBe(1);
    // updatedAt is set by the store, not carried over from what the client sent.
    expect(first.updatedAt).not.toBe('2001-01-01T00:00:00.000Z');

    const second = sets.save({ ...first, title: 'Schimbat' });
    expect(second.rev).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);
    // Not strict inequality: two saves can land in the same millisecond, and `rev` is
    // the ordering key. Asserting on a millisecond clock would be flaky by design.
    expect(second.updatedAt >= first.updatedAt).toBe(true);
  });

  it('keeps a set in its existing file rather than creating a second one', () => {
    const first = sets.save(newSet());
    sets.save({ ...first, date: '2026-12-25' });
    expect(readdirSync(join(dir, 'sets'))).toHaveLength(1);
  });

  it('rebuilds the index from the files alone', () => {
    sets.save(newSet({ title: 'A' }));
    sets.save(newSet({ title: 'B' }));
    library.db.exec('DELETE FROM sets');
    expect(sets.list()).toHaveLength(0);
    expect(sets.reindex().added).toBe(2);
    expect(sets.list()).toHaveLength(2);
  });

  it('lists the newest service first', () => {
    sets.save(newSet({ title: 'Veche', date: '2026-01-04' }));
    sets.save(newSet({ title: 'Nouă', date: '2026-12-20' }));
    expect(sets.list().map((s) => s.title)).toEqual(['Nouă', 'Veche']);
  });

  it('counts songs separately from other items', () => {
    sets.save(
      newSet({
        items: [
          {
            kind: 'song',
            songId: 'a',
            keyOverride: null,
            capoOverride: null,
            arrangementOverride: null,
          },
          { kind: 'note', text: 'rugăciune' },
          { kind: 'gap', label: 'predică', minutes: 35 },
          {
            kind: 'song',
            songId: 'b',
            keyOverride: null,
            capoOverride: null,
            arrangementOverride: null,
          },
        ],
      }),
    );
    expect(sets.list()[0]).toMatchObject({ itemCount: 4, songCount: 2 });
  });

  it('deletes a set and its file', () => {
    const stored = sets.save(newSet());
    expect(sets.delete(stored.id)).toBe(true);
    expect(sets.list()).toHaveLength(0);
    expect(readdirSync(join(dir, 'sets'))).toHaveLength(0);
  });

  it('reports deleting a set that was never there', () => {
    expect(sets.delete('nope')).toBe(false);
  });
});

describe('duplicating a set', () => {
  it('carries the items and their overrides across', () => {
    const original = sets.save(
      newSet({
        title: 'Duminica trecută',
        items: [
          {
            kind: 'song',
            songId: 'a',
            keyOverride: 'E',
            capoOverride: 2,
            arrangementOverride: null,
          },
          { kind: 'gap', label: 'predică', minutes: 35 },
        ],
      }),
    );
    const copy = sets.duplicate(original.id, {
      title: 'Duminica viitoare',
      date: '2026-09-27',
    })!;

    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe('Duminica viitoare');
    expect(copy.date).toBe('2026-09-27');
    // A song dropped a tone last week is still dropped a tone this week.
    expect(copy.items[0]).toMatchObject({ keyOverride: 'E', capoOverride: 2 });
    expect(copy.items).toHaveLength(2);
  });

  it('leaves the original untouched', () => {
    const original = sets.save(newSet({ title: 'Original' }));
    sets.duplicate(original.id);
    expect(sets.get(original.id)?.title).toBe('Original');
    expect(sets.list()).toHaveLength(2);
  });

  it('defaults to an undated copy, so it cannot be mistaken for the original service', () => {
    const original = sets.save(newSet({ date: '2026-09-20' }));
    expect(sets.duplicate(original.id)?.date).toBeNull();
  });

  it('returns null for a set that does not exist', () => {
    expect(sets.duplicate('nope')).toBeNull();
  });
});
