import { createFileRoute } from '@tanstack/react-router'
import { KnitPage } from '@/features/knit/KnitPage'

export const Route = createFileRoute('/p/$projectId/knit')({
  component: KnitPage,
})
