import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Download } from 'lucide-react'
import type { ReviewSettings } from '../types'
import { getReviewSettings, updateReviewSettings } from '../services/api'
import { useSettings, type ClozeAnswer, type JpSize, type MarkLevel, type Theme } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'

const THEMES: { value: Theme; label: string; ground: string; ink: string }[] = [
  { value: 'system', label: '跟随系统', ground: 'linear-gradient(90deg,#FAF9F7 50%,#141414 50%)', ink: '#8A8580' },
  { value: 'kami', label: '紙', ground: '#FAF9F7', ink: '#1C1917' },
  { value: 'yoru', label: '夜', ground: '#141414', ink: '#D6C59C' },
  { value: 'ai', label: '藍', ground: '#F4F6F9', ink: '#2B4C7E' },
  { value: 'koke', label: '苔', ground: '#F5F5EE', ink: '#55653A' },
]

const SECTIONS = [['look', '外观'], ['read', '阅读'], ['review', '复习'], ['data', '数据']] as const

const speechSupported = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

/**
 * 设置: four groups. These are the defaults — the switches on a page
 * (threshold, furigana, translations) change only that one time.
 */
export default function SettingsPage() {
  const { settings, updateSettings } = useSettings()
  const { toast } = useToast()
  const [review, setReview] = useState<ReviewSettings | null>(null)

  useEffect(() => { getReviewSettings().then(setReview).catch(() => {}) }, [])

  const saveReview = async (patch: Partial<ReviewSettings>) => {
    try { setReview(await updateReviewSettings(patch)) } catch { toast('没存上，请再试一次', 'error') }
  }

  const segmented = <T extends string>(value: T, options: [T, string, boolean?][], onChange: (v: T) => void, label: string) => (
    <span role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-accent-light p-1 shrink-0">
      {options.map(([v, text, disabled]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
                className={clsx('h-8 px-3 rounded-lg text-sm disabled:opacity-40',
                  value === v ? 'bg-surface text-fg font-semibold shadow-card' : 'text-fg-muted')}>
          {text}
        </button>
      ))}
    </span>
  )

  const row = (title: string, hint: string, control: React.ReactNode, id?: string) => (
    <div className="flex items-center gap-4 py-4 border-b border-border">
      <label htmlFor={id} className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[0.9375rem] text-fg">{title}</span>
        {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
      </label>
      {control}
    </div>
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-10 py-6 md:py-10 flex gap-12">
        <nav className="hidden md:flex w-56 shrink-0 flex-col gap-1 sticky top-6 self-start">
          <h1 className="text-2xl font-bold text-fg pb-4">设置</h1>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-accent-light hover:text-fg">{label}</a>
          ))}
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          <h1 className="md:hidden text-xl font-bold text-fg pb-2">设置</h1>

          <h2 id="look" className="text-xs font-semibold text-fg-subtle pt-4 scroll-mt-6">外观</h2>
          {row('主题', '', (
            <span role="radiogroup" aria-label="主题" className="flex flex-wrap justify-end gap-2">
              {THEMES.map(t => (
                <button key={t.value} type="button" role="radio" aria-checked={settings.theme === t.value}
                        onClick={() => updateSettings({ theme: t.value })}
                        className={clsx('w-[4.5rem] rounded-xl border p-1.5 flex flex-col items-center gap-1.5 text-xs',
                          settings.theme === t.value ? 'border-fg border-[1.5px]' : 'border-border')}>
                  <span className="w-full h-8 rounded-lg flex items-center justify-center" style={{ background: t.ground }}>
                    <span className="w-6 h-[3px] rounded-full" style={{ background: t.ink }} />
                  </span>
                  <span className="text-fg">{t.label}</span>
                </button>
              ))}
            </span>
          ))}
          {row('日文字号', '',
            segmented<JpSize>(settings.jpSize, [['sm', '小'], ['md', '中'], ['lg', '大']], v => updateSettings({ jpSize: v }), '日文字号'))}

          <h2 id="read" className="text-xs font-semibold text-fg-subtle pt-8 scroll-mt-6">阅读（语料分析、JLPT 解析）</h2>
          {row('生词标注门槛', '', (
            <select id="set-level" value={settings.markLevel} onChange={e => updateSettings({ markLevel: e.target.value as MarkLevel })} className="input w-28">
              <option value="N1">N1</option><option value="N2">N2 以上</option><option value="N3">N3 以上</option>
              <option value="N4">N4 以上</option><option value="all">全部</option>
            </select>
          ), 'set-level')}
          {row('振假名', '', (
            <input id="set-furigana" type="checkbox" checked={!settings.hideFurigana} className="accent-fg w-5 h-5"
                   onChange={e => updateSettings({ hideFurigana: !e.target.checked })} />
          ), 'set-furigana')}
          {row('逐句译文', '', (
            <input id="set-zh" type="checkbox" checked={settings.showTranslations} className="accent-fg w-5 h-5"
                   onChange={e => updateSettings({ showTranslations: e.target.checked })} />
          ), 'set-zh')}

          <h2 id="review" className="text-xs font-semibold text-fg-subtle pt-8 scroll-mt-6">复习（内化学习）</h2>
          {row('每天新卡上限', '', (
            <input id="set-new" type="number" min={0} max={200} key={review?.new_cards_per_day} defaultValue={review?.new_cards_per_day ?? ''}
                   onBlur={e => { const v = Number(e.target.value); if (review && Number.isFinite(v) && v !== review.new_cards_per_day) void saveReview({ new_cards_per_day: v }) }}
                   className="input w-24 text-right tabular-nums" />
          ), 'set-new')}
          {row('目标记住率', '越高，复习越频繁', (
            <select id="set-ret" value={review ? String(review.desired_retention) : ''} onChange={e => void saveReview({ desired_retention: Number(e.target.value) })} className="input w-24">
              {[0.8, 0.85, 0.9, 0.95].map(r => <option key={r} value={String(r)}>{Math.round(r * 100)}%</option>)}
            </select>
          ), 'set-ret')}
          {row('挖空卡怎么答', speechSupported ? '' : '这个浏览器不支持语音识别',
            segmented<ClozeAnswer>(settings.clozeAnswer, [['self', '自评'], ['type', '打字'], ['speak', '说出来', !speechSupported]],
              v => updateSettings({ clozeAnswer: v }), '挖空卡怎么答'))}
          {row('背诵：假名提示', '', (
            <input id="set-kana" type="checkbox" checked={settings.reciteKana} className="accent-fg w-5 h-5"
                   onChange={e => updateSettings({ reciteKana: e.target.checked })} />
          ), 'set-kana')}

          <h2 id="data" className="text-xs font-semibold text-fg-subtle pt-8 scroll-mt-6">数据</h2>
          {row('导出知识库', '', (
            <a href="/api/kb/export.csv" download className="btn h-10 border border-border text-fg"><Download className="w-4 h-4" />导出 CSV</a>
          ))}
        </div>
      </div>
    </div>
  )
}
