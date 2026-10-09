import { useState, type FormEvent } from 'react';
import { Sheet } from './components/ui/sheet';
import { Button } from './components/ui/button';
import { Field } from './Forms';
import { api, localTime } from './api';
import type { Track, DrawRecord } from '../shared/model';
import { poolPeriods, rarityClass } from '../shared/pools';

export function DeleteConfirmation({
  title,
  description,
  endpoint,
  close,
  saved,
}: {
  title: string;
  description: string;
  endpoint: string;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== 'DELETE' || busy) return;
    setBusy(true);
    try {
      await api(endpoint, 'DELETE', { confirmation });
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
      title={title}
      description={description}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form className="form-body" onSubmit={submit}>
        <p className="help">
          將刪除這個項目及其全部抽取紀錄。刪除前會自動備份完整 DB，備份失敗則中止刪除。
        </p>
        <Field label="輸入 DELETE 確認刪除">
          <input
            autoFocus
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button type="submit" disabled={busy || confirmation !== 'DELETE'}>
            {busy ? '備份與刪除中…' : '確認刪除'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

export function PoolSwitchForm({
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
  const { activeId, periods } = poolPeriods(track, records);
  const [id, setId] = useState(record?.setPool?.id ?? activeId);
  const [name, setName] = useState('');
  const [at, setAt] = useState(localTime(record?.at));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const poolName = id === 'new' ? name.trim() : periods.find((p) => p.id === id)?.name;
      if (!poolName) throw new Error('請輸入卡池名稱');
      const result = await api<{ id: string }>(
        record ? `/records/${record.id}` : '/records',
        record ? 'PUT' : 'POST',
        {
          trackId: track.id,
          at: new Date(at).toISOString(),
          ordered: true,
          kind: 'cycle_reset',
          setPool: {
            ...(id === 'new' ? { create: true } : { id }),
            inherit: record?.setPool?.inherit ?? track.rules.inheritPity ?? true,
          },
          results: [],
          note: poolName,
        },
      );
      await saved(result.id);
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
      title={record ? '編輯換池紀錄' : '換池'}
      description={`${track.server} / ${track.account} / ${track.pool}`}
      onClose={close}
    >
      <form className="form-body" onSubmit={submit}>
        <p className="help">
          {track.rules.inheritPity !== false
            ? '換池時繼承目前墊抽與必 UP 狀態。'
            : '新池從零開始；切回舊池恢復該池最後的墊抽與必 UP 狀態。'}{' '}
          總累積與歷史紀錄保留。
        </p>
        <Field label="卡池">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === activeId ? '（目前）' : ''}
              </option>
            ))}
            <option value="new">＋ 新增卡池</option>
          </select>
        </Field>
        {id === 'new' && (
          <Field label="新卡池名稱／UP 角色">
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="切換時間">
          <input
            type="datetime-local"
            required
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button disabled={busy} type="submit">
            {id === 'new' ? '新增並切換' : '切換到此池'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

export function PoolManager({
  tracks,
  records,
  initialTrack,
  close,
  saved,
  switchPool,
}: {
  tracks: Track[];
  records: DrawRecord[];
  initialTrack?: string;
  close: () => void;
  saved: () => Promise<void>;
  switchPool: (track: Track) => void;
}) {
  const [trackId, setTrackId] = useState(initialTrack || tracks[0]?.id || '');
  const [periodId, setPeriodId] = useState('initial');
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const track = tracks.find((t) => t.id === trackId);
  const resolved = track ? poolPeriods(track, records) : null;
  const period = resolved?.periods.find((p) => p.id === periodId);
  async function rename(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/tracks/${trackId}/pools/${encodeURIComponent(id)}`, 'PUT', { name });
      await saved();
      setEditing('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title="卡池列表"
      description="管理各期 UP 卡池名稱，查看各期紀錄與統計。"
      onClose={close}
    >
      <div className="form-body">
        <Field label="帳號／卡池類型">
          <select
            value={trackId}
            onChange={(e) => {
              setTrackId(e.target.value);
              setPeriodId('initial');
              setEditing('');
              setPage(0);
            }}
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.server} / {t.account} / {t.pool}
              </option>
            ))}
          </select>
        </Field>
        {track && (
          <Button variant="outline" onClick={() => switchPool(track)}>
            換池／新增 UP 卡池
          </Button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {resolved?.periods.map((p) => (
          <div className="period-card" key={p.id}>
            {editing === p.id ? (
              <form
                className="period-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename(p.id);
                }}
              >
                <input
                  aria-label="卡池名稱"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Button type="submit" disabled={busy}>
                  儲存
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing('')}>
                  取消
                </Button>
              </form>
            ) : (
              <div className="period-heading">
                <strong>
                  {p.name}
                  {p.id === resolved.activeId ? ' · 目前' : ''}
                </strong>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(p.id);
                    setName(p.name);
                  }}
                >
                  編輯名稱
                </Button>
              </div>
            )}
            <p className="help">
              {p.stats.total.toLocaleString()} 抽 · {track?.rules.rarities[0].name}{' '}
              {p.stats.top.toLocaleString()} · 出貨率 {p.stats.rate.toFixed(2)}% · {p.stats.rewards}{' '}
              個獎勵
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPeriodId(p.id);
                setPage(0);
              }}
            >
              查看紀錄與統計
            </Button>
          </div>
        ))}
        {period && track && (
          <section className="period-detail">
            <h3>{period.name} · 抽取紀錄與統計</h3>
            <div className="result-list">
              {track.rules.rarities.map((r, i) => (
                <span className={rarityClass(i, track.rules.rarities.length)} key={r.name}>
                  {r.name}：{period.stats.counts[r.name] || 0}
                </span>
              ))}
            </div>
            <p className="help">
              平均 {period.stats.average?.toFixed(1) ?? '—'} 抽 · UP{' '}
              {period.stats.setState?.up ?? period.stats.up} · 歪{' '}
              {period.stats.setState?.off ?? period.stats.off}
            </p>
            {period.id === 'initial' && (
              <p className="help">包含原有歷史起始資料；只有逐筆紀錄能列出時間與結果。</p>
            )}
            {!period.records.length && <p className="help">此池尚無逐筆抽取紀錄。</p>}
            {[...period.records]
              .reverse()
              .slice(page * 50, (page + 1) * 50)
              .map((r) => (
                <div className="period-record" key={r.id}>
                  <time>{new Date(r.at).toLocaleString('zh-TW', { hour12: false })}</time>
                  <div className="result-list">
                    {r.results.map((x, i) => (
                      <span
                        className={rarityClass(
                          track.rules.rarities.findIndex((v) => v.name === x.rarity),
                          track.rules.rarities.length,
                        )}
                        key={i}
                      >
                        {x.rarity} × {x.count}
                        {x.outcome === 'up' ? ' · UP' : x.outcome === 'off' ? ' · 歪' : ''}
                      </span>
                    ))}
                  </div>
                  <small>
                    {r.kind === 'reward' ? '獎勵' : '抽取'} {r.note}
                  </small>
                </div>
              ))}
            <div className="form-actions">
              <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                上一頁
              </Button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(period.records.length / 50))}
              </span>
              <Button
                variant="ghost"
                disabled={(page + 1) * 50 >= period.records.length}
                onClick={() => setPage(page + 1)}
              >
                下一頁
              </Button>
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}
