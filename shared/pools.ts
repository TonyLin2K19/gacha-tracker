import { emptyBaseline, type Track, type DrawRecord } from './model.js';
import { chronology, summarize } from './stats.js';

/** Resolve ownership from chronological switches, including backdated/imported records. */
export function poolCatalog(track: Track, all: DrawRecord[]) {
  const periods = new Map<string, { id: string; name: string; records: DrawRecord[] }>();
  const ensure = (id: string, name: string) => {
    if (!periods.has(id)) periods.set(id, { id, name: track.poolNames?.[id] ?? name, records: [] });
    return periods.get(id)!;
  };
  let activeId = 'initial';
  ensure(activeId, '卡池一');
  for (const record of chronology(all.filter((r) => r.trackId === track.id))) {
    if (record.kind === 'cycle_reset') {
      activeId = record.setPool?.id ?? record.id;
      const period = ensure(activeId, record.note || '未命名卡池');
      period.name = track.poolNames?.[activeId] ?? (record.note.trim() || period.name);
    } else ensure(activeId, '未命名卡池').records.push(record);
  }
  return { activeId, periods: [...periods.values()] };
}

export function poolPeriods(track: Track, all: DrawRecord[]) {
  const catalog = poolCatalog(track, all);
  return {
    activeId: catalog.activeId,
    periods: catalog.periods.map((period) => {
      const scoped = {
        ...track,
        pityGroup: '',
        baseline: period.id === 'initial' ? track.baseline : structuredClone(emptyBaseline),
      };
      return { ...period, stats: summarize(scoped, period.records, [scoped]) };
    }),
  };
}

export function rarityClass(index: number, count: number) {
  return `rarity-tone-${count >= 4 ? Math.min(index, 3) : Math.min(index + 1, 3)}`;
}
