import type { QueryClient } from '@tanstack/react-query'
import { projectKeys } from './projects'
import type { SyncedRepository } from './sync'
import type { SyncedLibrary } from './synced-library'

/**
 * Without an account, everything is kept in this browser alone. Once
 * someone's signed in: this browser and the server brought level. The
 * first time on this browser, the charts and colorwork motifs already here
 * (made while signed out) are kept on the server as theirs. If a
 * different account signs in on the same browser, what's here isn't sent to
 * it: it only takes that account's own from the server.
 */
export function startSync(charts: SyncedRepository, motifs: SyncedLibrary, queryClient: QueryClient) {
  let started: string | null = null
  return async (userId: string) => {
    if (started === userId) return
    started = userId
    charts.activate()
    motifs.activate()
    const owner = readOwner()
    const ours = owner === null || owner === userId
    try {
      if (ours) {
        writeOwner(userId)
        await charts.adoptLocal()
      }
      await charts.pull()
      if (ours && (await motifs.pull())) await queryClient.invalidateQueries({ queryKey: ['library'] })
      await queryClient.invalidateQueries({ queryKey: projectKeys.all })
    } catch (error) {
      console.warn('Couldn’t reach the server; everything is saved here and will be sent later.', error)
      started = null
    }
  }
}

function readOwner(): string | null {
  try {
    return localStorage.getItem('skeinfiend.syncOwner')
  } catch {
    return null
  }
}

function writeOwner(id: string): void {
  try {
    localStorage.setItem('skeinfiend.syncOwner', id)
  } catch {
    // Not remembered: asked again next time, which is harmless.
  }
}

/**
 * Signing out: what's waiting is sent first, then this browser's copy of the
 * account's charts and colorwork motifs is cleared, so the next person here
 * starts empty (it's all in the account, for next time). If something hasn't
 * reached the account (offline), nothing's cleared, and it says so.
 */
export async function signOut(charts: SyncedRepository, clearLocal: () => Promise<void>): Promise<'signed-out' | 'unsent'> {
  await charts.flush()
  if (charts.hasUnsent()) return 'unsent'
  const { authClient, declineSignIn, forgetUser } = await import('./auth')
  await authClient.signOut()
  forgetUser()
  // Signed out on purpose: not asked to sign back in for the rest of this visit.
  declineSignIn()
  await clearLocal()
  try {
    for (const key of Object.keys(localStorage)) {
      if (key === 'skeinfiend.sync' || key === 'skeinfiend.syncOwner' || key === 'skeinfiend.syncedMotifs' || key.startsWith('skeinfiend.progress.')) localStorage.removeItem(key)
    }
  } catch {
    // Nothing to tidy.
  }
  return 'signed-out'
}
