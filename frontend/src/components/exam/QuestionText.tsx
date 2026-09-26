import Stem from './Stem'

/**
 * A question's text, including the two cases where the paper prints none.
 *
 * Two kinds of question legitimately have no stem and they are nothing
 * alike: 聴解 prints nothing because the question is spoken, and 文章の文法
 * prints nothing because the question is a gap in the passage above. Every
 * place that drew an empty stem had hardcoded 「音声のみ」, so 問題7 read as
 * an audio question everywhere it appeared — the draft review was the one
 * screen that told them apart, and that is exactly why this lives here now
 * rather than being written out a fourth time.
 */
export default function QuestionText({
  stem, type, num, transcript,
}: {
  stem: string | null
  type: string
  num?: number | null
  transcript?: string | null
}) {
  if (stem) return <Stem text={stem} />

  if (type === 'listening') {
    return (
      <span className="text-fg-subtle">
        {transcript ? '（音声のみ — 原文见下）' : '（音声のみ）'}
      </span>
    )
  }
  if (type === 'passage_fill' && num != null) {
    return <span className="text-fg-subtle">（文章中の【{num}】）</span>
  }
  return <span className="text-fg-subtle italic">（试卷上未印内容）</span>
}
