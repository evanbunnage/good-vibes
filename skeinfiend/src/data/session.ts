import type { QueryClient } from '@tanstack/react-query'
import { hasUnsavedCharts } from './projects'

/**
 * Signing out: refused while a chart's changes haven't reached the account
 * yet (offline, say), so nothing's lost. Otherwise what's cached of the
 * account is dropped, so the next person here starts empty, and this
 * device's knitting progress (and the sizes being knitted) with it.
 */
export async function signOut(queryClient: QueryClient): Promise<'signed-out' | 'unsaved'> {
  if (hasUnsavedCharts(queryClient)) return 'unsaved'
  const { authClient, declineSignIn, forgetUser } = await import('./auth')
  await authClient.signOut()
  forgetUser()
  // Signed out on purpose: not asked to sign back in for the rest of this visit.
  declineSignIn()
  queryClient.clear()
  try {
    for (const key of Object.keys(localStorage)) {
      if (key === 'skeinfiend.lastChart' || key === 'skeinfiend.knitSizes' || key.startsWith('skeinfiend.progress.')) localStorage.removeItem(key)
    }
  } catch {
    // Nothing to tidy.
  }
  return 'signed-out'
}
