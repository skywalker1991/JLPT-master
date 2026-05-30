import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BookOpen, AlignLeft } from 'lucide-react'
import { getAtoms } from '../services/api'
import AtomList from '../components/atoms/AtomList'
import KnowledgeGraph from '../components/atoms/KnowledgeGraph'

interface Stats {
  total: number
  vocabulary: number
  grammar: number
}

export default function KnowledgeBasePage() {
  const { pathname } = useLocation()
  const isActive = /^\/kb\/?$/.test(pathname)
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [jumpToKey, setJumpToKey] = useState<string | null>(null)

  function handleListSelect(id: string) {
    setSelectedId(prev => prev === id ? null : id)
    setJumpToKey(null)
  }

  function handleGraphSelect(id: string, key: string) {
    setSelectedId(id)
    setJumpToKey(key)
  }

  useEffect(() => {
    if (!isActive) return
    Promise.all([
      getAtoms({ limit: 1 }),
      getAtoms({ type: 'vocabulary', limit: 1 }),
      getAtoms({ type: 'grammar', limit: 1 }),
    ]).then(([all, vocab, grammar]) => {
      setStats({ total: all.total, vocabulary: vocab.total, grammar: grammar.total })
    }).catch(() => {})
  }, [isActive])

  return (
    <div className="flex flex-1 min-h-0 p-4 gap-4 overflow-hidden">

      {/* Left: atom list */}
      <div className="card w-full md:w-80 shrink-0 flex flex-col overflow-hidden">
        <div className="px-4 py-4 border-b border-border shrink-0 space-y-2">
          <div>
            <h1 className="text-base font-bold text-fg">知识库</h1>
            <p className="text-xs text-fg-muted mt-0.5">词汇与语法原子</p>
          </div>
          {stats !== null && (
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <BookOpen className="w-3 h-3 text-blue-500" />
                <span className="text-fg-muted">词汇</span>
                <span className="font-semibold text-fg">{stats.vocabulary}</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1">
                <AlignLeft className="w-3 h-3 text-orange-500" />
                <span className="text-fg-muted">语法</span>
                <span className="font-semibold text-fg">{stats.grammar}</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <span className="text-fg-muted">共 <span className="font-semibold text-fg">{stats.total}</span> 条</span>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <AtomList active={isActive} selectedId={selectedId ?? undefined} onSelect={handleListSelect} jumpToKey={jumpToKey} compact />
        </div>
      </div>

      {/* Right: knowledge graph */}
      <div className="card hidden md:flex flex-1 flex-col min-h-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-border shrink-0">
          <h1 className="text-base font-bold text-fg">知识图谱</h1>
          <p className="text-xs text-fg-muted mt-0.5">词条关联网络 · 点击节点选中词条</p>
        </div>
        <KnowledgeGraph selectedId={selectedId} onSelectAtom={handleGraphSelect} />
      </div>

    </div>
  )
}
