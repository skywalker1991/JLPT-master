import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Loader2, Volume2 } from 'lucide-react'
import type { Recitation, TokenInfo } from '../../types'
import { finishRecitation, preprocessBatch, setRecitationProgress } from '../../services/api'
import { isFunctionToken, tokensFor } from '../../utils/tokens'
import { speak } from '../../utils/speech'
import TokenText from '../shared/TokenText'
import { useSettings } from '../../context/SettingsContext'
import { Connected } from '../shared/Motion'

/** The cues fade level by level: the whole text, then each word's first
 *  character, then only the Chinese. */
export const LEVELS = ['读熟', '首字', '盲背'] as const
const LAST = LEVELS.length - 1

/**
 * Saying one passage by heart, the whole passage at a time. Each level
 * takes away more of the Japanese — first all of it is there to read and
 * listen to, then only each word's first character, then only the
 * Chinese. A hidden sentence can be tapped to peek at; a peeked sentence
 * is marked, showing where it stuck. Say it through, then go up a level
 * (or go through it again); through at 盲背, the passage is done.
 */
export default function ReciteSession({ item, next, onFinished, onProgress }: {
  item: Recitation
  next: Recitation | null
  onFinished: (startNext: boolean) => void
  onProgress?: (progress: number) => void
}) {
  const [level, setLevel] = useState(Math.min(item.progress, LAST))
  const [stage, setStage] = useState<'say' | 'done'>('say')
  const [peeked, setPeeked] = useState<Set<number>>(new Set())
  const { settings } = useSettings()
  const [kana, setKana] = useState(settings.reciteKana)
  const [zh, setZh] = useState(false)
  const [tokens, setTokens] = useState<TokenInfo[][]>([])
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    preprocessBatch(item.sentences.map(s => s.text))
      .then(r => setTokens(item.sentences.map((s, i) => tokensFor(s.text, r[i] ?? null))))
      .catch(() => {})
  }, [item])

  const goTo = (l: number) => {
    setLevel(l)
    setPeeked(new Set())
    onProgress?.(l)
    void setRecitationProgress(item.id, l).catch(() => {})
    document.getElementById('recite-scroll')?.scrollTo({ top: 0 })
  }

  const finish = async () => {
    await finishRecitation(item.id).catch(() => {})
    setStage('done')
  }

  const listen = async () => {
    if (speaking) return
    setSpeaking(true)
    try { await speak(item.sentences.map(x => x.text).join('')) } finally { setSpeaking(false) }
  }

  const peek = (i: number) => setPeeked(prev => new Set(prev).add(i))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Enter' && stage === 'say') { e.preventDefault(); if (level < LAST) goTo(level + 1); else void finish() }
      else if (e.key === 'r' || e.key === 'R') setPeeked(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const back = item.analysis_id && (
    <Link to={`/?analysis=${item.analysis_id}`} className="text-xs text-fg-muted hover:text-fg shrink-0">回到精读 ›</Link>
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

  const showZh = level > 0 || zh
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 border-b border-border">
        <div className="max-w-2xl mx-auto px-4 md:px-0 py-3 flex items-center gap-3">
          <div role="tablist" aria-label="提示程度" className="flex rounded-full bg-accent-light p-1">
            {LEVELS.map((l, i) => (
              <button key={l} type="button" role="tab" aria-selected={i === level} onClick={() => goTo(i)}
                      className={clsx('h-8 px-3.5 rounded-full text-sm transition-colors',
                        i === level ? 'bg-surface text-fg font-semibold shadow-sm' : 'text-fg-muted hover:text-fg')}>
                {l}
              </button>
            ))}
          </div>
          <span className="ml-auto">{back}</span>
        </div>
      </div>

      <div id="recite-scroll" className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 md:px-0 py-6 md:py-8 flex flex-col gap-5">
          {item.sentences.map((x, i) => {
            const open = level === 0 || peeked.has(i)
            return (
              <div key={i} className="flex flex-col gap-1">
                {open ? (
                  <p className={clsx('font-jp text-lg md:text-xl leading-[2] text-fg rounded-md -mx-1 px-1',
                    level > 0 && 'bg-danger-light/60 animate-reveal')}>
                    {level === 0
                      ? <TokenText tokens={tokens[i] ?? []} fallback={x.text} furigana={kana} className="text-lg md:text-xl leading-[2.1]" />
                      : x.text}
                  </p>
                ) : (
                  <button type="button" onClick={() => peek(i)} title="看一眼"
                          className="text-left font-jp text-lg md:text-xl leading-[2] text-fg rounded-md -mx-1 px-1 hover:bg-accent-light">
                    {level === 1 ? <FirstChars tokens={tokens[i]} text={x.text} /> : (
                      <span className="inline-block w-full h-[1.6em] align-middle rounded-md border border-dashed border-border bg-accent-light/40" />
                    )}
                  </button>
                )}
                {showZh && x.translation && (
                  <p className={clsx('leading-relaxed', level === LAST ? 'text-base text-fg' : 'text-sm text-fg-muted')}>{x.translation}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border">
        <div className="max-w-2xl mx-auto px-4 md:px-0 py-3 flex items-center gap-2">
          <button type="button" onClick={() => void listen()} disabled={speaking} aria-label="听全文"
                  className="btn h-11 border border-border text-fg">
            {speaking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}<span className="hidden sm:inline">听全文</span>
          </button>
          {level === 0 ? (
            <span className="flex items-center gap-3 text-sm text-fg-muted">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={kana} onChange={e => setKana(e.target.checked)} className="accent-fg w-4 h-4" />假名</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={zh} onChange={e => setZh(e.target.checked)} className="accent-fg w-4 h-4" />中文</label>
            </span>
          ) : (
            <button type="button" disabled={peeked.size === 0} onClick={() => setPeeked(new Set())}
                    className="btn h-11 border border-border text-fg disabled:opacity-40">
              再来一遍{peeked.size > 0 && <span className="text-danger-fg tabular-nums">· 看了 {peeked.size} 句</span>}
            </button>
          )}
          {level < LAST ? (
            <button type="button" onClick={() => goTo(level + 1)} className="ml-auto btn-primary h-11 px-5 font-semibold">
              {level === 0 ? '读熟了' : '背出来了'} · 下一级
            </button>
          ) : (
            <button type="button" onClick={() => void finish()} className="ml-auto btn-primary h-11 px-5 font-semibold">全部背出来了</button>
          )}
        </div>
      </footer>
    </div>
  )
}

/** A sentence with each word down to its first character; particles and
 *  punctuation stay, so its shape is still there to hang the words on. */
function FirstChars({ tokens, text }: { tokens?: TokenInfo[]; text: string }) {
  if (!tokens?.length) return <span className="text-fg-subtle">{text.slice(0, 1)}{'＿'.repeat(Math.max(0, Math.min(text.length - 1, 12)))}</span>
  return (
    <>
      {tokens.map((t, i) => isFunctionToken(t) || t.surface.length === 1
        ? <span key={i} className="text-fg-muted">{t.surface}</span>
        : (
          <span key={i}>
            {t.surface[0]}
            <span aria-hidden="true" className="inline-block align-baseline border-b border-fg-subtle mx-[0.05em]" style={{ width: `${t.surface.length - 1}em` }} />
          </span>
        ))}
    </>
  )
}
