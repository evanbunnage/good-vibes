import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { forgetLastChart, rememberLastChart } from '@/data/last-chart'
import { hasUnsavedChart, ProjectNotFoundError, projectKeys, projectQuery, useRepository } from '@/data/projects'
import { ChartGoneError, type ChartConflictError } from '@/data/remote-repository'
import { EditorStore } from '@/editor/store'
import { agentTools } from '@/features/agent/tools'
import { useAgentTools } from '@/features/agent/use-agent-tools'
import { useLibrary } from '@/data/library'
import { EditorContext, useAutosave } from '@/features/editor/editor-context'
import { describeError, Problem } from '@/ui/Problem'

/**
 * Loads a project and shares one editor store between its editing, knitting,
 * and print views, so switching between them is instant and nothing is re-read.
 */
export const Route = createFileRoute('/p/$projectId')({
  // The latest from the account, unless it was read moments ago (hovering its link preloads it).
  // With changes still to save (back from signing in again, say), the cached copy is the newest: not the account's.
  loader: ({ context, params }) => {
    const query = projectQuery(context.repository, params.projectId)
    return hasUnsavedChart(context.queryClient, params.projectId) ? context.queryClient.ensureQueryData(query) : context.queryClient.fetchQuery(query)
  },
  // Where the app opens next time: on opening it, not on hovering its link.
  onEnter: ({ params }) => rememberLastChart(params.projectId),
  component: ProjectLayout,
  errorComponent: ({ error }) =>
    error instanceof ProjectNotFoundError ? (
      <Problem title="Chart not found" detail="It may have been deleted, or it was saved in a different browser." />
    ) : (
      <Problem title="Couldn't open this chart" detail={describeError(error)} />
    ),
})

function ProjectLayout() {
  const { projectId } = Route.useParams()
  // Keyed by id so navigating between projects gets a fresh store.
  return <ProjectEditor key={projectId} projectId={projectId} />
}

function ProjectEditor({ projectId }: { projectId: string }) {
  const repository = useRepository()
  const client = useQueryClient()
  const navigate = useNavigate()
  const { data: project } = useSuspenseQuery(projectQuery(repository, projectId))
  const [store, setStore] = useState(() => new EditorStore(project))

  // A save refused: the chart was deleted on another device, or someone saved it there first.
  const refused = (error: ChartConflictError | ChartGoneError) => {
    if (error instanceof ChartGoneError) {
      forgetLastChart()
      client.removeQueries({ queryKey: projectKeys.detail(projectId) })
      void client.invalidateQueries({ queryKey: projectKeys.list() })
      void navigate({ to: '/', replace: true })
      return
    }
    // Both kept: what's here as a copy, and theirs as the chart, which the editor now shows.
    const mine = store.project
    const copy = { ...mine, id: crypto.randomUUID(), name: `${mine.name} (this device)`, updatedAt: Date.now() }
    void repository.put(copy).then(() => client.invalidateQueries({ queryKey: projectKeys.list() }))
    client.setQueryData(projectKeys.detail(projectId), error.project)
    setStore(new EditorStore(error.project))
  }
  useAutosave(store, refused)
  // This chart's tools, while it's open: the colorwork motif library through the page's own cache.
  const library = useLibrary()
  const tools = useMemo(() => agentTools(store, {
    motifs: () => library.motifs(),
    putMotif: (motif) => library.putMotif(motif),
    removeMotif: (id) => library.removeMotif(id),
    changed: () => void client.invalidateQueries({ queryKey: ['library'] }),
  }), [store, library, client])
  useAgentTools(tools)
  return (
    <EditorContext value={store}>
      <Outlet />
    </EditorContext>
  )
}
