import { useState, useCallback, useEffect } from 'react'
import type { AtomListItem } from '../types'
import { getAtoms } from '../services/api'

interface AtomFilters {
  type: string
  search: string
  tag: string
  page: number
}

interface UseAtomsReturn {
  atoms: AtomListItem[]
  total: number
  isLoading: boolean
  filters: AtomFilters
  fetchAtoms: () => Promise<void>
  setFilter: <K extends keyof AtomFilters>(key: K, value: AtomFilters[K]) => void
  nextPage: () => void
  prevPage: () => void
}

const LIMIT = 20

export function useAtoms(active = true): UseAtomsReturn {
  const [atoms, setAtoms] = useState<AtomListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [filters, setFilters] = useState<AtomFilters>({
    type: '',
    search: '',
    tag: '',
    page: 0,
  })

  const fetchAtoms = useCallback(async () => {
    setIsLoading(true)
    try {
      const params: {
        type?: string
        search?: string
        tag?: string
        page?: number
        limit?: number
      } = {
        page: filters.page,
        limit: LIMIT,
      }
      if (filters.type) params.type = filters.type
      if (filters.search) params.search = filters.search
      if (filters.tag) params.tag = filters.tag

      const result = await getAtoms(params)
      setAtoms(result.items)
      setTotal(result.total)
    } catch (err) {
      console.error('Failed to fetch atoms:', err)
    } finally {
      setIsLoading(false)
    }
  }, [filters])

  const setFilter = useCallback(<K extends keyof AtomFilters>(
    key: K,
    value: AtomFilters[K],
  ) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      // reset page when filter changes (unless setting page directly)
      ...(key !== 'page' ? { page: 0 } : {}),
    }))
  }, [])

  const nextPage = useCallback(() => {
    setFilters((prev) => ({ ...prev, page: prev.page + 1 }))
  }, [])

  const prevPage = useCallback(() => {
    setFilters((prev) => ({ ...prev, page: Math.max(0, prev.page - 1) }))
  }, [])

  useEffect(() => {
    if (active) fetchAtoms()
  }, [fetchAtoms, active])

  return {
    atoms,
    total,
    isLoading,
    filters,
    fetchAtoms,
    setFilter,
    nextPage,
    prevPage,
  }
}
