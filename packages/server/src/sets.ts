/**
 * Service sets.
 *
 * Same principle as the song library: the files on disk are the truth and SQLite is a
 * rebuildable index. Sets are JSON rather than ChordPro because no interchange format
 * exists for a running order — inventing `x_` directives for something no other tool
 * reads would buy nothing.
 */

import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { ServiceSet, SetItem } from '@worship/core';
import { slug } from './library.js';

export const SETS_SCHEMA = `
CREATE TABLE IF NOT EXISTS sets (
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  date         TEXT,
  item_count   INTEGER NOT NULL DEFAULT 0,
  song_count   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  doc          TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sets_date ON sets(date DESC);
`;

export interface SetSummary {
  id: string;
  title: string;
  date: string | null;
  itemCount: number;
  songCount: number;
  updatedAt: string;
}

export interface SetsReindexResult {
  added: number;
  updated: number;
  removed: number;
  failed: { path: string; error: string }[];
}

function countSongs(items: SetItem[]): number {
  return items.filter((i) => i.kind === 'song').length;
}

export class SetStore {
  readonly setsDir: string;

  constructor(
    dataDir: string,
    private readonly db: Database.Database,
  ) {
    this.setsDir = join(dataDir, 'sets');
    mkdirSync(this.setsDir, { recursive: true });
    this.db.exec(SETS_SCHEMA);
  }

  private files(): string[] {
    if (!existsSync(this.setsDir)) return [];
    return readdirSync(this.setsDir)
      .filter((f) => !f.startsWith('.') && extname(f).toLowerCase() === '.json')
      .sort();
  }

  reindex(): SetsReindexResult {
    const result: SetsReindexResult = { added: 0, updated: 0, removed: 0, failed: [] };
    const known = new Map<string, string>(
      this.db
        .prepare('SELECT path, content_hash FROM sets')
        .all()
        .map((r) => [(r as { path: string }).path, (r as { content_hash: string }).content_hash]),
    );

    const upsert = this.db.prepare(`
      INSERT INTO sets (id, path, title, date, item_count, song_count, updated_at, doc, content_hash)
      VALUES (@id, @path, @title, @date, @itemCount, @songCount, @updatedAt, @doc, @contentHash)
      ON CONFLICT(id) DO UPDATE SET
        path=excluded.path, title=excluded.title, date=excluded.date,
        item_count=excluded.item_count, song_count=excluded.song_count,
        updated_at=excluded.updated_at, doc=excluded.doc, content_hash=excluded.content_hash
    `);

    const run = this.db.transaction(() => {
      for (const file of this.files()) {
        const previous = known.get(file);
        known.delete(file);

        let source: string;
        let contentHash: string;
        try {
          source = readFileSync(join(this.setsDir, file), 'utf8');
          contentHash = createHash('sha256').update(source).digest('hex');
        } catch (error) {
          result.failed.push({ path: file, error: String(error) });
          continue;
        }
        if (previous === contentHash) continue;

        try {
          const set = JSON.parse(source) as ServiceSet;
          upsert.run({
            id: set.id,
            path: file,
            title: set.title,
            date: set.date,
            itemCount: set.items.length,
            songCount: countSongs(set.items),
            updatedAt: set.updatedAt,
            doc: source,
            contentHash,
          });
          if (previous === undefined) result.added++;
          else result.updated++;
        } catch (error) {
          result.failed.push({ path: file, error: String(error) });
        }
      }

      const drop = this.db.prepare('DELETE FROM sets WHERE path = ?');
      for (const stale of known.keys()) {
        drop.run(stale);
        result.removed++;
      }
    });
    run();
    return result;
  }

  /** Newest service first — the one you are about to lead is the one you want. */
  list(): SetSummary[] {
    return this.db
      .prepare(
        `SELECT id, title, date, item_count AS itemCount, song_count AS songCount,
                updated_at AS updatedAt
         FROM sets
         ORDER BY COALESCE(date, updated_at) DESC`,
      )
      .all() as SetSummary[];
  }

  /** Every set, in full — the other half of an offline mirror. */
  all(): ServiceSet[] {
    return (this.db.prepare('SELECT doc FROM sets').all() as { doc: string }[]).map(
      (r) => JSON.parse(r.doc) as ServiceSet,
    );
  }

  get(id: string): ServiceSet | null {
    const row = this.db.prepare('SELECT doc FROM sets WHERE id = ?').get(id) as
      | { doc: string }
      | undefined;
    return row ? (JSON.parse(row.doc) as ServiceSet) : null;
  }

  save(set: ServiceSet): ServiceSet {
    const existing = this.db.prepare('SELECT path FROM sets WHERE id = ?').get(set.id) as
      | { path: string }
      | undefined;
    const previous = this.get(set.id);

    const stored: ServiceSet = {
      ...set,
      rev: (previous?.rev ?? 0) + 1,
      createdAt: previous?.createdAt ?? set.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Name the file after the service date when there is one, so the folder reads as a
    // calendar. Falls back to the title for sets that are templates rather than events.
    const base = stored.date ?? slug(stored.title, stored.id);
    const file = existing?.path ?? `${base}-${stored.id.slice(0, 8)}.json`;
    writeFileSync(join(this.setsDir, file), JSON.stringify(stored, null, 2), 'utf8');
    this.reindex();
    return stored;
  }

  delete(id: string): boolean {
    const row = this.db.prepare('SELECT path FROM sets WHERE id = ?').get(id) as
      | { path: string }
      | undefined;
    if (!row) return false;
    rmSync(join(this.setsDir, row.path), { force: true });
    this.reindex();
    return true;
  }

  /**
   * Copy a set, so last Sunday can become the starting point for next Sunday.
   *
   * Overrides come along: if a song was dropped a tone last time, it still is.
   */
  duplicate(id: string, options: { title?: string; date?: string | null } = {}): ServiceSet | null {
    const source = this.get(id);
    if (!source) return null;
    const now = new Date().toISOString();
    return this.save({
      ...source,
      id: crypto.randomUUID(),
      title: options.title ?? `${source.title} (copie)`,
      date: options.date ?? null,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });
  }
}
