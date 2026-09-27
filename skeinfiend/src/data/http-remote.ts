import type { Project } from '@/domain/project'
import { summarize } from './repository'
import { fromJSON, toJSON } from './serialize'
import type { SavedMotif } from '@/domain/saved-motifs'
import type { RemoteLibrary } from './synced-library'
import type { PutResult, RemoteEntry, RemoteStore } from './sync'

/**
 * The server a `SyncedRepository` sends charts to, over HTTP: the Worker in
 * `worker/index.ts`, at `/api`. Signed in by a session cookie, so requests
 * carry credentials. The API it expects:
 *
 *   GET    /charts        → [{ id, version }]            the signed-in person's charts
 *   GET    /charts/:id    → { project, version }         (404 if there's none)
 *   PUT    /charts/:id    { project, summary, baseVersion }
 *                           → 200 { version }              saved; version is baseVersion + 1
 *                           → 409 { project, version }     someone saved first: here's theirs
 *   DELETE /charts/:id    → 204
 *
 * Charts go as JSON with their grids' bytes in base64 (`serialize.ts`), and
 * with the summary the chart list shows, so listing never loads whole charts.
 * The tables are in `worker/schema.ts`; a save only lands on the version it
 * was based on, or answers 409 with what's there.
 */
export class HttpRemote implements RemoteStore, RemoteLibrary {
  constructor(private readonly baseUrl: string) {}

  async list(): Promise<RemoteEntry[]> {
    return (await this.request('GET', '/charts')).json()
  }

  async get(id: string): Promise<{ project: Project; version: number } | undefined> {
    const response = await this.request('GET', `/charts/${encodeURIComponent(id)}`, undefined, { allow404: true })
    return response.status === 404 ? undefined : fromJSON(await response.text())
  }

  async put(project: Project, baseVersion: number | null, { keepalive = false } = {}): Promise<PutResult> {
    const body = toJSON({ project, summary: summarize(project), baseVersion })
    const response = await this.request('PUT', `/charts/${encodeURIComponent(project.id)}`, body, { allow409: true, keepalive })
    if (response.status === 409) return { ok: false, ...fromJSON<{ project: Project; version: number }>(await response.text()) }
    return { ok: true, version: (await response.json()).version }
  }

  async remove(id: string): Promise<void> {
    await this.request('DELETE', `/charts/${encodeURIComponent(id)}`)
  }

  // Colorwork motifs: small, so each is sent whole as it's saved.

  async motifs(): Promise<SavedMotif[]> {
    return fromJSON(await (await this.request('GET', '/motifs')).text())
  }

  async putMotif(motif: SavedMotif): Promise<void> {
    await this.request('PUT', `/motifs/${encodeURIComponent(motif.id)}`, toJSON({ motif }))
  }

  async removeMotif(id: string): Promise<void> {
    await this.request('DELETE', `/motifs/${encodeURIComponent(id)}`)
  }

  private async request(method: string, path: string, body?: string, { allow404 = false, allow409 = false, keepalive = false } = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      body,
      credentials: 'include',
      // Sent even as the page closes, for what's waiting when it's hidden.
      keepalive,
      headers: body ? { 'content-type': 'application/json' } : undefined,
    })
    if (response.ok || (allow404 && response.status === 404) || (allow409 && response.status === 409)) return response
    throw new Error(`${method} ${path}: ${response.status}`)
  }
}
