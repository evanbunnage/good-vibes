import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { createRootRouteWithContext, Outlet, redirect, useNavigate, useRouterState } from '@tanstack/react-router'
import { useRepository } from '@/data/projects'
import { appTools } from '@/features/agent/app-tools'
import { useAgentTools } from '@/features/agent/use-agent-tools'
import { currentUser, declineSignIn, declinedSignIn, isReturning, markReturning } from '@/data/auth'
import type { AccountRepository } from '@/data/account-repository'
import { describeError, Problem } from '@/ui/Problem'
import { agentAtWork } from '@/features/editor/panels/motif-helper-state'

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
    // An agent sent to try it out (`/try`, or `?demo`) isn't stopped at the sign-in page: it works signed out, in this browser.
    const demo = 'demo' in location.search || location.pathname === '/try'
    if (!user && demo) declineSignIn()
    // Sent by the demo: an agent's at work, so the first-time helper stays out of its way.
    if (demo) agentAtWork()
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
  // Only the home page is for search engines: a chart is someone's own, and sign-in is just a form.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    if (pathname === '/') return robots?.remove()
    robots ??= Object.assign(document.createElement('meta'), { name: 'robots' })
    robots.content = 'noindex'
    document.head.append(robots)
  }, [pathname])
  return <Outlet />
}
