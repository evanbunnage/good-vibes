import { createFileRoute, redirect } from '@tanstack/react-router'
import { lastChart } from '@/data/last-chart'
import { projectListQuery } from '@/data/projects'
import { LandingPage } from '@/features/landing/LandingPage'

/**
 * Signed in with charts: straight into the studio, on the chart open last
 * (or the most recently edited). Signed out, or signed in with no charts yet,
 * or come by the logo: the landing page, to start one or open an example.
 */
export const Route = createFileRoute('/')({
  // `?home` (the logo) shows the landing page even to someone with charts; so does `?demo` (an agent sent here to try it).
  validateSearch: (search: Record<string, unknown>): { home?: boolean; demo?: boolean } =>
    'demo' in search ? { home: true, demo: true } : search.home ? { home: true } : {},
  beforeLoad: async ({ context, search }) => {
    const { user } = context as typeof context & { user?: { id: string } | null }
    if (!user || search.home) return
    const charts = await context.queryClient.ensureQueryData(projectListQuery(context.repository))
    const open = charts.find((c) => c.id === lastChart()) ?? charts[0]
    if (open) throw redirect({ to: '/p/$projectId', params: { projectId: open.id }, replace: true })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(projectListQuery(context.repository)),
  component: LandingPage,
})
