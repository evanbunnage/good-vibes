import { useRouter, useSearch } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { authClient, declineSignIn, forgetUser } from '@/data/auth'
import ui from '@/ui/ui.module.css'
import { Wordmark } from '@/ui/Wordmark'
import styles from './account.module.css'

/**
 * Signing in, or creating an account: just an email and a password. Charts and
 * colorwork motifs are kept in the account, so they're there on any device.
 */
export function SignInPage() {
  const router = useRouter()
  // Back where they were, query and all.
  const back = () => router.history.push(redirect ?? '/')
  const { redirect } = useSearch({ from: '/sign-in' })
  const [mode, setMode] = useState<'sign-in' | 'create' | 'forgot'>('sign-in')
  const creating = mode === 'create'
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    if (mode === 'forgot') {
      // Said the same whether or not there's an account: nobody learns who has one.
      const { error } = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
      setBusy(false)
      if (error) return setProblem(error.message ?? 'That didn’t work. Try again.')
      return setSent(true)
    }
    // Not asked for: an account needs a name, so it's the start of their email.
    const { error } = creating
      ? await authClient.signUp.email({ email, password, name: email.split('@')[0]! })
      : await authClient.signIn.email({ email, password })
    setBusy(false)
    if (error) return setProblem(error.message ?? 'That didn’t work. Try again.')
    forgetUser()
    // Back where they were; charts made here while signed out move into the account on the way.
    back()
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit} aria-labelledby={titleId}>
        <h1 className={styles.wordmark}><Wordmark size="1.4rem" /></h1>
        <h2 id={titleId}>{creating ? 'Create an account' : mode === 'forgot' ? (sent ? 'Check your email' : 'Reset your password') : 'Sign in'}</h2>
        {/* Sent: just what happens next. */}
        {!(mode === 'forgot' && sent) && (
          <label className={styles.field}>
            <span>Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
        )}
        {mode !== 'forgot' && (
          <label className={styles.field}>
            <span>Password</span>
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={creating ? 'new-password' : 'current-password'} />
          </label>
        )}
        {problem && <p className={styles.problem} role="alert">{problem}</p>}
        {mode === 'forgot' && sent ? (
          <p className={styles.note} role="status">If {email} has an account, you’ll get a link to reset your password.</p>
        ) : (
          <button type="submit" className={ui.button} data-variant="primary" disabled={busy}>
            {creating ? 'Create account' : mode === 'forgot' ? 'Send a reset link' : 'Sign in'}
          </button>
        )}
        {mode === 'sign-in' && (
          <button type="button" className={styles.switch} onClick={() => { setMode('forgot'); setSent(false) }}>Forgot password?</button>
        )}
        <button type="button" className={styles.switch} onClick={() => setMode(mode === 'sign-in' ? 'create' : 'sign-in')}>
          {mode === 'sign-in' ? 'Create an account' : 'Back to sign in'}
        </button>
        <button type="button" className={styles.switch} onClick={() => {
          declineSignIn()
          back()
        }}>
          Not now
        </button>
      </form>
    </main>
  )
}
