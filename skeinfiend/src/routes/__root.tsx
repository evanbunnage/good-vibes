import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { createRootRouteWithContext, Outlet, redirect, useNavigate, useRouterState } from '@tanstack/react-router'
import { useRepository } from '@/data/projects'
import { appTools } from '@/features/agent/app-tools'
import { useAgentTools } from '@/features/agent/use-agent-tools'
import { currentUser, declinedSignIn, isReturning, markReturning } from '@/data/auth'
import type { AccountRepository } from '@/data/account-repository'
import { describeError, Problem } from '@/ui/Problem'

export interface RouterContext {
  readonly queryClient: QueryClient
  readonly repository: AccountRepository
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // The whole app works without an account, kept in this browser; signed in, it's kept in the account instead.
  // Someone who's signed in here before, and is signed out now, is asked to sign in (once a visit); someone new isn't.
  beforeLoad: async ({ context, location }) => {
    const user = await currentUser()
    // Charts from the account, or from this browser: whatever was cached from the other is dropped.
    // Signing in moves what was made here while signed out into the account.
    if (await context.repository.use(Boolean(user))) context.queryClient.removeQueries()
    if (user) {
      markReturning()
    } else if (isReturning() && !declinedSignIn() && !['/sign-in', '/reset-password'].includes(location.pathname)) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { user }
  },
  component: Root,
  notFoundComponent: () => <Problem title="Page not found" detail="That page doesn't exist." />,
  errorComponent: ({ error }) => <Problem title="Something went wrong" detail={describeError(error)} />,
})

/** Every page: the app's own agent tools (the knitter's charts), offered wherever they are. */
function Root() {
  const repository = useRepository()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const openId = useRouterState({ select: (s) => /^\/p\/([^/]+)/.exec(s.location.pathname)?.[1] ?? null })
  const tools = useMemo(() => appTools({
    repository,
    queryClient,
    open: (id) => navigate({ to: '/p/$projectId', params: { projectId: id } }),
    openId,
  }), [repository, queryClient, navigate, openId])
  useAgentTools(tools)
  return <Outlet />
}
