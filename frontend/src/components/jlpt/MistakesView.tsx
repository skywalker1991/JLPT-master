import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { getJlptMistakes, type MistakeGroup } from '../../services/api'

/**
 * The questions whose latest answer was wrong, from mock exams and practice,
 * by question type. Opening one reviews it with the rest of its type after it.
 */
export default function MistakesView({ onBack, onOpen }: {
  onBack: () => void
  onOpen: (itemIds: string[], startAt: number) => void
}) {
  const [groups, setGroups] = useState<MistakeGroup[] | null>(null)
  useEffect(() => { getJlptMistakes().then(setGroups).catch(() => setGroups([])) }, [])
  const total = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-5 md:py-8 flex flex-col gap-5">
        <header className="flex items-center gap-2">
          <button type="button" onClick={onBack} aria-label="回到 JLPT" className="-ml-2 p-2 text-fg-muted hover:text-fg"><ChevronLeft className="w-5 h-5" /></button>
          <h1 className="text-xl font-bold text-fg">错题</h1>
          {groups && <span className="text-sm text-fg-muted">{total} 题 · 最近一次做错的</span>}
        </header>
        {!groups ? <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /> : groups.length === 0 ? (
          <p className="text-sm text-fg-muted">还没有错题。做练习或模拟考时答错的题会出现在这里，再做对就会离开。</p>
        ) : groups.map(g => (
          <section key={g.id} className="flex flex-col gap-2">
            <h2 className="flex items-baseline gap-2">
              <span className="font-jp text-base font-semibold text-fg">{g.label}</span>
              <span className="text-xs text-fg-subtle">{g.part} · {g.items.length} 题</span>
              <button type="button" onClick={() => onOpen(g.items.map(i => i.item_id), 0)} className="ml-auto text-sm text-fg underline underline-offset-4">
                从头看
              </button>
            </h2>
            <ul className="rounded-xl border border-border bg-surface divide-y divide-border">
              {g.items.map((it, i) => (
                <li key={it.item_id}>
                  <button type="button" onClick={() => onOpen(g.items.map(x => x.item_id), i)}
                          className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-accent-light/60">
                    <span className="text-xs text-fg-subtle w-24 shrink-0">{it.paper} · {it.num}</span>
                    <span className="font-jp text-sm text-fg truncate flex-1">{it.stem || '（音声のみ）'}</span>
                    {it.misses > 1 && <span className="text-xs text-danger-fg shrink-0">错 {it.misses} 次</span>}
                    <ChevronRight className="w-4 h-4 text-fg-subtle shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
