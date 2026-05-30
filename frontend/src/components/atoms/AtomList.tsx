import { useState, useEffect, useRef } from 'react'
import { Search, Loader2, Database, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useAtoms } from '../../hooks/useAtoms'
import AtomCard from './AtomCard'

const TYPE_TABS = [
  { value: '', label: '全部' },
  { value: 'vocabulary', label: '词汇' },
  { value: 'grammar', label: '语法' },
]

const LIMIT = 20

interface AtomListProps {
  active?: boolean
  selectedId?: string
  onSelect?: (id: string) => void
  compact?: boolean
  jumpToKey?: string | null
}

export default function AtomList({ active = true, selectedId, onSelect, compact, jumpToKey }: AtomListProps) {
  const { atoms, total, isLoading, filters, setFilter, nextPage, prevPage } = useAtoms(active)
  const [searchInput, setSearchInput] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setFilter('search', searchInput)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchInput, setFilter])

  // Sync left list when graph selects a node
  useEffect(() => {
    if (!selectedId) return

    // Small delay so the selected card renders with the new selectedId prop first
    const t = setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-atom-id="${selectedId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } else if (jumpToKey) {
        // Atom is on a different page — search by key to bring it into view
        setSearchInput(jumpToKey)
        setFilter('search', jumpToKey)
        setFilter('page', 0)
      }
    }, 50)

    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, jumpToKey])

  // After a jump-search loads, scroll the found item into view
  useEffect(() => {
    if (!selectedId || !jumpToKey || isLoading) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-atom-id="${selectedId}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [atoms, selectedId, jumpToKey, isLoading])

  const totalPages = Math.ceil(total / LIMIT)
  const currentPage = filters.page

  return (
    <div className="space-y-4">
      {/* Search + filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索词条..."
            className="input pl-9"
          />
        </div>

        <div className="flex items-center gap-1 bg-bg rounded-lg border border-border p-1">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter('type', tab.value)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 cursor-pointer',
                filters.type === tab.value
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-fg-muted hover:text-fg hover:bg-surface',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      )}

      {!isLoading && atoms.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-fg-subtle">
          <Database className="w-12 h-12 mb-3 opacity-25" />
          <p className="text-sm font-medium">暂无词条</p>
          <p className="text-xs mt-1 text-fg-subtle">分析文章后点击「加入知识库」添加</p>
        </div>
      )}

      {!isLoading && atoms.length > 0 && (
        <div
          ref={listRef}
          className={compact ? 'flex flex-col gap-2' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3'}
        >
          {atoms.map((atom) => (
            <AtomCard
              key={atom.id}
              atom={atom}
              selected={atom.id === selectedId}
              onSelect={onSelect}
              compact={compact}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <span className="text-xs text-fg-subtle">
            共 {total} 条，第 {currentPage + 1} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={prevPage}
              disabled={currentPage === 0}
              className="btn-ghost h-8 px-3 gap-1 text-sm"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              上一页
            </button>
            <button
              onClick={nextPage}
              disabled={currentPage >= totalPages - 1}
              className="btn-ghost h-8 px-3 gap-1 text-sm"
            >
              下一页
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
