import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { editExamItem, getBankPaper } from '../../services/api'
import Passage from '../exam/Passage'
import Stem from '../exam/Stem'
import type { ExamPaperDetail, ItemSchema } from '../../types'

const OPTS = ['1', '2', '3', '4']

/**
 * Correcting a paper that is already in the bank.
 *
 * Until now a mistake found after import could only be flagged and left: the
 * review page edits a draft, and a draft stops existing once the paper does.
 * But a wrong answer in the bank is wrong on every attempt made against it
 * from here on, so it has to be fixable where it lives.
 *
 * Every change is kept as a revision, because an attempt was answered against
 * the wording as it stood.
 */
export default function PaperEditor({ paperId }: { paperId: string }) {
  const [paper, setPaper] = useState<ExamPaperDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getBankPaper(paperId)
      .then(setPaper)
      .catch(() => setPaper(null))
      .finally(() => setLoading(false))
  }, [paperId])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-fg-muted" />
      </div>
    )
  }
  if (!paper) {
    return <div className="flex-1 flex items-center justify-center text-sm text-danger">读不到这份卷子</div>
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="shrink-0 px-5 py-3 border-b border-border flex items-baseline gap-3">
        <h1 className="text-base font-semibold text-fg">{paper.title}</h1>
        <span className="text-xs text-fg-muted">
          {paper.sections.reduce(
            (n, s) => n + s.problems.reduce((m, p) => m + p.items.length, 0), 0)} 题 · 已入库
        </span>
        <span className="ml-auto text-xs text-fg-subtle">改动会记入修订历史</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-4 space-y-5">
          {paper.sections.map(section => (
            <section key={section.id} className="space-y-3">
              <h2 className="text-sm font-semibold text-fg sticky top-0 bg-bg py-1.5 z-10">
                {section.name}
              </h2>
              {section.problems.map(problem => (
                <div key={problem.id} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-fg">{problem.name}</span>
                    <span className="text-xs text-fg-subtle">{problem.type}</span>
                    <span className="text-xs text-fg-subtle">{problem.items.length} 题</span>
                  </div>
                  {problem.passage && !problem.items.some(i => i.passage) && (
                    <details className="rounded-lg border border-border">
                      <summary className="px-3 py-1.5 text-xs text-fg-muted cursor-pointer">文章</summary>
                      <Passage text={problem.passage}
                               className="px-3 pb-2.5 text-xs text-fg-muted leading-relaxed whitespace-pre-wrap" />
                    </details>
                  )}
                  {problem.items.map(item => (
                    <ItemRow key={item.id} item={item} type={problem.type} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function ItemRow({ item, type }: { item: ItemSchema; type: string }) {
  const [answer, setAnswer] = useState(item.correct_answer ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save(next: string) {
    setAnswer(next)
    setSaving(true)
    setSaved(false)
    try {
      await editExamItem(item.id, { correct_answer: next })
      setSaved(true)
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg px-3 py-2 space-y-1.5 border-l-2 border-transparent hover:bg-bg">
      <p className="font-jp text-sm text-fg leading-relaxed">
        <span className="font-sans text-xs text-fg-subtle mr-1.5">{item.num ?? item.seq}.</span>
        {item.stem
          ? <Stem text={item.stem} />
          : <span className="text-fg-subtle">（音声のみ）</span>}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5">
        {OPTS.filter(k => k in item.options).map(k => (
          <button
            key={k}
            onClick={() => save(k)}
            className={`font-jp text-xs text-left transition-colors ${
              k === answer ? 'text-success font-semibold' : 'text-fg-muted hover:text-fg'
            }`}
          >
            <span className="font-sans font-bold mr-1">{k}</span>{item.options[k]}
          </button>
        ))}
        {type === 'listening' && item.transcript && (
          <span className="text-xs text-fg-subtle">原文 {item.transcript.length} 字</span>
        )}
        {/* 並べ替え is scored on one blank but only makes sense as the whole
            sentence — without the ordering there is no way to see whether the
            marked answer is the right one. */}
        {type === 'sentence_order' && item.answer_order && (
          <span className="font-sans text-xs text-fg-subtle">语序 {item.answer_order}</span>
        )}
        {saving && <Loader2 className="w-3 h-3 animate-spin text-fg-muted" />}
        {saved && !saving && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="w-3 h-3" />已保存
          </span>
        )}
      </div>
    </div>
  )
}
