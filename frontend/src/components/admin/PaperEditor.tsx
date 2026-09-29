import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { editExamItem, editExamProblem, getBankPaper } from '../../services/api'
import { Confidence, SourcePages } from './Provenance'
import RuledText from './RuledText'
import QuestionText from '../exam/QuestionText'
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

  // After a ruling, without the spinner: a correction to a shared passage
  // lands on every question holding it, and the page has to show that
  // without losing the reader's place.
  const reload = async () => setPaper(await getBankPaper(paperId))

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
                  {/* Where the questions carry their own texts the 問題 has
                      none — see split_passages. */}
                  {/* The picture is the passage where there is one — the
                      text beside it is the same notice flattened, and the
                      arrangement is what the question is about. */}
                  {problem.passage && problem.media.length === 0 && (
                    <RuledText
                      label="文章"
                      text={problem.passage}
                      onSave={async (next, reason) => {
                        await editExamProblem(problem.id, {
                          passage: next, ...(reason ? { note: reason } : {}),
                        })
                        await reload()
                      }}
                    />
                  )}
                  {/* 情報検索 keeps the printed page: the arrangement is
                      what the question asks about, so it is the thing to
                      check, not the flattened text beside it. */}
                  {problem.media.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {problem.media.map(m => (
                        <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                          <img src={m.url} alt={m.caption ?? ''}
                               className="max-h-80 rounded-lg border border-border" />
                        </a>
                      ))}
                    </div>
                  )}
                  {problem.items.map((item, i) => (
                    <div key={item.id} className="space-y-2">
                      {/* 問題8 prints four unrelated passages under one heading
                          and 問題9 three, so a text belongs to its questions
                          rather than to the 問題 — shown once for the run of
                          questions that share it. */}
                      {item.passage && item.passage !== problem.items[i - 1]?.passage && (
                        <RuledText
                          label={`文章（第 ${item.num} 题起）`}
                          text={item.passage}
                          onSave={async (next, reason) => {
                            await editExamItem(item.id, {
                              passage: next, ...(reason ? { note: reason } : {}),
                            })
                            await reload()
                          }}
                        />
                      )}
                      <ItemRow item={item} type={problem.type} onSaved={reload} />
                    </div>
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

function ItemRow({
  item, type, onSaved,
}: { item: ItemSchema; type: string; onSaved: () => Promise<void> }) {
  const [answer, setAnswer] = useState(item.correct_answer ?? '')
  const [stem, setStem] = useState(item.stem ?? '')
  const [opts, setOpts] = useState<Record<string, string>>(item.options ?? {})
  const [transcript, setTranscript] = useState(item.transcript ?? '')
  const [editing, setEditing] = useState(false)
  // Why. A ruling kept without its reason cannot be checked when it is met
  // again — and every ruling here is met again at every re-import.
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const changes: Record<string, unknown> = {}
  if (answer !== (item.correct_answer ?? '')) changes.correct_answer = answer || null
  if (stem !== (item.stem ?? '')) changes.stem = stem
  if (JSON.stringify(opts) !== JSON.stringify(item.options ?? {})) changes.options = opts
  if (transcript !== (item.transcript ?? '')) changes.transcript = transcript
  const dirty = Object.keys(changes).length > 0

  async function save() {
    setSaving(true)
    try {
      await editExamItem(item.id, { ...changes, ...(reason.trim() ? { note: reason.trim() } : {}) })
      setEditing(false)
      setReason('')
      await onSaved()
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`rounded-lg px-3 py-2 space-y-1.5 border-l-2 ${
      dirty ? 'border-accent bg-accent-light/20' : 'border-transparent hover:bg-bg'}`}>
      {(item.media ?? []).map(m => (
        <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
          <img src={m.url} alt={m.caption ?? ''}
               className="max-h-80 rounded-lg border border-border" />
        </a>
      ))}
      <p className="font-jp text-sm text-fg leading-relaxed">
        <span className="font-sans text-xs text-fg-subtle mr-1.5">{item.num ?? item.seq}.</span>
        <QuestionText stem={item.stem} type={type} num={item.num}
                      transcript={item.transcript} />
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5">
        <Confidence answer={item.correct_answer} votes={item.answer_votes} />
        {OPTS.filter(k => k in item.options).map(k => (
          <button
            key={k}
            onClick={() => setAnswer(k === answer ? '' : k)}
            className={`font-jp text-xs text-left transition-colors ${
              k === answer ? 'text-success font-semibold' : 'text-fg-muted hover:text-fg'
            }`}
          >
            <span className="font-sans font-bold mr-1">{k}</span>{item.options[k]}
          </button>
        ))}
        {/* 並べ替え is scored on one blank but only makes sense as the whole
            sentence — without the ordering there is no way to see whether the
            marked answer is the right one. */}
        {type === 'sentence_order' && item.answer_order && (
          <span className="font-sans text-xs text-fg-subtle">语序 {item.answer_order}</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <button onClick={() => setEditing(!editing)}
                  className="text-xs text-fg-subtle hover:text-accent transition-colors">
            {editing ? '收起' : '改文字'}
          </button>
          <SourcePages file={item.source_file} page={item.source_page}
                       scriptFile={item.script_file} scriptPage={item.script_page} />
        </span>
      </div>

      {/* The text as the paper prints it, with the page one click away to
          check against. Every slot a question can have is offered, not only
          the ones that were read: an option the text layer lost has nowhere
          to be typed otherwise. */}
      {editing && (
        <div className="pl-5 space-y-1.5">
          <textarea
            value={stem}
            onChange={e => setStem(e.target.value)}
            rows={Math.max(1, Math.ceil(stem.length / 40))}
            placeholder="题干"
            className="w-full bg-bg border border-border rounded px-2 py-1 text-sm font-jp text-fg"
          />
          {OPTS.map(k => (
            <label key={k} className="flex items-center gap-2 text-xs text-fg-muted">
              <span className="font-bold w-3">{k}</span>
              <input
                value={opts[k] ?? ''}
                placeholder={k in opts ? undefined : '（未读出）'}
                onChange={e => {
                  const next = { ...opts, [k]: e.target.value }
                  if (!e.target.value) delete next[k]
                  setOpts(next)
                }}
                className="flex-1 bg-bg border border-border rounded px-2 py-0.5 text-xs font-jp text-fg"
              />
            </label>
          ))}
          {item.transcript != null && item.transcript !== '' && (
            <label className="block text-xs text-fg-muted space-y-1">
              <span>聴解原文</span>
              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                rows={Math.min(20, Math.max(4, transcript.split('\n').length + 1))}
                className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-jp
                           text-fg leading-relaxed"
              />
            </label>
          )}
        </div>
      )}

      {dirty && (
        <div className="flex items-center gap-2 pl-5">
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={'answer' in changes || 'correct_answer' in changes
              ? '依据（例：答案页 20-25=432131）' : '依据（例：解析第 25 页原文是「…」）'}
            className="flex-1 bg-bg border border-border rounded px-2 py-0.5 text-xs text-fg"
          />
          <button onClick={() => {
                    setAnswer(item.correct_answer ?? ''); setStem(item.stem ?? '')
                    setOpts(item.options ?? {}); setTranscript(item.transcript ?? '')
                    setReason('')
                  }}
                  className="text-xs text-fg-subtle hover:text-fg">撤销</button>
          <button onClick={save} disabled={saving}
                  className="text-xs text-accent hover:underline flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            判定
          </button>
        </div>
      )}

      {/* For 聴解 the dialogue IS the question — the paper prints nothing, and
          the text is filled in from the 解析 booklet. A character count says
          something landed; only the text says it landed on the right 番. */}
      {item.transcript && !editing && (
        <details className="ml-5 rounded-lg border border-border">
          <summary className="px-2.5 py-1 text-xs text-fg-subtle cursor-pointer">
            聴解原文（{item.transcript.length} 字）
          </summary>
          <p className="px-2.5 pb-2 font-jp text-xs text-fg-muted leading-relaxed whitespace-pre-wrap">
            {item.transcript}
          </p>
        </details>
      )}
    </div>
  )
}
