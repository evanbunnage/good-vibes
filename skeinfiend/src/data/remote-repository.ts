import type { Project } from '@/domain/project'
import type { SavedMotif } from '@/domain/saved-motifs'
import type { LibraryRepository } from './library'
import { summarize, type ProjectRepository, type ProjectSummary } from './repository'
import { fromJSON, toJSON } from './serialize'

/**
 * Charts and colorwork motifs in the signed-in person's account, on the
 * server (the Worker's `/api`, in Postgres). Nothing is kept in the browser:
 * TanStack Query's cache is what makes it feel instant.
 *
 * Each save carries the version of the chart it was based on (the one this
 * page last read or wrote). If someone else has saved since, it's refused
 * with theirs (`ChartConflictError`); if the chart was deleted, with
 * `ChartGoneError`. Either way nothing of theirs is overwritten.
 */
export class RemoteRepository implements ProjectRepository, LibraryRepository {
  /** The version of each chart this page has read or written: its next save is based on it. */
  private readonly versions = new Map<string, number>()
  /** Charts found deleted: saves to them are refused here, without asking the server again. */
  private readonly gone = new Set<string>()

  constructor(private readonly baseUrl: string) {}

  async list(): Promise<ProjectSummary[]> {
    // The list's versions aren't taken: a chart being edited here stays based on what it was read as.
    const rows = fromJSON<Array<ProjectSummary & { version: number }>>(await (await this.request('GET', '/charts')).text())
    return rows.map(({ version: _, ...summary }) => summary)
  }

  async get(id: string): Promise<Project | undefined> {
    const response = await this.request('GET', `/charts/${encodeURIComponent(id)}`, undefined, [404])
    if (response.status === 404) return undefined
    const { project, version } = fromJSON<{ project: Project; version: number }>(await response.text())
    this.versions.set(id, version)
    return project
  }

  async put(project: Project): Promise<void> {
    if (this.gone.has(project.id)) throw new ChartGoneError(project.id)
    const body = toJSON({ project, summary: summarize(project), baseVersion: this.versions.get(project.id) ?? null })
    const response = await this.request('PUT', `/charts/${encodeURIComponent(project.id)}`, body, [409, 410])
    if (response.status === 410) {
      this.versions.delete(project.id)
      this.gone.add(project.id)
      throw new ChartGoneError(project.id)
    }
    if (response.status === 409) {
      const theirs = fromJSON<{ project: Project; version: number }>(await response.text())
      // From here on, saves are based on theirs: whoever catches this takes their version.
      this.versions.set(project.id, theirs.version)
      throw new ChartConflictError(theirs.project)
    }
    this.versions.set(project.id, (await response.json()).version)
  }

  async remove(id: string): Promise<void> {
    await this.request('DELETE', `/charts/${encodeURIComponent(id)}`)
    this.versions.delete(id)
  }

  // Colorwork motifs: small, and saved whole; the latest save wins.

  async motifs(): Promise<SavedMotif[]> {
    const motifs = fromJSON<SavedMotif[]>(await (await this.request('GET', '/motifs')).text())
    return motifs.sort((a, b) => a.savedAt - b.savedAt)
  }

  async putMotif(motif: SavedMotif): Promise<void> {
    await this.request('PUT', `/motifs/${encodeURIComponent(motif.id)}`, toJSON({ motif }))
  }

  async removeMotif(id: string): Promise<void> {
    await this.request('DELETE', `/motifs/${encodeURIComponent(id)}`)
  }

  private async request(method: string, path: string, body?: string, expected: readonly number[] = []): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      body,
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
    })
    if (response.ok || expected.includes(response.status)) return response
    throw new Error(`${method} ${path}: ${response.status}`)
  }
}

/** Someone saved the chart first (another device): theirs is `project`. */
export class ChartConflictError extends Error {
  constructor(readonly project: Project) {
    super(`${project.name} was changed somewhere else`)
  }
}

/** The chart was deleted (on another device) while it was open here. */
export class ChartGoneError extends Error {
  constructor(readonly id: string) {
    super(`Chart ${id} was deleted`)
  }
}
