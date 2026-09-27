import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LibraryContext } from '@/data/library'
import { HttpRemote } from '@/data/http-remote'
import { LocalRepository } from '@/data/local-repository'
import { startSync } from '@/data/session'
import { SyncedRepository } from '@/data/sync'
import { SyncedLibrary } from '@/data/synced-library'
import { projectKeys, RepositoryContext } from '@/data/projects'
import { routeTree } from './routeTree.gen'
import './styles/global.css'

// The browser keeps a working copy, for instant, offline editing; the server (the Worker's /api, in Postgres) is where it all lives.
const local = new LocalRepository()
const remote = new HttpRemote('/api')
const repository = new SyncedRepository(local, remote, undefined, () => void queryClient.invalidateQueries({ queryKey: projectKeys.all }))
const library = new SyncedLibrary(local, remote)

const queryClient = new QueryClient({
  defaultOptions: {
    // Local data: nothing to refetch on focus, and failures are real errors, not flaky networks.
    queries: { refetchOnWindowFocus: false, retry: false },
  },
})

// Once someone's signed in (the root route checks), this browser and the server are brought level.
const sync = startSync(repository, library, queryClient)
// What didn't reach the server goes as soon as the connection's back.
window.addEventListener('online', () => void repository.flush())
// What's waiting goes when the page is hidden or closed.
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void repository.flush({ keepalive: true }))

const router = createRouter({
  routeTree,
  context: { queryClient, repository, sync },
  defaultPreload: 'intent',
  // Route loaders read through Query, which already caches.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Ask the browser not to evict saved projects under storage pressure.
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepositoryContext value={repository}>
      <LibraryContext value={library}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LibraryContext>
    </RepositoryContext>
  </StrictMode>,
)
