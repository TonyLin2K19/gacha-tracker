import { z } from 'zod';
const name = z.string().trim().min(1).max(80);
const count = z.number().int().min(0).max(10000000);
export const rulesSchema = z
  .object({
    rarities: z
      .array(z.object({ name, rate: z.number().min(0).max(100) }))
      .min(2)
      .max(8),
    hardPity: count.default(0),
    softStart: count.default(0),
    softStep: z.number().min(0).max(100).default(0),
    upRate: z.number().min(0).max(100).default(50),
    guaranteeAfterLoss: z.boolean().default(false),
    tenPullLayout: z.enum(['row', 'column']).default('row'),
    linkLastFour: z.boolean().default(false),
    setPitySteps: z.array(z.number().int().min(1).max(1000)).max(20).default([]),
    tenGuarantee: z.string().max(200).default(''),
    notes: z.string().max(2000).default(''),
  })
  .superRefine((r, ctx) => {
    if (new Set(r.rarities.map((x) => x.name)).size !== r.rarities.length)
      ctx.addIssue({ code: 'custom', message: '稀有度名稱不可重複' });
    if (r.rarities.some((x) => /[\n,:]/.test(x.name)))
      ctx.addIssue({ code: 'custom', message: '稀有度名稱不可包含換行、逗號或冒號' });
    if (Math.abs(r.rarities.reduce((s, x) => s + x.rate, 0) - 100) > 0.001)
      ctx.addIssue({ code: 'custom', message: '各稀有度機率合計必須是 100%' });
    if (r.hardPity && r.softStart > r.hardPity)
      ctx.addIssue({ code: 'custom', message: '軟保底起點不可超過硬保底' });
  });
export const baselineSchema = z.object({
  counts: z.record(z.string(), count).default({}),
  pity: count.nullable().default(0),
  up: count.default(0),
  off: count.default(0),
  guaranteed: z.boolean().nullable().default(false),
  intervals: z.array(z.number().int().min(1).max(10000000)).max(1000).default([]),
  secondaryPity: count.nullable().default(0),
  secondaryIntervals: z.array(z.number().int().min(1).max(10000000)).max(1000).default([]),
  secondaryUp: count.default(0),
  secondaryOff: count.default(0),
  secondaryGuaranteed: z.boolean().nullable().default(false),
});
export const trackSchema = z.object({
  gameId: z.string().min(1),
  server: name,
  account: name,
  pool: name,
  pityGroup: z.string().trim().max(80).default(''),
  rules: rulesSchema,
  baseline: baselineSchema,
});
export const resultSchema = z.object({
  rarity: name,
  count: z.number().int().min(1).max(100000),
  outcome: z.enum(['unknown', 'up', 'off']).default('unknown'),
});
export const recordSchema = z
  .object({
    trackId: z.string().min(1),
    at: z.string().datetime({ offset: true }),
    ordered: z.boolean(),
    kind: z.enum(['draw', 'reward', 'cycle_reset']).default('draw'),
    setPool: z
      .object({
        id: z.string().trim().min(1).max(100),
        marks: count.nullable().optional(),
        stage: count.optional(),
        guaranteed: z.boolean().nullable().optional(),
      })
      .optional(),
    tenPull: z
      .object({
        linkedLastFour: z.boolean().default(false),
        setRarity: name.nullable().default(null),
        setOutcome: z.enum(['unknown', 'up', 'off', 'normal', 'initial']).default('unknown'),
      })
      .nullable()
      .default(null),
    results: z.array(resultSchema).max(1000).default([]),
    note: z.string().max(2000).default(''),
  })
  .superRefine((r, ctx) => {
    if (r.setPool && r.kind !== 'cycle_reset')
      ctx.addIssue({ code: 'custom', message: '套裝池切換資訊只能用於切換紀錄' });
    const total = r.results.reduce((s, x) => s + x.count, 0);
    if (total > 100000) ctx.addIssue({ code: 'custom', message: '每筆最多 100,000 抽' });
    if (r.kind === 'cycle_reset') {
      if (r.results.length || r.tenPull)
        ctx.addIssue({ code: 'custom', message: '套裝池重置不可包含抽卡結果' });
      if (!r.note.trim()) ctx.addIssue({ code: 'custom', message: '套裝池重置必須有新輪次名稱' });
      return;
    }
    if (!r.results.length) {
      ctx.addIssue({ code: 'custom', message: '抽卡或獎勵至少需要一個結果' });
      return;
    }
    if (r.tenPull) {
      if (r.kind !== 'draw' || !r.ordered || total !== 10) {
        ctx.addIssue({ code: 'custom', message: '快速十抽必須是十個有順序的抽卡結果' });
        return;
      }
      const expanded = r.results.flatMap((x) => Array.from({ length: x.count }, () => x));
      if (
        r.tenPull.linkedLastFour &&
        (expanded.slice(6).some((x) => x.rarity !== r.tenPull?.setRarity) || !r.tenPull.setRarity)
      )
        ctx.addIssue({ code: 'custom', message: '套裝連動時，第 7～10 抽必須是相同稀有度' });
    }
  });
type ParsedRules = z.infer<typeof rulesSchema>;
export type Rules = Omit<ParsedRules, 'setPitySteps'> & {
  /** 舊版卡池沒有套裝保底設定。 */
  setPitySteps?: ParsedRules['setPitySteps'];
};
type ParsedBaseline = z.infer<typeof baselineSchema>;
export type Baseline = Omit<
  ParsedBaseline,
  'secondaryPity' | 'secondaryIntervals' | 'secondaryUp' | 'secondaryOff' | 'secondaryGuaranteed'
> & {
  /** 舊版歷史基底沒有第二列統計。 */
  secondaryPity?: ParsedBaseline['secondaryPity'];
  secondaryIntervals?: ParsedBaseline['secondaryIntervals'];
  secondaryUp?: ParsedBaseline['secondaryUp'];
  secondaryOff?: ParsedBaseline['secondaryOff'];
  secondaryGuaranteed?: ParsedBaseline['secondaryGuaranteed'];
};
type ParsedTrack = z.infer<typeof trackSchema>;
export type Track = Omit<ParsedTrack, 'rules' | 'baseline'> & {
  rules: Rules;
  baseline: Baseline;
  id: string;
};
type ParsedRecord = z.infer<typeof recordSchema>;
type ParsedTenPull = NonNullable<ParsedRecord['tenPull']>;
type CompatibleTenPull = Omit<ParsedTenPull, 'setOutcome'> & {
  /** 舊版快速十抽沒有套裝 UP／歪欄位。 */
  setOutcome?: ParsedTenPull['setOutcome'];
};
export type DrawRecord = Omit<ParsedRecord, 'tenPull'> & {
  /** 舊版紀錄沒有這個欄位；讀入時 recordSchema 會自動補成 null。 */
  tenPull?: CompatibleTenPull | null;
  id: string;
  seq: number;
};
export interface Game {
  id: string;
  name: string;
  /** 舊版備份沒有自訂圖示。 */
  icon?: string;
  /** 舊版備份沒有顯示順序。 */
  sortOrder?: number;
}
export const snapshotSchema = z.object({
  version: z.literal(1),
  games: z
    .array(
      z.object({
        id: z.string().min(1),
        name,
        icon: z.string().max(255).default(''),
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .max(1000),
  tracks: z.array(trackSchema.extend({ id: z.string().min(1) })).max(10000),
  records: z
    .array(recordSchema.safeExtend({ id: z.string().min(1), seq: z.number().int().min(1) }))
    .max(500000),
  settings: z.record(z.string(), z.unknown()).default({}),
});
type ParsedSnapshot = z.infer<typeof snapshotSchema>;
export type Snapshot = Omit<ParsedSnapshot, 'games' | 'tracks' | 'records'> & {
  games: Game[];
  tracks: Track[];
  records: DrawRecord[];
};
export const defaultRules: Rules = {
  rarities: [
    { name: 'SSR', rate: 2 },
    { name: 'SR', rate: 18 },
    { name: 'R', rate: 80 },
  ],
  hardPity: 0,
  softStart: 0,
  softStep: 0,
  upRate: 50,
  guaranteeAfterLoss: false,
  tenPullLayout: 'row',
  linkLastFour: false,
  setPitySteps: [],
  tenGuarantee: '',
  notes: '',
};
export const emptyBaseline: Baseline = {
  counts: {},
  pity: 0,
  up: 0,
  off: 0,
  guaranteed: false,
  intervals: [],
  secondaryPity: 0,
  secondaryIntervals: [],
  secondaryUp: 0,
  secondaryOff: 0,
  secondaryGuaranteed: false,
};
export function validateTrack(t: Track | z.infer<typeof trackSchema>) {
  const names = t.rules.rarities.map((x) => x.name);
  const top = t.baseline.counts[names[0]] || 0;
  if (Object.keys(t.baseline.counts).some((x) => !names.includes(x)))
    throw new Error('歷史資料含未定義的稀有度');
  if (t.baseline.up + t.baseline.off > top)
    throw new Error('歷史 UP 與歪的數量不可超過最高稀有度數量');
  const total = Object.values(t.baseline.counts).reduce((a, b) => a + b, 0);
  if (t.baseline.pity !== null && t.baseline.pity > total)
    throw new Error('歷史墊抽不可超過歷史總抽數');
  if (t.baseline.secondaryPity != null && t.baseline.secondaryPity > total)
    throw new Error('第二列歷史墊抽不可超過歷史總抽數');
  if (t.baseline.intervals.length > top) throw new Error('歷史出貨間隔筆數不可超過最高稀有度數量');
  if ((t.baseline.secondaryIntervals ?? []).length > top)
    throw new Error('第二列歷史出貨間隔筆數不可超過最高稀有度數量');
  if ((t.baseline.secondaryUp ?? 0) + (t.baseline.secondaryOff ?? 0) > top)
    throw new Error('第二列歷史 UP 與歪的數量不可超過最高稀有度數量');
}
export function validateRecord(r: DrawRecord | z.infer<typeof recordSchema>, t: Track) {
  const names = t.rules.rarities.map((x) => x.name);
  if (r.kind === 'cycle_reset') {
    if (!t.rules.linkLastFour) throw new Error('只有同色套裝卡池可以重置套裝輪次');
    return;
  }
  for (const x of r.results) {
    if (!names.includes(x.rarity)) throw new Error('紀錄含未定義的稀有度');
    if (x.rarity !== names[0] && x.outcome !== 'unknown')
      throw new Error('只有最高稀有度能標示 UP／歪');
  }
  if (
    r.tenPull?.setOutcome &&
    r.tenPull.setOutcome !== 'unknown' &&
    (!r.tenPull.linkedLastFour || r.tenPull.setRarity !== names[0])
  )
    throw new Error('只有最高稀有度同色套裝能標示套裝 UP／歪');
}
export function validateSnapshot(s: Snapshot) {
  for (const items of [s.games, s.tracks, s.records])
    if (new Set(items.map((x) => x.id)).size !== items.length) throw new Error('備份內 ID 重複');
  if (new Set(s.records.map((x) => x.seq)).size !== s.records.length)
    throw new Error('備份內紀錄序號重複');
  const games = new Set(s.games.map((x) => x.id));
  const tracks = new Map(s.tracks.map((x) => [x.id, x]));
  for (const t of s.tracks) {
    if (!games.has(t.gameId)) throw new Error('找不到對應遊戲');
    validateTrack(t);
  }
  for (const r of s.records) {
    const t = tracks.get(r.trackId);
    if (!t) throw new Error('找不到對應卡池');
    validateRecord(r, t);
  }
  validateGroups(s.tracks);
}
export function groupKey(t: Track) {
  return JSON.stringify([t.gameId, t.server, t.account, t.pityGroup || t.id]);
}
export function validateGroups(tracks: Track[]) {
  const groups = new Map<string, Track[]>();
  for (const t of tracks) {
    const k = groupKey(t);
    groups.set(k, [...(groups.get(k) || []), t]);
  }
  for (const g of groups.values())
    if (g.length > 1) {
      if (g.some((t) => JSON.stringify(t.rules) !== JSON.stringify(g[0].rules)))
        throw new Error('共用保底的卡池必須使用完全相同的規則');
      if (
        g.some(
          (t) =>
            Object.values(t.baseline.counts).some((n) => n > 0) ||
            t.baseline.pity !== 0 ||
            t.baseline.guaranteed !== false,
        )
      )
        throw new Error('第一版共用保底限從零開始；含歷史起始資料的卡池請獨立計數');
    }
}
