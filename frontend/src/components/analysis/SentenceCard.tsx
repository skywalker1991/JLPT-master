import { useState } from 'react'
import clsx from 'clsx'
import { Volume2, Loader2, Eye, EyeOff, Keyboard, RotateCcw } from 'lucide-react'
import type { SentenceAnalysis, PreprocessedSentence } from '../../types'
import { useSettings } from '../../context/SettingsContext'
import TokenText from '../shared/TokenText'
import { speak } from '../../utils/speech'
import { checkTyping } from '../../utils/tokens'
import { AskSection } from './AskPanel'

interface Props {
  preprocessed: PreprocessedSentence
  analysis: SentenceAnalysis | null
}

/**
 * The current sentence. Japanese and the translation can each be hidden for
 * recall practice (hide 日文 → recall it from the Chinese; hide 中文 → recall
 * the meaning; hide both → listen only). Hidden Japanese can be peeked at one
 * 文節 at a time, or typed and checked 文節 by 文節.
 * Local state resets per sentence (the card is remounted on sentence change).
 */
export default function SentenceCard({ preprocessed, analysis }: Props) {
  const { settings, updateSettings } = useSettings()
  const [speaking, setSpeaking] = useState(false)
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set())
  const [zhRevealed, setZhRevealed] = useState(false)
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [marks, setMarks] = useState<boolean[] | null>(null)

  const handleSpeak = async () => {
    if (speaking) return
    setSpeaking(true)
    try { await speak(preprocessed.text) } finally { setSpeaking(false) }
  }

  const check = () => {
    if (!typed.trim() || preprocessed.tokens.length === 0) return
    setMarks(checkTyping(preprocessed.tokens, typed))
  }
  const retry = () => { setMarks(null); setTyped('') }

  const hideJa = settings.hideJa && !marks
  const correct = marks?.filter(Boolean).length ?? 0

  return (
    <div className="rounded-xl bg-accent-light/40 border border-accent-border/50 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <TokenText
            tokens={preprocessed.tokens}
            fallback={preprocessed.text}
            className="text-lg md:text-xl font-semibold leading-loose tracking-wide"
            hidden={hideJa}
            revealed={revealed}
            onReveal={i => setRevealed(prev => new Set(prev).add(i))}
            marks={marks}
          />
        </div>
        <button
          onClick={handleSpeak}
          disabled={speaking}
          className="btn-ghost p-1.5 rounded-lg shrink-0 text-fg-subtle hover:text-accent mt-1 disabled:opacity-40"
          title={speaking ? '朗读中…' : '朗读'}
        >
          {speaking
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Volume2 className="w-4 h-4" />
          }
        </button>
      </div>

      {marks && (
        <p className="text-xs text-fg-muted">
          对了 <span className="font-semibold text-fg tabular-nums">{correct} / {marks.length}</span> 个文节
          {correct < marks.length && '，红色是写错或漏掉的'}
        </p>
      )}

      {analysis?.translation && (
        settings.hideZh && !zhRevealed ? (
          <button
            type="button"
            onClick={() => setZhRevealed(true)}
            className="block w-full text-left text-sm text-fg-subtle border-t border-accent-border/40 pt-2"
          >
            <span className="inline-block rounded-md bg-border px-3 py-0.5">中文已隐藏，点击显示</span>
          </button>
        ) : (
          <p className="text-sm text-fg-muted border-t border-accent-border/40 pt-2 leading-relaxed">
            {analysis.translation}
          </p>
        )
      )}

      {typing && (
        <div className="space-y-2 pt-1">
          <textarea
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (!marks) check()
              }
            }}
            readOnly={!!marks}
            rows={2}
            placeholder="打出这句日语（假名或汉字都可以），回车核对"
            aria-label="输入日语"
            className="input resize-none text-base"
          />
          <div className="flex gap-2">
            {marks ? (
              <button key="retry" type="button" onClick={retry} className="btn-ghost text-xs gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" />重新打
              </button>
            ) : (
              <button key="check" type="button" onClick={check} disabled={!typed.trim()} className="btn-primary text-xs">
                核对
              </button>
            )}
          </div>
        </div>
      )}

      {/* Practice controls */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Toggle
          on={!settings.hideJa}
          label="日文"
          onClick={() => { updateSettings({ hideJa: !settings.hideJa }); setRevealed(new Set()) }}
        />
        <Toggle
          on={!settings.hideZh}
          label="中文"
          onClick={() => { updateSettings({ hideZh: !settings.hideZh }); setZhRevealed(false) }}
        />
        <button
          type="button"
          onClick={() => { setTyping(t => !t); retry() }}
          aria-pressed={typing}
          className={clsx(
            'btn text-xs gap-1.5 py-1 px-2.5 rounded-full ring-1',
            typing ? 'bg-accent text-white ring-accent' : 'text-fg-muted ring-border hover:text-fg',
          )}
        >
          <Keyboard className="w-3.5 h-3.5" />打字
        </button>
      </div>

      {/* folded by default: an open thread would push the words / grammar far down */}
      <AskSection kind="sentence" label="问这句" defaultOpen={false} />
    </div>
  )
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  const Icon = on ? Eye : EyeOff
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={on ? `隐藏${label}` : `显示${label}`}
      className={clsx(
        'btn text-xs gap-1.5 py-1 px-2.5 rounded-full ring-1',
        on ? 'text-fg-muted ring-border hover:text-fg' : 'bg-fg text-bg ring-fg',
      )}
    >
      <Icon className="w-3.5 h-3.5" />{label}
    </button>
  )
}
