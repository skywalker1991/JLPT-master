import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import type { AtomDetail } from '../types'
import { getAtom, deleteAtom } from '../services/api'
import AtomDetailView from '../components/atoms/AtomDetailView'

export default function AtomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<AtomDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    setIsLoading(true)
    setError(null)

    getAtom(id)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load atom'))
      .finally(() => setIsLoading(false))
  }, [id])

  const handleDelete = async () => {
    if (!id || !window.confirm('确认删除此词条？此操作不可撤销。')) return
    setIsDeleting(true)
    try {
      await deleteAtom(id)
      navigate('/kb')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-danger mb-4">{error ?? '词条不存在'}</p>
        <button onClick={() => navigate('/kb')} className="btn-ghost">
          返回知识库
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/kb')}
          className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          知识库
        </button>

        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-sm text-danger hover:text-danger/80 transition-colors cursor-pointer disabled:opacity-50"
        >
          {isDeleting ? '删除中...' : '删除'}
        </button>
      </div>

      <AtomDetailView detail={detail} />
    </div>
  )
}
