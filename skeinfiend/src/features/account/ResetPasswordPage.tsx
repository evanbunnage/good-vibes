import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '@/data/auth'
import ui from '@/ui/ui.module.css'
import { Wordmark } from '@/ui/Wordmark'
import styles from './account.module.css'

/** Choosing a new password, from the emailed link. Then signing in with it. */
export function ResetPasswordPage() {
  const { token, error } = useSearch({ from: '/reset-password' })
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!token || error) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.wordmark}><Wordmark size="1.4rem" /></h1>
          <h2>That link has expired</h2>
          <p className={styles.note}>Reset links work once, for an hour. Ask for a new one from the sign-in page.</p>
          <Link to="/sign-in" className={ui.button} data-variant="primary">Sign in</Link>
        </div>
      </main>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await authClient.resetPassword({ newPassword: password, token })
    setBusy(false)
    if (error) return setProblem(error.message ?? 'That didn’t work. Ask for a new link.')
    void navigate({ to: '/sign-in' })
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <h1 className={styles.wordmark}><Wordmark size="1.4rem" /></h1>
        <h2>Choose a new password</h2>
        <label className={styles.field}>
          <span>New password</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {problem && <p className={styles.problem} role="alert">{problem}</p>}
        <button type="submit" className={ui.button} data-variant="primary" disabled={busy}>Save and sign in</button>
      </form>
    </main>
  )
}
