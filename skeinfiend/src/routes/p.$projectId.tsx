import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { rememberLastChart } from '@/data/last-chart'
import { ProjectNotFoundError, projectQuery, useRepository } from '@/data/projects'
import { EditorStore } from '@/editor/store'
import { useAgentTools } from '@/features/agent/use-agent-tools'
import { EditorContext, useAutosave } from '@/features/editor/editor-context'
import { describeError, Problem } from '@/ui/Problem'

/**
 * Loads a project and shares one editor store between its editing, knitting,
 * and print views, so switching between them is instant and nothing is re-read.
 */
export const Route = createFileRoute('/p/$projectId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(projectQuery(context.repository, params.projectId)),
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
  const { data: project } = useSuspenseQuery(projectQuery(repository, projectId))
  const [store] = useState(() => new EditorStore(project))
  // Where the app opens next time.
  useEffect(() => rememberLastChart(projectId), [projectId])
  useAutosave(store)
  useAgentTools(store)
  return (
    <EditorContext value={store}>
      <Outlet />
    </EditorContext>
  )
}
