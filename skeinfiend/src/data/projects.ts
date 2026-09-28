import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import type { Project } from '@/domain/project'
import { ChartConflictError, ChartGoneError } from './remote-repository'
import { summarize, type ProjectRepository, type ProjectSummary } from './repository'

export const RepositoryContext = createContext<ProjectRepository | null>(null)

export function useRepository(): ProjectRepository {
  const repository = useContext(RepositoryContext)
  if (!repository) throw new Error('useRepository needs a RepositoryContext provider')
  return repository
}

export const projectKeys = {
  all: ['projects'] as const,
  list: () => [...projectKeys.all, 'list'] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
}

export function projectListQuery(repository: ProjectRepository) {
  // Fetched again on coming back to the tab: charts made or deleted on another device show here.
  return queryOptions({ queryKey: projectKeys.list(), queryFn: () => repository.list(), refetchOnWindowFocus: true })
}

export function projectQuery(repository: ProjectRepository, id: string) {
  return queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: async () => {
      const project = await repository.get(id)
      if (!project) throw new ProjectNotFoundError(id)
      return project
    },
    // Opened from the cache if it was read moments ago (a hover preloads it); otherwise fetched fresh,
    // so the editor starts from the latest. While it's open, the editor's copy is the live one.
    staleTime: 10_000,
  })
}

export class ProjectNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Project ${id} not found`)
  }
}

/** Stores a new project (from the new-project form, the example, or a duplicate). */
export function useAddProject() {
  const repository = useRepository()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (project: Project) => {
      await repository.put(project)
      return project
    },
    onSuccess: (project) => {
      client.setQueryData(projectKeys.detail(project.id), project)
      void client.invalidateQueries({ queryKey: projectKeys.list() })
    },
  })
}

/**
 * Saves the editor's copy. Optimistic: the list and detail caches update
 * immediately, and roll back if the write fails.
 */
export const SAVE_MUTATION_KEY = ['save-project'] as const

export function useSaveProject() {
  const repository = useRepository()
  const client = useQueryClient()
  return useMutation({
    mutationKey: SAVE_MUTATION_KEY,
    // One at a time, in order: each is based on the version the last one made.
    scope: { id: 'save-chart' },
    mutationFn: (project: Project) => repository.put(project),
    // Offline, saves wait (TanStack Query pauses them) and go when the connection's back. A failure
    // is tried again, less often each time, until it goes through; not someone else's newer save,
    // or a deleted chart, which the editor deals with.
    retry: (_count, error) => !(error instanceof ChartConflictError || error instanceof ChartGoneError),
    retryDelay: (attempt) => Math.min(30_000, 1000 * 2 ** attempt),
    onMutate: async (project) => {
      await client.cancelQueries({ queryKey: projectKeys.list() })
      const previousList = client.getQueryData<ProjectSummary[]>(projectKeys.list())
      client.setQueryData(projectKeys.detail(project.id), project)
      client.setQueryData<ProjectSummary[]>(projectKeys.list(), (list) =>
        list?.map((s) => (s.id === project.id ? summarize(project) : s)),
      )
      return { previousList }
    },
    onError: (_error, _project, context) => {
      if (context?.previousList) client.setQueryData(projectKeys.list(), context.previousList)
    },
  })
}

export function useDeleteProject() {
  const repository = useRepository()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repository.remove(id),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: projectKeys.list() })
      const previousList = client.getQueryData<ProjectSummary[]>(projectKeys.list())
      client.setQueryData<ProjectSummary[]>(projectKeys.list(), (list) => list?.filter((s) => s.id !== id))
      return { previousList }
    },
    onError: (_error, _id, context) => {
      if (context?.previousList) client.setQueryData(projectKeys.list(), context.previousList)
    },
    onSettled: (_data, _error, id) => {
      client.removeQueries({ queryKey: projectKeys.detail(id) })
      void client.invalidateQueries({ queryKey: projectKeys.list() })
    },
  })
}

/** A copy of a project under a new id and name, ready for `useAddProject`. */
export function duplicate(source: Project, id: string, now: number): Project {
  return { ...source, id, name: `${source.name} copy`, createdAt: now, updatedAt: now }
}

/**
 * Whether any chart has changes that haven't been saved yet: a save under way,
 * or waiting for the connection.
 */
export function hasUnsavedCharts(client: QueryClient): boolean {
  const latest = new Map<string, boolean>()
  for (const mutation of client.getMutationCache().findAll({ mutationKey: SAVE_MUTATION_KEY })) {
    const project = mutation.state.variables as Project | undefined
    const { status, error } = mutation.state
    // Someone else's newer save, or a deleted chart: the editor has dealt with it (kept a copy, or gone home).
    const handled = error instanceof ChartConflictError || error instanceof ChartGoneError
    if (project) latest.set(project.id, status !== 'success' && !handled)
  }
  return [...latest.values()].some(Boolean)
}
