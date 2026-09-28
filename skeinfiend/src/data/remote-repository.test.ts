import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtInTemplate } from '@/domain/pieces'
import { createProject, type Project } from '@/domain/project'
import { gridFromRows } from '@/domain/grid'
import type { SavedMotif } from '@/domain/saved-motifs'
import { AccountRepository } from './account-repository'
import { LocalRepository } from './local-repository'
import { ChartConflictError, ChartGoneError, RemoteRepository } from './remote-repository'
import { fromJSON, toJSON } from './serialize'

/** The Worker's /api in memory, answering as it does: versions, 409 for someone else's save, 410 for a deleted chart. */
function fakeServer() {
  const charts = new Map<string, { doc: Project; summary: unknown; version: number }>()
  const motifs = new Map<string, SavedMotif>()
  let requests = 0
  const respond = (status: number, body?: unknown) => new Response(body === undefined ? null : toJSON(body), { status })
  const fetch = async (url: string, init: RequestInit = {}) => {
    requests++
    const [, , kind, rawId] = new URL(url, 'https://x').pathname.split('/')
    const id = rawId && decodeURIComponent(rawId)
    const method = init.method ?? 'GET'
    const body = init.body ? fromJSON<Record<string, unknown>>(String(init.body)) : {}
    if (kind === 'charts') {
      if (!id) return respond(200, [...charts.values()].map((c) => ({ ...(c.summary as object), version: c.version })))
      const there = charts.get(id)
      if (method === 'GET') return there ? respond(200, { project: there.doc, version: there.version }) : respond(404)
      if (method === 'DELETE') {
        charts.delete(id)
        return respond(204)
      }
      const { project, summary, baseVersion } = body as { project: Project; summary: unknown; baseVersion: number | null }
      if (baseVersion === null ? there : there?.version === baseVersion) {
        if (baseVersion === null) return respond(409, { project: there!.doc, version: there!.version })
        charts.set(id, { doc: project, summary, version: there!.version + 1 })
        return respond(200, { version: there!.version + 1 })
      }
      if (baseVersion === null) {
        charts.set(id, { doc: project, summary, version: 1 })
        return respond(200, { version: 1 })
      }
      return there ? respond(409, { project: there.doc, version: there.version }) : respond(410)
    }
    if (kind === 'motifs') {
      if (!id) return respond(200, [...motifs.values()])
      if (method === 'DELETE') {
        motifs.delete(id)
        return respond(204)
      }
      motifs.set(id, (body as { motif: SavedMotif }).motif)
      return respond(204)
    }
    return respond(404)
  }
  return { fetch, charts, motifs, requests: () => requests }
}

const chart = (id: string, name = id, updatedAt = 1): Project => ({ ...createProject({ id, name, template: builtInTemplate('swatch'), now: 1 }), updatedAt })

describe('charts in the account', () => {
  let server: ReturnType<typeof fakeServer>
  beforeEach(() => {
    server = fakeServer()
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('saves each change over the last, and lists what the list shows', async () => {
    const repo = new RemoteRepository('/api')
    await repo.put(chart('a', 'First'))
    await repo.put(chart('a', 'Second', 2))
    expect(server.charts.get('a')).toMatchObject({ version: 2, doc: { name: 'Second' } })
    const [summary] = await repo.list()
    expect(summary).toMatchObject({ id: 'a', name: 'Second' })
    expect(summary).not.toHaveProperty('version')
  })

  it('refuses a save over another device’s newer one, with theirs, and saves on top of theirs after', async () => {
    const [laptop, phone] = [new RemoteRepository('/api'), new RemoteRepository('/api')]
    await laptop.put(chart('a', 'Laptop'))
    await phone.get('a')
    await phone.put(chart('a', 'Phone', 2))
    const refused = await laptop.put(chart('a', 'Laptop again', 3)).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(ChartConflictError)
    expect((refused as ChartConflictError).project.name).toBe('Phone')
    expect(server.charts.get('a')?.doc.name).toBe('Phone')
    await laptop.put(chart('a', 'Laptop, on top of the phone’s', 4))
    expect(server.charts.get('a')).toMatchObject({ version: 3 })
  })

  it('won’t bring back a chart deleted on another device', async () => {
    const [laptop, phone] = [new RemoteRepository('/api'), new RemoteRepository('/api')]
    await laptop.put(chart('a'))
    await phone.remove('a')
    await expect(laptop.put(chart('a', 'a', 2))).rejects.toBeInstanceOf(ChartGoneError)
    const asked = server.requests()
    await expect(laptop.put(chart('a', 'a', 3))).rejects.toBeInstanceOf(ChartGoneError)
    expect(server.requests()).toBe(asked)
    expect(server.charts.has('a')).toBe(false)
  })

  it('moves charts and motifs made while signed out into the account on signing in', async () => {
    const local = new LocalRepository(`moving-${Math.random()}`)
    const remote = new RemoteRepository('/api')
    await local.put(chart('mine'))
    await local.putMotif({ id: 'm', name: 'Tree', grid: gridFromRows(['1'], { 1: 0 }), savedAt: 1 })
    // One already there (moved from another tab): left as it is.
    await new RemoteRepository('/api').put(chart('also', 'Already there'))
    await local.put(chart('also', 'Here'))
    const account = new AccountRepository(local, remote)
    expect(await account.use(true)).toBe(true)
    expect((await account.list()).map((c) => c.id).sort()).toEqual(['also', 'mine'])
    expect(server.charts.get('also')?.doc.name).toBe('Already there')
    expect((await account.motifs()).map((m) => m.name)).toEqual(['Tree'])
    expect(await local.list()).toEqual([])
    expect(await local.motifs()).toEqual([])
    expect(await account.use(true)).toBe(false)
  })
})
