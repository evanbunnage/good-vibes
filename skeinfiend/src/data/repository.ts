import type { Grid } from '@/domain/grid'
import { cellAspect } from '@/domain/gauge'
import { composeChart, type Project } from '@/domain/project'

/**
 * Where projects live. The UI only ever talks to this interface (through
 * TanStack Query), so storage can move from the browser to a server, or sync
 * between them, without touching components.
 */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>
  get(id: string): Promise<Project | undefined>
  put(project: Project): Promise<void>
  remove(id: string): Promise<void>
}

/** What the project list needs: enough to draw a thumbnail without loading every layer. */
export interface ProjectSummary {
  readonly id: string
  readonly name: string
  readonly updatedAt: number
  readonly preview: Grid
  readonly colors: readonly string[]
  /** Stitch height relative to width at the project's gauge, so the thumbnail has the piece's proportions. */
  readonly aspect?: number
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    preview: composeChart(project),
    colors: project.yarns.map((y) => y.hex),
    aspect: cellAspect(project.gauge),
  }
}

