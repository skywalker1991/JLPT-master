import { useCallback, useEffect, useRef, useState } from 'react'

const SECONDS = 10

interface Pending { label: string; commit: () => Promise<void>; undo: () => void }

/**
 * A removal that can be taken back for ten seconds. The change shows at once;
 * it is sent to the server only when the time is up (or the page is left),
 * so undoing needs nothing from the server. No trash to empty later.
 */
export function useUndo() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [left, setLeft] = useState(SECONDS)
  const ref = useRef<Pending | null>(null)

  const flush = useCallback(() => {
    const p = ref.current
    ref.current = null
    setPending(null)
    if (p) void p.commit().catch(() => {})
  }, [])

  const schedule = useCallback((p: Pending) => {
    if (ref.current) flush()  // one at a time: the previous one goes through
    ref.current = p
    setPending(p)
    setLeft(SECONDS)
  }, [flush])

  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => setLeft(l => {
      if (l <= 1) { clearInterval(t); flush(); return 0 }
      return l - 1
    }), 1000)
    return () => clearInterval(t)
  }, [pending, flush])

  // Leaving the page commits what was waiting
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    return () => { document.removeEventListener('visibilitychange', onHide); flush() }
  }, [flush])

  const undo = () => {
    const p = ref.current
    ref.current = null
    setPending(null)
    p?.undo()
  }

  const toast = pending && (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-8 z-[70] flex items-center gap-3 rounded-2xl bg-fg text-bg pl-5 pr-3 py-3 shadow-lg">
      <span className="text-sm">{pending.label}</span>
      <button type="button" onClick={undo} className="h-8 px-3 rounded-lg border border-bg/30 text-sm font-semibold">撤销</button>
      <span className="text-xs opacity-70 tabular-nums w-8">{left} 秒</span>
    </div>
  )

  return { schedule, toast }
}
