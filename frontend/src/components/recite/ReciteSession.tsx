import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Eye, EyeOff, Loader2, Volume2 } from 'lucide-react'
import type { Recitation, TokenInfo } from '../../types'
import { finishRecitation, preprocessBatch } from '../../services/api'
import { tokensFor } from '../../utils/tokens'
import { speak } from '../../utils/speech'
import TokenText from '../shared/TokenText'
import { useSettings } from '../../context/SettingsContext'
import { Connected } from '../shared/Motion'

/**
 * Saying one passage by heart: its sentences one under another, each with
 * the Japanese above — blurred or shown, sentence by sentence or all at
 * once, kana on or off — and the Chinese small beneath it.
 */
export default function ReciteSession({ item, next, onFinished }: {
  item: Recitation
  next: Recitation | null
  onFinished: (startNext: boolean) => void
  onProgress?: (progress: number) => void
}) {
  const [stage, setStage] = useState<'say' | 'done'>('say')
  const { settings } = useSettings()
  const [kana, setKana] = useState(settings.reciteKana)
  const [tokens, setTokens] = useState<TokenInfo[][]>([])
  const [shown, setShown] = useState<Set<number>>(new Set())
  const [speaking, setSpeaking] = useState<number | 'all' | null>(null)
  const all = item.sentences.map((_, i) => i)
  const allShown = shown.size === item.sentences.length

  useEffect(() => {
    preprocessBatch(item.sentences.map(s => s.text))
      .then(r => setTokens(item.sentences.map((s, i) => tokensFor(s.text, r[i] ?? null))))
      .catch(() => {})
  }, [item])

  const toggle = (i: number) => setShown(prev => {
    const x = new Set(prev)
    if (x.has(i)) x.delete(i); else x.add(i)
    return x
  })

  const listen = async (which: number | 'all') => {
    if (speaking != null) return
    setSpeaking(which)
    try { await speak(which === 'all' ? item.sentences.map(x => x.text).join('') : item.sentences[which].text) } finally { setSpeaking(null) }
  }

  const finish = async () => {
    await finishRecitation(item.id).catch(() => {})
    setStage('done')
  }

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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 border-b border-border">
        <div className="max-w-2xl mx-auto px-4 md:px-0 py-2.5 flex items-center gap-2">
          <button type="button" onClick={() => setShown(allShown ? new Set() : new Set(all))} className="btn h-9 border border-border text-fg">
            {allShown ? <><EyeOff className="w-4 h-4" />全部模糊</> : <><Eye className="w-4 h-4" />全部显示</>}
          </button>
          <label className="flex items-center gap-1.5 px-2 text-sm text-fg-muted cursor-pointer">
            <input type="checkbox" checked={kana} onChange={e => setKana(e.target.checked)} className="accent-fg w-4 h-4" />假名
          </label>
          <button type="button" onClick={() => void listen('all')} disabled={speaking != null} className="btn h-9 border border-border text-fg">
            {speaking === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}<span className="hidden sm:inline">听全文</span>
          </button>
          <span className="ml-auto">{back}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ol className="max-w-2xl mx-auto px-5 md:px-0 py-6 md:py-8 flex flex-col gap-6">
          {item.sentences.map((x, i) => {
            const open = shown.has(i)
            return (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-5 pt-2 text-xs text-fg-subtle tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <button type="button" onClick={() => toggle(i)} aria-pressed={open} title={open ? '模糊' : '显示'}
                          className="text-left rounded-md -mx-1 px-1 hover:bg-accent-light/60">
                    <span className={clsx('block transition-[filter] duration-200', !open && 'blur-[6px] select-none')}>
                      <TokenText tokens={tokens[i] ?? []} fallback={x.text} furigana={kana} className="font-jp text-lg md:text-xl leading-[2.1] text-fg" />
                    </span>
                  </button>
                  {x.translation && <p className="text-sm text-fg-muted leading-relaxed">{x.translation}</p>}
                </div>
                <button type="button" onClick={() => void listen(i)} disabled={speaking != null} aria-label="听这一句"
                        className="shrink-0 self-start mt-1.5 p-1.5 text-fg-subtle hover:text-fg disabled:opacity-40">
                  {speaking === i ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <footer className="shrink-0 border-t border-border">
        <div className="max-w-2xl mx-auto px-4 md:px-0 py-3 flex">
          <button type="button" onClick={() => void finish()} className="ml-auto btn-primary h-11 px-6 font-semibold">背完了</button>
        </div>
      </footer>
    </div>
  )
}
