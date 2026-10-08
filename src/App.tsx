import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  BookOpen,
  Plus,
  Search,
  Settings2,
  Download,
  Upload,
  Sun,
  Moon,
  ChevronRight,
  Undo2,
  SlidersHorizontal,
  History,
  Table2,
  Pencil,
  Trash2,
  Check,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  Database,
  ArrowUpDown,
  X,
  Copy,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Sheet } from './components/ui/sheet';
import ImportForm from './ImportForm';
import { GameForm, TrackForm, RecordForm, QuickTenForm, SetCycleForm, Field } from './Forms';
import { api, download } from './api';
import { summarize, intervalClass, type RecentInterval, type Stats } from '../shared/stats';
import {
  defaultRules,
  emptyBaseline,
  type Snapshot,
  type Track,
  type DrawRecord,
  type Game,
} from '../shared/model';
const empty: Snapshot = { version: 1, games: [], tracks: [], records: [], settings: {} };
const num = (n: number) => n.toLocaleString('en-US');
const lastGameKey = 'gacha-ledger:last-game';
function rememberedGame() {
  try {
    return localStorage.getItem(lastGameKey) || '';
  } catch {
    return '';
  }
}
function GameAvatar({ game, tone }: { game: Game; tone: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [game.icon]);
  return (
    <span className={`game-avatar tone-${tone % 4}`}>
      {game.icon && !failed ? (
        <img
          src={`/api/game-icons/${encodeURIComponent(game.icon)}`}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        game.name.slice(0, 1)
      )}
    </span>
  );
}
type Row = Track & { stats: Stats };
function RecentIntervals({ intervals }: { intervals: RecentInterval[] }) {
  return (
    <div className="intervals">
      {intervals
        .slice(-5)
        .reverse()
        .map((interval, i) => (
          <span
            key={i}
            className={intervalClass(interval)}
            title={`${interval.count} 抽 · ${interval.outcome === 'off' ? '歪' : interval.outcome === 'up' ? 'UP（不歪）' : '未標示 UP／歪'}${interval.atPity ? ' · 保底' : ''}`}
          >
            {interval.count}
          </span>
        ))}
      {!intervals.length && <span className="muted">—</span>}
    </div>
  );
}
type Modal =
  | { type: 'game'; game?: Game }
  | { type: 'track'; track?: Track }
  | { type: 'record'; track: Track; record?: DrawRecord }
  | { type: 'ten'; track: Track; record?: DrawRecord }
  | { type: 'cycle'; track: Track; record?: DrawRecord }
  | { type: 'backup' }
  | { type: 'import' }
  | null;
export default function App() {
  const [data, setData] = useState<Snapshot>(empty),
    [gameId, setGameId] = useState(rememberedGame),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const [tab, setTab] = useState<'overview' | 'history'>('overview'),
    [fullOverview, setFullOverview] = useState(false),
    [server, setServer] = useState(''),
    [account, setAccount] = useState(''),
    [pool, setPool] = useState(''),
    [search, setSearch] = useState(''),
    [historyTrack, setHistoryTrack] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [page, setPage] = useState(0);
  const [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState(''),
    [quantity, setQuantity] = useState(1),
    [busy, setBusy] = useState(false),
    [lastId, setLastId] = useState('');
  const [dark, setDark] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [sizing, setSizing] = useState<ColumnSizingState>({}),
    [visibility, setVisibility] = useState<VisibilityState>({
      expected: false,
      min: false,
      max: false,
      hardHits: false,
      rewards: false,
      next: false,
    }),
    [sorting, setSorting] = useState<SortingState>([]),
    [columnsOpen, setColumnsOpen] = useState(false),
    [ready, setReady] = useState(false);
  const initialized = useRef(false),
    quickPanel = useRef<HTMLDivElement>(null),
    workspace = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const [restoreText, setRestoreText] = useState(''),
    [restoreName, setRestoreName] = useState(''),
    [restoreConfirm, setRestoreConfirm] = useState('');
  async function load() {
    const d = await api<Snapshot>('/state');
    setData(d);
    setGameId((old) => (d.games.some((g) => g.id === old) ? old : d.games[0]?.id || ''));
    if (!initialized.current) {
      const s = d.settings.layout as
        | {
            dark?: boolean;
            collapsed?: boolean;
            sizing?: ColumnSizingState;
            visibility?: VisibilityState;
            layoutVersion?: number;
          }
        | undefined;
      if (s) {
        setDark(s.dark ?? false);
        setCollapsed(s.collapsed ?? false);
        setSizing(
          (s.layoutVersion ?? 1) < 2 ? { ...(s.sizing ?? {}), identity: 180 } : (s.sizing ?? {}),
        );
        if (s.visibility) setVisibility(s.visibility);
      }
      initialized.current = true;
      setReady(true);
    }
    setError('');
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    if (!gameId) return;
    try {
      localStorage.setItem(lastGameKey, gameId);
    } catch {}
  }, [gameId]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      api('/settings/layout', 'PUT', {
        value: { dark, collapsed, sizing, visibility, layoutVersion: 2 },
      }).catch((e) => setError('版面設定未儲存：' + e.message));
    }, 500);
    return () => clearTimeout(timer);
  }, [dark, collapsed, sizing, visibility, ready]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!fullOverview || modal) return;
    function exitOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setFullOverview(false);
    }
    window.addEventListener('keydown', exitOnEscape);
    return () => window.removeEventListener('keydown', exitOnEscape);
  }, [fullOverview, modal]);
  useEffect(() => {
    setServer('');
    setAccount('');
    setPool('');
    setSelected('');
    setHistoryTrack('');
    setSearch('');
    setPage(0);
  }, [gameId]);
  useEffect(() => setPage(0), [search, server, account, pool, historyTrack, from, to]);
  const game = data.games.find((g) => g.id === gameId);
  const tracks = data.tracks.filter((t) => t.gameId === gameId);
  const filtered = tracks.filter(
    (t) =>
      (!server || t.server === server) &&
      (!account || t.account === account) &&
      (!pool || t.pool === pool) &&
      `${t.pool} ${t.account} ${t.server}`.toLowerCase().includes(search.toLowerCase()),
  );
  const rows = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => a.server.localeCompare(b.server) || a.account.localeCompare(b.account))
        .map((t) => ({ ...t, stats: summarize(t, data.records, data.tracks) })),
    [data, gameId, server, account, pool, search],
  );
  const chosen = filtered.find((t) => t.id === selected) || filtered[0];
  useEffect(() => {
    const panel = quickPanel.current;
    const container = workspace.current;
    if (!fullOverview || tab !== 'overview' || !panel || !container) return;
    const measure = () =>
      container.style.setProperty(
        '--quick-panel-height',
        `${panel.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      container.style.removeProperty('--quick-panel-height');
    };
  }, [fullOverview, tab, chosen?.id]);
  const rarityNames = [...new Set(tracks.flatMap((t) => t.rules.rarities.map((r) => r.name)))];
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: 'identity',
        header: '伺服器 / 帳號 / 卡池',
        size: 180,
        minSize: 100,
        enableHiding: false,
        accessorFn: (r) => `${r.server} ${r.account} ${r.pool}`,
        cell: ({ row }) => (
          <div className="identity">
            <span className="pool-dot" />
            <div>
              <strong>{row.original.pool}</strong>
              <small>
                {row.original.server} / {row.original.account}
                {row.original.stats.shared ? ' · 共用保底' : ''}
                {row.original.stats.setState
                  ? ` · 目前 ${row.original.stats.setState.cycleName}`
                  : ''}
              </small>
            </div>
          </div>
        ),
      },
      ...rarityNames.map((name, i): ColumnDef<Row> => ({
        id: 'rarity_' + name,
        header: name,
        size: 78,
        minSize: 58,
        accessorFn: (r) => r.stats.counts[name] || 0,
        cell: ({ getValue }) => (
          <span className={i === 0 ? 'rarity-top' : 'numeric'}>{num(getValue<number>())}</span>
        ),
      })),
      {
        id: 'total',
        header: '累計抽數',
        accessorFn: (r) => r.stats.total,
        size: 102,
        cell: ({ getValue }) => <strong>{num(getValue<number>())}</strong>,
      },
      {
        id: 'rate',
        header: '出貨率',
        accessorFn: (r) => r.stats.rate,
        size: 90,
        cell: ({ row }) => (
          <span
            className={
              row.original.stats.rate >= row.original.rules.rarities[0].rate ? 'good' : 'muted'
            }
          >
            {row.original.stats.rate.toFixed(2)}%
          </span>
        ),
      },
      {
        id: 'average',
        header: '平均抽數',
        accessorFn: (r) => r.stats.average,
        size: 90,
        cell: ({ getValue }) => getValue<number | null>()?.toFixed(1) ?? '—',
      },
      {
        id: 'pity',
        header: '目前墊抽',
        accessorFn: (r) => (r.stats.setState ? r.stats.setState.pity : r.stats.pity),
        size: 130,
        cell: ({ row }) => {
          const r = row.original;
          const setState = r.stats.setState;
          const pity = setState ? setState.pity : r.stats.pity;
          const target = (r.stats.setState?.target ?? r.rules.hardPity) || 0;
          return (
            <div className="pity-cell">
              <span>
                {setState?.marksMode ? (
                  <>
                    {setState.marks === null ? (
                      <span className="unknown">未知</span>
                    ) : (
                      num(setState.marks)
                    )}
                    <small> / {target ? target / 10 : '—'} 標記</small>
                  </>
                ) : (
                  <>
                    {pity === null ? <span className="unknown">未知</span> : num(pity)}
                    <small> / {target || '—'}</small>
                  </>
                )}
              </span>
              {setState?.marksMode && setState.nextGuaranteed && (
                <small className="good">下次十連必出套裝</small>
              )}
              {target > 0 && pity !== null && (
                <div className="pity-track">
                  <i style={{ width: Math.min(100, (pity / target) * 100) + '%' }} />
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'recent',
        header: '最近出貨間隔（新 → 舊）',
        size: 218,
        enableSorting: false,
        cell: ({ row }) => {
          const intervals =
            row.original.stats.setState?.recentIntervals ?? row.original.stats.recentIntervals;
          return <RecentIntervals intervals={intervals} />;
        },
      },
      {
        id: 'off',
        header: '歪 / UP',
        size: 84,
        accessorFn: (r) => r.stats.setState?.off ?? r.stats.off,
        cell: ({ row }) => {
          const state = row.original.stats.setState ?? row.original.stats;
          return (
            <>
              <span className="off">{state.off}</span>
              <span className="muted"> / </span>
              <span className="good">{state.up}</span>
            </>
          );
        },
      },
      {
        id: 'guarantee',
        header: 'UP 狀態',
        size: 103,
        accessorFn: (r) =>
          String(r.stats.setState ? r.stats.setState.guaranteed : r.stats.guaranteed),
        cell: ({ row }) => {
          const guaranteed = row.original.stats.setState
            ? row.original.stats.setState.guaranteed
            : row.original.stats.guaranteed;
          return !row.original.rules.guaranteeAfterLoss ? (
            <span className="muted">未啟用</span>
          ) : guaranteed === null ? (
            <span className="unknown">未知</span>
          ) : guaranteed ? (
            <span className="badge">下次必 UP</span>
          ) : (
            <span className="muted">{row.original.rules.upRate}% UP</span>
          );
        },
      },
      {
        id: 'next',
        header: '下抽出貨率',
        size: 110,
        accessorFn: (r) => r.stats.nextRate,
        cell: ({ getValue }) =>
          getValue<number | null>() === null ? '未知' : getValue<number>().toFixed(2) + '%',
      },
      {
        id: 'expected',
        header: '基礎期望',
        size: 90,
        accessorFn: (r) => r.stats.expected,
        cell: ({ getValue }) => getValue<number>().toFixed(1),
      },
      {
        id: 'min',
        header: '最短間隔',
        size: 85,
        accessorFn: (r) => {
          const intervals = r.stats.setState?.intervals ?? r.stats.intervals;
          return intervals.length ? intervals.reduce((a, b) => Math.min(a, b), Infinity) : null;
        },
      },
      {
        id: 'max',
        header: '最長間隔',
        size: 85,
        accessorFn: (r) => {
          const intervals = r.stats.setState?.intervals ?? r.stats.intervals;
          return intervals.length ? intervals.reduce((a, b) => Math.max(a, b), 0) : null;
        },
      },
      {
        id: 'hardHits',
        header: '已知保底次數',
        size: 120,
        accessorFn: (r) => r.stats.setState?.hardHits ?? r.stats.hardHits,
      },
      { id: 'rewards', header: '額外獎勵', size: 90, accessorFn: (r) => r.stats.rewards },
      {
        id: 'actions',
        header: '操作',
        size: 114,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="row-actions">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setModal({ type: 'record', track: row.original });
              }}
            >
              <Plus />
              記錄
            </Button>
            <button
              className="icon-button"
              aria-label={`編輯 ${row.original.account} ${row.original.pool}`}
              onClick={(e) => {
                e.stopPropagation();
                setModal({ type: 'track', track: row.original });
              }}
            >
              <Pencil size={13} />
            </button>
          </div>
        ),
      },
    ],
    [data, gameId, rarityNames.join('|')],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnSizing: sizing, columnVisibility: visibility, sorting },
    onColumnSizingChange: setSizing,
    onColumnVisibilityChange: setVisibility,
    onSortingChange: setSorting,
    columnResizeMode: 'onChange',
    defaultColumn: { minSize: 55, maxSize: 500 },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const visibleTableWidth = table
    .getVisibleLeafColumns()
    .reduce((total, column) => total + column.getSize(), 0);
  function secondaryCell(row: Row, columnId: string) {
    const { stats } = row;
    if (columnId === 'identity')
      return (
        <div className="identity secondary-identity">
          <span className="pool-dot" />
          <div>
            <strong>{row.pool}抽墊底</strong>
            <small>
              一般 {row.rules.rarities[0].name} · {row.rules.hardPity || '—'} 抽保底
            </small>
          </div>
        </div>
      );
    if (columnId === 'pity') {
      const target = row.rules.hardPity || 0;
      return (
        <div className="pity-cell">
          <span>
            {stats.pity === null ? <span className="unknown">未知</span> : num(stats.pity)}
            <small> / {target || '—'}</small>
          </span>
          {target > 0 && stats.pity !== null && (
            <div className="pity-track">
              <i style={{ width: Math.min(100, (stats.pity / target) * 100) + '%' }} />
            </div>
          )}
        </div>
      );
    }
    if (columnId === 'recent') return <RecentIntervals intervals={stats.recentIntervals} />;
    if (columnId === 'min')
      return stats.intervals.length ? Math.min(...stats.intervals).toLocaleString('en-US') : '—';
    if (columnId === 'max')
      return stats.intervals.length ? Math.max(...stats.intervals).toLocaleString('en-US') : '—';
    if (columnId === 'hardHits') return stats.hardHits;
    if (columnId === 'off')
      return (
        <>
          <span className="off">{stats.off}</span>
          <span className="muted"> / </span>
          <span className="good">{stats.up}</span>
        </>
      );
    if (columnId === 'guarantee')
      return !row.rules.guaranteeAfterLoss ? (
        <span className="muted">未啟用</span>
      ) : stats.guaranteed === null ? (
        <span className="unknown">未知</span>
      ) : stats.guaranteed ? (
        <span className="badge">下次必 UP</span>
      ) : (
        <span className="muted">{row.rules.upRate}% UP</span>
      );
    if (columnId === 'next')
      return stats.nextRate === null ? '未知' : stats.nextRate.toFixed(2) + '%';
    return null;
  }
  async function act(fn: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      setToast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function quick(rarity: string) {
    if (!chosen || busy) return;
    await act(async () => {
      const result = await api<{ id: string }>('/records', 'POST', {
        trackId: chosen.id,
        at: new Date().toISOString(),
        ordered: true,
        kind: 'draw',
        results: [{ rarity, count: quantity, outcome: 'unknown' }],
        note: '',
      });
      setLastId(result.id);
    }, `已記錄 ${rarity} × ${quantity}`);
  }
  const shownIds = new Set(filtered.map((t) => t.id));
  const records = data.records
    .filter(
      (r) =>
        shownIds.has(r.trackId) &&
        (!historyTrack || r.trackId === historyTrack) &&
        (!from || new Date(r.at) >= new Date(from + 'T00:00:00')) &&
        (!to || new Date(r.at) <= new Date(to + 'T23:59:59.999')),
    )
    .sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq);
  function exportCsv() {
    const headers = [
      '伺服器',
      '帳號',
      '卡池',
      ...rarityNames,
      '總抽數',
      '最高稀有度出貨率%',
      '平均抽數',
      '目前墊抽',
      '最近已知出貨間隔(新到舊)',
      '歪',
      'UP',
    ];
    const contents = [
      headers,
      ...rows.map((r) => [
        r.server,
        r.account,
        r.pool,
        ...rarityNames.map((n) => r.stats.counts[n] || 0),
        r.stats.total,
        r.stats.rate.toFixed(4),
        r.stats.average?.toFixed(2) ?? '',
        r.stats.pity ?? '未知',
        r.stats.intervals.slice(-5).reverse().join(' / '),
        r.stats.off,
        r.stats.up,
      ]),
    ];
    const csv = contents
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@-]/, "'$&")
                .replace(/"/g, '""') +
              '"',
          )
          .join(','),
      )
      .join('\r\n');
    download(`${game?.name || 'gacha'}-overview.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
  }
  async function demo() {
    await act(async () => {
      const { id } = await api<{ id: string }>('/games', 'POST', { name: '示範遊戲（虛構資料）' });
      for (const [server, account, pool, total, top, pity] of [
        ['台服', '主帳號', '限定角色', 1036, 29, 16],
        ['台服', '小號', '限定角色', 482, 11, 42],
        ['台服', '主帳號', '常駐角色', 790, 17, 28],
        ['日服', '主帳號', '限定角色', 365, 8, 5],
      ] as const) {
        await api('/tracks', 'POST', {
          gameId: id,
          server,
          account,
          pool,
          pityGroup: '',
          rules: {
            ...defaultRules,
            hardPity: 90,
            softStart: 74,
            softStep: 6,
            guaranteeAfterLoss: true,
          },
          baseline: {
            ...emptyBaseline,
            counts: {
              SSR: top,
              SR: Math.floor(total * 0.18),
              R: total - top - Math.floor(total * 0.18),
            },
            pity,
            intervals: [75, 23, 64, 15, 72],
            up: 3,
            off: 2,
          },
        });
      }
      setGameId(id);
    }, '已新增獨立示範遊戲');
  }
  const total = rows.reduce((s, r) => s + r.stats.total, 0);
  const drawCount = data.records.filter((r) => tracks.some((t) => t.id === r.trackId)).length;
  return (
    <div
      className={`app-shell ${collapsed ? 'is-collapsed' : ''} ${fullOverview ? 'full-overview' : ''}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <BookOpen size={18} />
          </div>
          {!collapsed && (
            <div>
              抽卡簿<small>GACHA LEDGER</small>
            </div>
          )}
        </div>
        <button
          className="collapse-button"
          aria-label="收合或展開側欄"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        {!collapsed && (
          <div className="nav-label">
            遊戲收藏 <span>{data.games.length}</span>
          </div>
        )}
        <nav>
          {data.games.map((g, i) => (
            <button
              key={g.id}
              className={`game-link ${gameId === g.id ? 'active' : ''}`}
              onClick={() => {
                setGameId(g.id);
                setTab('overview');
              }}
              title={g.name}
            >
              <GameAvatar game={g} tone={i} />
              {!collapsed && (
                <>
                  <span className="truncate">{g.name}</span>
                  <ChevronRight size={13} />
                </>
              )}
            </button>
          ))}
        </nav>
        <button className="add-game" onClick={() => setModal({ type: 'game' })} title="新增遊戲">
          <Plus size={16} />
          {!collapsed && '新增遊戲'}
        </button>
        <div className="sidebar-bottom">
          <button onClick={() => setModal({ type: 'backup' })} title="資料與備份">
            <Database size={15} />
            {!collapsed && '資料與備份'}
          </button>
          <button onClick={() => setDark(!dark)} title="切換深淺色">
            {dark ? <Sun size={15} /> : <Moon size={15} />}{' '}
            {!collapsed && (dark ? '淺色模式' : '深色模式')}
          </button>
          {!collapsed && (
            <div className="local-status">
              <i /> UNRAID · SELF HOSTED <small>v0.2.2</small>
            </div>
          )}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            我的遊戲 <ChevronRight size={13} /> <strong>{game?.name || '開始記錄'}</strong>
          </div>
          <div className="flex items-center gap-2">
            <span className="top-hint">每一次抽卡，都有跡可循</span>
            <Button
              variant="ghost"
              size="icon"
              title="重新整理"
              aria-label="重新整理"
              onClick={() => load().catch((e) => setError(e.message))}
            >
              <RefreshCw />
            </Button>
          </div>
        </header>
        <div
          ref={workspace}
          className={`workspace ${chosen && tab === 'overview' ? 'has-quick-panel' : ''}`}
        >
          {fullOverview && (
            <div className="full-game-switcher" aria-label="切換遊戲">
              {data.games.map((item, index) => (
                <button
                  key={item.id}
                  className={item.id === gameId ? 'active' : ''}
                  onClick={() => {
                    setGameId(item.id);
                    setTab('overview');
                  }}
                  title={item.name}
                >
                  <GameAvatar game={item} tone={index} />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">PERSONAL GACHA RECORDS</div>
              <h1>
                {game?.name || '你的抽卡紀錄，從這裡開始'}
                {game && (
                  <button
                    aria-label="編輯遊戲名稱"
                    className="icon-button"
                    onClick={() => setModal({ type: 'game', game })}
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </h1>
              <p>把運氣留給抽卡，把數字交給抽卡簿。</p>
            </div>
            <div className="flex gap-2">
              {game && (
                <>
                  <Button variant="outline" onClick={() => setModal({ type: 'import' })}>
                    <Upload />
                    匯入基底
                  </Button>
                  <Button variant="outline" onClick={() => setModal({ type: 'track' })}>
                    <Plus />
                    新增帳號卡池
                  </Button>
                  <Button
                    disabled={!chosen}
                    onClick={() => chosen && setModal({ type: 'record', track: chosen })}
                  >
                    <Plus />
                    新增抽卡
                  </Button>
                </>
              )}
            </div>
          </div>
          {error && (
            <div className="error global-error" role="alert">
              {error}
              <button aria-label="關閉錯誤" onClick={() => setError('')}>
                <X size={14} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty-state">正在讀取抽卡紀錄…</div>
          ) : !game ? (
            <div className="empty-state">
              <BookOpen size={32} />
              <h2>先加入第一個遊戲</h2>
              <p>建立伺服器、帳號與卡池，所有統計會出現在同一張總覽。</p>
              <div className="flex gap-2">
                <Button onClick={() => setModal({ type: 'game' })}>
                  <Plus />
                  新增遊戲
                </Button>
                <Button disabled={busy} variant="outline" onClick={demo}>
                  載入虛構示範資料
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="summary-strip">
                <span>
                  <strong>{new Set(tracks.map((t) => `${t.server}/${t.account}`)).size}</strong>{' '}
                  個帳號
                </span>
                <span>
                  <strong>{tracks.length}</strong> 個卡池
                </span>
                <span>
                  目前篩選 <strong>{num(total)}</strong> 抽
                </span>
                <span>
                  <strong>{num(drawCount)}</strong> 筆詳細紀錄
                </span>
                <div className="strip-end">
                  <span className="status-dot" />
                  已連線
                </div>
              </div>
              <div className="tabs-bar">
                <div className="tabs">
                  <button
                    className={tab === 'overview' ? 'active' : ''}
                    onClick={() => setTab('overview')}
                  >
                    <Table2 size={15} />
                    帳號總覽<span>{tracks.length}</span>
                  </button>
                  {!fullOverview && (
                    <button
                      className={tab === 'history' ? 'active' : ''}
                      onClick={() => setTab('history')}
                    >
                      <History size={15} />
                      抽卡紀錄
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={fullOverview ? '退出完整總覽' : '進入完整總覽'}
                    title={fullOverview ? '退出完整總覽（Esc）' : '只顯示總覽表格'}
                    onClick={() => {
                      if (!fullOverview) setTab('overview');
                      setFullOverview(!fullOverview);
                      setColumnsOpen(false);
                    }}
                  >
                    {fullOverview ? <Minimize2 /> : <Maximize2 />}
                    {fullOverview ? '返回一般模式' : '完整總覽'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={exportCsv}>
                    <Download />
                    匯出 CSV
                  </Button>
                  <div className="relative">
                    <Button variant="ghost" size="sm" onClick={() => setColumnsOpen(!columnsOpen)}>
                      <SlidersHorizontal />
                      欄位
                    </Button>
                    {columnsOpen && (
                      <div className="column-menu">
                        <div className="flex justify-between">
                          <strong>顯示欄位</strong>
                          <button onClick={() => setColumnsOpen(false)} aria-label="關閉欄位選單">
                            <X size={14} />
                          </button>
                        </div>
                        {table
                          .getAllLeafColumns()
                          .filter((c) => c.getCanHide())
                          .map((c) => (
                            <label key={c.id} className="check">
                              <input
                                type="checkbox"
                                checked={c.getIsVisible()}
                                onChange={c.getToggleVisibilityHandler()}
                              />
                              {String(c.columnDef.header)}
                            </label>
                          ))}
                        <Button variant="outline" size="sm" onClick={() => setSizing({})}>
                          重設欄寬
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="filters">
                <div className="search-box">
                  <Search size={15} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜尋帳號、卡池…"
                    aria-label="搜尋帳號卡池"
                  />
                </div>
                <select
                  aria-label="篩選伺服器"
                  value={server}
                  onChange={(e) => {
                    setServer(e.target.value);
                    setAccount('');
                  }}
                >
                  <option value="">全部伺服器</option>
                  {[...new Set(tracks.map((t) => t.server))].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="篩選帳號"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">全部帳號</option>
                  {[
                    ...new Set(
                      tracks.filter((t) => !server || t.server === server).map((t) => t.account),
                    ),
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="篩選卡池"
                  value={pool}
                  onChange={(e) => setPool(e.target.value)}
                >
                  <option value="">全部卡池</option>
                  {[
                    ...new Set(
                      tracks
                        .filter(
                          (t) =>
                            (!server || t.server === server) && (!account || t.account === account),
                        )
                        .map((t) => t.pool),
                    ),
                  ].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                {tab === 'overview' ? (
                  <span className="filter-count">顯示 {rows.length} 個卡池 · 拖曳欄線調整寬度</span>
                ) : (
                  <>
                    <select
                      aria-label="篩選卡池"
                      value={historyTrack}
                      onChange={(e) => setHistoryTrack(e.target.value)}
                    >
                      <option value="">全部卡池</option>
                      {filtered.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.account} / {t.pool}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="起始日期"
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                    <span>—</span>
                    <input
                      aria-label="結束日期"
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </>
                )}
              </div>
              {tab === 'overview' ? (
                <>
                  <div className="table-frame">
                    <div className="table-scroll">
                      <table
                        className="data-table overview-table"
                        style={{
                          width: visibleTableWidth,
                          minWidth: visibleTableWidth,
                          maxWidth: visibleTableWidth,
                        }}
                      >
                        <thead>
                          {table.getHeaderGroups().map((hg) => (
                            <tr key={hg.id}>
                              {hg.headers.map((h) => (
                                <th
                                  key={h.id}
                                  style={{ width: h.getSize() }}
                                  className={h.id === 'identity' ? 'sticky-identity' : ''}
                                >
                                  <button
                                    className="table-header"
                                    onClick={h.column.getToggleSortingHandler()}
                                    disabled={!h.column.getCanSort()}
                                  >
                                    {flexRender(h.column.columnDef.header, h.getContext())}
                                    {h.column.getIsSorted()
                                      ? h.column.getIsSorted() === 'asc'
                                        ? ' ↑'
                                        : ' ↓'
                                      : h.column.getCanSort() && <ArrowUpDown size={10} />}
                                  </button>
                                  <div
                                    className="resizer"
                                    onMouseDown={h.getResizeHandler()}
                                    onTouchStart={h.getResizeHandler()}
                                    onDoubleClick={() => h.column.resetSize()}
                                  />
                                </th>
                              ))}
                            </tr>
                          ))}
                        </thead>
                        <tbody>
                          {table.getRowModel().rows.map((row, i, all) => {
                            const t = row.original;
                            const previous = all[i - 1]?.original;
                            const newGroup =
                              !sorting.length &&
                              (!previous ||
                                previous.server !== t.server ||
                                previous.account !== t.account);
                            return (
                              <Fragment key={row.id}>
                                {newGroup && (
                                  <tr className="group-row">
                                    <td colSpan={table.getVisibleLeafColumns().length}>
                                      <span className="group-label">
                                        {t.server}
                                        <span>/</span>
                                        {t.account}
                                      </span>
                                    </td>
                                  </tr>
                                )}
                                <tr
                                  className={chosen?.id === t.id ? 'selected' : ''}
                                  onClick={() => setSelected(t.id)}
                                >
                                  {row.getVisibleCells().map((cell) => (
                                    <td
                                      key={cell.id}
                                      style={{ width: cell.column.getSize() }}
                                      className={
                                        cell.column.id === 'identity' ? 'sticky-identity' : ''
                                      }
                                    >
                                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                  ))}
                                </tr>
                                {t.stats.setState && (
                                  <tr
                                    className={`secondary-row ${chosen?.id === t.id ? 'selected' : ''}`}
                                    onClick={() => setSelected(t.id)}
                                  >
                                    {table.getVisibleLeafColumns().map((column) => (
                                      <td
                                        key={`${row.id}-secondary-${column.id}`}
                                        style={{ width: column.getSize() }}
                                        className={
                                          column.id === 'identity' ? 'sticky-identity' : ''
                                        }
                                      >
                                        {secondaryCell(t, column.id)}
                                      </td>
                                    ))}
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                      {!rows.length && (
                        <div className="empty-table">
                          <h3>{tracks.length ? '沒有符合條件的卡池' : '新增第一個帳號卡池'}</h3>
                          <p>
                            {tracks.length
                              ? '試試其他篩選條件。'
                              : '設定機率，也可以帶入 Google Sheet 的歷史累計。'}
                          </p>
                          {!tracks.length && (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => setModal({ type: 'import' })}
                              >
                                <Upload />
                                匯入基底
                              </Button>
                              <Button variant="outline" onClick={() => setModal({ type: 'track' })}>
                                <Plus />
                                新增帳號卡池
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="table-foot">
                      <span>出貨率／平均抽數依各卡池最高稀有度計算 · 出貨間隔僅列已知值</span>
                      <span>
                        {num(total)} 抽 / {rows.length} 列
                      </span>
                    </div>
                  </div>
                  {chosen && (
                    <div
                      ref={quickPanel}
                      className="quick-panel"
                      role="region"
                      aria-label="快速記錄"
                    >
                      <div className="quick-title">
                        <span className="quick-icon">
                          <Plus size={16} />
                        </span>
                        <div>
                          <strong>快速記錄</strong>
                          <small>
                            {chosen.server} / {chosen.account} / {chosen.pool}
                          </small>
                        </div>
                      </div>
                      <div className="quick-controls">
                        <label>
                          本次 +
                          <input
                            type="number"
                            min="1"
                            max="100000"
                            value={quantity}
                            aria-label="快速記錄數量"
                            onChange={(e) => setQuantity(Number(e.target.value))}
                          />
                        </label>
                        {[1, 10].map((n) => (
                          <Button key={n} size="sm" variant="ghost" onClick={() => setQuantity(n)}>
                            {n} 抽
                          </Button>
                        ))}
                        <div className="quick-divider" />
                        {chosen.rules.rarities
                          .slice()
                          .reverse()
                          .map((r, i) => (
                            <Button
                              key={r.name}
                              variant={
                                i === chosen.rules.rarities.length - 1 ? 'default' : 'outline'
                              }
                              disabled={
                                busy ||
                                !Number.isInteger(quantity) ||
                                quantity < 1 ||
                                quantity > 100000
                              }
                              onClick={() => quick(r.name)}
                            >
                              {r.name} +{quantity || 1}
                            </Button>
                          ))}
                        <Button
                          variant="outline"
                          title="依第 1～10 抽輸入完整結果"
                          onClick={() => setModal({ type: 'ten', track: chosen })}
                        >
                          <Table2 />
                          快速十抽
                        </Button>
                        {chosen.rules.linkLastFour && (
                          <Button
                            variant="outline"
                            title="選擇舊套裝池或新增；共用保障標記，恢復各池自己的保底階段"
                            onClick={() => setModal({ type: 'cycle', track: chosen })}
                          >
                            <RefreshCw />
                            換套裝池
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          title="自訂時間、混合結果、UP／歪"
                          onClick={() => setModal({ type: 'record', track: chosen })}
                        >
                          <Settings2 />
                          詳細
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!lastId || busy || !data.records.some((r) => r.id === lastId)}
                          onClick={() =>
                            act(async () => {
                              await api('/records/' + lastId, 'DELETE');
                              setLastId('');
                            }, '已撤銷上一筆新增紀錄')
                          }
                        >
                          <Undo2 />
                          撤銷
                        </Button>
                      </div>
                    </div>
                  )}
                  {chosen && (
                    <div className="selection-notes">
                      <span>快速按鈕代表連續相同結果；最高稀有度預設未註明 UP／歪。</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setTab('history');
                            setHistoryTrack(chosen.id);
                          }}
                        >
                          查看此池紀錄
                        </button>
                        <button
                          onClick={() =>
                            setModal({
                              type: 'track',
                              track: {
                                ...chosen,
                                id: '',
                                pool: chosen.pool + '（新池）',
                                baseline: structuredClone(emptyBaseline),
                                pityGroup: '',
                              },
                            })
                          }
                        >
                          <Copy size={12} />
                          複製設定
                        </button>
                        <button
                          className="off"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                `刪除「${chosen.server} / ${chosen.account} / ${chosen.pool}」與全部紀錄？刪除前會自動備份。`,
                              )
                            )
                              act(() => api('/tracks/' + chosen.id, 'DELETE'), '已刪除卡池');
                          }}
                        >
                          <Trash2 size={12} />
                          刪除卡池
                        </button>
                      </div>
                    </div>
                  )}
                  {chosen && (chosen.rules.tenGuarantee || chosen.rules.notes) && (
                    <div className="rule-notes">
                      <strong>此池規則備註</strong>
                      {chosen.rules.tenGuarantee} {chosen.rules.notes}
                    </div>
                  )}
                </>
              ) : (
                <div className="table-frame">
                  <div className="table-scroll history-scroll">
                    <table className="data-table history-table">
                      <thead>
                        <tr>
                          <th>時間</th>
                          <th>伺服器 / 帳號</th>
                          <th>卡池</th>
                          <th>結果</th>
                          <th>順序 / 類型</th>
                          <th>備註</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.slice(page * 50, (page + 1) * 50).map((r) => {
                          const t = tracks.find((t) => t.id === r.trackId)!;
                          return (
                            <tr key={r.id}>
                              <td>{new Date(r.at).toLocaleString('zh-TW', { hour12: false })}</td>
                              <td>
                                {t.server} / {t.account}
                              </td>
                              <td>{t.pool}</td>
                              <td>
                                {r.kind === 'cycle_reset' ? (
                                  <span className="badge">
                                    {r.setPool ? '切換至' : '開始'} {r.note}
                                    {r.setPool?.marks !== undefined
                                      ? ` · 標記校正 ${r.setPool.marks ?? '未知'}`
                                      : ''}
                                  </span>
                                ) : (
                                  <div className="result-list">
                                    {r.results.map((x, i) => (
                                      <span
                                        key={i}
                                        className={
                                          x.rarity === t.rules.rarities[0].name ? 'rarity-top' : ''
                                        }
                                      >
                                        {x.rarity} × {x.count}
                                        {x.outcome === 'up'
                                          ? ' · UP'
                                          : x.outcome === 'off'
                                            ? ' · 歪'
                                            : ''}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td>
                                <span
                                  className={
                                    r.kind === 'reward' || r.kind === 'cycle_reset'
                                      ? 'badge'
                                      : r.ordered
                                        ? 'muted'
                                        : 'unknown'
                                  }
                                >
                                  {r.kind === 'cycle_reset'
                                    ? '切換套裝池'
                                    : r.kind === 'reward'
                                      ? '額外獎勵'
                                      : r.tenPull?.linkedLastFour
                                        ? '十抽 · 同色套裝'
                                        : r.tenPull
                                          ? '快速十抽'
                                          : r.ordered
                                            ? '順序已知'
                                            : '順序未知'}
                                </span>
                              </td>
                              <td className="note-cell" title={r.note}>
                                {r.note || '—'}
                              </td>
                              <td>
                                <div className="flex">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="編輯紀錄"
                                    onClick={() =>
                                      setModal(
                                        r.kind === 'cycle_reset'
                                          ? { type: 'cycle', track: t, record: r }
                                          : r.tenPull
                                            ? { type: 'ten', track: t, record: r }
                                            : { type: 'record', track: t, record: r },
                                      )
                                    }
                                  >
                                    <Pencil />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="刪除紀錄"
                                    disabled={busy}
                                    onClick={() => {
                                      if (confirm('刪除這筆紀錄？統計會重新計算。'))
                                        act(() => api('/records/' + r.id, 'DELETE'), '已刪除紀錄');
                                    }}
                                  >
                                    <Trash2 />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!records.length && (
                      <div className="empty-table">
                        <h3>目前沒有詳細紀錄</h3>
                        <p>歷史起始累計顯示在總覽；從新增抽卡開始累積這裡的紀錄。</p>
                      </div>
                    )}
                  </div>
                  <div className="table-foot">
                    <span>{records.length} 筆紀錄 · 每頁 50 筆</span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        上一頁
                      </Button>
                      {page + 1} / {Math.max(1, Math.ceil(records.length / 50))}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={(page + 1) * 50 >= records.length}
                        onClick={() => setPage(page + 1)}
                      >
                        下一頁
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <footer className="workspace-footer">
                <span>
                  GACHA LEDGER <span> / </span> 你的紀錄，你的資料。
                </span>
                <button onClick={() => setModal({ type: 'backup' })}>
                  <Database size={12} />
                  備份與還原
                </button>
              </footer>
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal?.type === 'import' && (
        <ImportForm
          gameId={gameId}
          tracks={tracks}
          close={() => setModal(null)}
          saved={async () => {
            await load();
            setToast('歷史基底匯入完成');
          }}
        />
      )}
      {modal?.type === 'game' && (
        <GameForm
          game={modal.game}
          games={data.games}
          close={() => setModal(null)}
          saved={async (id) => {
            await load();
            setGameId(id);
            setToast('已儲存遊戲');
          }}
        />
      )}
      {modal?.type === 'track' && (
        <TrackForm
          gameId={gameId}
          track={modal.track}
          templates={tracks}
          close={() => setModal(null)}
          saved={async () => {
            await load();
            setToast('已儲存卡池');
          }}
        />
      )}
      {modal?.type === 'record' && (
        <RecordForm
          track={modal.track}
          record={modal.record}
          close={() => setModal(null)}
          saved={async (id) => {
            if (!modal.record) setLastId(id);
            await load();
            setToast('已儲存抽卡紀錄');
          }}
        />
      )}
      {modal?.type === 'ten' && (
        <QuickTenForm
          track={modal.track}
          records={data.records}
          record={modal.record}
          close={() => setModal(null)}
          saved={async (id) => {
            if (!modal.record) setLastId(id);
            await load();
            setToast('已儲存快速十抽');
          }}
        />
      )}
      {modal?.type === 'cycle' && (
        <SetCycleForm
          track={modal.track}
          records={data.records}
          record={modal.record}
          close={() => setModal(null)}
          saved={async (id) => {
            if (!modal.record) setLastId(id);
            await load();
            setToast('已儲存套裝池切換');
          }}
        />
      )}
      {modal?.type === 'backup' && (
        <Sheet
          open
          onClose={() => setModal(null)}
          title="資料與備份"
          description="完整備份包含所有遊戲、卡池規則、紀錄與版面設定。"
        >
          <div className="form-body">
            <div className="section-title">完整備份</div>
            <p className="help">
              下載 JSON 可搬移到另一台主機，或在這裡還原。服務每連續執行 24 小時會建立一份自動備份。
            </p>
            <Button
              onClick={async () => {
                try {
                  const snapshot = await api<Snapshot>('/backup');
                  download(
                    `gacha-backup-${new Date().toISOString().slice(0, 10)}.json`,
                    JSON.stringify(snapshot, null, 2),
                  );
                  setToast('已下載完整備份');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Download />
              下載完整備份
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => act(() => api('/backup', 'POST'), '已在主機 backups 資料夾建立備份')}
            >
              <Database />在 Unraid 建立一份備份
            </Button>
            <div className="section-title">還原備份</div>
            <p className="help">
              還原會取代目前全部資料；系統會先在主機保存還原前備份。只接受本工具匯出的 v1 JSON。
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setRestoreText(await file.text());
                  setRestoreName(file.name);
                  setRestoreConfirm('');
                }
              }}
            />
            {restoreName && (
              <>
                <span className="subtle">已選擇：{restoreName}</span>
                <Field label="輸入 RESTORE 確認取代全部資料">
                  <input
                    value={restoreConfirm}
                    onChange={(e) => setRestoreConfirm(e.target.value)}
                  />
                </Field>
                <Button
                  variant="destructive"
                  disabled={restoreConfirm !== 'RESTORE' || busy}
                  onClick={() =>
                    act(async () => {
                      await api('/restore', 'POST', JSON.parse(restoreText));
                      setRestoreText('');
                      setRestoreName('');
                      setModal(null);
                      initialized.current = false;
                    }, '已還原備份')
                  }
                >
                  <Upload />
                  還原並取代
                </Button>
              </>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
