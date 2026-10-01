import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Loader2, Volume2 } from 'lucide-react'
import type { Recitation, TokenInfo } from '../../types'
import { finishRecitation, preprocessBatch, setRecitationProgress } from '../../services/api'
import { tokensFor } from '../../utils/tokens'
import { speak } from '../../utils/speech'
import TokenText from '../shared/TokenText'
import { useSettings } from '../../context/SettingsContext'
import { Connected } from '../shared/Motion'

type Stage = 'line' | 'chain' | 'done'

/**
 * Saying one passage by heart. The whole passage stays in view: sentences
 * already said keep their Japanese, faded; the one being said shows its
 * Chinese with the Japanese hidden (shown whole, on demand, to check); the
 * rest show only Chinese. A sentence not yet said doesn't move on.
 *
 * Then 连段: the whole passage from the top in one go, marking the
 * sentences that stuck, which are practised alone before going through again.
 */
export default function ReciteSession({ item, next, onFinished, onProgress }: {
  item: Recitation
  next: Recitation | null
  onFinished: (startNext: boolean) => void
  onProgress?: (progress: number) => void
}) {
  const n = item.sentences.length
  const [at, setAt] = useState(Math.min(item.progress, n))
  const [stage, setStage] = useState<Stage>(item.progress >= n ? 'chain' : 'line')
  const [shown, setShown] = useState(false)
  const { settings } = useSettings()
  const [kana, setKana] = useState(settings.reciteKana)
  const [tokens, setTokens] = useState<TokenInfo[][]>([])
  const [speaking, setSpeaking] = useState(false)
  const [stuck, setStuck] = useState<Set<number>>(new Set())
  /** Sentences being practised alone after a 连段 (null = the whole passage) */
  const [only, setOnly] = useState<number[] | null>(null)

  useEffect(() => {
    preprocessBatch(item.sentences.map(s => s.text))
      .then(r => setTokens(item.sentences.map((s, i) => tokensFor(s.text, r[i] ?? null))))
      .catch(() => {})
  }, [item])

  const order = only ?? item.sentences.map((_, i) => i)
  const current = order[at]

  const advance = useCallback(() => {
    if (stage !== 'line') return
    const nextAt = at + 1
    setShown(false)
    if (nextAt >= order.length) {
      setStage('chain')
      setOnly(null)
      setStuck(new Set())
      if (!only) { onProgress?.(n); void setRecitationProgress(item.id, n).catch(() => {}) }
      return
    }
    setAt(nextAt)
    if (!only) { onProgress?.(nextAt); void setRecitationProgress(item.id, nextAt).catch(() => {}) }
  }, [stage, at, order.length, only, item.id, n, onProgress])

  const say = async (text: string) => {
    if (speaking) return
    setSpeaking(true)
    try { await speak(text) } finally { setSpeaking(false) }
  }

  const finish = async () => {
    await finishRecitation(item.id).catch(() => {})
    setStage('done')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === ' ') { e.preventDefault(); setShown(s => !s) }
      else if (e.key === 'r' || e.key === 'R') setShown(false)
      else if (e.key === 'Enter' && stage === 'line') { e.preventDefault(); advance() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, stage])

  const title = item.sentences[0]?.text.slice(0, 14) + (item.sentences[0]?.text.length > 14 ? '…' : '')
  const back = item.analysis_id && (
    <Link to={`/?analysis=${item.analysis_id}`} className="btn h-8 text-xs rounded-full border border-border text-fg shrink-0">回到语料重新学 ›</Link>
  )

  if (stage === 'done') {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto px-5 md:px-0 py-8 flex flex-col items-center gap-5 max-w-xl mx-auto w-full">
          <Connected className="w-12 h-12" />
          <div className="text-center flex flex-col gap-1">
            <h2 className="text-xl font-bold text-fg">这一段背完了</h2>
            <p className="text-sm text-fg-muted">收进「已背完」，随时可以再背一遍</p>
          </div>
          <p className="w-full rounded-2xl bg-accent-light px-5 py-4 font-jp text-[0.9375rem] leading-[1.9] text-fg-muted">
            {item.sentences.map(s => s.text).join('')}
          </p>
          {next && (
            <div className="w-full flex flex-col gap-2 pt-2 border-t border-border">
              <span className="text-xs text-fg-subtle pt-3">下一段</span>
              <div className="rounded-2xl border border-fg px-5 py-4 flex flex-col gap-1">
                <p className="font-jp text-base leading-relaxed text-fg">{next.sentences.map(s => s.text).join('').slice(0, 60)}</p>
                <p className="text-xs text-fg-subtle">{next.sentences.length} 句</p>
              </div>
            </div>
          )}
        </div>
        <footer className="shrink-0 px-4 py-3 border-t border-border flex gap-3 max-w-xl mx-auto w-full">
          <button type="button" onClick={() => onFinished(false)} className="btn flex-1 h-12 justify-center border border-border text-fg">今天到这</button>
          {next && <button type="button" onClick={() => onFinished(true)} className="btn-primary flex-[1.3] h-12 justify-center font-semibold">开始下一段</button>}
        </footer>
      </div>
    )
  }

  if (stage === 'chain') {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-5 md:px-0 py-6 md:py-10 flex flex-col gap-5">
            <p className="text-xs font-semibold text-fg-subtle">{n > 1 ? `${n} 句都背出来了 · 现在从头连起来` : '再完整说一遍'}</p>
            <p className="text-lg md:text-xl font-semibold text-fg leading-relaxed">{item.sentences.map(s => s.translation).join('')}</p>
            <div className="border-t border-border pt-4 flex flex-col gap-3">
              <p className="text-xs font-semibold text-fg-subtle">{shown ? '点出卡住的句子' : '背完点「显示」对照'}</p>
              {shown ? (
                <p className="font-jp text-lg leading-[2] text-fg animate-reveal">
                  {item.sentences.map((s, i) => (
                    <span key={i} role="button" tabIndex={0} aria-pressed={stuck.has(i)}
                          onClick={() => setStuck(prev => { const x = new Set(prev); if (x.has(i)) x.delete(i); else x.add(i); return x })}
                          className={clsx('rounded-[0.25em] cursor-pointer box-decoration-clone', stuck.has(i) ? 'bg-danger-light text-danger-fg' : 'hover:bg-accent-light')}>
                      {s.text}
                    </span>
                  ))}
                </p>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-accent-light/50 px-4 py-6 text-center text-sm text-fg-subtle">日文已隐藏</div>
              )}
            </div>
            {back}
          </div>
        </div>
        <footer className="shrink-0 px-4 py-3 border-t border-border flex gap-3 max-w-2xl mx-auto w-full">
          {!shown ? (
            <button type="button" onClick={() => setShown(true)} className="btn-primary flex-1 h-12 justify-center font-semibold">显示</button>
          ) : (
            <>
              <button type="button" disabled={stuck.size === 0}
                      onClick={() => { setOnly([...stuck].sort((a, b) => a - b)); setAt(0); setShown(false); setStage('line') }}
                      className="btn flex-1 h-12 justify-center border border-border text-fg disabled:opacity-40">练卡住的句子</button>
              <button type="button" onClick={() => void finish()} className="btn-primary flex-[1.3] h-12 justify-center font-semibold">全部顺下来了</button>
            </>
          )}
        </footer>
      </div>
    )
  }

  const s = item.sentences[current]
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 md:px-0 py-5 md:py-10 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <span className="font-jp truncate">{title}</span>
            <span className="text-fg-subtle shrink-0">· {only ? `卡住的第 ${at + 1} / ${order.length} 句` : `第 ${at + 1} / ${n} 句`}</span>
            <span className="ml-auto">{back}</span>
          </div>

          {item.sentences.map((x, i) => {
            const pos = order.indexOf(i)
            const said = only ? !order.includes(i) || pos < at : i < at
            if (i === current) {
              return (
                <section key={i} className="rounded-2xl border-[1.5px] border-fg bg-surface px-5 md:px-7 py-5 flex flex-col gap-4 animate-rise-in">
                  <p className="text-lg md:text-xl font-semibold text-fg leading-relaxed">{s.translation || '（没有译文）'}</p>
                  {shown ? (
                    <div className="font-jp text-xl md:text-2xl leading-[2] text-fg animate-reveal">
                      <TokenText tokens={tokens[i] ?? []} fallback={x.text} furigana={kana} className="text-xl md:text-2xl leading-[2.2]" />
                    </div>
                  ) : (
                    <button type="button" onClick={() => setShown(true)}
                            className="self-start rounded-lg border border-dashed border-fg-subtle bg-accent-light/60 px-4 py-2.5 text-sm text-fg-subtle">
                      日文已隐藏 · 点「显示」对照
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => void say(x.text)} disabled={speaking}
                            className="btn h-9 rounded-full border border-border text-fg">
                      {speaking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}听原句
                    </button>
                    <label className="ml-auto flex items-center gap-1.5 text-sm text-fg-muted cursor-pointer">
                      <input type="checkbox" checked={kana} onChange={e => setKana(e.target.checked)} className="accent-fg w-4 h-4" />假名提示
                    </label>
                  </div>
                </section>
              )
            }
            return said ? (
              <p key={i} className="flex gap-2 font-jp text-base text-fg-subtle leading-relaxed">
                <Check className="w-4 h-4 text-success-fg shrink-0 mt-1" />{x.text}
              </p>
            ) : (
              <p key={i} className="flex gap-2 text-base text-fg-subtle leading-relaxed">
                <span className="w-3 h-3 rounded-full border border-fg-subtle shrink-0 mt-1.5 ml-0.5" />{x.translation}
              </p>
            )
          })}

        </div>
      </div>
      <footer className="shrink-0 border-t border-border">
        <div className="md:hidden px-4 py-3 flex gap-2">
          <button type="button" onClick={() => setShown(v => !v)} className="btn flex-1 h-12 justify-center border border-border text-fg">{shown ? '隐藏' : '显示'}</button>
          <button type="button" onClick={() => setShown(false)} className="btn flex-1 h-12 justify-center border border-danger/30 bg-danger-light/60 text-danger-fg">再来一遍</button>
          <button type="button" onClick={advance} className="btn-primary flex-[1.4] h-12 justify-center font-semibold">背出了，下一句</button>
        </div>
        <div className="hidden md:flex items-center justify-center gap-8 h-16 text-sm text-fg-muted">
          <button type="button" onClick={() => setShown(v => !v)} className="flex items-center gap-2"><kbd className="kbd">空格</kbd>显示 / 隐藏</button>
          <button type="button" onClick={() => setShown(false)} className="flex items-center gap-2"><kbd className="kbd">R</kbd>再来一遍</button>
          <button type="button" onClick={advance} className="flex items-center gap-2"><kbd className="kbd">回车</kbd>背出了，下一句</button>
        </div>
      </footer>
    </div>
  )
}
