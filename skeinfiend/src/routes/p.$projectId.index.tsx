import { createFileRoute } from '@tanstack/react-router'
import { EditorPage } from '@/features/editor/EditorPage'

export const Route = createFileRoute('/p/$projectId/')({
  // `?layer=<id>` opens with that layer selected and its window open: a colorwork motif just added from the library, to place and size.
  validateSearch: (search: Record<string, unknown>): { layer?: string } => (typeof search.layer === 'string' ? { layer: search.layer } : {}),
  component: EditorPage,
})
