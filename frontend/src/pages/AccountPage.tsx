import { useState } from 'react'
import { Loader2, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { changePassword } from '../services/api'
import InviteAdmin from '../components/admin/InviteAdmin'
import UserAdmin from '../components/admin/UserAdmin'

export default function AccountPage() {
  const { user, isAdmin, logout } = useAuth()
  const { toast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await changePassword(current, next)
      toast('密码已修改，其他设备已退出登录', 'success')
      setCurrent(''); setNext('')
    } catch (err) {
      toast(err instanceof Error ? err.message : '修改失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-10">
        <section className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold text-fg">账号</h1>
          <div className="card p-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-fg">{user?.display_name || user?.email}</span>
              <span className="text-xs text-fg-muted">{user?.display_name ? `${user.email} · ` : ''}{isAdmin ? '管理员' : '用户'}</span>
            </div>
            <button type="button" className="btn-ghost ml-auto" onClick={logout}>
              <LogOut className="w-4 h-4" />退出登录
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-fg">修改密码</h2>
          <form onSubmit={submit} className="card p-4 flex flex-wrap items-end gap-3">
            <label htmlFor="pw-current" className="flex flex-col gap-1 text-xs text-fg-muted grow min-w-48">
              当前密码
              <input id="pw-current" type="password" required className="input" autoComplete="current-password"
                     value={current} onChange={e => setCurrent(e.target.value)} />
            </label>
            <label htmlFor="pw-next" className="flex flex-col gap-1 text-xs text-fg-muted grow min-w-48">
              新密码（至少 8 位）
              <input id="pw-next" type="password" required minLength={8} className="input" autoComplete="new-password"
                     value={next} onChange={e => setNext(e.target.value)} />
            </label>
            <button type="submit" disabled={busy} className="btn-primary h-9">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}保存
            </button>
          </form>
        </section>

        {isAdmin && <InviteAdmin />}
        {isAdmin && <UserAdmin />}
      </div>
    </div>
  )
}
