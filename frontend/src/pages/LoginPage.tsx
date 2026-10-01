import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Idle, Thinking } from '../components/shared/Motion'
import { useAuth } from '../context/AuthContext'
import { getAuthConfig, type SignupMode } from '../services/api'
import { suggestEmail } from '../utils/emailTypo'

// An invite link is <site>/join?code=XXXX-XXXX; any path works, the code is what matters.
const linkCode = new URLSearchParams(window.location.search).get('code') ?? ''

export default function LoginPage() {
  const { login, signup } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>(linkCode ? 'signup' : 'login')
  const [code, setCode] = useState(linkCode)
  const [signupMode, setSignupMode] = useState<SignupMode>('closed')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAuthConfig().then(c => setSignupMode(c.signup_mode)).catch(() => {})
  }, [])

  const suggestion = suggestEmail(email)
  const canSignup = signupMode === 'open' || signupMode === 'invite'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await login(email, password)
      else await signup(email, password, name, signupMode === 'invite' ? code : undefined)
      if (window.location.search.includes('code=')) window.history.replaceState(null, '', '/')
    } catch (err) {
      setError(err instanceof Error ? err.message : '出错了，请再试一次')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg flex items-center justify-center px-4"
         style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* The mark keeps connecting while the page waits, and thinks while signing in */}
          {busy ? <Thinking className="w-12 h-12 text-fg" /> : <Idle className="w-12 h-12 text-fg" />}
          <h1 className="text-xl font-semibold text-fg tracking-[-0.02em]">日本語 Master</h1>
          <p className="text-sm text-fg-muted">
            {mode === 'login' ? '登录后继续你的语料、知识库和复习' : '创建账号，开始你自己的词典'}
          </p>
        </div>

        <form onSubmit={submit} className="card p-6 flex flex-col gap-4">
          {mode === 'signup' && signupMode === 'invite' && (
            <label className="flex flex-col gap-1.5 text-sm text-fg" htmlFor="signup-code">
              邀请码
              <input id="signup-code" required className="input font-mono tracking-wider uppercase"
                     autoComplete="off" autoCapitalize="characters" spellCheck={false}
                     placeholder="XXXX-XXXX" value={code} onChange={e => setCode(e.target.value)} />
            </label>
          )}
          {mode === 'signup' && (
            <label className="flex flex-col gap-1.5 text-sm text-fg" htmlFor="signup-name">
              称呼（可不填）
              <input id="signup-name" className="input" autoComplete="nickname"
                     value={name} onChange={e => setName(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm text-fg" htmlFor="login-email">
            邮箱
            <input id="login-email" type="email" required className="input" autoComplete="email"
                   inputMode="email" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          {mode === 'signup' && suggestion && (
            <p className="text-xs text-fg-muted -mt-2">
              是不是 <button type="button" className="text-fg font-medium underline underline-offset-4"
                            onClick={() => setEmail(suggestion)}>{suggestion}</button>？
              邮箱暂不验证，写错了就收不到以后的通知
            </p>
          )}
          <label className="flex flex-col gap-1.5 text-sm text-fg" htmlFor="login-password">
            密码
            <input id="login-password" type="password" required className="input"
                   minLength={mode === 'signup' ? 8 : undefined}
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                   value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {mode === 'signup' && <p className="text-xs text-fg-subtle -mt-2">至少 8 位</p>}

          {error && (
            <p role="alert" className="text-sm text-danger-fg bg-danger-light rounded-lg px-3 py-2">{error}</p>
          )}

          <button type="submit" disabled={busy} className="btn-primary justify-center h-11 text-base disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <p className="text-center text-sm text-fg-muted">
          {canSignup ? (
            mode === 'login' ? (
              <>{signupMode === 'invite' ? '有邀请码？' : '还没有账号？'}<button type="button" className="text-fg font-medium underline underline-offset-4"
                               onClick={() => { setMode('signup'); setError(null) }}>注册</button></>
            ) : (
              <>已有账号？<button type="button" className="text-fg font-medium underline underline-offset-4"
                             onClick={() => { setMode('login'); setError(null) }}>登录</button></>
            )
          ) : '账号由管理员创建；忘记密码请联系管理员重置'}
        </p>
      </div>
    </div>
  )
}
