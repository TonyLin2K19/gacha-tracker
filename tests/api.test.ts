import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRules, emptyBaseline } from '../shared/model.js';

test('HTTP: baseline import, duplicate rejection, record editing, restore and static app', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gacha-api-'));
  const port = String(33000 + Math.floor(Math.random() * 10000));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: port, DATA_DIR: dir },
    stdio: 'pipe',
  });
  let logs = '';
  child.stdout.on('data', (b) => (logs += b));
  child.stderr.on('data', (b) => (logs += b));
  const base = `http://127.0.0.1:${port}`;
  async function request(path: string, method = 'GET', body?: unknown) {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-gacha-request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        ready = (await fetch(base + '/api/health')).ok;
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, logs);
    const g = await request('/games', 'POST', { name: '測試' });
    assert.equal(g.status, 200);
    const g2 = await request('/games', 'POST', { name: '第二個' });
    assert.equal(
      (await request('/games/' + g2.data.id, 'PUT', { name: '第二個', position: 1 })).status,
      200,
    );
    let orderedGames = (await request('/state')).data.games;
    assert.equal(orderedGames[0].id, g2.data.id);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const iconResponse = await fetch(base + '/api/games/' + g.data.id + '/icon', {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-gacha-request': '1' },
      body: png,
    });
    assert.equal(iconResponse.status, 200);
    orderedGames = (await request('/state')).data.games;
    const uploadedIcon = orderedGames.find((game: { id: string }) => game.id === g.data.id).icon;
    assert.match(uploadedIcon, /\.png$/);
    assert.equal((await fetch(base + '/api/game-icons/' + uploadedIcon)).status, 200);
    const payload = {
      gameId: g.data.id,
      server: '台服',
      account: '主帳號',
      pool: '角色池',
      pityGroup: '',
      rules: defaultRules,
      baseline: { ...emptyBaseline, counts: { SSR: 2, SR: 10, R: 88 }, pity: 20 },
    };
    const imported = await request('/tracks/import', 'POST', { tracks: [payload] });
    assert.equal(imported.status, 200);
    assert.equal((await request('/tracks/import', 'POST', { tracks: [payload] })).status, 400);
    let state = (await request('/state')).data;
    assert.equal(state.tracks.length, 1);
    const trackId = state.tracks[0].id;
    const rec = {
      trackId,
      at: '2026-09-13T08:00:00+08:00',
      kind: 'draw',
      ordered: true,
      results: [{ rarity: 'R', count: 10, outcome: 'unknown' }],
      note: '測試',
    };
    const r = await request('/records', 'POST', rec);
    assert.equal(r.status, 200);
    assert.equal(
      (
        await request('/records/' + r.data.id, 'PUT', {
          ...rec,
          results: [{ rarity: 'SSR', count: 1, outcome: 'up' }],
        })
      ).status,
      200,
    );
    state = (await request('/state')).data;
    assert.equal(state.records[0].at, '2026-09-13T00:00:00.000Z');
    assert.equal(state.records[0].results[0].rarity, 'SSR');
    assert.equal(
      (await request('/records', 'POST', { ...rec, results: [{ rarity: 'R', count: -1 }] })).status,
      400,
    );
    const backup = (await request('/backup')).data;
    assert.equal((await request('/restore', 'POST', { ...backup, tracks: [] })).status, 400);
    assert.equal((await request('/state')).data.records.length, 1);
    await request('/records/' + r.data.id, 'DELETE');
    assert.equal((await request('/state')).data.records.length, 0);
    assert.equal((await request('/restore', 'POST', backup)).status, 200);
    assert.equal((await request('/state')).data.records.length, 1);
    const mech = await request('/tracks', 'POST', {
      gameId: g.data.id,
      server: '台服',
      account: '主帳號',
      pool: '機甲',
      rules: { ...defaultRules, linkLastFour: true, setPitySteps: [9, 12, 15] },
      baseline: emptyBaseline,
    });
    assert.equal(mech.status, 200);
    const poolSwitch = {
      trackId: mech.data.id,
      at: '2026-10-08T00:00:00.000Z',
      kind: 'cycle_reset',
      ordered: true,
      results: [],
      note: '莫比烏斯X',
      setPool: { id: 'initial', marks: 6, stage: 2, guaranteed: null },
    };
    const switched = await request('/records', 'POST', poolSwitch);
    assert.equal(switched.status, 200);
    const updatedBackup = (await request('/backup')).data;
    assert.deepEqual(
      updatedBackup.records.find((item: { id: string }) => item.id === switched.data.id).setPool,
      poolSwitch.setPool,
    );
    assert.equal((await request('/restore', 'POST', updatedBackup)).status, 200);
    assert.deepEqual(
      (await request('/state')).data.records.find(
        (item: { id: string }) => item.id === switched.data.id,
      ).setPool,
      poolSwitch.setPool,
    );
    assert.equal(
      (
        await fetch(base + '/api/games', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'blocked' }),
        })
      ).status,
      403,
    );
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /星願旅記/);
    assert.equal(
      (await request(`/tracks/${trackId}/pools/initial`, 'PUT', { name: '初始 UP 池' })).status,
      200,
    );
    assert.equal(
      (await request('/state')).data.tracks.find((t: { id: string }) => t.id === trackId).poolNames
        .initial,
      '初始 UP 池',
    );
    const genericSwitch = await request('/records', 'POST', {
      ...poolSwitch,
      trackId,
      setPool: { id: 'limited', inherit: false },
      note: '限定角色',
    });
    assert.equal(genericSwitch.status, 200);
    assert.equal(
      (await request(`/tracks/${trackId}/pools/limited`, 'PUT', { name: '限定修正名' })).status,
      200,
    );
    const beforeDelete = (await request('/state')).data;
    const filesBefore = readdirSync(join(dir, 'backups'));
    assert.equal(
      (await request('/tracks/' + trackId, 'DELETE', { confirmation: 'delete' })).status,
      400,
    );
    assert.equal(
      (await request('/games/' + g.data.id, 'DELETE', { confirmation: '' })).status,
      400,
    );
    assert.deepEqual((await request('/state')).data, beforeDelete);
    assert.deepEqual(readdirSync(join(dir, 'backups')), filesBefore);
    assert.equal(
      (await request('/tracks/' + trackId, 'DELETE', { confirmation: 'DELETE' })).status,
      200,
    );
    const trackBackup = readdirSync(join(dir, 'backups')).find(
      (f) => f.startsWith('before-delete-track') && f.endsWith('.db'),
    )!;
    const restoredDb = new DatabaseSync(join(dir, 'backups', trackBackup), { readOnly: true });
    assert.ok(restoredDb.prepare('SELECT id FROM tracks WHERE id=?').get(trackId));
    assert.ok(restoredDb.prepare('SELECT id FROM records WHERE track_id=?').get(trackId));
    assert.equal(restoredDb.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    restoredDb.close();
    assert.equal(
      (await request('/games/' + g.data.id, 'DELETE', { confirmation: 'DELETE' })).status,
      200,
    );
    state = (await request('/state')).data;
    assert.ok(!state.games.some((x: { id: string }) => x.id === g.data.id));
    assert.ok(!state.tracks.some((x: { gameId: string }) => x.gameId === g.data.id));
    assert.equal(state.records.length, 0);
    assert.ok(state.games.some((x: { id: string }) => x.id === g2.data.id));
    // A backup filesystem failure must prevent the deletion, even with correct confirmation.
    const blockedDir = join(dir, 'backups');
    rmSync(blockedDir, { recursive: true });
    writeFileSync(blockedDir, 'block directory creation');
    assert.equal(
      (await request('/games/' + g2.data.id, 'DELETE', { confirmation: 'DELETE' })).status,
      400,
    );
    assert.ok(
      (await request('/state')).data.games.some((x: { id: string }) => x.id === g2.data.id),
    );
    rmSync(blockedDir);
    mkdirSync(blockedDir);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
