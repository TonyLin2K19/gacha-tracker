import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { ensureUniqueTracks } from '../shared/import.js';
import { createStore } from './db.js';
import {
  trackSchema,
  recordSchema,
  snapshotSchema,
  validateSnapshot,
  validateRecord,
  validateTrack,
  validateGroups,
  type Track,
} from '../shared/model.js';
const dataDir = resolve(process.env.DATA_DIR || 'data');
const iconDir = resolve(dataDir, 'game-icons');
mkdirSync(iconDir, { recursive: true });
const store = createStore(resolve(dataDir, 'gacha.db'));
const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers['x-gacha-request'] !== '1') {
      res.status(403).json({ error: '請從星願旅記介面送出操作' });
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          res.status(403).json({ error: '來源不符' });
          return;
        }
      } catch {
        res.status(403).json({ error: '來源不符' });
        return;
      }
    }
  }
  next();
});
app.use(express.json({ limit: '30mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/state', (_req, res) => res.json(store.snapshot()));
app.post('/api/games', (req, res) => {
  const name = z.string().trim().min(1).max(80).parse(req.body.name);
  const id = randomUUID();
  const nextOrder = Number(
    store.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM games').get()?.value || 1,
  );
  store.db
    .prepare('INSERT INTO games(id,name,icon,sort_order) VALUES(?,?,?,?)')
    .run(id, name, '', nextOrder);
  res.json({ id });
});
app.put('/api/games/:id', (req, res) => {
  const name = z.string().trim().min(1).max(80).parse(req.body.name);
  const games = store.snapshot().games;
  const current = games.findIndex((game) => game.id === req.params.id);
  if (current < 0) throw new Error('遊戲不存在');
  const position = z.number().int().min(1).max(games.length).parse(req.body.position);
  const reordered = [...games];
  const [moved] = reordered.splice(current, 1);
  reordered.splice(position - 1, 0, moved);
  store.transaction(() => {
    store.db.prepare('UPDATE games SET name=? WHERE id=?').run(name, req.params.id);
    const updateOrder = store.db.prepare('UPDATE games SET sort_order=? WHERE id=?');
    reordered.forEach((game, index) => updateOrder.run(index + 1, game.id));
  });
  res.json({ ok: true });
});
app.use('/api/game-icons', express.static(iconDir, { index: false, fallthrough: false }));
app.put(
  '/api/games/:id/icon',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }),
  (req, res) => {
    const game = store.snapshot().games.find((item) => item.id === req.params.id);
    if (!game) throw new Error('遊戲不存在');
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      throw new Error('請選擇 PNG、JPG 或 WebP 圖片');
    const type = String(req.headers['content-type'] || '').split(';')[0];
    const extension = type === 'image/png' ? '.png' : type === 'image/jpeg' ? '.jpg' : '.webp';
    const filename = `${req.params.id}-${randomUUID()}${extension}`;
    writeFileSync(resolve(iconDir, filename), req.body);
    store.db.prepare('UPDATE games SET icon=? WHERE id=?').run(filename, req.params.id);
    if (game.icon && basename(game.icon) === game.icon) {
      const oldPath = resolve(iconDir, game.icon);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }
    res.json({ icon: filename });
  },
);
app.delete('/api/games/:id', (req, res) => {
  z.literal('DELETE').parse(req.body.confirmation);
  const snapshot = store.snapshot();
  const game = snapshot.games.find((item) => item.id === req.params.id);
  if (!game) throw new Error('遊戲不存在');
  store.backupDatabase('before-delete-game');
  store.backup('before-delete-game');
  store.transaction(() => {
    store.db
      .prepare('DELETE FROM records WHERE track_id IN (SELECT id FROM tracks WHERE game_id=?)')
      .run(req.params.id);
    store.db.prepare('DELETE FROM tracks WHERE game_id=?').run(req.params.id);
    store.db.prepare('DELETE FROM games WHERE id=?').run(req.params.id);
  });
  // Keep the icon file so restoring a pre-deletion backup also restores its reference.
  res.json({ ok: true });
});
app.post('/api/tracks/import', (req, res) => {
  const rows = z
    .array(trackSchema)
    .min(1)
    .max(1000)
    .parse(req.body.tracks)
    .map((t) => ({ ...t, id: randomUUID() }));
  const snap = store.snapshot();
  const merged = { ...snap, tracks: [...snap.tracks, ...rows] };
  validateSnapshot(merged);
  ensureUniqueTracks(merged.tracks);
  store.transaction(() => {
    for (const t of rows)
      store.db.prepare('INSERT INTO tracks VALUES(?,?,?)').run(t.id, t.gameId, JSON.stringify(t));
  });
  res.json({ count: rows.length });
});
function saveTrack(req: express.Request, res: express.Response) {
  const input = trackSchema.parse(req.body);
  const id = String(req.params.id || randomUUID());
  const snap = store.snapshot();
  if (!snap.games.some((g) => g.id === input.gameId)) throw new Error('遊戲不存在');
  const old = snap.tracks.find((t) => t.id === id);
  if (req.method === 'PUT' && !old) throw new Error('卡池不存在');
  const track: Track = { ...input, id };
  validateTrack(track);
  if (
    old &&
    snap.records.some((r) => r.trackId === id) &&
    JSON.stringify(old.rules.rarities.map((x) => x.name)) !==
      JSON.stringify(track.rules.rarities.map((x) => x.name))
  )
    throw new Error('已有紀錄後不能更改稀有度名稱或順序；請建立新卡池');
  validateGroups([...snap.tracks.filter((t) => t.id !== id), track]);
  ensureUniqueTracks([...snap.tracks.filter((t) => t.id !== id), track]);
  store.db
    .prepare(
      'INSERT INTO tracks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET game_id=excluded.game_id,body=excluded.body',
    )
    .run(id, input.gameId, JSON.stringify(track));
  res.json({ id });
}
app.post('/api/tracks', saveTrack);
app.put('/api/tracks/:id', saveTrack);
app.delete('/api/tracks/:id', (req, res) => {
  z.literal('DELETE').parse(req.body.confirmation);
  if (!store.snapshot().tracks.some((t) => t.id === req.params.id)) throw new Error('卡池不存在');
  store.backupDatabase('before-delete-track');
  store.backup('before-delete-track');
  store.transaction(() => {
    store.db.prepare('DELETE FROM records WHERE track_id=?').run(req.params.id);
    store.db.prepare('DELETE FROM tracks WHERE id=?').run(req.params.id);
  });
  res.json({ ok: true });
});
app.put('/api/tracks/:id/pools/:poolId', (req, res) => {
  const name = z.string().trim().min(1).max(80).parse(req.body.name);
  const snap = store.snapshot();
  const track = snap.tracks.find((t) => t.id === req.params.id);
  if (!track) throw new Error('卡池不存在');
  const id = String(req.params.poolId);
  if (
    id !== 'initial' &&
    !snap.records.some(
      (r) => r.trackId === track.id && r.kind === 'cycle_reset' && (r.setPool?.id ?? r.id) === id,
    )
  )
    throw new Error('池期不存在');
  track.poolNames = { ...track.poolNames, [id]: name };
  store.db.prepare('UPDATE tracks SET body=? WHERE id=?').run(JSON.stringify(track), track.id);
  res.json({ ok: true });
});
function saveRecord(req: express.Request, res: express.Response) {
  const input = recordSchema.parse(req.body);
  input.at = new Date(input.at).toISOString();
  const track = store.snapshot().tracks.find((t) => t.id === input.trackId);
  if (!track) throw new Error('卡池不存在');
  validateRecord(input, track);
  const id = String(req.params.id || randomUUID());
  if (req.method === 'PUT') {
    if (
      !store.db
        .prepare('UPDATE records SET track_id=?,body=? WHERE id=?')
        .run(input.trackId, JSON.stringify(input), id).changes
    )
      throw new Error('紀錄不存在');
  } else
    store.db
      .prepare('INSERT INTO records(id,track_id,body) VALUES(?,?,?)')
      .run(id, input.trackId, JSON.stringify(input));
  res.json({ id });
}
app.post('/api/records', saveRecord);
app.put('/api/records/:id', saveRecord);
app.delete('/api/records/:id', (req, res) => {
  store.db.prepare('DELETE FROM records WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.put('/api/settings/:key', (req, res) => {
  const key = z.string().max(100).parse(req.params.key);
  store.db
    .prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(req.body.value));
  res.json({ ok: true });
});
app.get('/api/backup', (_req, res) => {
  res
    .attachment(`gacha-backup-${new Date().toISOString().slice(0, 10)}.json`)
    .json(store.snapshot());
});
app.post('/api/backup', (_req, res) => {
  store.backup();
  res.json({ ok: true });
});
app.post('/api/restore', (req, res) => {
  const s = snapshotSchema.parse(req.body);
  for (const r of s.records) r.at = new Date(r.at).toISOString();
  validateSnapshot(s);
  store.backup('before-restore');
  store.replace(s);
  res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: '找不到此 API' }));
app.use(express.static(resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((x) => x.message).join('；')
        : err instanceof Error
          ? err.message
          : '操作失敗';
    res.status(400).json({ error: message });
  },
);
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
  console.log('GACHA JOURNEY running on port ' + (process.env.PORT || 3000)),
);
// Application-level snapshots are consistent because requests and this callback are synchronous.
const timer = setInterval(
  () => {
    try {
      store.backup('auto');
    } catch (e) {
      console.error('Backup failed', e);
    }
  },
  24 * 60 * 60 * 1000,
);
timer.unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      store.db.close();
      process.exit(0);
    });
  });
