import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, ChevronUp, GripVertical, Loader2, Trash2 } from 'lucide-react'
import type { Recitation } from '../../types'
import { getRecitations, reciteAgain, removeRecitation, reorderRecitations } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import ReciteSession, { LEVELS } from './ReciteSession'

const preview = (r: Recitation, len = 18) => {
  const t = r.sentences.map(s => s.text).join('')
  return t.length > len ? `${t.slice(0, len)}…` : t
}
const day = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * 背诵: the queue — one passage at a time, the next only once it is done —
 * and the passages done, waiting to be said again by choice.
 */
export default function ReciteView({ onBack }: { onBack: () => void }) {
  const { toast } = useToast()
  const [data, setData] = useState<{ queue: Recitation[]; done: Recitation[] } | null>(null)
  const [working, setWorking] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)

  const load = useCallback(() => getRecitations().then(setData).catch(() => toast('背诵队列没取到', 'error')), [toast])
  useEffect(() => { void load() }, [load])

  if (!data) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  const [first, ...rest] = data.queue

  const move = async (ids: string[]) => {
    setData(d => d && { ...d, queue: ids.map(id => d.queue.find(r => r.id === id)!).filter(Boolean) })
    await reorderRecitations(ids).catch(() => toast('顺序没存上', 'error'))
  }

  const again = async (r: Recitation) => {
    await reciteAgain(r.id).catch(() => null)
    await load()
    setWorking(true)
  }

  const queueList = (
    <div className="flex flex-col gap-3">
      {data.queue.length === 0 && (
        <p className="text-sm text-fg-muted leading-relaxed">队列是空的。在精读里读完一段，点「要背」，它就排进来。</p>
      )}
      {data.queue.map((r, i) => (
        <div key={r.id}
             draggable={i > 0}
             onDragStart={() => setDragging(r.id)}
             onDragOver={e => e.preventDefault()}
             onDrop={() => {
               if (!dragging || dragging === r.id) return
               const ids = data.queue.map(x => x.id).filter(id => id !== dragging)
               ids.splice(ids.indexOf(r.id), 0, dragging)
               setDragging(null)
               void move(ids)
             }}
             className={clsx('rounded-2xl px-4 py-3.5 flex items-center gap-2 bg-surface',
               i === 0 ? 'border-[1.5px] border-fg' : 'border border-border', dragging === r.id && 'opacity-50')}>
          {i > 0 && <GripVertical className="w-4 h-4 text-fg-subtle shrink-0 cursor-grab" aria-hidden="true" />}
          <button type="button" onClick={() => i === 0 && setWorking(true)} className="flex-1 min-w-0 text-left flex flex-col gap-0.5">
            <span className="font-jp text-[0.9375rem] text-fg truncate">{preview(r)}</span>
            <span className="text-xs text-fg-subtle">
              {r.sentences.length} 句{i === 0 ? ` · 到了「${LEVELS[Math.min(r.progress, LEVELS.length - 1)]}」` : ` · ${day(r.created_at)}`}
            </span>
          </button>
          {i === 0 ? (
            <span className="text-xs font-semibold rounded-full bg-fg text-bg px-2.5 py-1 shrink-0">正在背</span>
          ) : (
            <>
              <span className="text-xs text-fg-subtle shrink-0">排队</span>
              <button type="button" aria-label="提到最前" title="提到最前"
                      onClick={() => void move([r.id, ...data.queue.map(x => x.id).filter(id => id !== r.id)])}
                      className="p-1.5 text-fg-subtle hover:text-fg"><ChevronUp className="w-4 h-4" /></button>
            </>
          )}
          {r.analysis_id && <Link to={`/?analysis=${r.analysis_id}`} className="text-sm text-fg-muted hover:text-fg shrink-0">精读 ›</Link>}
        </div>
      ))}

      {data.done.length > 0 && (
        <section className="flex flex-col gap-2 pt-3">
          <h3 className="text-xs font-semibold text-fg-subtle">已背完 · 不自动复习，想背时手动再背</h3>
          {data.done.map(r => (
            <div key={r.id} className="rounded-2xl bg-accent-light/60 px-4 py-3 flex items-center gap-2">
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-jp text-[0.9375rem] text-fg-muted truncate">{preview(r)}</span>
                <span className="text-xs text-fg-subtle">{r.sentences.length} 句 · {day(r.done_at)}背完{r.times_done > 1 ? ` · 背过 ${r.times_done} 遍` : ''}</span>
              </div>
              <button type="button" onClick={() => void again(r)} className="btn h-8 text-xs border border-border bg-surface text-fg shrink-0">再背一遍</button>
              <button type="button" aria-label="删掉" onClick={async () => { await removeRecitation(r.id).catch(() => {}); void load() }}
                      className="p-1.5 text-fg-subtle hover:text-danger shrink-0"><Trash2 className="w-4 h-4" /></button>
              {r.analysis_id && <Link to={`/?analysis=${r.analysis_id}`} className="text-sm text-fg-muted hover:text-fg shrink-0">精读 ›</Link>}
            </div>
          ))}
        </section>
      )}
    </div>
  )

  const session = first && (
    <ReciteSession key={`${first.id}-${first.times_done}`} item={first} next={rest[0] ?? null}
                   onProgress={p => setData(d => d && { ...d, queue: d.queue.map(r => (r.id === first.id ? { ...r, progress: p } : r)) })}
                   onFinished={async startNext => { await load(); setWorking(startNext) }} />
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      {/* Desktop: the queue beside the passage being said */}
      <aside className="hidden md:flex w-80 shrink-0 border-r border-border bg-accent-light/30 flex-col gap-4 px-5 py-6 overflow-y-auto">
        <div className="flex items-center gap-1">
          <button type="button" onClick={onBack} aria-label="回到提取练习" className="-ml-2 p-1.5 text-fg-muted hover:text-fg"><ChevronLeft className="w-4 h-4" /></button>
          <h2 className="font-bold text-fg">背诵队列</h2>
          <span className="text-xs text-fg-subtle ml-2">一次一段</span>
        </div>
        {queueList}
      </aside>
      <div className="hidden md:flex flex-1 min-w-0 flex-col">
        {session ?? <div className="flex-1 flex items-center justify-center text-sm text-fg-muted">没有要背的段落</div>}
      </div>

      {/* Phone: the queue, then the passage full screen */}
      <div className={clsx('md:hidden flex flex-col', working && session ? 'fixed inset-0 z-50 bg-bg' : 'flex-1 min-h-0')}
           style={working && session ? { paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : undefined}>
        <header className="h-14 shrink-0 flex items-center gap-2 px-1 border-b border-border">
          <button type="button" onClick={() => (working ? setWorking(false) : onBack())} aria-label="返回" className="w-11 h-11 flex items-center justify-center text-fg"><ChevronLeft className="w-5 h-5" /></button>
          <span className="font-semibold text-fg">背诵</span>
          <span className="ml-auto pr-3 text-xs text-fg-muted">
            {working ? (rest.length ? `队列里还有 ${rest.length} 段` : '') : `${data.queue.length} 段待背`}
          </span>
        </header>
        {working && session ? session : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
              {queueList}
            </div>
            {first && (
              <footer className="shrink-0 px-4 py-3 border-t border-border">
                <button type="button" onClick={() => setWorking(true)} className="btn-primary w-full h-12 justify-center text-base font-semibold">
                  {first.progress > 0 ? '继续背第 1 段' : '开始背第 1 段'}
                </button>
              </footer>
            )}
          </>
        )}
      </div>
    </div>
  )
}
