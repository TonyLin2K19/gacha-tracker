import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Snapshot, Game, Track, DrawRecord } from '../shared/model.js';
export function createStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,name TEXT NOT NULL,icon TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id),body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS records(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,track_id TEXT NOT NULL REFERENCES tracks(id),body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS records_track ON records(track_id);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 PRAGMA user_version=1;`);
  const gameColumns = new Set(
    db
      .prepare('PRAGMA table_info(games)')
      .all()
      .map((column) => String(column.name)),
  );
  if (!gameColumns.has('icon'))
    db.exec("ALTER TABLE games ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  if (!gameColumns.has('sort_order')) {
    db.exec('ALTER TABLE games ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE games SET sort_order=rowid');
  }
  function snapshot(): Snapshot {
    return {
      version: 1,
      games: db
        .prepare('SELECT * FROM games ORDER BY sort_order,rowid')
        .all()
        .map((x) => ({
          id: String(x.id),
          name: String(x.name),
          icon: String(x.icon || ''),
          sortOrder: Number(x.sort_order || 0),
        })) as Game[],
      tracks: db
        .prepare('SELECT body FROM tracks ORDER BY rowid')
        .all()
        .map((x) => JSON.parse(x.body as string) as Track),
      records: db
        .prepare('SELECT seq,id,body FROM records ORDER BY seq')
        .all()
        .map(
          (x) => ({ ...JSON.parse(x.body as string), id: x.id, seq: Number(x.seq) }) as DrawRecord,
        ),
      settings: Object.fromEntries(
        db
          .prepare('SELECT * FROM settings')
          .all()
          .map((x) => [x.key, JSON.parse(x.value as string)]),
      ),
    };
  }
  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  function replace(s: Snapshot) {
    transaction(() => {
      db.exec(
        "DELETE FROM records;DELETE FROM tracks;DELETE FROM games;DELETE FROM settings;DELETE FROM sqlite_sequence WHERE name='records';",
      );
      for (const [index, g] of s.games.entries())
        db.prepare('INSERT INTO games(id,name,icon,sort_order) VALUES(?,?,?,?)').run(
          g.id,
          g.name,
          g.icon || '',
          g.sortOrder || index + 1,
        );
      for (const t of s.tracks)
        db.prepare('INSERT INTO tracks VALUES(?,?,?)').run(t.id, t.gameId, JSON.stringify(t));
      for (const r of s.records)
        db.prepare('INSERT INTO records(seq,id,track_id,body) VALUES(?,?,?,?)').run(
          r.seq,
          r.id,
          r.trackId,
          JSON.stringify(r),
        );
      for (const [k, v] of Object.entries(s.settings))
        db.prepare('INSERT INTO settings VALUES(?,?)').run(k, JSON.stringify(v));
    });
  }
  function backup(prefix = 'manual') {
    const dir = resolve(dirname(path), 'backups');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(snapshot(), null, 2));
    return file;
  }
  return { db, snapshot, transaction, replace, backup };
}
