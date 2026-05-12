import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, Info, AlertCircle, X } from 'lucide-react'
import clsx from 'clsx'

type ToastType = 'success' | 'info' | 'error'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const ICONS = {
  success: <CheckCircle className="w-4 h-4 text-success-fg shrink-0" />,
  info:    <Info className="w-4 h-4 text-accent shrink-0" />,
  error:   <AlertCircle className="w-4 h-4 text-danger shrink-0" />,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++counter.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.95 }}
              transition={{ duration: 0.18 }}
              className={clsx(
                'pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg',
                'border text-sm font-medium max-w-xs',
                t.type === 'success' && 'bg-white border-success/30 text-fg',
                t.type === 'info'    && 'bg-white border-border text-fg',
                t.type === 'error'   && 'bg-white border-danger/30 text-fg',
              )}
            >
              {ICONS[t.type]}
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="text-fg-subtle hover:text-fg transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
