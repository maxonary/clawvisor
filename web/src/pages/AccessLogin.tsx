import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api/client'
import { useAuth } from '../hooks/useAuth'

export default function AccessLogin() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signIn() {
    setBusy(true)
    setError('')
    try {
      const result = await api.auth.access()
      setSession(result.access_token, result.refresh_token, result.user)
      navigate('/dashboard', { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.') }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen flex items-center justify-center bg-surface-0 p-4">
    <section className="max-w-md w-full space-y-6 p-8 bg-surface-1 border border-border-default rounded-lg">
      <h1 className="text-3xl font-bold">Clawvisor</h1>
      <h2 className="text-lg">Sign in with Ontora</h2>
      <p className="text-sm text-text-secondary">Continue with the Ontora Google account you used at the access gate. Access is limited to Ontora’s founders.</p>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      <button onClick={signIn} disabled={busy} className="w-full px-4 py-3 rounded bg-brand text-surface-0 disabled:opacity-50">{busy ? 'Signing in…' : 'Continue with Ontora Google'}</button>
      <a className="text-sm text-brand" href="/cdn-cgi/access/logout">Use a different Google account</a>
    </section>
  </main>
}
