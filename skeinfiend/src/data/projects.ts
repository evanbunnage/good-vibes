import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import type { Project } from '@/domain/project'
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
  return queryOptions({ queryKey: projectKeys.list(), queryFn: () => repository.list() })
}

export function projectQuery(repository: ProjectRepository, id: string) {
  return queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: async () => {
      const project = await repository.get(id)
      if (!project) throw new ProjectNotFoundError(id)
      return project
    },
    // The editor owns the live copy while it's open; don't refetch under it.
    staleTime: Number.POSITIVE_INFINITY,
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
    mutationFn: (project: Project) => repository.put(project),
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
