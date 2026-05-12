import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BookOpen, AlignLeft } from 'lucide-react'
import { getAtoms } from '../services/api'
import AtomList from '../components/atoms/AtomList'

interface Stats {
  total: number
  vocabulary: number
  grammar: number
}

export default function KnowledgeBasePage() {
  const { pathname } = useLocation()
  const isActive = /^\/kb\/?$/.test(pathname)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!isActive) return
    Promise.all([
      getAtoms({ limit: 1 }),
      getAtoms({ type: 'vocabulary', limit: 1 }),
      getAtoms({ type: 'grammar', limit: 1 }),
    ]).then(([all, vocab, grammar]) => {
      setStats({
        total: all.total,
        vocabulary: vocab.total,
        grammar: grammar.total,
      })
    }).catch(() => {})
  }, [isActive])

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header + stats */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-fg">知识库</h1>
            <p className="text-sm text-fg-muted mt-1">从分析结果中加入的词汇与语法原子</p>
          </div>

          {stats !== null && (
            <div className="flex items-center gap-4 shrink-0">
              <div className="flex items-center gap-2 text-sm">
                <BookOpen className="w-4 h-4 text-blue-500" />
                <span className="text-fg-muted">词汇</span>
                <span className="font-semibold text-fg">{stats.vocabulary}</span>
              </div>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-2 text-sm">
                <AlignLeft className="w-4 h-4 text-orange-500" />
                <span className="text-fg-muted">语法</span>
                <span className="font-semibold text-fg">{stats.grammar}</span>
              </div>
              <div className="w-px h-4 bg-border" />
              <div className="text-sm text-fg-muted">
                共 <span className="font-semibold text-fg">{stats.total}</span> 条
              </div>
            </div>
          )}
        </div>

        <AtomList active={isActive} />
      </div>
    </div>
  )
}
