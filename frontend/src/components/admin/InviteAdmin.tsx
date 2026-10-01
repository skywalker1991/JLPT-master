import { useEffect, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { createInvites, listInvites, updateInvite, type InviteRow } from '../../services/api'
import { useToast } from '../../context/ToastContext'

function fmt(iso: string | null): string {
  if (!iso) return '不过期'
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日过期`
}

const linkFor = (code: string) => `${window.location.origin}/join?code=${code}`

/** Invite codes, for an admin: one per post or group, so it shows which one brought whom. */
export default function InviteAdmin() {
  const { toast } = useToast()
  const [rows, setRows] = useState<InviteRow[] | null>(null)
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState(30)
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = () => listInvites().then(setRows).catch(e => toast(String(e.message ?? e), 'error'))
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const [made] = await createInvites({
        note, max_uses: maxUses,
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      })
      await copy(made.code)
      setNote('')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '生成失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code))
      toast(`已复制邀请链接 ${code}`, 'success')
    } catch {
      toast(linkFor(code), 'info')
    }
  }

  async function toggle(row: InviteRow) {
    try {
      await updateInvite(row.code, { is_active: !row.is_active })
      toast(row.is_active ? `已停用 ${row.code}` : `已恢复 ${row.code}`, 'success')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-fg">邀请码</h2>
        <p className="text-xs text-fg-muted">每篇笔记或每个群发一个码，就能看出谁是从哪来的。停用只挡住后来的人，已注册的不受影响。</p>
      </div>

      <form onSubmit={add} className="card p-4 flex flex-wrap items-end gap-3">
        <label htmlFor="invite-note" className="flex flex-col gap-1 text-xs text-fg-muted grow min-w-48">
          备注（发在哪）
          <input id="invite-note" className="input" placeholder="小红书 · 第一篇招募帖" value={note}
                 onChange={e => setNote(e.target.value)} maxLength={200} />
        </label>
        <label htmlFor="invite-max" className="flex flex-col gap-1 text-xs text-fg-muted w-24">
          最多几人
          <input id="invite-max" type="number" min={1} max={1000} required className="input" value={maxUses}
                 onChange={e => setMaxUses(Number(e.target.value))} />
        </label>
        <label htmlFor="invite-expires" className="flex flex-col gap-1 text-xs text-fg-muted">
          过期日（可不填）
          <input id="invite-expires" type="date" className="input" value={expires}
                 onChange={e => setExpires(e.target.value)} />
        </label>
        <button type="submit" disabled={busy} className="btn-primary h-9">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}生成并复制链接
        </button>
      </form>

      {rows === null ? (
        <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">还没有邀请码</p>
      ) : (
        <ul className="card divide-y divide-border">
          {rows.map(r => {
            const full = r.used_count >= r.max_uses
            const expired = r.expires_at !== null && new Date(r.expires_at) < new Date()
            const state = !r.is_active ? '已停用' : full ? '已用完' : expired ? '已过期' : null
            return (
              <li key={r.code} className="p-4 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`font-mono text-sm tracking-wider ${state ? 'text-fg-subtle line-through' : 'text-fg'}`}>{r.code}</span>
                  <span className="text-sm text-fg truncate min-w-0">{r.note ?? '—'}</span>
                  {state && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg text-fg-muted border border-border">{state}</span>}
                  <span className="ml-auto text-xs text-fg-muted tabular-nums">
                    {r.used_count} / {r.max_uses} 人 · {fmt(r.expires_at)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn h-8 text-xs border border-border text-fg hover:bg-bg" onClick={() => copy(r.code)}>
                    <Copy className="w-3.5 h-3.5" />复制链接
                  </button>
                  <button type="button" className="btn-ghost h-8 text-xs" onClick={() => toggle(r)}>
                    {r.is_active ? '停用' : '恢复'}
                  </button>
                  {r.users.length > 0 && (
                    <button type="button" className="btn-ghost h-8 text-xs" aria-expanded={open === r.code}
                            onClick={() => setOpen(open === r.code ? null : r.code)}>
                      {open === r.code ? '收起' : `看看是谁（${r.users.length}）`}
                    </button>
                  )}
                </div>
                {open === r.code && (
                  <ul className="text-xs text-fg-muted flex flex-col gap-1 pl-1">
                    {r.users.map(u => <li key={u}>{u}</li>)}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
