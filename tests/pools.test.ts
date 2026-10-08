import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRules,
  emptyBaseline,
  snapshotSchema,
  validateRecord,
  type Track,
  type DrawRecord,
} from '../shared/model.js';
import { poolPeriods, rarityClass } from '../shared/pools.js';
import { summarize, pityState } from '../shared/stats.js';

const track = (): Track => ({
  id: 't',
  gameId: 'g',
  server: '台服',
  account: '主帳號',
  pool: '限定尋訪',
  pityGroup: '',
  rules: { ...defaultRules, inheritPity: false, guaranteeAfterLoss: true },
  baseline: structuredClone(emptyBaseline),
});
function event(
  seq: number,
  kind: 'draw' | 'cycle_reset' | 'reward',
  data: Partial<DrawRecord> = {},
): DrawRecord {
  return {
    id: `r${seq}`,
    seq,
    trackId: 't',
    at: `2026-10-09T00:${String(seq).padStart(2, '0')}:00.000Z`,
    ordered: true,
    kind,
    note: '',
    results: kind === 'draw' ? [{ rarity: 'R', count: 10, outcome: 'unknown' }] : [],
    ...data,
  };
}
const change = (seq: number, id: string, inherit = false) =>
  event(seq, 'cycle_reset', { note: id, setPool: { id, inherit } });

test('non-inheriting periods reset new pools and restore progress and UP on returning', () => {
  const t = track();
  const records = [
    event(1, 'draw', { results: [{ rarity: 'SSR', count: 1, outcome: 'off' }] }),
    event(2, 'draw'),
    change(3, 'B'),
    event(4, 'draw', { results: [{ rarity: 'R', count: 3, outcome: 'unknown' }] }),
  ];
  assert.equal(pityState(t, records).pity, 3);
  assert.equal(pityState(t, records).guaranteed, false);
  const back = [...records, change(5, 'initial')];
  assert.equal(pityState(t, back).pity, 10);
  assert.equal(pityState(t, back).guaranteed, true);
  assert.equal(pityState(t, [...back, change(6, 'B')]).pity, 3);
  assert.equal(summarize(t, back, [t]).total, 14);
});

test('inheriting switch carries progress and guarantee, using event-time setting', () => {
  const t = track();
  const records = [
    event(1, 'draw', { results: [{ rarity: 'SSR', count: 1, outcome: 'off' }] }),
    event(2, 'draw'),
    change(3, 'B', true),
  ];
  assert.equal(pityState(t, records).pity, 10);
  assert.equal(pityState(t, records).guaranteed, true);
  t.rules.inheritPity = false;
  assert.equal(pityState(t, records).pity, 10);
});

test('pool ownership, baseline, rewards and totals survive renaming and unsorted input', () => {
  const t = track();
  t.baseline.counts = { R: 20 };
  t.baseline.pity = 20;
  const records = [
    event(1, 'draw'),
    change(2, 'B'),
    event(3, 'draw'),
    event(4, 'reward', {
      kind: 'reward',
      results: [{ rarity: 'SSR', count: 1, outcome: 'unknown' }],
    }),
    change(5, 'initial'),
    event(6, 'draw'),
  ];
  const before = summarize(t, records, [t]);
  t.poolNames = { initial: '卡池一修正', B: '某角色 UP' };
  const periods = poolPeriods(t, [...records].reverse());
  assert.equal(periods.activeId, 'initial');
  assert.equal(periods.periods[0].name, '卡池一修正');
  assert.equal(periods.periods[0].stats.total, 40);
  assert.equal(periods.periods[1].stats.total, 10);
  assert.equal(periods.periods[1].stats.rewards, 1);
  assert.deepEqual(summarize(t, records, [t]), before);
  assert.equal(
    periods.periods.reduce((s, p) => s + p.stats.total, 0),
    before.total,
  );
});

test('older snapshots default to inherited progress and unnamed first period', () => {
  const t = track();
  delete t.rules.inheritPity;
  const snapshot = snapshotSchema.parse({
    version: 1,
    games: [{ id: 'g', name: '遊戲' }],
    tracks: [t],
    records: [],
    settings: {},
  });
  assert.equal(snapshot.tracks[0].rules.inheritPity, true);
  assert.equal(poolPeriods(t, []).periods[0].name, '卡池一');
  validateRecord(change(1, 'B'), t);
  assert.throws(
    () => validateRecord(event(1, 'cycle_reset', { note: 'B', setPool: { id: 'B', marks: 3 } }), t),
    /機甲/,
  );
});

test('rarity rank colors handle four ranks and three ranks independent of labels', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => rarityClass(i, 4)),
    ['rarity-tone-0', 'rarity-tone-1', 'rarity-tone-2', 'rarity-tone-3'],
  );
  assert.deepEqual(
    [0, 1, 2].map((i) => rarityClass(i, 3)),
    ['rarity-tone-1', 'rarity-tone-2', 'rarity-tone-3'],
  );
});

test('a named initial legacy checkpoint keeps its name without rewriting history', () => {
  const t = track();
  t.rules.linkLastFour = true;
  t.rules.setPitySteps = [9, 12, 15];
  const records = [
    event(1, 'cycle_reset', { note: '莫比烏斯X', setPool: { id: 'initial', marks: 6, stage: 2 } }),
  ];
  assert.equal(poolPeriods(t, records).periods[0].name, '莫比烏斯X');
  t.poolNames = { initial: '修正名稱' };
  assert.equal(poolPeriods(t, records).periods[0].name, '修正名稱');
  assert.equal(summarize(t, records, [t]).setState?.cycleName, '修正名稱');
  assert.equal(summarize(t, records, [t]).setState?.marks, 6);
});

test('soft pity increases from pull 51 and resets in a new non-inheriting period', () => {
  const t = track();
  t.rules.rarities = [
    { name: '六星', rate: 2 },
    { name: '五星', rate: 8 },
    { name: '四星', rate: 50 },
    { name: '三星', rate: 40 },
  ];
  t.rules.softStart = 51;
  t.rules.softStep = 2;
  t.rules.hardPity = 99;
  const draws = event(1, 'draw', { results: [{ rarity: '三星', count: 50, outcome: 'unknown' }] });
  assert.equal(pityState(t, [draws]).nextRate, 4);
  assert.equal(pityState(t, [draws, change(2, 'B')]).nextRate, 2);
  assert.equal(pityState(t, [draws, change(2, 'B', true)]).nextRate, 4);
});
