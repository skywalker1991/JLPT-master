import type { TypeTotal } from '../../types'

const LABEL: Record<string, string> = {
  kanji_reading: '漢字読み',
  vocab_fill: '文脈規定',
  synonym: '言い換え類義',
  usage: '用法',
  grammar_fill: '文法形式の判断',
  sentence_order: '文の組み立て',
  passage_fill: '文章の文法',
  reading_comp: '読解',
  info_search: '情報検索',
  listening: '聴解',
}

const PART: Record<string, string> = {
  kanji_reading: '文字・語彙', vocab_fill: '文字・語彙',
  synonym: '文字・語彙', usage: '文字・語彙',
  grammar_fill: '文法', sentence_order: '文法', passage_fill: '文法',
  reading_comp: '読解', info_search: '読解', listening: '聴解',
}

/**
 * What the bank holds, by kind of question.
 *
 * The count is the useful part: practising a type needs enough of it, and
 * which types are thin is not visible from a list of papers.
 */
export default function TypeTotals({ types }: { types: TypeTotal[] }) {
  const total = types.reduce((n, t) => n + t.items, 0)
  const widest = Math.max(1, ...types.map(t => t.items))

  const byPart = new Map<string, TypeTotal[]>()
  for (const t of types) {
    const part = PART[t.type] ?? '其他'
    if (!byPart.has(part)) byPart.set(part, [])
    byPart.get(part)!.push(t)
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <p className="text-xs text-fg-muted mb-4">全库 {total} 题</p>
      {[...byPart.entries()].map(([part, rows]) => (
        <div key={part} className="mb-5">
          <p className="text-xs font-semibold text-fg-muted mb-2">{part}</p>
          <div className="space-y-1.5">
            {rows.map(t => (
              <div key={t.type} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-sm text-fg font-jp">
                  {LABEL[t.type] ?? t.type}
                </span>
                <span className="w-16 shrink-0 text-xs text-fg-muted tabular-nums">
                  {t.items} 题
                </span>
                <span className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(t.items / widest) * 100}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-xs text-fg-subtle">
                  {t.papers} 份卷
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
