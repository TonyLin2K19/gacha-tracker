import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRules,
  emptyBaseline,
  validateSnapshot,
  validateGroups,
  validateTrack,
  recordSchema,
  type Track,
  type DrawRecord,
} from '../shared/model.js';
import { summarize, pityState, linkedSetState, intervalClass } from '../shared/stats.js';
import { parseBaselineTSV, ensureUniqueTracks } from '../shared/import.js';
import { createStore } from '../server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const track = (): Track => ({
  id: 't',
  gameId: 'g',
  server: '台服',
  account: '主帳號',
  pool: '角色池',
  pityGroup: '',
  rules: {
    ...structuredClone(defaultRules),
    hardPity: 90,
    softStart: 74,
    softStep: 6,
    guaranteeAfterLoss: true,
  },
  baseline: structuredClone(emptyBaseline),
});
let seq = 0;
const record = (results: DrawRecord['results'], extra: Partial<DrawRecord> = {}): DrawRecord => ({
  id: String(++seq),
  seq,
  trackId: 't',
  at: '2026-09-13T00:00:00.000Z',
  kind: 'draw',
  ordered: true,
  note: '',
  results,
  ...extra,
});
const result = (rarity: string, count: number, outcome: 'unknown' | 'up' | 'off' = 'unknown') => ({
  rarity,
  count,
  outcome,
});
test('baseline plus new draws does not invent historical events', () => {
  const t = track();
  t.baseline = {
    counts: { SSR: 2, SR: 10, R: 88 },
    pity: 20,
    up: 1,
    off: 1,
    guaranteed: true,
    intervals: [30, 50],
  };
  const r = [record([result('R', 4), result('SSR', 1, 'up'), result('R', 5)])];
  const s = summarize(t, r, [t]);
  assert.equal(s.total, 110);
  assert.equal(s.top, 3);
  assert.equal(s.pity, 5);
  assert.deepEqual(s.intervals, [30, 50, 25]);
  assert.equal(s.guaranteed, false);
  assert.equal(s.up, 2);
});
test('unknown batch makes pity uncertain; next known top restores it without fabricating a gap', () => {
  const t = track();
  const r = [
    record([result('R', 9), result('SSR', 1, 'off')], { ordered: false }),
    record([result('R', 8)]),
    record([result('SSR', 1, 'up'), result('R', 3)]),
  ];
  assert.equal(pityState(t, r.slice(0, 2)).pity, null);
  const s = pityState(t, r);
  assert.equal(s.pity, 3);
  assert.deepEqual(s.intervals, []);
  assert.equal(s.guaranteed, false);
});

test('recent intervals keep outcomes aligned and prioritize UP/off over hard pity', () => {
  const t = track();
  t.baseline.intervals = [90, 23];
  t.baseline.pity = 89;
  const draws = [
    record([result('SSR', 1, 'off')]),
    record([result('R', 89), result('SSR', 1, 'up')]),
    record([result('R', 89), result('SSR', 1)]),
    record([result('R', 3), result('SSR', 1)]),
  ];
  const state = pityState(t, draws);
  assert.deepEqual(
    state.recentIntervals.map((x) => x.count),
    state.intervals,
  );
  assert.deepEqual(state.recentIntervals.map(intervalClass), [
    'at-pity',
    '',
    'is-off',
    'is-up',
    'at-pity',
    '',
  ]);
  const uncertain = pityState(t, [
    record([result('SSR', 1, 'off')], { ordered: false }),
    record([result('SSR', 1, 'up')]),
    record([result('SSR', 1, 'off')]),
    record([result('SSR', 1, 'up')], { kind: 'reward' }),
  ]);
  assert.deepEqual(uncertain.recentIntervals.map(intervalClass), ['at-pity', '', 'is-off']);
});

test('linked set interval colors use their own outcomes and historical pity thresholds', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  t.baseline.pity = 80;
  const setRecord = (outcome: 'unknown' | 'up' | 'off') =>
    record([result('R', 6), result('SSR', 4)], {
      tenPull: { linkedLastFour: true, setRarity: 'SSR', setOutcome: outcome },
    });
  const draws = [setRecord('unknown')];
  for (let i = 0; i < 11; i++)
    draws.push(record([result('R', 10)], { tenPull: { linkedLastFour: true, setRarity: 'R' } }));
  draws.push(setRecord('off'));
  draws.push(record([], { kind: 'cycle_reset', note: '第二輪' }));
  for (let i = 0; i < 8; i++)
    draws.push(record([result('R', 10)], { tenPull: { linkedLastFour: true, setRarity: 'R' } }));
  draws.push(setRecord('up'));
  const state = linkedSetState(t, draws)!;
  assert.deepEqual(state.intervals, [90, 120, 90]);
  assert.deepEqual(state.recentIntervals.map(intervalClass), ['at-pity', 'is-off', 'is-up']);
  assert.equal(state.target, 120);
  const summary = summarize(t, draws, [t]);
  assert.equal(summary.setState?.recentIntervals.at(-1)?.outcome, 'up');
  assert.equal(summary.recentIntervals.at(-1)?.outcome, 'unknown');
});
test('unknown mixed UP ordering does not guess guaranteed state', () => {
  const t = track();
  const s = pityState(t, [
    record([result('SSR', 1, 'up'), result('SSR', 1, 'off')], { ordered: false }),
  ]);
  assert.equal(s.guaranteed, null);
});
test('reward excluded from all draw statistics and pity', () => {
  const t = track();
  const s = summarize(
    t,
    [record([result('R', 10)]), record([result('SSR', 1, 'up')], { kind: 'reward' })],
    [t],
  );
  assert.equal(s.total, 10);
  assert.equal(s.top, 0);
  assert.equal(s.pity, 10);
  assert.equal(s.up, 0);
  assert.equal(s.rewards, 1);
});
test('hard pity and linear soft pity boundaries', () => {
  const t = track();
  t.baseline.pity = 72;
  assert.equal(pityState(t, []).nextRate, 2);
  t.baseline.pity = 73;
  assert.equal(pityState(t, []).nextRate, 8);
  t.baseline.pity = 89;
  assert.equal(pityState(t, []).nextRate, 100);
  assert.equal(pityState(t, [record([result('SSR', 1)])]).hardHits, 1);
});
test('quick ten-pull preserves logical order and validates a linked last-four set', () => {
  const t = track();
  const results = [
    ...Array.from({ length: 6 }, () => result('R', 1)),
    ...Array.from({ length: 4 }, () => result('SSR', 1)),
  ];
  const parsed = recordSchema.parse({
    ...record(results),
    tenPull: { linkedLastFour: true, setRarity: 'SSR' },
  });
  const state = pityState(t, [{ ...parsed, id: 'ten', seq: 999 }]);
  assert.equal(state.pity, 0);
  assert.deepEqual(state.intervals, [10]);
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  const setState = linkedSetState(t, [{ ...parsed, id: 'ten', seq: 999 }]);
  assert.equal(setState?.pity, 0);
  assert.deepEqual(setState?.intervals, [10]);
  assert.equal(setState?.target, 120);
  assert.throws(
    () =>
      recordSchema.parse({
        ...parsed,
        results: [...results.slice(0, 9), result('SR', 1)],
      }),
    /第 7～10 抽/,
  );
});
test('linked SSR set resets both counters once while a single draw only advances the secondary row', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  t.baseline.pity = 80;
  t.baseline.intervals = [];
  t.baseline.secondaryPity = 45;
  t.baseline.secondaryIntervals = [30, 46];
  const set = recordSchema.parse({
    ...record([
      ...Array.from({ length: 6 }, () => result('R', 1)),
      ...Array.from({ length: 4 }, () => result('SSR', 1)),
    ]),
    tenPull: { linkedLastFour: true, setRarity: 'SSR' },
  });
  const single = record([result('R', 1)], { at: '2026-09-13T00:01:00.000Z' });
  const stats = summarize(
    t,
    [
      { ...set, id: 'set', seq: 1000 },
      { ...single, id: 'single', seq: 1001 },
    ],
    [t],
  );
  assert.equal(stats.top, 4);
  assert.deepEqual(stats.setState?.intervals, [90]);
  assert.equal(stats.setState?.pity, 0);
  assert.deepEqual(stats.intervals, [30, 46, 55]);
  assert.equal(stats.pity, 1);
});
test('the initial 90-pull guaranteed set is excluded from set UP/off statistics', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  t.baseline.pity = 80;
  const initialSet = recordSchema.parse({
    ...record([
      ...Array.from({ length: 6 }, () => result('R', 1)),
      ...Array.from({ length: 4 }, () => result('SSR', 1)),
    ]),
    tenPull: { linkedLastFour: true, setRarity: 'SSR', setOutcome: 'initial' },
  });
  const stats = summarize(t, [{ ...initialSet, id: 'initial', seq: 2000 }], [t]);
  assert.equal(stats.setState?.up, 0);
  assert.equal(stats.setState?.off, 0);
  assert.equal(stats.setState?.guaranteed, false);
  assert.deepEqual(stats.setState?.intervals, [90]);
});
test('a redeemed set guarantee clears the state without adding an UP or off count', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.guaranteeAfterLoss = true;
  t.rules.setPitySteps = [9, 12, 15];
  t.baseline.guaranteed = true;
  t.baseline.up = 2;
  t.baseline.off = 1;
  const redeemed = recordSchema.parse({
    ...record([
      ...Array.from({ length: 6 }, () => result('R', 1)),
      ...Array.from({ length: 4 }, () => result('SSR', 1)),
    ]),
    tenPull: { linkedLastFour: true, setRarity: 'SSR', setOutcome: 'normal' },
  });
  const stats = summarize(t, [{ ...redeemed, id: 'redeemed', seq: 2500 }], [t]);
  assert.equal(stats.setState?.up, 2);
  assert.equal(stats.setState?.off, 1);
  assert.equal(stats.setState?.guaranteed, false);
});
test('cycle reset returns the stage to 9, preserves pity, and clears the old pool guarantee', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  t.baseline.pity = 30;
  t.baseline.guaranteed = true;
  t.baseline.intervals = [90, 120, 150];
  t.baseline.secondaryPity = 30;
  const reset = recordSchema.parse({
    trackId: t.id,
    at: '2026-09-13T00:00:00.000Z',
    ordered: true,
    kind: 'cycle_reset',
    results: [],
    note: '白月機甲',
  });
  const stats = summarize(t, [{ ...reset, id: 'reset', seq: 3000 }], [t]);
  assert.equal(stats.setState?.pity, 30);
  assert.equal(stats.setState?.target, 90);
  assert.equal(stats.setState?.cycleName, '白月機甲');
  assert.equal(stats.setState?.cycleNumber, 2);
  assert.equal(stats.setState?.guaranteed, false);
  assert.equal(stats.pity, 30);
  assert.equal(stats.total, 0);
});
test('shared pity is scoped to account and server', () => {
  const a = track();
  a.pityGroup = '限定';
  const b = { ...structuredClone(a), id: 'b', pool: '另一池' };
  const c = { ...structuredClone(a), id: 'c', account: '小號' };
  validateGroups([a, b, c]);
  const records = [
    record([result('R', 5)]),
    record([result('R', 7)], { trackId: 'b' }),
    record([result('R', 9)], { trackId: 'c' }),
  ];
  assert.equal(summarize(a, records, [a, b, c]).pity, 12);
  assert.equal(summarize(b, records, [a, b, c]).total, 7);
  assert.equal(summarize(c, records, [a, b, c]).pity, 9);
});
test('edits/deletions recompute from chronological data', () => {
  const t = track();
  const a = record([result('R', 10)], { at: '2026-09-14T00:00:00.000Z' });
  const b = record([result('SSR', 1, 'off')], { at: '2026-09-13T00:00:00.000Z' });
  assert.equal(pityState(t, [a, b]).pity, 10);
  assert.equal(pityState(t, [a]).pity, 10);
  assert.deepEqual(pityState(t, [a]).intervals, []);
});
test('TSV supports reordered columns and checks totals and duplicates', () => {
  const t = track();
  const text =
    '帳號\t伺服器\t卡池\tSSR\tSR\tR\t累計\t墊抽\tUP\t歪\t出貨間隔\n主帳號\t台服\t角色\t2\t10\t88\t100\t20\t1\t1\t30,50';
  const rows = parseBaselineTSV(text, 'g', t.rules);
  assert.equal(rows[0].baseline.pity, 20);
  assert.deepEqual(rows[0].baseline.intervals, [30, 50]);
  assert.throws(
    () => parseBaselineTSV(text.replace('\t100\t', '\t101\t'), 'g', t.rules),
    /合計不符/,
  );
  assert.throws(() => ensureUniqueTracks([t, { ...t, id: 't2' }]), /已有相同/);
});
test('baseline invalid inputs rejected', () => {
  const t = track();
  t.baseline.up = 1;
  assert.throws(() => validateTrack(t), /不可超過/);
});
test('SQLite restore is transactional, preserves sequence and survives reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gacha-'));
  try {
    const path = join(dir, 'gacha.db');
    const store = createStore(path);
    const t = track();
    const r = record([result('R', 3)]);
    const snap = {
      version: 1 as const,
      games: [{ id: 'g', name: '遊戲', icon: '', sortOrder: 1 }],
      tracks: [t],
      records: [r],
      settings: { layout: { sizing: { total: 140 } } },
    };
    validateSnapshot(snap);
    store.replace(snap);
    assert.deepEqual(store.snapshot(), snap);
    assert.throws(() => store.replace({ ...snap, records: [r, { ...r, seq: r.seq + 1 }] }));
    assert.deepEqual(store.snapshot(), snap);
    store.backup();
    store.db.close();
    const reopened = createStore(path);
    assert.deepEqual(reopened.snapshot(), snap);
    reopened.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('SQLite upgrades old game rows without losing their order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gacha-migration-'));
  try {
    const path = join(dir, 'gacha.db');
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE games(id TEXT PRIMARY KEY,name TEXT NOT NULL); INSERT INTO games VALUES('a','第一個'),('b','第二個');",
    );
    old.close();
    const upgraded = createStore(path);
    assert.deepEqual(
      upgraded
        .snapshot()
        .games.map((game) => ({ name: game.name, icon: game.icon, order: game.sortOrder })),
      [
        { name: '第一個', icon: '', order: 1 },
        { name: '第二個', icon: '', order: 2 },
      ],
    );
    upgraded.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('existing mech totals and history survive a progress checkpoint', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  t.baseline.counts = { SSR: 285, SR: 853, R: 3437 };
  t.baseline.intervals = [90, 120, 90, 90, 120];
  t.baseline.pity = 60;
  t.baseline.secondaryPity = 5;
  const original = summarize(t, [], [t]);
  const checkpoint = record([], {
    kind: 'cycle_reset',
    note: '莫比烏斯X',
    setPool: { id: 'initial', marks: 6, stage: 2, guaranteed: false },
  });
  const state = summarize(t, [checkpoint], [t]);
  assert.equal(state.total, 4575);
  assert.deepEqual(state.counts, original.counts);
  assert.deepEqual(state.setState?.intervals, original.setState?.intervals);
  assert.equal(state.setState?.marks, 6);
  assert.equal(state.setState?.target, 150);
  assert.equal(state.pity, 5);
  assert.equal(state.setState?.pools.length, 1);
  assert.equal(summarize(t, [], [t]).setState?.marksMode, false);
});

test('shared marks retain surplus while each pool retains its stage and UP state', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  const switchPool = (id: string, extra: NonNullable<DrawRecord['setPool']> = { id }) =>
    record([], {
      kind: 'cycle_reset',
      note: id,
      setPool: extra,
    });
  const drawSet = (outcome: 'up' | 'off') =>
    record([result('R', 6), result('SSR', 4)], {
      tenPull: { linkedLastFour: true, setRarity: 'SSR', setOutcome: outcome },
    });
  const draws = [
    switchPool('initial', { id: 'initial', marks: 14, stage: 2, guaranteed: true }),
    switchPool('B'),
    drawSet('off'),
  ];
  let state = linkedSetState(t, draws)!;
  assert.equal(state.marks, 5);
  assert.equal(state.target, 120);
  assert.equal(state.guaranteed, true);
  assert.equal(state.recentIntervals.at(-1)?.atPity, true);
  draws.push(switchPool('initial'));
  state = linkedSetState(t, draws)!;
  assert.equal(state.marks, 5);
  assert.equal(state.target, 150);
  assert.equal(state.guaranteed, true);
  draws.push(switchPool('B'));
  state = linkedSetState(t, draws)!;
  assert.equal(state.target, 120);
  assert.equal(state.pools.length, 2);
  draws.push(switchPool('C', { id: 'C', marks: 14, stage: 1 }), drawSet('up'));
  state = linkedSetState(t, draws)!;
  assert.equal(state.marks, 2);
  assert.equal(state.target, 150);
  assert.equal(state.guaranteed, false);
});

test('eight marks at a nine-ten-pull threshold guarantees the next ten-pull; single draws do not add marks', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  const checkpoint = record([], {
    kind: 'cycle_reset',
    note: '新池',
    setPool: { id: 'B', marks: 8 },
  });
  const single = record([result('R', 20)]);
  let state = linkedSetState(t, [checkpoint, single])!;
  assert.equal(state.marks, 8);
  assert.equal(state.nextGuaranteed, true);
  const topSet = record([result('R', 6), result('SSR', 4)], {
    tenPull: { linkedLastFour: true, setRarity: 'SSR', setOutcome: 'initial' },
  });
  state = linkedSetState(t, [checkpoint, single, topSet])!;
  assert.equal(state.marks, 0);
  assert.equal(state.target, 120);
});

test('legacy named pools are selectable without rewriting historical stages or inventing intervals', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  t.baseline.intervals = [90, 120];
  t.baseline.pity = 60;
  const old = record([], { kind: 'cycle_reset', note: '白月' });
  const draw = record([result('R', 6), result('SSR', 4)], {
    tenPull: { linkedLastFour: true, setRarity: 'SSR' },
  });
  const back = record([], { kind: 'cycle_reset', note: '機甲1', setPool: { id: 'initial' } });
  const state = linkedSetState(t, [old, draw, back])!;
  assert.equal(state.target, 150);
  assert.equal(state.pools.find((pool) => pool.id === old.id)?.target, 120);
  assert.deepEqual(state.intervals, [90, 120, 70]);
  const unknown = record([], {
    kind: 'cycle_reset',
    note: '白月',
    setPool: { id: old.id, marks: null },
  });
  assert.equal(linkedSetState(t, [old, draw, back, unknown])?.pity, null);
  assert.equal(linkedSetState(t, [old, draw, back, unknown])?.marks, null);
});

test('component UP guarantee follows the selected pool while the 55-pull counter is retained', () => {
  const t = track();
  t.rules.linkLastFour = true;
  const loss = record([result('SSR', 1, 'off')]);
  const toB = record([], { kind: 'cycle_reset', note: 'B', setPool: { id: 'B' } });
  const nonTop = record([result('R', 5)]);
  const toA = record([], { kind: 'cycle_reset', note: 'A', setPool: { id: 'initial' } });
  assert.equal(pityState(t, [loss, toB, nonTop]).guaranteed, false);
  const state = pityState(t, [loss, toB, nonTop, toA]);
  assert.equal(state.guaranteed, true);
  assert.equal(state.pity, 5);
  assert.throws(() => recordSchema.parse({ ...loss, setPool: { id: 'B' } }), /套裝池切換資訊/);
});
