import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ImagePlus, X } from 'lucide-react'
import Logo from '../shared/Logo'

const EXAMPLE = '日本の少子高齢化は年々深刻さを増している。働く世代が減る一方で、医療や介護にかかる費用は増え続けている。'

interface Props {
  text: string
  imageData: string | null
  imageMime: string
  error: string | null
  /** Nothing analysed yet: introduce the page and offer an example */
  firstUse: boolean
  onTextChange: (v: string) => void
  onImagePick: (file: File) => void
  onImageClear: () => void
  onSubmit: () => void
}

/** Rough count the way a reader thinks of it: sentences and characters. */
function measure(text: string) {
  const t = text.trim()
  if (!t) return null
  const sentences = t.split(/(?<=[。！？!?\n])/).filter(s => s.trim()).length
  return `${sentences} 句 · ${t.replace(/\s/g, '').length} 字`
}

/**
 * The big box for a new passage. It is the only thing on the page when
 * nothing is open; paste text, or drop / pick a screenshot.
 */
export default function NewAnalysisBox({
  text, imageData, imageMime, error, firstUse, onTextChange, onImagePick, onImageClear, onSubmit,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const canSubmit = !!imageData || !!text.trim()
  const count = measure(text)

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 px-4 md:px-0 py-8 md:py-16">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-xl md:text-2xl font-bold text-fg tracking-[-0.01em]">
          <Logo className="w-8 h-8 md:w-9 md:h-9 shrink-0" />
          {firstUse ? '从一段你读不懂的日语开始' : '新建分析'}
        </h1>
        {firstUse && (
          <p className="text-sm md:text-[0.9375rem] text-fg-muted leading-relaxed max-w-2xl">
            从电子书、网页复制一段，或者拖入截图。分析完，你卡住的词和语法会留在知识库里，之后在提取练习里复习。
          </p>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit() }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'))
          if (file) onImagePick(file)
        }}
        className={clsx(
          'rounded-2xl border-[1.5px] bg-surface flex flex-col gap-3 p-4 transition-colors',
          dragging ? 'border-dashed border-fg' : 'border-fg',
        )}
      >
        {imageData ? (
          <div className="flex items-start gap-3 min-h-[8rem]">
            <div className="relative">
              <img src={`data:${imageMime};base64,${imageData}`} alt="要分析的截图"
                   className="max-h-40 max-w-[16rem] rounded-lg border border-border object-contain" />
              <button type="button" onClick={onImageClear} aria-label="去掉这张截图"
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-fg text-bg flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-sm text-fg-muted pt-1">截图里的日语会先识别出来，再逐句分析</p>
          </div>
        ) : (
          <>
            <label htmlFor="new-analysis" className="sr-only">要分析的日语</label>
            <textarea
              id="new-analysis"
              value={text}
              onChange={e => onTextChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canSubmit) onSubmit() }
              }}
              rows={5}
              placeholder="粘贴一段日语……"
              className="w-full resize-none bg-transparent font-jp text-base md:text-lg leading-[1.9] text-fg
                         placeholder:text-fg-subtle placeholder:font-jp outline-none"
            />
          </>
        )}
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
                 onChange={e => { const f = e.target.files?.[0]; if (f) onImagePick(f); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()}
                  className="btn h-9 border border-dashed border-fg-subtle text-fg-muted hover:text-fg">
            <ImagePlus className="w-4 h-4" />截图
          </button>
          {count && !imageData && <span className="text-xs text-fg-subtle tabular-nums">{count}</span>}
          <button type="submit" disabled={!canSubmit} className="btn-primary ml-auto h-11 px-6 text-base font-semibold">
            分析
          </button>
        </div>
      </form>
      {error && <p role="alert" className="text-sm text-danger-fg -mt-3">{error}</p>}

      {firstUse && !text && !imageData && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-fg-subtle">手边没有文本？</span>
          <div className="flex flex-col md:flex-row gap-3">
            <button type="button" onClick={() => onTextChange(EXAMPLE)}
                    className="md:max-w-md text-left rounded-xl border border-border p-4 flex flex-col gap-1.5 hover:border-fg-subtle">
              <span className="text-xs text-fg-muted">试一段示例</span>
              <span className="font-jp text-sm text-fg leading-relaxed">{EXAMPLE}</span>
            </button>
            <Link to="/jlpt" className="rounded-xl border border-border p-4 flex flex-col gap-1.5 justify-center hover:border-fg-subtle">
              <span className="text-xs text-fg-muted">或者</span>
              <span className="text-sm font-semibold text-fg">先做一套 JLPT 真题 ›</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
