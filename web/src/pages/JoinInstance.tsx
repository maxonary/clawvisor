import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../api/client'

export default function JoinInstance() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try { await api.users.claimInvite(email.trim(), password, token); setClaimed(true); setPassword('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not accept the invitation.') }
    finally { setBusy(false) }
  }
  const field = 'px-3 py-2 rounded-md border border-border-default bg-surface-0 text-text-primary'
  return <div className="min-h-screen flex items-center justify-center bg-surface-0 p-4"><main className="max-w-md w-full p-8 bg-surface-1 border border-border-default rounded-lg space-y-5">
    <h1 className="text-2xl font-bold">Join Clawvisor</h1>
    {claimed ? <div role="status" className="space-y-3"><h2 className="font-semibold">Account awaiting verification</h2><p className="text-sm text-text-secondary">Your invitation was accepted. Email verification is still required before you can sign in. Contact your administrator to complete the verification process.</p><Link className="text-brand" to="/login">Return to sign in</Link></div> : !token ? <p role="alert">This invitation link is incomplete. Ask your administrator for a new link.</p> : <>
      <p className="text-sm text-text-secondary">Use the email address your invitation was issued to. You will join as a member; an administrator can change your role afterward.</p>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className="flex flex-col gap-1 text-sm">Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className={field} disabled={busy} /></label>
        <label className="flex flex-col gap-1 text-sm">Password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} className={field} disabled={busy} /></label>
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        <button className="px-4 py-2 rounded-md bg-brand text-white disabled:opacity-50" disabled={busy}>{busy ? 'Accepting…' : 'Accept invitation'}</button>
      </form>
    </>}
  </main></div>
}
