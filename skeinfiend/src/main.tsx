import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountRepository } from '@/data/account-repository'
import { LibraryContext } from '@/data/library'
import { LocalRepository } from '@/data/local-repository'
import { hasUnsavedCharts, RepositoryContext } from '@/data/projects'
import { RemoteRepository } from '@/data/remote-repository'
import { hasPendingEdits } from '@/features/editor/editor-context'
import { routeTree } from './routeTree.gen'
import './styles/global.css'

// Signed out, charts are kept in this browser; signed in, in the account (the Worker's /api, in Postgres),
// with TanStack Query's cache making it instant. The root route says which, once it knows who's here.
const repository = new AccountRepository(new LocalRepository(), new RemoteRepository('/api'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
})

// Leaving with changes not saved yet (offline, say): the browser asks first.
window.addEventListener('beforeunload', (event) => {
  if (hasPendingEdits() || hasUnsavedCharts(queryClient)) event.preventDefault()
})

const router = createRouter({
  routeTree,
  context: { queryClient, repository },
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

// Signed out, the charts are only in this browser: ask it not to evict them under storage pressure.
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepositoryContext value={repository}>
      <LibraryContext value={repository}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LibraryContext>
    </RepositoryContext>
  </StrictMode>,
)
