import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createUser, listUsers, updateUser, type AdminUserRow } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** Accounts, for an admin: with sign-up closed this is how anyone gets one. */
export default function UserAdmin() {
  const { user: me } = useAuth()
  const { toast } = useToast()
  const [rows, setRows] = useState<AdminUserRow[] | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [busy, setBusy] = useState(false)
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const load = () => listUsers().then(setRows).catch(e => toast(String(e.message ?? e), 'error'))
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await createUser({ email, password, role })
      toast(`已创建 ${email}`, 'success')
      setEmail(''); setPassword(''); setRole('user')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '创建失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function change(row: AdminUserRow, body: Parameters<typeof updateUser>[1], done: string) {
    try {
      await updateUser(row.id, body)
      toast(done, 'success')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-fg">账号管理</h2>

      <form onSubmit={add} className="card p-4 flex flex-wrap items-end gap-3">
        <label htmlFor="new-user-email" className="flex flex-col gap-1 text-xs text-fg-muted grow min-w-48">
          邮箱
          <input id="new-user-email" type="email" required className="input" value={email}
                 onChange={e => setEmail(e.target.value)} />
        </label>
        <label htmlFor="new-user-password" className="flex flex-col gap-1 text-xs text-fg-muted grow min-w-40">
          初始密码（至少 8 位）
          <input id="new-user-password" type="text" required minLength={8} className="input" value={password}
                 onChange={e => setPassword(e.target.value)} autoComplete="off" />
        </label>
        <label htmlFor="new-user-role" className="flex flex-col gap-1 text-xs text-fg-muted">
          角色
          <select id="new-user-role" className="input" value={role}
                  onChange={e => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">用户</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <button type="submit" disabled={busy} className="btn-primary h-9">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}创建账号
        </button>
      </form>

      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="w-4 h-4 animate-spin" />加载中</div>
      ) : (
        <div className="card divide-y divide-border">
          {rows.map(row => {
            const self = row.id === me?.id
            return (
              <div key={row.id} className="p-4 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-fg">{row.email}</span>
                  {row.role === 'admin' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent text-on-accent">管理员</span>}
                  {!row.is_active && <span className="text-[11px] px-2 py-0.5 rounded-full bg-danger-light text-danger-fg">已停用</span>}
                  {self && <span className="text-[11px] text-fg-subtle">（你）</span>}
                  <span className="ml-auto text-xs text-fg-subtle tabular-nums">
                    词条 {row.atoms} · 分析 {row.analyses} · 做题 {row.attempts} · 创建 {fmt(row.created_at)} · 最近登录 {fmt(row.last_login_at)}
                  </span>
                </div>
                {!self && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-ghost text-xs h-8"
                            onClick={() => { setResetFor(resetFor === row.id ? null : row.id); setNewPassword('') }}>
                      重置密码
                    </button>
                    <button type="button" className="btn-ghost text-xs h-8"
                            onClick={() => change(row, { role: row.role === 'admin' ? 'user' : 'admin' },
                              row.role === 'admin' ? '已取消管理员' : '已设为管理员')}>
                      {row.role === 'admin' ? '取消管理员' : '设为管理员'}
                    </button>
                    <button type="button" className={row.is_active ? 'btn-danger text-xs h-8' : 'btn-ghost text-xs h-8'}
                            onClick={() => change(row, { is_active: !row.is_active }, row.is_active ? '已停用，并已退出所有设备' : '已启用')}>
                      {row.is_active ? '停用' : '启用'}
                    </button>
                  </div>
                )}
                {resetFor === row.id && (
                  <form className="flex flex-wrap items-center gap-2"
                        onSubmit={e => { e.preventDefault(); change(row, { password: newPassword }, '已重置，对方需要用新密码重新登录'); setResetFor(null) }}>
                    <label htmlFor={`reset-${row.id}`} className="sr-only">新密码</label>
                    <input id={`reset-${row.id}`} type="text" minLength={8} required className="input max-w-xs"
                           placeholder="新密码（至少 8 位）" value={newPassword}
                           onChange={e => setNewPassword(e.target.value)} autoComplete="off" />
                    <button type="submit" className="btn-primary h-9 text-xs">确认重置</button>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
