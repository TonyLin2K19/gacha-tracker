import { useMemo, useState } from 'react';
import { Sheet } from './components/ui/sheet';
import { Button } from './components/ui/button';
import { Field } from './Forms';
import { parseBaselineTSV } from '../shared/import';
import { defaultRules, type Track } from '../shared/model';
import { api } from './api';
export default function ImportForm({
  gameId,
  tracks,
  close,
  saved,
}: {
  gameId: string;
  tracks: Track[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [template, setTemplate] = useState('');
  const rules = tracks.find((t) => t.id === template)?.rules || defaultRules;
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    if (!text.trim()) return { rows: [], error: '' };
    try {
      return { rows: parseBaselineTSV(text, gameId, rules), error: '' };
    } catch (e) {
      return { rows: [], error: (e as Error).message };
    }
  }, [text, gameId, rules]);
  const header = [
    '伺服器',
    '帳號',
    '卡池',
    ...rules.rarities.map((x) => x.name),
    '墊抽',
    'UP',
    '歪',
    '下次必UP',
    '出貨間隔',
  ].join('\t');
  return (
    <Sheet
      open
      onClose={close}
      title="匯入歷史基底"
      description="從 Google Sheets 複製多列，貼上後先核對，再一次建立帳號卡池。"
    >
      <div className="form-body">
        <Field label="這一批使用的卡池規則">
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">預設 SSR 2% / SR 18% / R 80%（無保底）</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.server} / {t.account} / {t.pool}
              </option>
            ))}
          </select>
        </Field>
        <p className="help">
          不同規則請分批匯入，或匯入後逐池編輯。可先建立一個設定好規則的卡池作為範本。此功能只新增，不覆蓋已有卡池。
        </p>
        <div className="section-title">1. 準備欄位標題</div>
        <p className="help">
          在 Sheet
          建立以下標題與資料列。伺服器、帳號、卡池與各稀有度欄必須存在；可增加「累計」欄協助核對。墊抽留空表示未知；出貨間隔按舊
          → 新，以逗號分隔。原表的 last、last2… 若由新到舊排列，請反轉後貼入。
        </p>
        <textarea
          aria-label="匯入欄位標題"
          readOnly
          rows={3}
          value={header}
          onFocus={(e) => e.target.select()}
          className="code-input"
        />
        <div className="section-title">2. 貼上標題與資料</div>
        <textarea
          autoFocus
          aria-label="貼上歷史資料"
          rows={9}
          className="code-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          placeholder="直接從 Google Sheets 複製儲存格（Tab 分隔）"
        />
        {preview.error && <div className="error">{preview.error}</div>}
        {preview.rows.length > 0 && (
          <>
            <div className="section-title">3. 核對 {preview.rows.length} 個卡池</div>
            <div className="import-preview">
              {preview.rows.map((r, i) => (
                <div key={i}>
                  <strong>
                    {r.server} / {r.account} / {r.pool}
                  </strong>
                  <span>
                    {Object.entries(r.baseline.counts)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </span>
                  <small>
                    共 {Object.values(r.baseline.counts).reduce((a, b) => a + b, 0)} 抽 · 墊抽{' '}
                    {r.baseline.pity ?? '未知'}
                  </small>
                </div>
              ))}
            </div>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          <Button
            disabled={busy || !preview.rows.length || !!preview.error}
            onClick={async () => {
              setBusy(true);
              try {
                await api('/tracks/import', 'POST', { tracks: preview.rows });
                await saved();
                close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            匯入 {preview.rows.length} 個卡池
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
