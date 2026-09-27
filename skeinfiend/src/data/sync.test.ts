import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtInTemplate } from '@/domain/pieces'
import { createProject, type Project } from '@/domain/project'
import { summarize, type ProjectRepository } from './repository'
import { SEND_AFTER_MS, SyncedRepository, type PutResult, type RemoteStore, type SyncState } from './sync'

/** A server in memory: charts by id, each with a version that goes up by one per save. */
function fakeServer() {
  const charts = new Map<string, { project: Project; version: number }>()
  let puts = 0
  const remote: RemoteStore = {
    list: async () => [...charts].map(([id, { version }]) => ({ id, version })),
    get: async (id) => charts.get(id),
    put: async (project, baseVersion): Promise<PutResult> => {
      puts++
      const there = charts.get(project.id)
      if (there && there.version !== baseVersion) return { ok: false, ...there }
      const version = (there?.version ?? 0) + 1
      charts.set(project.id, { project, version })
      return { ok: true, version }
    },
    remove: async (id) => void charts.delete(id),
  }
  return { remote, charts, puts: () => puts }
}

const memoryState = (): SyncState => {
  let state = {}
  return { load: () => structuredClone(state), save: (s) => (state = structuredClone(s)) }
}

/** The browser's copy, in memory: the sync layer only needs the repository interface. */
class MemoryRepository implements ProjectRepository {
  readonly charts = new Map<string, Project>()
  list = async () => [...this.charts.values()].map(summarize)
  get = async (id: string) => this.charts.get(id)
  put = async (project: Project) => void this.charts.set(project.id, project)
  remove = async (id: string) => void this.charts.delete(id)
}

const chart = (id: string, name = id, updatedAt = 1) => ({ ...createProject({ id, name, template: builtInTemplate('swatch'), now: 1 }), updatedAt })

describe('syncing charts to a server', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves here at once, and sends the latest once editing pauses', async () => {
    const server = fakeServer()
    const repo = new SyncedRepository(new MemoryRepository(), server.remote, memoryState())
    repo.activate()
    for (let i = 1; i <= 5; i++) await repo.put(chart('a', `Edit ${i}`, i))
    expect((await repo.get('a'))!.name).toBe('Edit 5')
    expect(server.puts()).toBe(0)
    await vi.advanceTimersByTimeAsync(SEND_AFTER_MS)
    expect(server.puts()).toBe(1)
    expect(server.charts.get('a')).toMatchObject({ version: 1, project: { name: 'Edit 5' } })
  })

  it('sends what’s waiting straight away when flushed (the page hidden)', async () => {
    const server = fakeServer()
    const repo = new SyncedRepository(new MemoryRepository(), server.remote, memoryState())
    repo.activate()
    await repo.put(chart('a'))
    await repo.flush()
    expect(server.charts.get('a')?.version).toBe(1)
  })

  it('keeps both when another device saved first: theirs as the chart, this one’s as a copy', async () => {
    const server = fakeServer()
    const local = new MemoryRepository()
    const repo = new SyncedRepository(local, server.remote, memoryState())
    repo.activate()
    await repo.put(chart('a', 'Mine', 1))
    await repo.flush()
    // Meanwhile, another device saves version 2.
    server.charts.set('a', { project: chart('a', 'Theirs', 2), version: 2 })
    await repo.put(chart('a', 'Mine again', 3))
    await repo.flush()
    const names = (await local.list()).map((s) => s.name).sort()
    expect(names).toEqual(['Mine again (this device)', 'Theirs'])
    await repo.flush()
    expect(server.charts.size).toBe(2)
  })

  it('takes charts newer on the server when the app opens, and waits when offline', async () => {
    const server = fakeServer()
    server.charts.set('b', { project: chart('b', 'From the laptop'), version: 4 })
    const repo = new SyncedRepository(new MemoryRepository(), server.remote, memoryState())
    repo.activate()
    await repo.pull()
    expect((await repo.get('b'))!.name).toBe('From the laptop')

    const failing = { ...server.remote, put: async () => { throw new Error('offline') } }
    const offline = new SyncedRepository(new MemoryRepository(), failing, memoryState())
    offline.activate()
    await offline.put(chart('c'))
    await offline.flush()
    expect((await offline.get('c'))).toBeDefined()
  })

  it('keeps changes here while signed out, and sends them once signed in', async () => {
    const server = fakeServer()
    const repo = new SyncedRepository(new MemoryRepository(), server.remote, memoryState())
    await repo.put(chart('a', 'Before signing in'))
    await vi.advanceTimersByTimeAsync(SEND_AFTER_MS)
    await repo.flush()
    expect(server.puts()).toBe(0)
    repo.activate()
    await repo.pull()
    expect(server.charts.get('a')?.project.name).toBe('Before signing in')
  })

  it('says where each chart stands: kept here, saving only while sent, saved, or waiting on the connection', async () => {
    const server = fakeServer()
    const repo = new SyncedRepository(new MemoryRepository(), server.remote, memoryState())
    await repo.put(chart('a'))
    expect(repo.status('a')).toBe('local')
    repo.activate()
    await repo.put(chart('a', 'a', 2))
    // Waiting to be sent, it's already saved here.
    expect(repo.status('a')).toBe('saved')
    const sent = repo.flush()
    await Promise.resolve()
    expect(repo.status('a')).toBe('saving')
    await sent
    expect(repo.status('a')).toBe('saved')

    let up = false
    const flaky = new SyncedRepository(new MemoryRepository(), { ...server.remote, put: async (...args) => (up ? server.remote.put(...args) : Promise.reject(new Error('offline'))) }, memoryState())
    flaky.activate()
    await flaky.put(chart('b'))
    await flaky.flush()
    expect(flaky.status('b')).toBe('offline')
    up = true
    await flaky.flush()
    expect(flaky.status('b')).toBe('saved')
  })
})
