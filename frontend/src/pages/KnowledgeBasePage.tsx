import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Loader2, Search } from 'lucide-react'
import type { Familiarity, KbEntryRow, KbOverview, KbSourceGroup } from '../types'
import { getKbEntries, getKbOverview, getKbSources } from '../services/api'
import Logo from '../components/shared/Logo'

const FAM_LABEL: Record<Familiarity, string> = { new: '新', learning: '在学', familiar: '熟' }
const LEVEL_CLASS: Record<string, string> = { N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5' }

const day = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日` }

export function FamChip({ fam }: { fam: Familiarity }) {
  return (
    <span className={clsx('text-[11px] rounded-full px-2 py-0.5 shrink-0',
      fam === 'familiar' ? 'bg-fg text-bg' : fam === 'learning' ? 'bg-accent-light text-fg-muted' : 'border border-border text-fg-muted')}>
      {FAM_LABEL[fam]}
    </span>
  )
}

/**
 * 知识库: look up, browse, tidy. A light overview on top — how familiar the
 * library is, the last 30 days, what keeps being forgotten — then search
 * and the list, by when it was added or by where it was met.
 */
export default function KnowledgeBasePage() {
  const { pathname } = useLocation()
  const active = /^\/kb\/?$/.test(pathname)
  const navigate = useNavigate()
  const [overview, setOverview] = useState<KbOverview | null>(null)
  const [items, setItems] = useState<KbEntryRow[] | null>(null)
  const [sources, setSources] = useState<KbSourceGroup[] | null>(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState<'' | 'vocabulary' | 'grammar'>('')
  const [fam, setFam] = useState<'' | Familiarity>('')
  const [level, setLevel] = useState('')
  const [by, setBy] = useState<'time' | 'source'>('time')

  useEffect(() => {
    if (!active) return
    getKbOverview().then(setOverview).catch(() => {})
  }, [active])

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      getKbEntries({ type, fam, level, q: q.trim() }).then(r => setItems(r.items)).catch(() => setItems([]))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [active, type, fam, level, q])

  useEffect(() => {
    if (active && by === 'source' && !sources) getKbSources().then(setSources).catch(() => setSources([]))
  }, [active, by, sources])

  const spark = useMemo(() => {
    const d = overview?.added_per_day ?? []
    const max = Math.max(1, ...d)
    return d.map((v, i) => `${(i / Math.max(1, d.length - 1)) * 100},${24 - (v / max) * 20}`).join(' ')
  }, [overview])

  if (overview && overview.total === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-sm flex flex-col gap-4">
          <Logo className="w-10 h-10 text-fg" />
          <h1 className="text-xl font-bold text-fg">知识库还是空的</h1>
          <p className="text-sm text-fg-muted leading-relaxed">在精读里读一段，把卡住的词和语法入库；遇到过的句子会跟着一起存进来。</p>
          <Link to="/" className="btn-primary h-12 justify-center text-base font-semibold">去读一段语料</Link>
        </div>
      </div>
    )
  }

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} aria-pressed={on}
            className={clsx('h-9 px-3.5 rounded-full text-sm border shrink-0', on ? 'bg-fg text-bg border-fg' : 'border-border text-fg hover:border-fg-subtle')}>
      {label}
    </button>
  )
  const f = overview?.familiarity
  const total = overview?.total ?? 0

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-10 py-5 md:py-8 flex flex-col gap-4">
        <header className="flex items-baseline gap-3">
          <h1 className="text-xl md:text-2xl font-bold text-fg">知识库</h1>
          {overview && <span className="text-sm text-fg-muted">{total} 个 · 词汇 {overview.vocab} · 语法 {overview.grammar}</span>}
        </header>

        {overview && f && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-2.5">
              <span className="text-xs text-fg-muted">熟悉程度 · {total} 个</span>
              <span className="flex h-2 rounded-full overflow-hidden bg-border" aria-hidden="true">
                <span className="bg-border" style={{ width: `${(f.new / Math.max(1, total)) * 100}%` }} />
                <span className="bg-fg-subtle" style={{ width: `${(f.learning / Math.max(1, total)) * 100}%` }} />
                <span className="bg-fg" style={{ width: `${(f.familiar / Math.max(1, total)) * 100}%` }} />
              </span>
              <span className="text-xs text-fg-muted">新 {f.new}　在学 {f.learning}　熟 {f.familiar}</span>
            </div>
            <div className="hidden md:flex rounded-2xl border border-border bg-surface p-4 flex-col gap-1.5">
              <span className="text-xs text-fg-muted">最近 30 天</span>
              <span className="flex items-baseline gap-4">
                <span><b className="text-2xl text-fg tabular-nums">+{overview.added_30}</b><span className="text-xs text-fg-muted"> 入库</span></span>
                <span><b className="text-2xl text-fg tabular-nums">+{overview.familiar_30}</b><span className="text-xs text-fg-muted"> 变熟</span></span>
              </span>
              <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="w-full h-6 text-fg" aria-hidden="true">
                <polyline points={spark} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-2">
              <span className="text-xs text-fg-muted">老是忘的 · {overview.forgotten.length} 个</span>
              {overview.forgotten.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {overview.forgotten.map(x => (
                    <button key={x.id} type="button" onClick={() => navigate(`/kb/${x.id}`)}
                            className="font-jp text-sm rounded-full bg-danger-light text-danger-fg px-2.5 py-0.5">{x.key}</button>
                  ))}
                </span>
              ) : <span className="text-sm text-fg-subtle">还没有反复忘记的</span>}
            </div>
          </div>
        )}

        <label className="relative">
          <span className="sr-only">搜索知识库</span>
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜日文、假名、中文，或例句里的内容"
                 className="w-full h-12 rounded-2xl border border-border bg-surface pl-11 pr-4 text-[0.9375rem] text-fg placeholder:text-fg-subtle outline-none focus:border-fg-subtle" />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {chip(!type, '全部', () => setType(''))}
          {chip(type === 'vocabulary', '词汇', () => setType(type === 'vocabulary' ? '' : 'vocabulary'))}
          {chip(type === 'grammar', '语法', () => setType(type === 'grammar' ? '' : 'grammar'))}
          <span className="hidden md:block w-px h-6 bg-border mx-1" />
          {(['new', 'learning', 'familiar'] as const).map(x => chip(fam === x, `${FAM_LABEL[x]}${f ? ` ${f[x]}` : ''}`, () => setFam(fam === x ? '' : x)))}
          <span className="hidden md:block w-px h-6 bg-border mx-1" />
          <span className="hidden md:contents">{['N1', 'N2', 'N3', 'N4', 'N5'].map(l => chip(level === l, l, () => setLevel(level === l ? '' : l)))}</span>
          <span className="ml-auto inline-flex rounded-xl bg-accent-light p-1">
            {(['time', 'source'] as const).map(x => (
              <button key={x} type="button" onClick={() => setBy(x)} aria-pressed={by === x}
                      className={clsx('h-8 px-3.5 rounded-lg text-sm', by === x ? 'bg-surface text-fg font-semibold shadow-card' : 'text-fg-muted')}>
                {x === 'time' ? '按时间' : '按来源'}
              </button>
            ))}
          </span>
        </div>

        {by === 'time' ? (
          !items ? <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /> : items.length === 0 ? (
            <p className="text-sm text-fg-muted py-6">没有符合的词条</p>
          ) : (
            <div className="flex flex-col">
              <div className="hidden md:grid grid-cols-[2fr_2.2fr_4rem_4rem_4rem_5rem] gap-4 px-4 py-2 text-xs text-fg-subtle border-b border-border">
                <span>词 / 语法</span><span>意思</span><span>等级</span><span>遇到</span><span>熟悉</span><span className="text-right">入库</span>
              </div>
              {items.map(e => (
                <Link key={e.id} to={`/kb/${e.id}`}
                      className="grid grid-cols-[1fr_auto] md:grid-cols-[2fr_2.2fr_4rem_4rem_4rem_5rem] gap-x-4 gap-y-0.5 items-center px-4 py-3 border-b border-border hover:bg-accent-light/50">
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="font-jp text-lg text-fg truncate">{e.key}</span>
                    {e.reading && e.reading !== e.key && <span className="text-xs text-fg-subtle truncate">{e.reading}</span>}
                  </span>
                  <span className="md:hidden row-span-2 self-center"><FamChip fam={e.familiarity} /></span>
                  <span className="text-sm text-fg-muted truncate">{e.meaning ?? '—'}<span className="md:hidden"> · {e.sentences} 句</span></span>
                  <span className="hidden md:block">{e.level && <span className={LEVEL_CLASS[e.level] ?? 'badge'}>{e.level}</span>}</span>
                  <span className="hidden md:block text-sm text-fg-muted tabular-nums">{e.sentences} 句</span>
                  <span className="hidden md:block"><FamChip fam={e.familiarity} /></span>
                  <span className="hidden md:block text-sm text-fg-subtle text-right tabular-nums">{day(e.created_at)}</span>
                </Link>
              ))}
            </div>
          )
        ) : (
          !sources ? <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sources.map(g => (
                <div key={g.analysis_id ?? 'jlpt'} className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-2.5">
                  <p className="flex items-baseline gap-2">
                    <span className="font-jp text-[0.9375rem] text-fg truncate flex-1">{g.title}</span>
                    {g.analysis_id
                      ? <Link to={`/?analysis=${g.analysis_id}`} className="text-xs text-fg-muted hover:text-fg shrink-0">回到原文 ›</Link>
                      : <Link to="/jlpt" className="text-xs text-fg-muted hover:text-fg shrink-0">去 JLPT ›</Link>}
                  </p>
                  <p className="text-xs text-fg-subtle">{day(g.date)} · {g.source} · 收了 {g.entries.length} 个</p>
                  <p className="flex flex-wrap gap-1.5">
                    {g.entries.map(e => (
                      <Link key={e.id} to={`/kb/${e.id}`} className="font-jp text-sm rounded-full bg-accent-light px-3 py-1 text-fg hover:bg-border">{e.key}</Link>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
