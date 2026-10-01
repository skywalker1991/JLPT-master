import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import * as api from '../services/api'
import type { AuthUser } from '../services/api'

type Status = 'loading' | 'signed-out' | 'signed-in'

interface AuthContextValue {
  status: Status
  user: AuthUser | null
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, displayName?: string, inviteCode?: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

/** Who is signed in. The session itself is an httpOnly cookie the page never
 *  sees; this only asks the server who it belongs to, and drops back to the
 *  sign-in page whenever the server stops recognising it. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    let alive = true
    api.getMe()
      .then(u => { if (alive) { setUser(u); setStatus('signed-in') } })
      .catch(() => { if (alive) { setUser(null); setStatus('signed-out') } })
    const onUnauthorized = () => { setUser(null); setStatus('signed-out') }
    window.addEventListener(api.UNAUTHORIZED_EVENT, onUnauthorized)
    return () => { alive = false; window.removeEventListener(api.UNAUTHORIZED_EVENT, onUnauthorized) }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.login(email, password)
    setUser(u)
    setStatus('signed-in')
  }, [])

  const signup = useCallback(async (email: string, password: string, displayName?: string, inviteCode?: string) => {
    const u = await api.signup(email, password, displayName, inviteCode)
    setUser(u)
    setStatus('signed-in')
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } finally {
      // A full reload, so nothing the last person had open stays in memory.
      window.location.assign('/')
    }
  }, [])

  return (
    <AuthContext.Provider value={{ status, user, isAdmin: user?.role === 'admin', login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
