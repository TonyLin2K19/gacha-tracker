import { groupKey, type Track, type DrawRecord } from './model.js';
export function chronology(records: DrawRecord[]) {
  return [...records].sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
}
const expand = (record: DrawRecord) =>
  record.results.flatMap((result) => Array.from({ length: result.count }, () => result));

export type RecentInterval = {
  count: number;
  outcome: 'unknown' | 'up' | 'off';
  atPity: boolean;
};

export function intervalClass(interval: RecentInterval) {
  return interval.outcome === 'off'
    ? 'is-off'
    : interval.outcome === 'up'
      ? 'is-up'
      : interval.atPity
        ? 'at-pity'
        : '';
}

export function pityState(track: Track, records: DrawRecord[], baseline = track.baseline) {
  const top = track.rules.rarities[0].name;
  let pity: number | null = baseline.pity,
    guaranteed: boolean | null = baseline.guaranteed;
  const intervals = [...baseline.intervals];
  const recentIntervals: RecentInterval[] = intervals.map((count) => ({
    count,
    outcome: 'unknown',
    atPity: !!track.rules.hardPity && count === track.rules.hardPity,
  }));
  let hardHits = 0;
  let activePool = 'initial';
  const poolGuarantees = new Map<string, boolean | null>();
  const poolProgress = new Map<string, { pity: number | null; guaranteed: boolean | null }>();
  for (const r of chronology(records)) {
    if (!track.rules.linkLastFour && r.kind === 'cycle_reset') {
      poolProgress.set(activePool, { pity, guaranteed });
      activePool = r.setPool?.id ?? r.id;
      if (!(r.setPool?.inherit ?? track.rules.inheritPity ?? true)) {
        const prior = poolProgress.get(activePool);
        pity = prior?.pity ?? (prior ? null : 0);
        guaranteed = prior?.guaranteed ?? (prior ? null : false);
      }
      continue;
    }
    if (track.rules.linkLastFour && r.kind === 'cycle_reset') {
      poolGuarantees.set(activePool, guaranteed);
      activePool = r.setPool?.id ?? r.id;
      guaranteed =
        poolGuarantees.get(activePool) ?? (poolGuarantees.has(activePool) ? null : false);
      continue;
    }
    if (r.kind !== 'draw') continue;
    const tops = r.results.filter((x) => x.rarity === top);
    const topCount = tops.reduce((s, x) => s + x.count, 0);
    const total = r.results.reduce((s, x) => s + x.count, 0);
    if (!r.ordered && topCount > 0) {
      pity = null;
      if (track.rules.guaranteeAfterLoss) {
        const states = new Set(tops.map((x) => x.outcome));
        guaranteed = states.size === 1 && !states.has('unknown') ? states.has('off') : null;
      }
      continue;
    }
    const results = expand(r);
    const linkedTopSet =
      r.tenPull?.linkedLastFour === true &&
      r.tenPull.setRarity === top &&
      results.length === 10 &&
      results.slice(6).every((x) => x.rarity === top);
    for (let position = 0; position < results.length; position++) {
      const x = results[position];
      if (linkedTopSet && position === 6) {
        // 四件套在畫面上是四個 SSR，但對 55 抽保底只算一次，並視為第 10 抽觸發。
        if (pity !== null) {
          const gap = pity + 4;
          intervals.push(gap);
          recentIntervals.push({
            count: gap,
            outcome: 'unknown',
            atPity: gap === track.rules.hardPity,
          });
          if (track.rules.hardPity && gap === track.rules.hardPity) hardHits++;
        }
        pity = 0;
        position = 9;
        continue;
      }
      if (x.rarity !== top) {
        if (pity !== null) pity++;
        continue;
      }
      if (pity !== null) {
        const gap = pity + 1;
        intervals.push(gap);
        recentIntervals.push({
          count: gap,
          outcome: x.outcome,
          atPity: gap === track.rules.hardPity,
        });
        if (track.rules.hardPity && gap === track.rules.hardPity) hardHits++;
      }
      pity = 0;
      if (track.rules.guaranteeAfterLoss)
        guaranteed = x.outcome === 'unknown' ? null : x.outcome === 'off';
    }
    // Unordered batches without a top rarity only advance the known counter.
    void total;
  }
  const nextRate =
    pity === null
      ? null
      : track.rules.hardPity && pity + 1 >= track.rules.hardPity
        ? 100
        : Math.min(
            100,
            track.rules.rarities[0].rate +
              (track.rules.softStart && pity + 1 >= track.rules.softStart
                ? (pity + 2 - track.rules.softStart) * track.rules.softStep
                : 0),
          );
  return { pity, guaranteed, intervals, recentIntervals, hardHits, nextRate };
}

export function linkedSetState(track: Track, records: DrawRecord[]) {
  if (!track.rules.linkLastFour) return null;
  let pity: number | null = track.baseline.pity;
  let guaranteed: boolean | null = track.baseline.guaranteed;
  const intervals = [...track.baseline.intervals];
  let hardHits = 0;
  const steps = track.rules.setPitySteps ?? [];
  const recentIntervals: RecentInterval[] = intervals.map((count, index) => ({
    count,
    outcome: 'unknown',
    atPity: !!steps.length && count === steps[Math.min(index, steps.length - 1)] * 10,
  }));
  let setCount = intervals.length;
  let cycleNumber = 1;
  let cycleName = track.poolNames?.initial ?? '卡池一';
  let cycleId = 'initial';
  let marksMode = false;
  let marks: number | null = null;
  // Historical intervals stay separate from shared guarantee marks.
  let intervalPity = pity;
  const pools = new Map<
    string,
    { id: string; name: string; setCount: number; guaranteed: boolean | null }
  >();
  const savePool = () => pools.set(cycleId, { id: cycleId, name: cycleName, setCount, guaranteed });
  const target = () => (steps.length ? steps[Math.min(setCount, steps.length - 1)] * 10 : null);
  savePool();
  for (const record of chronology(records)) {
    if (record.kind === 'cycle_reset') {
      savePool();
      if (record.setPool && !marksMode) {
        // Start the new model at the existing displayed progress, never reinterpret old draws.
        marks = pity === null || pity % 10 !== 0 ? null : pity / 10;
        marksMode = true;
      }
      cycleId = record.setPool?.id ?? record.id;
      const prior = pools.get(cycleId);
      cycleName =
        track.poolNames?.[cycleId] ??
        (record.note.trim() || prior?.name || `卡池${pools.size + 1}`);
      setCount = prior?.setCount ?? 0;
      guaranteed = prior ? prior.guaranteed : false;
      if (record.setPool?.marks !== undefined) marks = record.setPool.marks;
      if (record.setPool?.stage !== undefined) setCount = record.setPool.stage;
      if (record.setPool?.guaranteed !== undefined) guaranteed = record.setPool.guaranteed;
      if (marksMode) pity = marks === null ? null : marks * 10;
      savePool();
      cycleNumber = [...pools.keys()].indexOf(cycleId) + 1;
      continue;
    }
    if (record.kind !== 'draw' || !record.tenPull) continue;
    const isTopSet =
      record.tenPull.linkedLastFour && record.tenPull.setRarity === track.rules.rarities[0].name;
    if (isTopSet) {
      const atPity = marksMode
        ? marks !== null && target() !== null && marks + 1 >= target()! / 10
        : pity !== null && target() === pity + 10;
      if (intervalPity !== null) {
        const gap = intervalPity + 10;
        intervals.push(gap);
        const outcome = record.tenPull.setOutcome;
        recentIntervals.push({
          count: gap,
          outcome: outcome === 'up' || outcome === 'off' ? outcome : 'unknown',
          atPity,
        });
      }
      if (atPity) hardHits++;
      if (marksMode && marks !== null) {
        marks = target() === null ? null : Math.max(0, marks - target()! / 10);
      }
      setCount++;
      pity = marksMode ? (marks === null ? null : marks * 10) : 0;
      intervalPity = 0;
      if (track.rules.guaranteeAfterLoss) {
        const outcome = record.tenPull?.setOutcome ?? 'unknown';
        guaranteed =
          outcome === 'initial' || outcome === 'normal'
            ? false
            : outcome === 'unknown'
              ? null
              : outcome === 'off';
      }
    } else {
      if (marksMode && marks !== null) marks++;
      if (marksMode) pity = marks === null ? null : marks * 10;
      else if (pity !== null) pity += 10;
      if (intervalPity !== null) intervalPity += 10;
    }
  }
  savePool();
  const poolList = [...pools.values()].map((pool) => ({
    ...pool,
    target: steps.length ? steps[Math.min(pool.setCount, steps.length - 1)] * 10 : null,
  }));
  return {
    pity,
    intervals,
    recentIntervals,
    hardHits,
    target: target(),
    guaranteed,
    cycleNumber,
    cycleName,
    cycleId,
    setCount,
    pools: poolList,
    marksMode,
    marks: marksMode ? marks : pity === null || pity % 10 !== 0 ? null : pity / 10,
    nextGuaranteed: marksMode
      ? marks !== null && target() !== null && marks + 1 >= target()! / 10
      : pity !== null && target() !== null && pity + 10 >= target()!,
  };
}

export function summarize(track: Track, all: DrawRecord[], tracks: Track[]) {
  const records = all.filter((r) => r.trackId === track.id);
  const counts = { ...track.baseline.counts };
  let up = track.rules.linkLastFour ? (track.baseline.secondaryUp ?? 0) : track.baseline.up,
    off = track.rules.linkLastFour ? (track.baseline.secondaryOff ?? 0) : track.baseline.off,
    setUp = track.rules.linkLastFour ? track.baseline.up : 0,
    setOff = track.rules.linkLastFour ? track.baseline.off : 0,
    rewards = 0;
  for (const r of records) {
    const results = expand(r);
    const linkedTopSet =
      r.tenPull?.linkedLastFour === true &&
      r.tenPull.setRarity === track.rules.rarities[0].name &&
      results.length === 10;
    for (const [position, x] of results.entries()) {
      if (r.kind === 'reward') {
        rewards++;
        continue;
      }
      counts[x.rarity] = (counts[x.rarity] || 0) + 1;
      if (linkedTopSet && position >= 6) continue;
      if (x.outcome === 'up') up++;
      if (x.outcome === 'off') off++;
    }
    if (r.kind === 'draw' && linkedTopSet) {
      if (r.tenPull?.setOutcome === 'up') setUp++;
      if (r.tenPull?.setOutcome === 'off') setOff++;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0),
    top = counts[track.rules.rarities[0].name] || 0;
  const peers = tracks.filter((t) => groupKey(t) === groupKey(track));
  const ids = new Set(peers.map((t) => t.id));
  const groupRecords = all.filter((r) => ids.has(r.trackId));
  const secondaryBaseline = track.rules.linkLastFour
    ? {
        ...track.baseline,
        pity: track.baseline.secondaryPity ?? 0,
        intervals: track.baseline.secondaryIntervals ?? [],
        up: track.baseline.secondaryUp ?? 0,
        off: track.baseline.secondaryOff ?? 0,
        guaranteed: track.baseline.secondaryGuaranteed ?? false,
      }
    : track.baseline;
  const state = pityState(track, groupRecords, secondaryBaseline);
  return {
    counts,
    total,
    top,
    rate: total ? (top / total) * 100 : 0,
    average: top ? total / top : null,
    up,
    off,
    rewards,
    expected: (total * track.rules.rarities[0].rate) / 100,
    shared: peers.length > 1,
    setState: (() => {
      const setState = linkedSetState(track, groupRecords);
      return setState ? { ...setState, up: setUp, off: setOff } : null;
    })(),
    ...state,
  };
}
export type Stats = ReturnType<typeof summarize>;
