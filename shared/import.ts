import { trackSchema, validateTrack, type Rules, type Track } from './model.js';
// A deliberate header mapping keeps Google Sheets exports independent of column order.
export function parseBaselineTSV(text: string, gameId: string, rules: Rules) {
  const lines = text
    .replace(/^\ufeff/, '')
    .trim()
    .split(/\r?\n/);
  if (lines.length < 2) throw new Error('請貼上欄位標題與至少一列資料');
  const headers = lines[0].split('\t').map((x) => x.trim());
  const required = ['伺服器', '帳號', '卡池', ...rules.rarities.map((x) => x.name)];
  for (const h of required) if (!headers.includes(h)) throw new Error('缺少欄位：' + h);
  if (new Set(headers).size !== headers.length) throw new Error('欄位標題不可重複');
  const integer = (v: string, label: string) => {
    if (!/^\d+$/.test(v.replaceAll(',', ''))) throw new Error(label + ' 必須是非負整數');
    const n = Number(v.replaceAll(',', ''));
    if (!Number.isSafeInteger(n)) throw new Error(label + ' 數字過大');
    return n;
  };
  const rows = lines
    .slice(1)
    .filter((x) => x.trim())
    .map((line, i) => {
      try {
        const cells = line.split('\t');
        if (cells.length > headers.length) throw new Error('資料欄數超過標題');
        const get = (key: string) => cells[headers.indexOf(key)]?.trim() || '';
        const counts = Object.fromEntries(
          rules.rarities.map((r) => [r.name, integer(get(r.name) || '0', r.name)]),
        );
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (get('累計') && integer(get('累計'), '累計') !== total)
          throw new Error('累計與各稀有度數量合計不符');
        const intervals = get('出貨間隔')
          ? get('出貨間隔')
              .split(/[,， ]+/)
              .map((v) => integer(v, '出貨間隔'))
          : [];
        const guarantee = get('下次必UP');
        if (guarantee && !['是', '否', '未知'].includes(guarantee))
          throw new Error('下次必UP 請填 是、否 或 未知');
        const row = trackSchema.parse({
          gameId,
          server: get('伺服器'),
          account: get('帳號'),
          pool: get('卡池'),
          pityGroup: '',
          rules,
          baseline: {
            counts,
            pity: get('墊抽') ? integer(get('墊抽'), '墊抽') : null,
            up: integer(get('UP') || '0', 'UP'),
            off: integer(get('歪') || '0', '歪'),
            guaranteed: guarantee === '是' ? true : guarantee === '否' ? false : null,
            intervals,
          },
        });
        validateTrack(row);
        return row;
      } catch (e) {
        throw new Error(`第 ${i + 2} 行：${(e as Error).message}`);
      }
    });
  const keys = rows.map((t) => JSON.stringify([t.server, t.account, t.pool]));
  if (new Set(keys).size !== keys.length) throw new Error('貼入資料有重複的伺服器／帳號／卡池');
  return rows;
}
export function ensureUniqueTracks(tracks: Track[]) {
  const keys = tracks.map((t) => JSON.stringify([t.gameId, t.server, t.account, t.pool]));
  if (new Set(keys).size !== keys.length)
    throw new Error('已有相同的遊戲／伺服器／帳號／卡池；請修改名稱或編輯原卡池，避免重複匯入');
}
