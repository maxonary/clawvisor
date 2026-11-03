import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CreatedInstanceInvite, type InstanceUser, type InstanceRole } from '../api/client'
import { useAuth } from '../hooks/useAuth'

const button = 'px-3 py-2 text-sm rounded-md border border-border-default hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed'
const field = 'px-3 py-2 text-sm rounded-md border border-border-default bg-surface-0 text-text-primary'
type Action = { kind: 'role'; user: InstanceUser; role: InstanceRole } | { kind: 'remove'; user: InstanceUser } | { kind: 'revoke'; id: string; email: string }

export default function Users() {
  const { user, currentOrg, features } = useAuth()
  if (user?.role !== 'admin' || currentOrg || !features?.user_management) {
    return <div className="p-4 sm:p-8"><h1 className="text-2xl font-bold">Users</h1><p className="mt-3 text-text-secondary">User management is available to instance administrators only.</p></div>
  }
  return <UserManagement currentUserId={user.id} />
}

function UserManagement({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient()
  const key = ['instance-users', currentUserId]
  const [email, setEmail] = useState('')
  const [created, setCreated] = useState<CreatedInstanceInvite | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (action) dialog.current?.showModal() }, [action])
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [users, invites] = await Promise.all([api.users.list(), api.users.invites()])
      return { users: users.users, invites: invites.invites }
    },
    retry: false,
  })
  const invite = useMutation({
    mutationFn: () => api.users.invite(email.trim()),
    onSuccess: async (result) => {
      setCreated(result)
      setCopyMessage('')
      setEmail('')
      await qc.invalidateQueries({ queryKey: key })
    },
  })
  const change = useMutation({
    mutationFn: async (target: Action) => {
      if (target.kind === 'role') await api.users.updateRole(target.user.id, target.role)
      else if (target.kind === 'remove') await api.users.remove(target.user.id)
      else await api.users.revokeInvite(target.id)
    },
    onSuccess: async (_, target) => {
      if (target.kind === 'revoke' && created?.id === target.id) setCreated(null)
      setAction(null)
      await qc.invalidateQueries({ queryKey: key })
    },
  })
  const busy = invite.isPending || change.isPending
  function confirm(target: Action) { change.reset(); setAction(target) }
  function submit(e: FormEvent) {
    e.preventDefault()
    setCreated(null)
    invite.mutate()
  }
  async function copyLink() {
    if (!created) return
    try { await navigator.clipboard.writeText(created.invite_url); setCopyMessage('Link copied.') }
    catch { setCopyMessage('Could not copy automatically. Select and copy the link above.') }
  }
  const admins = query.data?.users.filter(u => u.role === 'admin').length ?? 0
  return (
    <div className="p-4 sm:p-8 space-y-8">
      <header><h1 className="text-2xl font-bold text-text-primary">Users</h1><p className="mt-2 text-sm text-text-secondary">Manage accounts and invitations for this Clawvisor instance.</p></header>
      {query.isPending ? <p role="status">Loading users…</p> : query.isError ? (
        <div role="alert" className="text-danger"><p>{query.error.message}</p><button className={button} onClick={() => query.refetch()}>Try again</button></div>
      ) : <>
        <section className="bg-surface-1 border border-border-default rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">Invite a user</h2>
          <p className="text-sm text-text-secondary">Create a single-use link, valid for 48 hours. No email is sent. Your organization’s access policy still applies. New users join as members and must complete email verification before signing in.</p>
          <form onSubmit={submit} className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm flex-1">Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={field} placeholder="name@example.com" disabled={busy} /></label>
            <button className={`${button} self-end`} disabled={busy || !email.trim()}>{invite.isPending ? 'Creating…' : 'Create invitation'}</button>
          </form>
          {invite.isError && <p role="alert" className="text-sm text-danger">{invite.error.message}</p>}
          {created && <div className="p-3 bg-surface-0 rounded-md space-y-2" role="status">
            <p className="text-sm">Invitation for {created.email}. Copy this link now; it cannot be retrieved later.</p>
            <input aria-label="Invitation link" readOnly value={created.invite_url} className={`${field} w-full`} onFocus={e => e.target.select()} />
            <div className="flex gap-2"><button className={button} onClick={copyLink}>Copy link</button><button className={button} onClick={() => setCreated(null)}>Dismiss link</button></div>
            <p className="text-sm">{copyMessage}</p>
          </div>}
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">Accounts ({query.data.users.length})</h2>
          <div className="overflow-x-auto border border-border-default rounded-lg"><table className="w-full text-sm text-left">
            <thead className="bg-surface-1 text-text-secondary"><tr><th className="p-3">Email</th><th className="p-3">Status</th><th className="p-3">Role</th><th className="p-3">Access</th></tr></thead>
            <tbody>{query.data.users.map(u => {
              const protectedUser = u.id === currentUserId || (u.role === 'admin' && admins <= 1)
              return <tr key={u.id} className="border-t border-border-default">
                <td className="p-3">{u.email}{u.id === currentUserId && <span className="text-text-tertiary"> (you)</span>}</td>
                <td className="p-3">{u.verified ? 'Verified' : 'Pending verification'}</td>
                <td className="p-3"><select aria-label={`Role for ${u.email}`} className={field} value={u.role} disabled={busy || protectedUser} onChange={e => confirm({ kind: 'role', user: u, role: e.target.value as InstanceRole })}><option value="member">Member</option><option value="admin">Admin</option></select></td>
                <td className="p-3"><button className={`${button} text-danger`} disabled={busy || protectedUser} aria-label={`Remove ${u.email}`} onClick={() => confirm({ kind: 'remove', user: u })}>Remove</button></td>
              </tr>
            })}</tbody>
          </table></div>
          <p className="text-xs text-text-tertiary">Your own account and the last administrator are protected here. Removing an account also revokes its agents.</p>
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">Pending invitations</h2>
          {query.data.invites.length === 0 ? <p className="text-sm text-text-secondary">No pending invitations.</p> : <ul className="border border-border-default rounded-lg divide-y divide-border-default">{query.data.invites.map(i => <li className="p-3 flex flex-wrap justify-between gap-3 items-center" key={i.id}><div className="text-sm"><p>{i.email || 'Any email'}</p><p className="text-text-tertiary">{new Date(i.expires_at).getTime() <= Date.now() ? 'Expired' : 'Expires'} {new Date(i.expires_at).toLocaleString()}</p></div><button className={button} disabled={busy} aria-label={`Revoke invitation for ${i.email || 'any email'}`} onClick={() => confirm({ kind: 'revoke', id: i.id, email: i.email || 'any email' })}>Revoke</button></li>)}</ul>}
        </section>
      </>}
      {action && <dialog ref={dialog} aria-labelledby="user-action-title" className="bg-surface-1 text-text-primary border border-border-default rounded-lg p-6 max-w-lg w-full space-y-4 backdrop:bg-black/60" onCancel={e => { e.preventDefault(); if (!change.isPending) setAction(null) }}>
          <h2 id="user-action-title" className="font-semibold">{action.kind === 'role' ? `Change ${action.user.email} to ${action.role}?` : action.kind === 'remove' ? `Remove ${action.user.email}?` : `Revoke invitation for ${action.email}?`}</h2>
          <p className="text-sm text-text-secondary">{action.kind === 'remove' ? 'This permanently removes the account and revokes its agents. Audit history is retained.' : action.kind === 'role' ? (action.role === 'admin' ? 'Administrators can manage users and access instance-wide activity.' : 'This account will lose administrator permissions.') : 'The invitation link will stop working.'}</p>
          {change.isError && <p role="alert" className="text-sm text-danger">{change.error.message}</p>}
          <div className="flex gap-3 justify-end"><button autoFocus className={button} disabled={change.isPending} onClick={() => setAction(null)}>Cancel</button><button className={button} disabled={change.isPending} onClick={() => change.mutate(action)}>{change.isPending ? 'Saving…' : 'Confirm'}</button></div>
      </dialog>}
    </div>
  )
}
