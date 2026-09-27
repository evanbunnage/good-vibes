import { createFileRoute } from '@tanstack/react-router'
import { ResetPasswordPage } from '@/features/account/ResetPasswordPage'

export const Route = createFileRoute('/reset-password')({
  // From the emailed link: a token to reset with, or an error if it's expired or been used.
  validateSearch: (search: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof search.token === 'string' && { token: search.token }),
    ...(typeof search.error === 'string' && { error: search.error }),
  }),
  component: ResetPasswordPage,
})
