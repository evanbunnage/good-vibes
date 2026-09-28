import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { signOut } from '@/data/session'
import { Icon } from '@/ui/Icon'
import ui from '@/ui/ui.module.css'
import styles from './charts-menu.module.css'

/**
 * Who's signed in, at the end of the top bar: their name, and signing out.
 * Signed out, a way to sign in (charts are kept on this device until then).
 */
export function AccountMenu({ returnTo }: { returnTo: string }) {
  const { user } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return <Link to="/sign-in" search={{ redirect: returnTo }} className={ui.button} data-variant="ghost">Sign in</Link>

  return (
    <div ref={root} className={styles.account}>
      <button type="button" className={ui.button} data-variant="ghost" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} aria-label={user.name} title={user.name}>
        <span className={styles.accountName}>{user.name}</span>
        <span className={styles.accountIcon}><Icon name="person" /></span>
      </button>
      {open && (
        <div className={styles.accountPanel} role="menu">
          <p>{user.email}</p>
          {problem && <p className={styles.problem} role="alert">{problem}</p>}
          <button type="button" className={ui.button} data-variant="ghost" role="menuitem" onClick={async () => {
            const result = await signOut(queryClient)
            if (result === 'unsaved') return setProblem('Some changes haven’t reached your account yet. Try again when you’re online.')
            // A fresh start: nothing of the account is left here; it's all in the account for next time.
            window.location.assign('/')
          }}>Sign out</button>
        </div>
      )}
    </div>
  )
}
