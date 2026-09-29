import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { sourcePageUrl } from '../../services/api'

/**
 * Where an answer came from, and how far that goes.
 *
 * Shared by the two review surfaces because the moment this matters most is
 * before a paper is imported — that is when the findings are still on the
 * table and the question is whether the extraction matches the page — and
 * the surface for that is the draft. Showing it only after the import put it
 * where the judgement had already been made.
 */

/** The vote a person casts — spelled as the backend spells it. */
export const RULED = '人工判定'

/**
 * How far to trust an answer, from the evidence rather than from a score.
 *
 * A ruling is one of the votes, not their absence: reading "no votes" as
 * "checked" labelled sixty-eight answers nobody had looked at as 已核对.
 */
export function confidenceOf(
  answer: string | null | undefined,
  votes: Record<string, string> | null | undefined,
): string {
  const said = votes ?? {}
  if (RULED in said) return '已核对'
  if (!answer) return '无答案'
  const files = new Set(Object.keys(said).map(k => k.split('·')[0]))
  if (files.size === 0) return '来源未记录'
  return files.size > 1 ? '多源一致' : '单源'
}

const TONE: Record<string, string> = {
  已核对: 'bg-success-light text-success-fg',
  多源一致: 'bg-accent-light text-accent-fg',
  单源: 'bg-orange-100 text-orange-700',
  无答案: 'bg-danger-light text-danger-fg',
  来源未记录: 'bg-border/50 text-fg-muted',
}

export function Confidence({
  answer, votes,
}: {
  answer: string | null | undefined
  votes: Record<string, string> | null | undefined
}) {
  const level = confidenceOf(answer, votes)
  // Counted by file, and the hover names them: 多源一致 means two booklets,
  // not one booklet quoted in two places.
  const said = Object.entries(votes ?? {}).map(([who, v]) => `${who} → ${v}`).join('\n')
  return (
    <span title={said || undefined}
          className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium
                      ${TONE[level] ?? 'bg-border/50 text-fg-muted'}`}>
      {level}
    </span>
  )
}

/** Which of a sitting's files this is, in the words a reviewer uses. */
function kindOf(file: string): string {
  if (/解析|答案|原文/.test(file)) return '解析'
  if (/真题|試題|试题/.test(file)) return '试题'
  return '原件'
}

/** A page of one of the sitting's files, fetched only when asked for. */
export function SourcePage({
  file, page, label,
}: { file?: string | null; page?: number | null; label?: string }) {
  const [open, setOpen] = useState(false)
  if (!file || !page) return null
  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title={file}
        className="shrink-0 flex items-center gap-1 text-xs text-fg-subtle hover:text-accent transition-colors"
      >
        <BookOpen className="w-3 h-3" />{label ?? kindOf(file)} 第 {page} 页
      </button>
      {open && (
        <img
          src={sourcePageUrl(file, page)}
          alt={`${file} 第 ${page} 页`}
          className="w-full mt-2 rounded-lg border border-border"
        />
      )}
    </>
  )
}

/**
 * Every page a question was read from.
 *
 * Usually one. A listening question can have two: the question paper prints
 * 問題1's options, the 解析 booklet prints what is said and the answer — and
 * for 問題3 and 4, which the paper prints nothing of, both are the booklet,
 * and one link is enough.
 */
export function SourcePages({
  file, page, scriptFile, scriptPage,
}: {
  file?: string | null
  page?: number | null
  scriptFile?: string | null
  scriptPage?: number | null
}) {
  const same = file === scriptFile && page === scriptPage
  return (
    <span className="flex items-center gap-3">
      <SourcePage file={file} page={page} />
      {!same && <SourcePage file={scriptFile} page={scriptPage} label="原文" />}
    </span>
  )
}
