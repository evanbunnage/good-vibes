import { createFileRoute } from '@tanstack/react-router'
import { SignInPage } from '@/features/account/SignInPage'

export const Route = createFileRoute('/sign-in')({
  // Where to go back to once signed in: the chart they were on.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' && /^\/(?![/\\])/.test(search.redirect) ? { redirect: search.redirect } : {},
  component: SignInPage,
})
