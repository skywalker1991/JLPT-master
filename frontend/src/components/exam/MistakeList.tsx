import { useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { listMistakes } from '../../services/api'
import AnalysisPanel from './AnalysisPanel'
import PlayAudio from './PlayAudio'
import Stem from './Stem'
import type { MistakeItem } from '../../types'

const CATS = [
  { key: null, label: '全部' },
  { key: 'vocab', label: '単語' },
  { key: 'grammar', label: '文法' },
  { key: 'reading', label: '読解' },
  { key: 'listening', label: '聴解' },
] as const

/**
 * Every question answered wrongly, worst first.
 *
 * Read across records rather than inside one. A mistake made once is worth
 * another look; the same mistake three times is the thing to work on, and that
 * only shows when the records are read together.
 *
 * The explanation hangs off the question, not the record, so a question met
 * again brings the one already generated with it — opening a repeat costs
 * nothing and answers instantly.
 */
export default function MistakeList() {
  const [category, setCategory] = useState<string | null>(null)
  const [items, setItems] = useState<MistakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    listMistakes(category ?? undefined)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [category])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex gap-1 px-5 py-3 border-b border-border">
        {CATS.map(c => (
          <button
            key={c.label}
            onClick={() => setCategory(c.key)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              category === c.key
                ? 'bg-fg/10 text-fg font-medium'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {c.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-fg-subtle self-center">
          {loading ? '' : `${items.length} 道`}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <p className="text-sm text-fg-muted text-center py-12">这里还没有错题</p>
        )}
        {items.map(m => {
          const expanded = open === m.item_id
          return (
            <div key={m.item_id} className="border-b border-border">
              <button
                onClick={() => setOpen(expanded ? null : m.item_id)}
                className="w-full text-left px-5 py-3 hover:bg-bg transition-colors"
              >
                <div className="flex items-baseline gap-2 mb-1">
                  {m.wrong_count > 1 && (
                    <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full
                                     bg-danger-light text-danger-fg">
                      错 {m.wrong_count} 次
                    </span>
                  )}
                  <span className="text-[11px] text-fg-subtle truncate">
                    {m.paper_title.replace('日本語能力試験', '')} · {m.problem_name}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-fg-subtle ml-auto shrink-0 transition-transform
                                           ${expanded ? '' : '-rotate-90'}`} />
                </div>
                <p className="font-jp text-sm text-fg leading-relaxed">
                  <span className="text-xs text-fg-subtle mr-1.5">{m.num}.</span>
                  {m.stem ? <Stem text={m.stem} /> : <span className="text-fg-subtle">（音声のみ）</span>}
                </p>
              </button>

              {expanded && (
                <div className="px-5 pb-4 space-y-3">
                  <div className="space-y-1 pl-5">
                    {['1', '2', '3', '4'].filter(k => k in m.options).map(k => {
                      const right = k === m.correct_answer
                      const picked = m.wrong_answers.includes(k)
                      return (
                        <p
                          key={k}
                          className={`font-jp text-sm ${
                            right ? 'text-success-fg font-semibold'
                              : picked ? 'text-danger-fg' : 'text-fg-muted'
                          }`}
                        >
                          <span className="font-sans text-xs mr-1.5">{k}</span>
                          {m.options[k]}
                          {right && <span className="font-sans text-[10px] ml-2">正解</span>}
                          {picked && <span className="font-sans text-[10px] ml-2">你选的</span>}
                        </p>
                      )
                    })}
                  </div>
                  {m.category === 'listening' && (
                    <PlayAudio itemId={m.item_id} />
                  )}
                  <AnalysisPanel itemId={m.item_id} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
