/**
 * The library.
 *
 * **The `.chopro` files are the database.** SQLite is an index and nothing more: it
 * holds no fact that cannot be rebuilt by re-reading the folder. Delete `index.db` and
 * the next start reconstructs it. That constraint is what keeps the format promise
 * honest — the files stay editable by hand, by git, and by any other ChordPro tool.
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { parseChordPro, serialiseChordPro, type Song } from '@worship/core';

export const ROOT_COLLECTION = 'Main';

export interface SongSummary {
  id: string;
  title: string;
  writtenKey: string | null;
  performanceKey: string | null;
  tempo: number | null;
  timeSignature: string | null;
  authors: string[];
  tags: string[];
  collection: string;
  updatedAt: string;
  blockCount: number;
}

export interface SearchHit extends SongSummary {
  /** FTS5 snippet with the match wrapped in «». */
  snippet: string;
  rank: number;
}

export interface ListOptions {
  collection?: string | undefined;
  tag?: string | undefined;
  key?: string | undefined;
  sort?: 'title' | 'updated' | undefined;
}

export interface ReindexResult {
  added: number;
  updated: number;
  removed: number;
  failed: { path: string; error: string }[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id              TEXT PRIMARY KEY,
  path            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  written_key     TEXT,
  performance_key TEXT,
  tempo           INTEGER,
  time_signature  TEXT,
  authors         TEXT NOT NULL DEFAULT '[]',
  tags            TEXT NOT NULL DEFAULT '[]',
  collection      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  block_count     INTEGER NOT NULL DEFAULT 0,
  doc             TEXT NOT NULL,
  content_hash    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS songs_title      ON songs(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS songs_collection ON songs(collection);
CREATE INDEX IF NOT EXISTS songs_updated    ON songs(updated_at DESC);

-- remove_diacritics 2 is not optional here: the library is Romanian and nobody types
-- "bunătatea" into a search box. Without it, searching "bunatatea" finds nothing.
CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
  id UNINDEXED,
  title,
  lyrics,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

/** Flatten a song's lyrics for the search index. */
function lyricsOf(song: Song): string {
  const parts: string[] = [];
  for (const block of song.blocks) {
    for (const line of block.lines) if (line.text) parts.push(line.text);
  }
  return parts.join('\n');
}

/**
 * The collection a file belongs to, taken from its folder.
 *
 * `songs/foo.chopro` → "Main"; `songs/L&I/foo.chopro` → "L&I". Folders carry meaning
 * here: `Song files L&I` is a different band's songs that the main group also uses.
 */
function collectionOf(relPath: string): string {
  const dir = dirname(relPath);
  if (dir === '.' || dir === '') return ROOT_COLLECTION;
  return dir.split(sep)[0] ?? ROOT_COLLECTION;
}

/** Escape a user query for FTS5, so punctuation cannot become syntax. */
export function toFtsQuery(raw: string): string | null {
  const terms = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  // Quote every term, and prefix-match the last one so search feels live as you type.
  return terms.map((t, i) => (i === terms.length - 1 ? `"${t}"*` : `"${t}"`)).join(' AND ');
}

export class Library {
  readonly songsDir: string;
  private readonly db: Database.Database;

  constructor(readonly dataDir: string) {
    this.songsDir = join(dataDir, 'songs');
    mkdirSync(this.songsDir, { recursive: true });
    this.db = new Database(join(dataDir, 'index.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Every `.chopro` file under `songs/`, as paths relative to it. */
  private files(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (extname(entry).toLowerCase() === '.chopro') out.push(relative(this.songsDir, full));
      }
    };
    if (existsSync(this.songsDir)) walk(this.songsDir);
    return out.sort();
  }

  /**
   * Bring the index in line with the folder.
   *
   * Change is detected by hashing file contents, not by mtime. mtime granularity is a
   * whole second on some filesystems, so two edits inside the same tick — or a checkout
   * that rewrites a file with a preserved timestamp — would be silently missed, and the
   * app would keep serving a song that no longer matches what is on disk.
   *
   * Reading and hashing the whole library is a few milliseconds at this size. Parsing
   * is the expensive part, and that is still skipped for unchanged files.
   */
  reindex(): ReindexResult {
    const result: ReindexResult = { added: 0, updated: 0, removed: 0, failed: [] };
    const onDisk = this.files();
    const known = new Map<string, string>(
      this.db
        .prepare('SELECT path, content_hash FROM songs')
        .all()
        .map((r) => [(r as { path: string }).path, (r as { content_hash: string }).content_hash]),
    );

    const upsert = this.db.prepare(`
      INSERT INTO songs (id, path, title, written_key, performance_key, tempo, time_signature,
                         authors, tags, collection, updated_at, block_count, doc, content_hash)
      VALUES (@id, @path, @title, @writtenKey, @performanceKey, @tempo, @timeSignature,
              @authors, @tags, @collection, @updatedAt, @blockCount, @doc, @contentHash)
      ON CONFLICT(id) DO UPDATE SET
        path=excluded.path, title=excluded.title, written_key=excluded.written_key,
        performance_key=excluded.performance_key, tempo=excluded.tempo,
        time_signature=excluded.time_signature, authors=excluded.authors, tags=excluded.tags,
        collection=excluded.collection, updated_at=excluded.updated_at,
        block_count=excluded.block_count, doc=excluded.doc, content_hash=excluded.content_hash
    `);
    const dropFts = this.db.prepare('DELETE FROM songs_fts WHERE id = ?');
    const addFts = this.db.prepare('INSERT INTO songs_fts (id, title, lyrics) VALUES (?, ?, ?)');

    const run = this.db.transaction(() => {
      for (const rel of onDisk) {
        const full = join(this.songsDir, rel);
        const previous = known.get(rel);
        known.delete(rel);

        let source: string;
        let contentHash: string;
        try {
          source = readFileSync(full, 'utf8');
          contentHash = createHash('sha256').update(source).digest('hex');
        } catch (error) {
          result.failed.push({ path: rel, error: String(error) });
          continue;
        }
        if (previous === contentHash) continue;

        try {
          const song = parseChordPro(source);
          upsert.run({
            id: song.id,
            path: rel,
            title: song.title,
            writtenKey: song.writtenKey,
            performanceKey: song.performanceKey,
            tempo: song.tempo,
            timeSignature: song.timeSignature,
            authors: JSON.stringify(song.authors),
            tags: JSON.stringify(song.tags),
            collection: collectionOf(rel),
            updatedAt: song.updatedAt,
            blockCount: song.blocks.length,
            doc: JSON.stringify(song),
            contentHash,
          });
          dropFts.run(song.id);
          addFts.run(song.id, song.title, lyricsOf(song));
          if (previous === undefined) result.added++;
          else result.updated++;
        } catch (error) {
          result.failed.push({ path: rel, error: String(error) });
        }
      }

      // Whatever is still in `known` no longer exists on disk.
      const dropSong = this.db.prepare('DELETE FROM songs WHERE path = ?');
      const idOf = this.db.prepare('SELECT id FROM songs WHERE path = ?');
      for (const stalePath of known.keys()) {
        const row = idOf.get(stalePath) as { id: string } | undefined;
        if (row) dropFts.run(row.id);
        dropSong.run(stalePath);
        result.removed++;
      }
    });
    run();
    return result;
  }

  private toSummary(row: Record<string, unknown>): SongSummary {
    return {
      id: row['id'] as string,
      title: row['title'] as string,
      writtenKey: (row['written_key'] as string | null) ?? null,
      performanceKey: (row['performance_key'] as string | null) ?? null,
      tempo: (row['tempo'] as number | null) ?? null,
      timeSignature: (row['time_signature'] as string | null) ?? null,
      authors: JSON.parse((row['authors'] as string) || '[]') as string[],
      tags: JSON.parse((row['tags'] as string) || '[]') as string[],
      collection: row['collection'] as string,
      updatedAt: row['updated_at'] as string,
      blockCount: (row['block_count'] as number | null) ?? 0,
    };
  }

  list(options: ListOptions = {}): SongSummary[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (options.collection) {
      where.push('collection = @collection');
      params['collection'] = options.collection;
    }
    if (options.key) {
      where.push('(performance_key = @key OR (performance_key IS NULL AND written_key = @key))');
      params['key'] = options.key;
    }
    if (options.tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(songs.tags) WHERE json_each.value = @tag)");
      params['tag'] = options.tag;
    }
    const order =
      options.sort === 'updated' ? 'updated_at DESC' : 'title COLLATE NOCASE ASC';
    const sql = `SELECT * FROM songs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}`;
    return (this.db.prepare(sql).all(params) as Record<string, unknown>[]).map((r) =>
      this.toSummary(r),
    );
  }

  get(id: string): Song | null {
    const row = this.db.prepare('SELECT doc FROM songs WHERE id = ?').get(id) as
      | { doc: string }
      | undefined;
    return row ? (JSON.parse(row.doc) as Song) : null;
  }

  /** Full-text search over titles and lyrics, diacritic-insensitive. */
  search(query: string, limit = 50): SearchHit[] {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const rows = this.db
      .prepare(
        `SELECT s.*, snippet(songs_fts, 2, '«', '»', '…', 12) AS snip, bm25(songs_fts, 10.0, 1.0) AS rank
         FROM songs_fts
         JOIN songs s ON s.id = songs_fts.id
         WHERE songs_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(fts, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      ...this.toSummary(r),
      snippet: (r['snip'] as string) ?? '',
      rank: (r['rank'] as number) ?? 0,
    }));
  }

  collections(): { name: string; count: number }[] {
    return this.db
      .prepare('SELECT collection AS name, COUNT(*) AS count FROM songs GROUP BY collection ORDER BY name')
      .all() as { name: string; count: number }[];
  }

  tags(): { name: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT json_each.value AS name, COUNT(*) AS count
         FROM songs, json_each(songs.tags)
         GROUP BY name ORDER BY count DESC, name`,
      )
      .all() as { name: string; count: number }[];
  }

  keys(): { name: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT COALESCE(performance_key, written_key) AS name, COUNT(*) AS count
         FROM songs WHERE name IS NOT NULL GROUP BY name ORDER BY count DESC, name`,
      )
      .all() as { name: string; count: number }[];
  }

  stats(): { songs: number; collections: number } {
    const songs = (this.db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n;
    return { songs, collections: this.collections().length };
  }

  /** Path on disk for a song, or null if it is not indexed. */
  pathOf(id: string): string | null {
    const row = this.db.prepare('SELECT path FROM songs WHERE id = ?').get(id) as
      | { path: string }
      | undefined;
    return row ? join(this.songsDir, row.path) : null;
  }

  /**
   * Write a song to disk and reindex it.
   *
   * The file is written first and the index updated from what landed there, so the
   * index can never claim something the file does not say.
   */
  save(song: Song, relPath?: string): void {
    const existing = this.db.prepare('SELECT path FROM songs WHERE id = ?').get(song.id) as
      | { path: string }
      | undefined;
    const target = relPath ?? existing?.path ?? `${slug(song.title, song.id)}.chopro`;
    const full = join(this.songsDir, target);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, serialiseChordPro(song), 'utf8');
    this.reindex();
  }
}

/** Filesystem-safe, readable, stable file name. */
export function slug(title: string, fallback: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback.slice(0, 8);
}
