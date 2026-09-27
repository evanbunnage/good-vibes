import { describe, expect, it } from 'vitest'
import { gridFromRows } from '@/domain/grid'
import type { SavedMotif } from '@/domain/saved-motifs'
import type { LibraryRepository } from './library'
import { SyncedLibrary, type KnownMotifs, type RemoteLibrary } from './synced-library'

class Memory implements LibraryRepository, RemoteLibrary {
  readonly all = new Map<string, SavedMotif>()
  motifs = async () => [...this.all.values()]
  putMotif = async (m: SavedMotif) => void this.all.set(m.id, m)
  removeMotif = async (id: string) => void this.all.delete(id)
}
const known = (): KnownMotifs => {
  let ids: string[] = []
  return { load: () => [...ids], save: (next) => (ids = [...next]) }
}
const motif = (id: string, savedAt: number, editedAt?: number): SavedMotif => ({ id, name: id, grid: gridFromRows(['1'], { 1: 0 }), savedAt, ...(editedAt && { editedAt }) })

describe('colorwork motifs on the server', () => {
  it('keeps the most recently edited copy of each, on both sides', async () => {
    const [here, there] = [new Memory(), new Memory()]
    await here.putMotif(motif('a', 1, 9))
    await there.putMotif(motif('a', 1, 5))
    await there.putMotif(motif('b', 2))
    await here.putMotif(motif('c', 3))
    const library = new SyncedLibrary(here, there, known())
    library.activate()
    expect(await library.pull()).toBe(true)
    expect(there.all.get('a')?.editedAt).toBe(9)
    expect([...here.all.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect([...there.all.keys()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('removes one here that was deleted on another device, and sends saves and deletes as they happen', async () => {
    const [here, there] = [new Memory(), new Memory()]
    const library = new SyncedLibrary(here, there, known())
    library.activate()
    await library.putMotif(motif('a', 1))
    await library.putMotif(motif('b', 1))
    await new Promise((r) => setTimeout(r))
    expect([...there.all.keys()].sort()).toEqual(['a', 'b'])
    await library.pull()
    // Deleted on another device:
    there.all.delete('b')
    await library.pull()
    expect([...here.all.keys()]).toEqual(['a'])
    await library.removeMotif('a')
    await new Promise((r) => setTimeout(r))
    expect(there.all.size).toBe(0)
  })
})
