import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Trash2, ArrowDown } from 'lucide-react';
import { Button } from './components/ui/button';
import { Sheet } from './components/ui/sheet';
import { api, localTime, uploadGameIcon } from './api';
import {
  defaultRules,
  emptyBaseline,
  type Track,
  type DrawRecord,
  type Rules,
  type Baseline,
  type Game,
} from '../shared/model';
import { linkedSetState } from '../shared/stats';
import { rarityClass } from '../shared/pools';
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function GameForm({
  game,
  games,
  close,
  saved,
}: {
  game?: Game;
  games: Game[];
  close: () => void;
  saved: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(game?.name || '');
  const [position, setPosition] = useState(
    game ? Math.max(1, games.findIndex((item) => item.id === game.id) + 1) : games.length + 1,
  );
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!iconFile) {
      setIconPreview('');
      return;
    }
    const url = URL.createObjectURL(iconFile);
    setIconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [iconFile]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (iconFile && iconFile.size > 2 * 1024 * 1024) throw new Error('遊戲圖示不可超過 2 MB');
      const data = await api<{ id: string }>(
        game ? `/games/${game.id}` : '/games',
        game ? 'PUT' : 'POST',
        game ? { name, position } : { name },
      );
      const id = game?.id || data.id;
      if (iconFile) await uploadGameIcon(id, iconFile);
      await saved(id);
      close();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={close}
      title={game ? '編輯遊戲' : '新增遊戲'}
      description="每個遊戲擁有自己的伺服器、帳號與卡池。"
    >
      <form onSubmit={submit} className="form-body">
        <Field label="遊戲名稱">
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：鋼嵐"
            maxLength={80}
          />
        </Field>
        <Field
          label="遊戲圖示"
          hint="支援 PNG、JPG、WebP，最大 2 MB；檔案會保存在 /data/game-icons。"
        >
          <div className="game-icon-picker">
            {(iconPreview || game?.icon) && (
              <img
                src={iconPreview || `/api/game-icons/${encodeURIComponent(game?.icon || '')}`}
                alt="遊戲圖示預覽"
              />
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setIconFile(e.target.files?.[0] || null)}
            />
          </div>
        </Field>
        {game && games.length > 1 && (
          <Field label="顯示順序" hint="1 代表最前面；新遊戲預設放在最後。">
            <select value={position} onChange={(e) => setPosition(Number(e.target.value))}>
              {games.map((_, index) => (
                <option key={index} value={index + 1}>
                  第 {index + 1} 個
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorText error={error} />
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button disabled={busy}>儲存遊戲</Button>
        </div>
      </form>
    </Sheet>
  );
}
export function TrackForm({
  gameId,
  track,
  templates,
  close,
  saved,
}: {
  gameId: string;
  track?: Track;
  templates: Track[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [server, setServer] = useState(track?.server || '台服'),
    [account, setAccount] = useState(track?.account || '主帳號'),
    [pool, setPool] = useState(track?.pool || ''),
    [group, setGroup] = useState(track?.pityGroup || '');
  const [rules, setRules] = useState<Rules>(structuredClone(track?.rules || defaultRules));
  const [setPityStepsText, setSetPityStepsText] = useState(
    (track?.rules.setPitySteps ?? []).join(','),
  );
  const [baseline, setBaseline] = useState<Baseline>(
    structuredClone(track?.baseline || emptyBaseline),
  );
  const [history, setHistory] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const patch = (v: Partial<Rules>) => setRules({ ...rules, ...v });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const stepTokens = setPityStepsText.trim() ? setPityStepsText.trim().split(/[,，\s]+/) : [];
      if (stepTokens.some((value) => !/^\d+$/.test(value) || Number(value) < 1))
        throw new Error('套裝保底請輸入正整數，並用逗號分隔，例如：9,12,15');
      const submittedRules = { ...rules, setPitySteps: stepTokens.map(Number) };
      await api(track?.id ? `/tracks/${track.id}` : '/tracks', track?.id ? 'PUT' : 'POST', {
        gameId,
        server,
        account,
        pool,
        pityGroup: group,
        poolNames: track?.poolNames,
        rules: submittedRules,
        baseline,
      });
      await saved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={close}
      title={track?.id ? '編輯卡池與規則' : '新增帳號卡池'}
      description="一列代表一個伺服器／帳號／卡池；規則可從其他列複製。"
    >
      <form className="form-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="伺服器">
            <input
              required
              value={server}
              onChange={(e) => setServer(e.target.value)}
              list="servers"
            />
          </Field>
          <Field label="帳號">
            <input
              required
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              list="accounts"
            />
          </Field>
        </div>
        <datalist id="servers">
          {[...new Set(templates.map((t) => t.server))].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </datalist>
        <datalist id="accounts">
          {[...new Set(templates.map((t) => t.account))].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </datalist>
        <Field label="卡池名稱">
          <input
            required
            value={pool}
            onChange={(e) => setPool(e.target.value)}
            placeholder="例如：機師招募"
          />
        </Field>
        <div className="section-title">
          機率與規則 <span>第一列為最高稀有度</span>
        </div>
        {templates.length > 0 && (
          <Field label="套用既有規則">
            <select
              value=""
              onChange={(e) => {
                const t = templates.find((t) => t.id === e.target.value);
                if (t) {
                  setRules(structuredClone(t.rules));
                  setSetPityStepsText((t.rules.setPitySteps ?? []).join(','));
                }
              }}
            >
              <option value="">選擇卡池作為範本…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.server} / {t.account} / {t.pool}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="rarity-editor">
          <div className="subtle">名稱</div>
          <div className="subtle">基礎機率 %</div>
          <span />
          {rules.rarities.map((r, i) => (
            <div className="contents" key={i}>
              <input
                aria-label={`稀有度 ${i + 1}`}
                required
                value={r.name}
                onChange={(e) =>
                  patch({
                    rarities: rules.rarities.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
              <input
                aria-label={`${r.name} 機率`}
                type="number"
                min="0"
                max="100"
                step="0.001"
                required
                value={r.rate}
                onChange={(e) =>
                  patch({
                    rarities: rules.rarities.map((x, j) =>
                      j === i ? { ...x, rate: Number(e.target.value) } : x,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`移除稀有度 ${i + 1}`}
                disabled={rules.rarities.length <= 2}
                onClick={() => patch({ rarities: rules.rarities.filter((_, j) => j !== i) })}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rules.rarities.length >= 8}
            onClick={() => patch({ rarities: [...rules.rarities, { name: '新稀有度', rate: 0 }] })}
          >
            <Plus />
            稀有度
          </Button>
          <small>合計 {rules.rarities.reduce((s, x) => s + x.rate, 0).toFixed(3)}%</small>
        </div>
        <div className="form-grid">
          <Field label="硬保底抽數" hint="0 表示未設定">
            <input
              type="number"
              min="0"
              value={rules.hardPity}
              onChange={(e) => patch({ hardPity: Number(e.target.value) })}
            />
          </Field>
          <Field label="出貨時 UP 機率 %">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={rules.upRate}
              onChange={(e) => patch({ upRate: Number(e.target.value) })}
            />
          </Field>
          <Field label="軟保底起始抽數" hint="該抽起開始增加機率；0 關閉">
            <input
              type="number"
              min="0"
              value={rules.softStart}
              onChange={(e) => patch({ softStart: Number(e.target.value) })}
            />
          </Field>
          <Field label="每抽增加百分點" hint="例如 6 代表增加 6 個百分點">
            <input
              type="number"
              min="0"
              max="100"
              step="0.001"
              value={rules.softStep}
              onChange={(e) => patch({ softStep: Number(e.target.value) })}
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={rules.inheritPity ?? true}
            disabled={rules.linkLastFour}
            onChange={(e) => patch({ inheritPity: e.target.checked })}
          />
          換池時繼承保底（墊抽與必 UP）
        </label>
        <p className="help">
          關閉時新池從零開始，切回舊池恢復該池進度；機甲同色套裝仍依共用標記與各池獨立階段計算。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={rules.guaranteeAfterLoss}
            onChange={(e) => patch({ guaranteeAfterLoss: e.target.checked })}
          />
          歪後，下次最高稀有度必為 UP
        </label>
        <div className="section-title">
          快速十抽 <span>只影響輸入排列，資料仍按第 1～10 抽保存</span>
        </div>
        <Field label="十抽排列方式">
          <select
            value={rules.tenPullLayout ?? 'row'}
            onChange={(e) => patch({ tenPullLayout: e.target.value as Rules['tenPullLayout'] })}
          >
            <option value="row">標準：1 2 3 4 5／6 7 8 9 10</option>
            <option value="column">交錯：1 3 5 7 9／2 4 6 8 10</option>
          </select>
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={rules.linkLastFour ?? false}
            onChange={(e) => patch({ linkLastFour: e.target.checked })}
          />
          快速十抽預設連動第 7～10 抽（同色套裝），總覽顯示第二列
        </label>
        {rules.linkLastFour && (
          <Field
            label="套裝保底（十抽次數）"
            hint="依序套用，最後一個會持續循環；鋼嵐機甲請填 9,12,15"
          >
            <input
              value={setPityStepsText}
              onChange={(e) => setSetPityStepsText(e.target.value)}
              inputMode="numeric"
              placeholder="例如：9,12,15"
            />
          </Field>
        )}
        <Field
          label="保底共用群組（選填）"
          hint="同遊戲、伺服器、帳號內，相同名稱共用墊抽。第一版限無歷史起始資料且規則完全相同的卡池。"
        >
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="留空則獨立；例如：限定角色池"
          />
        </Field>
        <Field label="十抽／特殊保底說明" hint="第一版僅保存此說明，不自動推算特殊保底。">
          <input
            value={rules.tenGuarantee}
            onChange={(e) => patch({ tenGuarantee: e.target.value })}
            placeholder="例如：每十抽至少一張 SR"
          />
        </Field>
        <Field label="額外機制與備註">
          <textarea
            rows={2}
            value={rules.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="例如：累積 180 抽可兌換；額外贈送請記為獎勵"
          />
        </Field>
        <button
          className="section-title w-full text-left"
          type="button"
          onClick={() => setHistory(!history)}
        >
          歷史起始資料{' '}
          <span>
            {history ? '收合' : '展開設定'} <ArrowDown size={12} className="inline" />
          </span>
        </button>
        {history && (
          <>
            <p className="help">
              把 Sheet 的累計填在這裡。之後新增的紀錄會往上累加；歷史不會被捏造成逐抽紀錄。
            </p>
            <div className="form-grid">
              {rules.rarities.map((r) => (
                <Field key={r.name} label={`${r.name} 歷史數量`}>
                  <input
                    type="number"
                    min="0"
                    value={baseline.counts[r.name] || 0}
                    onChange={(e) =>
                      setBaseline({
                        ...baseline,
                        counts: { ...baseline.counts, [r.name]: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
              ))}
              <Field
                label={rules.linkLastFour ? '套裝目前進度（抽數）' : '目前墊抽'}
                hint="留空代表未知"
              >
                <input
                  type="number"
                  min="0"
                  value={baseline.pity ?? ''}
                  onChange={(e) =>
                    setBaseline({
                      ...baseline,
                      pity: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label={rules.linkLastFour ? '套裝歷史 UP 數量' : '歷史 UP 數量'}>
                <input
                  type="number"
                  min="0"
                  value={baseline.up}
                  onChange={(e) => setBaseline({ ...baseline, up: Number(e.target.value) })}
                />
              </Field>
              <Field label={rules.linkLastFour ? '套裝歷史歪的數量' : '歷史歪的數量'}>
                <input
                  type="number"
                  min="0"
                  value={baseline.off}
                  onChange={(e) => setBaseline({ ...baseline, off: Number(e.target.value) })}
                />
              </Field>
              <Field label={rules.linkLastFour ? '套裝起始大保底狀態' : '起始大保底狀態'}>
                <select
                  value={String(baseline.guaranteed)}
                  onChange={(e) =>
                    setBaseline({
                      ...baseline,
                      guaranteed: e.target.value === 'null' ? null : e.target.value === 'true',
                    })
                  }
                >
                  <option value="false">非必 UP</option>
                  <option value="true">下次必 UP</option>
                  <option value="null">未知</option>
                </select>
              </Field>
            </div>
            <Field
              label={rules.linkLastFour ? '套裝已知間隔（舊 → 新）' : '已知出貨間隔（舊 → 新）'}
              hint="用逗號分隔，例如 50,12,45,49"
            >
              <input
                defaultValue={baseline.intervals.join(',')}
                onBlur={(e) =>
                  setBaseline({
                    ...baseline,
                    intervals: e.target.value.trim()
                      ? e.target.value.split(/[,，\s]+/).map(Number)
                      : [],
                  })
                }
              />
            </Field>
            {rules.linkLastFour && (
              <>
                <div className="section-title">
                  {pool || '卡池'}抽墊底 <span>一般 SSR 的 55 抽保底第二列</span>
                </div>
                <Field label="第二列目前墊抽" hint="例如目前尚未出 SSR 已累積 30 抽">
                  <input
                    type="number"
                    min="0"
                    value={baseline.secondaryPity ?? ''}
                    onChange={(e) =>
                      setBaseline({
                        ...baseline,
                        secondaryPity: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="第二列已知間隔（舊 → 新）"
                  hint="照 Sheet 第二行輸入，例如 9,41,56,46,30"
                >
                  <input
                    defaultValue={(baseline.secondaryIntervals ?? []).join(',')}
                    onBlur={(e) =>
                      setBaseline({
                        ...baseline,
                        secondaryIntervals: e.target.value.trim()
                          ? e.target.value.split(/[,，\s]+/).map(Number)
                          : [],
                      })
                    }
                  />
                </Field>
                <div className="form-grid">
                  <Field label="第二列歷史 UP 數量">
                    <input
                      type="number"
                      min="0"
                      value={baseline.secondaryUp ?? 0}
                      onChange={(e) =>
                        setBaseline({ ...baseline, secondaryUp: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="第二列歷史歪的數量">
                    <input
                      type="number"
                      min="0"
                      value={baseline.secondaryOff ?? 0}
                      onChange={(e) =>
                        setBaseline({ ...baseline, secondaryOff: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="第二列起始大保底狀態">
                    <select
                      value={String(baseline.secondaryGuaranteed ?? false)}
                      onChange={(e) =>
                        setBaseline({
                          ...baseline,
                          secondaryGuaranteed:
                            e.target.value === 'null' ? null : e.target.value === 'true',
                        })
                      }
                    >
                      <option value="false">非必 UP</option>
                      <option value="true">下次必 UP</option>
                      <option value="null">未知</option>
                    </select>
                  </Field>
                </div>
              </>
            )}
          </>
        )}
        {track && (
          <p className="help">
            修改規則會重新解讀此卡池全部紀錄；活動規則不同時，請新增卡池。已有紀錄不能改稀有度名稱或順序。
          </p>
        )}
        <ErrorText error={error} />
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button disabled={busy}>儲存卡池</Button>
        </div>
      </form>
    </Sheet>
  );
}
export function RecordForm({
  track,
  record,
  close,
  saved,
}: {
  track: Track;
  record?: DrawRecord;
  close: () => void;
  saved: (id: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'single' | 'batch'>(record ? 'batch' : 'single'),
    [rarity, setRarity] = useState(track.rules.rarities.at(-1)!.name),
    [quantity, setQuantity] = useState(1),
    [outcome, setOutcome] = useState('unknown');
  const [at, setAt] = useState(localTime(record?.at)),
    [kind, setKind] = useState(record?.kind || 'draw'),
    [ordered, setOrdered] = useState(record?.ordered ?? true),
    [note, setNote] = useState(record?.note || '');
  const [lines, setLines] = useState(
    record
      ? record.results.map((x) => `${x.rarity},${x.count},${x.outcome}`).join('\n')
      : `${track.rules.rarities.at(-1)!.name},8\n${track.rules.rarities[0].name},1,up\n${track.rules.rarities[1].name},1`,
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const results =
        mode === 'single'
          ? [
              {
                rarity,
                count: quantity,
                outcome: rarity === track.rules.rarities[0].name ? outcome : 'unknown',
              },
            ]
          : lines
              .trim()
              .split('\n')
              .filter((x) => x.trim())
              .map((line) => {
                const [rarity, count, outcome = 'unknown'] = line
                  .split(/[,，]/)
                  .map((x) => x.trim());
                return { rarity, count: Number(count), outcome };
              });
      const data = await api<{ id: string }>(
        record ? `/records/${record.id}` : '/records',
        record ? 'PUT' : 'POST',
        {
          trackId: track.id,
          at: new Date(at).toISOString(),
          kind,
          ordered: mode === 'single' || ordered,
          results,
          note,
        },
      );
      await saved(data.id);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={close}
      title={record ? '編輯抽卡紀錄' : '記一筆抽卡'}
      description={`${track.server} / ${track.account} / ${track.pool}`}
    >
      <form onSubmit={submit} className="form-body">
        <div className="segmented">
          <button
            type="button"
            className={mode === 'single' ? 'active' : ''}
            onClick={() => setMode('single')}
          >
            單一結果
          </button>
          <button
            type="button"
            className={mode === 'batch' ? 'active' : ''}
            onClick={() => setMode('batch')}
          >
            混合批次
          </button>
        </div>
        <div className="form-grid">
          <Field label="抽卡時間">
            <input
              type="datetime-local"
              required
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </Field>
          <Field label="紀錄類型">
            <select value={kind} onChange={(e) => setKind(e.target.value as 'draw' | 'reward')}>
              <option value="draw">抽卡（計入機率）</option>
              <option value="reward">額外獎勵（不計抽數）</option>
            </select>
          </Field>
        </div>
        {mode === 'single' ? (
          <>
            <div className="form-grid">
              <Field label="稀有度">
                <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
                  {track.rules.rarities.map((r) => (
                    <option key={r.name}>{r.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="本次數量">
                <input
                  autoFocus
                  type="number"
                  required
                  min="1"
                  max="100000"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              {[1, 10, 20, 50].map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
            {rarity === track.rules.rarities[0].name && (
              <Field label="出貨結果（套用本筆全部最高稀有度）">
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="unknown">未註明</option>
                  <option value="up">UP／不歪</option>
                  <option value="off">歪</option>
                </select>
              </Field>
            )}
          </>
        ) : (
          <>
            <Field
              label="每行：稀有度, 數量, 結果"
              hint="結果可省略，或填 up（不歪）、off（歪）、unknown。"
            >
              <textarea
                className="code-input"
                rows={8}
                value={lines}
                onChange={(e) => setLines(e.target.value)}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={ordered}
                onChange={(e) => setOrdered(e.target.checked)}
              />
              已知順序：每行依序發生，同一行為連續相同結果
            </label>
            <p className="help">
              如果只知道十連的總數，請取消勾選。有最高稀有度而順序未知時，墊抽將標為未知，直到下一次已知位置的出貨。
            </p>
          </>
        )}
        <Field label="角色／備註（選填）">
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：抽到本期限定角色"
          />
        </Field>
        <ErrorText error={error} />
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button disabled={busy}>{record ? '儲存修改' : '新增紀錄'}</Button>
        </div>
      </form>
    </Sheet>
  );
}

export function SetCycleForm({
  track,
  records,
  record,
  close,
  saved,
}: {
  track: Track;
  records: DrawRecord[];
  record?: DrawRecord;
  close: () => void;
  saved: (id: string) => Promise<void>;
}) {
  const trackRecords = records.filter((item) => item.trackId === track.id);
  const priorRecords = trackRecords.filter(
    (item) =>
      item.id !== record?.id &&
      (!record || item.at < record.at || (item.at === record.at && item.seq < record.seq)),
  );
  const current = linkedSetState(track, priorRecords);
  const nextNumber = (current?.pools.length ?? 1) + 1;
  const defaultName = `卡池${nextNumber}`;
  const pools = [...(current?.pools ?? [])];
  const editedId = record?.setPool?.id ?? record?.id;
  if (editedId && !pools.some((pool) => pool.id === editedId))
    pools.push({
      id: editedId,
      name: record!.note,
      setCount: 0,
      guaranteed: false,
      target: (track.rules.setPitySteps?.[0] ?? 9) * 10,
    });
  const [poolId, setPoolId] = useState(editedId ?? current?.cycleId ?? 'initial');
  const selectedPool = pools.find((pool) => pool.id === poolId);
  const [name, setName] = useState(record?.note || '');
  const [calibrate, setCalibrate] = useState(
    !current?.marksMode ||
      !!(
        record?.setPool &&
        ('marks' in record.setPool || 'stage' in record.setPool || 'guaranteed' in record.setPool)
      ),
  );
  const [marks, setMarks] = useState<string>(
    String(
      record?.setPool?.marks !== undefined ? (record.setPool.marks ?? '') : (current?.marks ?? ''),
    ),
  );
  const [stage, setStage] = useState(record?.setPool?.stage ?? selectedPool?.setCount ?? 0);
  const [guaranteed, setGuaranteed] = useState(
    String(
      record?.setPool?.guaranteed !== undefined
        ? (record.setPool.guaranteed ?? 'unknown')
        : (selectedPool?.guaranteed ?? 'unknown'),
    ),
  );
  const [at, setAt] = useState(localTime(record?.at));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const poolName = poolId === 'new' ? name.trim() || defaultName : selectedPool?.name;
      if (!poolName) throw new Error('請選擇套裝池');
      if (poolId === 'new' && pools.some((pool) => pool.name === poolName))
        throw new Error('名稱已存在，請從下拉選單選擇舊池');
      const data = await api<{ id: string }>(
        record ? `/records/${record.id}` : '/records',
        record ? 'PUT' : 'POST',
        {
          trackId: track.id,
          at: new Date(at).toISOString(),
          kind: 'cycle_reset',
          setPool: {
            ...(poolId === 'new' ? { create: true } : { id: poolId }),
            ...(calibrate
              ? {
                  marks: marks.trim() === '' ? null : Number(marks),
                  stage,
                  guaranteed: guaranteed === 'unknown' ? null : guaranteed === 'true',
                }
              : {}),
          },
          ordered: true,
          tenPull: null,
          results: [],
          note: poolName,
        },
      );
      await saved(data.id);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={close}
      title={record ? '編輯套裝池切換' : '切換套裝池'}
      description={`${track.server} / ${track.account} / ${track.pool}`}
    >
      <form onSubmit={submit} className="form-body">
        <p className="help">
          目前：{current?.cycleName || `${track.pool}1`}；共用保障標記 {current?.marks ?? '未知'}{' '}
          個。 切回舊池會恢復該池的階段與整機必 UP 狀態，新池從第一階段開始。累計抽數、出貨歷史與{' '}
          {track.rules.hardPity || 55} 抽墊底進度保留。
        </p>
        {!current?.marksMode && (
          <p className="help">
            首次切換會啟用保障標記計算。舊版的 {current?.pity ?? '未知'}{' '}
            抽進度只能換算成參考值，請對照遊戲校正；已累積的抽卡資料不會清除。
          </p>
        )}
        <Field label="套裝池">
          <select
            value={poolId}
            onChange={(e) => {
              setPoolId(e.target.value);
              const pool = pools.find((item) => item.id === e.target.value);
              setStage(pool?.setCount ?? 0);
              setGuaranteed(
                pool?.guaranteed === null ? 'unknown' : String(pool?.guaranteed ?? false),
              );
            }}
          >
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name} · {pool.target ? `${pool.target / 10} 次十連` : '未設定門檻'}
                {pool.id === current?.cycleId ? '（目前）' : ''}
              </option>
            ))}
            <option value="new">＋ 新增套裝池</option>
          </select>
        </Field>
        {poolId === 'new' && (
          <Field label="新套裝名稱（選填）" hint={`留空會自動使用「${defaultName}」`}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName}
              maxLength={80}
            />
          </Field>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={calibrate}
            onChange={(e) => setCalibrate(e.target.checked)}
          />
          校正進度（首次更新或補登舊池）
        </label>
        {calibrate && (
          <>
            <Field
              label="共用保障標記"
              hint="填遊戲目前的標記數量；不是累計抽數，也不是 55 抽墊底。留空代表未知。"
            >
              <input
                type="number"
                min="0"
                max="10000000"
                step="1"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
              />
            </Field>
            <Field label="此池目前保底階段">
              <select
                value={Math.min(stage, Math.max(0, (track.rules.setPitySteps?.length ?? 1) - 1))}
                onChange={(e) => setStage(Number(e.target.value))}
              >
                {(track.rules.setPitySteps ?? []).map((value, index) => (
                  <option key={index} value={index}>
                    {value} 次十連（{value * 10} 抽）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="此池整機下次必 UP">
              <select value={guaranteed} onChange={(e) => setGuaranteed(e.target.value)}>
                <option value="false">否</option>
                <option value="true">是</option>
                <option value="unknown">未知</option>
              </select>
            </Field>
            <p className="help">校正會另存一筆切換紀錄，可編輯或刪除；不修改以前的抽卡紀錄。</p>
          </>
        )}
        <Field label="切換時間">
          <input
            type="datetime-local"
            required
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button disabled={busy}>
            {record ? '儲存修改' : poolId === 'new' ? '新增並切換' : '切換到此池'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

type TenPullSlot = {
  rarity: string;
  outcome: 'unknown' | 'up' | 'off';
};

export function QuickTenForm({
  track,
  records,
  record,
  close,
  saved,
}: {
  track: Track;
  records: DrawRecord[];
  record?: DrawRecord;
  close: () => void;
  saved: (id: string) => Promise<void>;
}) {
  const lowest = track.rules.rarities.at(-1)!.name;
  const top = track.rules.rarities[0].name;
  const previousRecords = records.filter(
    (item) =>
      item.trackId === track.id &&
      item.id !== record?.id &&
      (!record || item.at < record.at || (item.at === record.at && item.seq < record.seq)),
  );
  const previousSetState = linkedSetState(track, previousRecords);
  const initialSlots = record
    ? record.results.flatMap((x) =>
        Array.from({ length: x.count }, () => ({
          rarity: x.rarity,
          outcome: x.outcome,
        })),
      )
    : Array.from({ length: 10 }, () => ({
        rarity: lowest,
        outcome: 'unknown' as const,
      }));
  const [slots, setSlots] = useState<TenPullSlot[]>(
    initialSlots.length === 10
      ? initialSlots
      : Array.from({ length: 10 }, () => ({ rarity: lowest, outcome: 'unknown' })),
  );
  const [linked, setLinked] = useState(
    record?.tenPull?.linkedLastFour ?? track.rules.linkLastFour ?? false,
  );
  const [setOutcome, setSetOutcome] = useState<'unknown' | 'up' | 'off' | 'normal'>(
    record?.tenPull?.setOutcome === 'up' ||
      record?.tenPull?.setOutcome === 'off' ||
      record?.tenPull?.setOutcome === 'normal'
      ? record.tenPull.setOutcome
      : previousSetState?.guaranteed
        ? 'normal'
        : 'unknown',
  );
  const [at, setAt] = useState(localTime(record?.at));
  const [note, setNote] = useState(record?.note || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const layout = track.rules.tenPullLayout ?? 'row';
  const order =
    layout === 'column' ? [0, 2, 4, 6, 8, 1, 3, 5, 7, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const hasTopSet = linked && slots[6].rarity === top;
  const initialGuaranteedSet =
    hasTopSet &&
    (record?.tenPull?.setOutcome === 'initial' ||
      (previousSetState?.target === 90 && previousSetState.setCount === 0));
  const effectiveSetOutcome = initialGuaranteedSet ? 'initial' : setOutcome;

  function setSlotRarity(position: number, rarity: string) {
    if (linked && position >= 6 && rarity !== top) setSetOutcome('unknown');
    setSlots((current) =>
      current.map((slot, index) =>
        linked && position >= 6 && index >= 6
          ? { rarity, outcome: 'unknown' }
          : index === position
            ? { rarity, outcome: rarity === top ? slot.outcome : 'unknown' }
            : slot,
      ),
    );
  }
  function cycle(position: number) {
    const current = track.rules.rarities.findIndex((x) => x.name === slots[position].rarity);
    const next = (current - 1 + track.rules.rarities.length) % track.rules.rarities.length;
    setSlotRarity(position, track.rules.rarities[next].name);
  }
  function toggleLinked(value: boolean) {
    setLinked(value);
    if (value) {
      const rarity = slots[6].rarity;
      setSlots((current) =>
        current.map((slot, index) => (index >= 6 ? { rarity, outcome: 'unknown' } : slot)),
      );
    }
  }
  function reset() {
    setSlots(Array.from({ length: 10 }, () => ({ rarity: lowest, outcome: 'unknown' })));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ id: string }>(
        record ? `/records/${record.id}` : '/records',
        record ? 'PUT' : 'POST',
        {
          trackId: track.id,
          at: new Date(at).toISOString(),
          kind: 'draw',
          ordered: true,
          tenPull: {
            linkedLastFour: linked,
            setRarity: linked ? slots[6].rarity : null,
            setOutcome: hasTopSet ? effectiveSetOutcome : 'unknown',
          },
          results: slots.map((slot, position) => ({
            rarity: slot.rarity,
            count: 1,
            outcome:
              linked && position >= 6 ? 'unknown' : slot.rarity === top ? slot.outcome : 'unknown',
          })),
          note,
        },
      );
      await saved(data.id);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const summary = track.rules.rarities
    .map((rarity) => ({
      name: rarity.name,
      count: slots.filter((slot) => slot.rarity === rarity.name).length,
    }))
    .filter((x) => x.count > 0);

  return (
    <Sheet
      open
      onClose={close}
      title={record ? '編輯快速十抽' : '快速記錄十抽'}
      description={`${track.server} / ${track.account} / ${track.pool}${previousSetState ? ` · ${previousSetState.cycleName}` : ''}`}
    >
      <form onSubmit={submit} className="form-body">
        <Field label="抽卡時間">
          <input
            type="datetime-local"
            required
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </Field>
        <div className="ten-pull-toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={linked}
              onChange={(e) => toggleLinked(e.target.checked)}
            />
            第 7～10 抽同色套裝
          </label>
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            全部重設為 {lowest}
          </Button>
        </div>
        <div className={`ten-pull-grid layout-${layout}`}>
          {order.map((position) => {
            const slot = slots[position];
            const rarityIndex = track.rules.rarities.findIndex((x) => x.name === slot.rarity);
            return (
              <button
                key={position}
                type="button"
                className={`ten-pull-slot ${rarityClass(rarityIndex, track.rules.rarities.length)} ${
                  linked && position >= 6 ? 'linked-set' : ''
                }`}
                onClick={() => cycle(position)}
                title={`第 ${position + 1} 抽；點擊切換稀有度`}
              >
                <small>{position + 1}</small>
                <strong>{slot.rarity}</strong>
              </button>
            );
          })}
        </div>
        {linked && (
          <div className="set-rarity-buttons">
            <span>套裝：</span>
            {[...track.rules.rarities].reverse().map((rarity) => (
              <Button
                key={rarity.name}
                type="button"
                size="sm"
                variant={slots[6].rarity === rarity.name ? 'default' : 'outline'}
                onClick={() => setSlotRarity(6, rarity.name)}
              >
                {rarity.name} ×4
              </Button>
            ))}
          </div>
        )}
        <div className="ten-pull-summary">
          {summary.map((x) => (
            <span key={x.name}>
              {x.name} ×{x.count}
            </span>
          ))}
          <strong>合計 10 抽</strong>
        </div>
        {slots.some((slot) => slot.rarity === top) && (
          <details className="ten-pull-outcomes">
            <summary>設定 {top} 的 UP／歪（選填）</summary>
            {hasTopSet &&
              (initialGuaranteedSet ? (
                <p className="help">此池首次 SSR 套裝必定 UP，本次不列入套裝 UP／歪統計。</p>
              ) : (
                <Field label={`同色套裝 ${top}`}>
                  <select
                    value={effectiveSetOutcome}
                    onChange={(e) =>
                      setSetOutcome(e.target.value as 'unknown' | 'up' | 'off' | 'normal')
                    }
                  >
                    <option value="unknown">未註明</option>
                    <option value="normal">正常／保底兌現（不計 UP／歪）</option>
                    <option value="up">UP／不歪</option>
                    <option value="off">歪</option>
                  </select>
                  {previousSetState?.guaranteed && (
                    <small>上次套裝歪，本次預設為正常／保底兌現；仍可手動修改。</small>
                  )}
                </Field>
              ))}
            {slots.map(
              (slot, position) =>
                slot.rarity === top &&
                !(linked && position >= 6) && (
                  <Field key={position} label={`第 ${position + 1} 抽 ${top}`}>
                    <select
                      value={slot.outcome}
                      onChange={(e) =>
                        setSlots((current) =>
                          current.map((x, index) =>
                            index === position
                              ? {
                                  ...x,
                                  outcome: e.target.value as TenPullSlot['outcome'],
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="unknown">未註明</option>
                      <option value="up">UP／不歪</option>
                      <option value="off">歪</option>
                    </select>
                  </Field>
                ),
            )}
          </details>
        )}
        <Field label="角色／備註（選填）">
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：整套 SSR 保底與 55 抽保底同時觸發"
          />
        </Field>
        <ErrorText error={error} />
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button disabled={busy}>{record ? '儲存修改' : '記錄十抽'}</Button>
        </div>
      </form>
    </Sheet>
  );
}
