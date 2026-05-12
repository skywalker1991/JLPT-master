import { useState } from 'react'
import clsx from 'clsx'
import type { SessionConfig } from '../../types'

interface Props {
  onStart: (config: SessionConfig) => void
}

const PRESET_LIMITS = [10, 20, 50]

const PROMPT_OPTIONS = [
  { value: 'meaning', label: '中文释义' },
  { value: 'reading', label: '读音' },
  { value: 'example', label: '例句' },
]

const JLPT_TAGS = ['N1', 'N2', 'N3', 'N4', 'N5']

export default function SessionSetup({ onStart }: Props) {
  const [limit, setLimit] = useState(20)
  const [customLimit, setCustomLimit] = useState('')
  const [promptType, setPromptType] = useState('meaning')
  const [tag, setTag] = useState('')

  const effectiveLimit = customLimit ? Math.max(1, Math.min(200, parseInt(customLimit) || 20)) : limit

  function handleStart() {
    onStart({ limit: effectiveLimit, promptType, tag: tag.trim() })
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 gap-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-fg">卡牌复习</h2>
        <p className="text-fg-muted text-sm mt-1">从知识库中抽取最需要复习的卡牌</p>
      </div>

      {/* 数量 */}
      <div className="w-full max-w-sm space-y-2">
        <label className="text-sm font-medium text-fg">复习数量</label>
        <div className="flex gap-2">
          {PRESET_LIMITS.map((n) => (
            <button
              key={n}
              onClick={() => { setLimit(n); setCustomLimit('') }}
              className={clsx(
                'btn flex-1',
                limit === n && !customLimit ? 'btn-primary' : 'btn-ghost border border-border',
              )}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={200}
            placeholder="自定义"
            value={customLimit}
            onChange={(e) => setCustomLimit(e.target.value)}
            className="input w-20 text-center"
          />
        </div>
      </div>

      {/* 提示属性 */}
      <div className="w-full max-w-sm space-y-2">
        <label className="text-sm font-medium text-fg">正面提示</label>
        <div className="flex gap-2">
          {PROMPT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPromptType(opt.value)}
              className={clsx(
                'btn flex-1',
                promptType === opt.value ? 'btn-primary' : 'btn-ghost border border-border',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 标签过滤（可选） */}
      <div className="w-full max-w-sm space-y-2">
        <label className="text-sm font-medium text-fg">
          级别筛选 <span className="text-fg-subtle font-normal">（可选）</span>
        </label>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setTag('')}
            className={clsx('btn', !tag ? 'btn-primary' : 'btn-ghost border border-border')}
          >
            全部
          </button>
          {JLPT_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => setTag(t === tag ? '' : t)}
              className={clsx('btn', tag === t ? 'btn-primary' : 'btn-ghost border border-border')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <button onClick={handleStart} className="btn-primary px-8 py-3 text-base">
        开始复习
      </button>
    </div>
  )
}
