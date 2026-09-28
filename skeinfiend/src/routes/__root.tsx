import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router'
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
  component: Outlet,
  notFoundComponent: () => <Problem title="Page not found" detail="That page doesn't exist." />,
  errorComponent: ({ error }) => <Problem title="Something went wrong" detail={describeError(error)} />,
})
