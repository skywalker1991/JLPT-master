import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, RotateCcw, X } from 'lucide-react'
import type { AskTarget, ItemReview, SentenceAnalysis, TokenInfo } from '../../types'
import { getItemReading, preprocessBatch } from '../../services/api'
import { useSettings } from '../../context/SettingsContext'
import { useKnown } from '../../hooks/useKnown'
import { tokensFor } from '../../utils/tokens'
import PassageReader from '../reader/PassageReader'
import ReaderToolbar from '../reader/ReaderToolbar'
import SentencePanel from '../analysis/SentencePanel'
import { AskContext } from '../analysis/AskPanel'
import PlayAudio from '../exam/PlayAudio'
import Stem from '../exam/Stem'
import SentenceOrderStem from '../exam/SentenceOrderStem'
import { useItemAnalysis } from './DiffBox'
import type { Mark } from '../../utils/marks'
import { Thinking } from '../shared/Motion'

const KIND_LABEL = { passage: '文章', script: '听力原文', sentence: '正确顺序' }

/**
 * Review of a question you understand by reading: 読解, 文章の文法, 聴解,
 * 整序. The text is read with the same reader as 語料分析 — the gaps
 * marked, a sentence tapped for its translation, words and grammar — and
 * the question with translated options sits beside it.
 */
export default function ReadingReview({ data, itemId, chosen, correct, ask }: {
  data: ItemReview
  itemId: string
  chosen: string | null
  correct: string
  ask: React.ReactNode
}) {
  const prob = data.problem
  const item = prob.items.find(i => i.id === itemId)!
  const { settings } = useSettings()
  const { analysis } = useItemAnalysis(itemId)
  const [reading, setReading] = useState<{ kind: 'passage' | 'script' | 'sentence'; sentences: SentenceAnalysis[] } | null>(null)
  const [tokens, setTokens] = useState<TokenInfo[][]>([])
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [picked, setPicked] = useState<Mark['item'] | null>(null)
  const { known, remember } = useKnown(reading?.sentences ?? [])
  const [attached, setAttached] = useState<AskTarget[]>([])
  const composerRef = useRef<HTMLInputElement>(null)

  // 整序 reads the sentence put in order, which comes from the explanation
  const waitFor = prob.type === 'sentence_order' ? !!analysis : true
  useEffect(() => {
    if (!waitFor) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setFailed(false)
    // Still being analysed: ask again, less often as time goes on
    const ask = (n: number) => getItemReading(itemId)
      .then(async r => {
        if (!live) return
        if (r.pending) {
          if (n >= 40) setFailed(true)
          else timer = setTimeout(() => void ask(n + 1), Math.min(2000 + n * 500, 6000))
          return
        }
        setReading(r)
        setSelected(0)
        const pre = await preprocessBatch(r.sentences.map(s => s.text)).catch(() => null)
        if (live) setTokens(r.sentences.map((s, i) => tokensFor(s.text, pre?.[i] ?? null)))
      })
      .catch(() => { if (live) setFailed(true) })
    void ask(0)
    return () => { live = false; clearTimeout(timer) }
  }, [itemId, waitFor, attempt])

  const options = analysis?.options_analysis ?? []
  const sel = selected != null && reading ? reading.sentences[selected] : null

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-10 py-5 md:py-8 flex flex-col gap-5">
          {prob.type === 'listening' && <PlayAudio itemId={item.id} />}
          <p className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-fg">{reading ? KIND_LABEL[reading.kind] : '文章'}</span>
            {reading && <span className="text-xs text-fg-subtle">{reading.sentences.length} 句</span>}
          </p>
          {failed ? (
            <button type="button" onClick={() => setAttempt(a => a + 1)} className="self-start btn h-9 border border-border">
              <RotateCcw className="w-4 h-4" />文章没分析出来，重试
            </button>
          ) : !reading ? (
            <div className="rounded-xl bg-accent-light px-5 py-4 flex items-center gap-3 text-sm text-fg-muted">
              <Thinking className="w-5 h-5" />正在逐句分析这段{prob.type === 'listening' ? '原文' : '文章'}……第一次要半分钟左右
            </div>
          ) : (
            <AskContext.Provider value={{
              analysisId: null, sentenceIndex: selected, sentenceText: sel?.text ?? null,
              sentenceTranslation: sel?.translation ?? null, asks: [], addAsk: () => {}, busy: false,
              attached, setAttached, composerRef,
            }}>
              <ReaderToolbar />
              <PassageReader
                sentences={reading.sentences.map((s, i) => ({ text: s.text, tokens: tokens[i] ?? [], analysis: s }))}
                selectedIndex={selected}
                onSelect={i => { setSelected(i); setPicked(null) }}
                onPickItem={(i, it) => { setSelected(i); setPicked(it) }}
                threshold={settings.markLevel}
                known={known}
                furigana={!settings.hideFurigana}
                translations={settings.showTranslations}
                streaming={false}
              />
              {sel && selected != null && (
                <div className="rounded-2xl bg-accent-light/60 px-4 md:px-5 py-4">
                  <SentencePanel key={selected} index={selected} text={sel.text} analysis={sel} streaming={false}
                                 threshold={settings.markLevel} known={known} remember={remember}
                                 picked={picked} retrying={false} onRetry={() => {}} />
                </div>
              )}
            </AskContext.Provider>
          )}
        </div>
      </main>

      <aside className="md:w-[28rem] shrink-0 md:border-l border-border overflow-y-auto px-4 md:px-7 py-5 md:py-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-fg tabular-nums">{item.num}</span>
            {prob.type === 'sentence_order' && item.stem
              ? <span className="font-jp text-lg text-fg"><SentenceOrderStem stem={item.stem} /></span>
              : <span className="font-jp text-lg text-fg leading-relaxed"><Stem text={item.stem || '（音声のみ）'} /></span>}
          </p>
          {analysis?.stem_translation && <p className="text-sm text-fg-muted">{analysis.stem_translation}</p>}
          <p className="flex gap-2 text-xs pt-1">
            {chosen && chosen !== correct && <span className="rounded-full bg-danger-light text-danger-fg px-2.5 py-0.5">你选 {chosen}</span>}
            {!chosen && <span className="rounded-full bg-danger-light text-danger-fg px-2.5 py-0.5">没答</span>}
            <span className="rounded-full bg-success-light text-success-fg px-2.5 py-0.5">正解 {correct}</span>
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {Object.entries(item.options).sort(([a], [b]) => a.localeCompare(b)).map(([k, text]) => {
            const row = options.find(o => o.option === k)
            return (
              <li key={k} className={clsx('rounded-xl border px-4 py-3 flex gap-3',
                k === correct ? 'border-fg border-[1.5px]' : k === chosen ? 'border-danger/40 bg-danger-light/50' : 'border-border')}>
                <span className="flex items-start gap-0.5 text-sm font-semibold tabular-nums pt-0.5 w-7 shrink-0">
                  {k}{k === correct ? <Check className="w-3.5 h-3.5 text-success-fg mt-0.5" /> : k === chosen ? <X className="w-3.5 h-3.5 text-danger-fg mt-0.5" /> : null}
                </span>
                <span className="flex flex-col gap-1 min-w-0">
                  <span className="font-jp text-[0.9375rem] text-fg leading-relaxed"><Stem text={text} /></span>
                  {row?.translation && <span className="text-xs text-fg-muted leading-relaxed">{row.translation}</span>}
                </span>
              </li>
            )
          })}
        </ul>
        {ask}
      </aside>
    </div>
  )
}
