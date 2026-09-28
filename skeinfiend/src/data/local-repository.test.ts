import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { gridsEqual } from '@/domain/grid'
import { createProject } from '@/domain/project'
import { LocalRepository } from './local-repository'
import { builtInTemplate, rectangle } from '@/domain/pieces'
import { publishedPattern } from '@/domain/published-patterns.fixture'

describe('LocalRepository', () => {
  const repository = () => new LocalRepository(`test-${crypto.randomUUID()}`)

  it('round-trips a project, including its typed-array layers', async () => {
    const repo = repository()
    const project = createProject({ id: 'a', name: 'Yoke', template: publishedPattern('hat'), now: 1 })
    await repo.put(project)
    const loaded = await repo.get('a')
    expect(loaded?.name).toBe('Yoke')
    expect(loaded && gridsEqual(loaded.outline, project.outline)).toBe(true)
    expect(loaded?.outline.cells).toBeInstanceOf(Uint8Array)
  })

  it('lists summaries newest first', async () => {
    const repo = repository()
    await repo.put(createProject({ id: 'old', name: 'Old', template: builtInTemplate('swatch'), now: 1 }))
    await repo.put(createProject({ id: 'new', name: 'New', template: builtInTemplate('swatch'), now: 2 }))
    const list = await repo.list()
    expect(list.map((s) => s.id)).toEqual(['new', 'old'])
    expect(list[0]?.preview.width).toBeGreaterThan(0)
  })

  it('removes a project and its summary', async () => {
    const repo = repository()
    await repo.put(createProject({ id: 'gone', name: 'Gone', template: builtInTemplate('swatch'), now: 1 }))
    await repo.remove('gone')
    expect(await repo.get('gone')).toBeUndefined()
    expect(await repo.list()).toEqual([])
  })
  it('keeps saved motifs', async () => {
    const repo = repository()
    await repo.putMotif({ id: 'm', name: 'Tree', grid: rectangle(2, 2), savedAt: 1 })
    expect((await repo.motifs()).map((m) => m.name)).toEqual(['Tree'])
    await repo.removeMotif('m')
    expect(await repo.motifs()).toEqual([])
  })

})
