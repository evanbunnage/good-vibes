import { createAuthClient } from 'better-auth/react'

/**
 * Signing in, against the app's own API (`/api/auth`, Better Auth on the
 * Worker): email and password. The session is a cookie the API reads.
 */
export const authClient = createAuthClient({ basePath: '/api/auth' })

let known: { id: string; email: string; name: string } | null | undefined

/** Who's signed in, asked once and remembered for the page (until signing in or out). */
export async function currentUser(): Promise<{ id: string; email: string; name: string } | null> {
  if (known !== undefined) return known
  try {
    const { data } = await authClient.getSession()
    known = data ? { id: data.user.id, email: data.user.email, name: data.user.name } : null
  } catch {
    known = null
  }
  return known
}

/** After signing in or out: ask again next time. */
export function forgetUser(): void {
  known = undefined
}

/**
 * Whether this browser has been signed in before: a mark with nothing in it
 * but that (no name, no email, no session). Someone who has an account is
 * asked to sign in when they come back signed out; someone new just uses the app.
 */
const RETURNING = 'skeinfiend.returning'

export function markReturning(): void {
  try {
    localStorage.setItem(RETURNING, '1')
  } catch {
    // Not remembered: they're just not asked to sign in next time.
  }
}

export function isReturning(): boolean {
  try {
    return localStorage.getItem(RETURNING) === '1'
  } catch {
    return false
  }
}

/** "Not now", on the sign-in page: not asked again until the browser's next visit. */
const DECLINED = 'skeinfiend.declinedSignIn'

export function declineSignIn(): void {
  try {
    sessionStorage.setItem(DECLINED, '1')
  } catch {
    // Not remembered: asked again on the next page load.
  }
}

export function declinedSignIn(): boolean {
  try {
    return sessionStorage.getItem(DECLINED) === '1'
  } catch {
    return false
  }
}
