import { editedAt, type SavedMotif } from '@/domain/saved-motifs'
import type { LibraryRepository } from './library'

/** Where colorwork motifs are kept on the server. */
export interface RemoteLibrary {
  motifs(): Promise<SavedMotif[]>
  putMotif(motif: SavedMotif): Promise<void>
  removeMotif(id: string): Promise<void>
}

/** Which motifs this browser has seen on the server: one missing there since was deleted on another device. */
export interface KnownMotifs {
  load(): string[]
  save(ids: readonly string[]): void
}

export const localKnownMotifs: KnownMotifs = {
  load() {
    try {
      return JSON.parse(localStorage.getItem('skeinfiend.syncedMotifs') ?? '[]')
    } catch {
      return []
    }
  },
  save(ids) {
    try {
      localStorage.setItem('skeinfiend.syncedMotifs', JSON.stringify(ids))
    } catch {
      // Not remembered: a motif deleted elsewhere may come back once, from here.
    }
  },
}

/**
 * Colorwork motifs kept on the server too. They're small, so each is sent
 * whole as it's saved or deleted (a failed send is caught up when the app next
 * opens). Opening the app brings both sides level: the most recently edited
 * copy of each wins, and one deleted on another device goes here too.
 */
export class SyncedLibrary implements LibraryRepository {
  constructor(
    private readonly local: LibraryRepository,
    private readonly remote: RemoteLibrary,
    private readonly known: KnownMotifs = localKnownMotifs,
  ) {}

  /** Signed in: saves and deletes go to the server. Until then they're kept here, and brought level on signing in. */
  private active = false

  activate(): void {
    this.active = true
  }

  motifs(): Promise<SavedMotif[]> {
    return this.local.motifs()
  }

  async putMotif(motif: SavedMotif): Promise<void> {
    await this.local.putMotif(motif)
    if (this.active) this.remote.putMotif(motif).then(() => this.remember(motif.id, true), () => {})
  }

  async removeMotif(id: string): Promise<void> {
    await this.local.removeMotif(id)
    if (this.active) this.remote.removeMotif(id).then(() => this.remember(id, false), () => {})
  }

  /** Brings this browser and the server level. Returns whether anything here changed. */
  async pull(): Promise<boolean> {
    const [there, here] = await Promise.all([this.remote.motifs(), this.local.motifs()])
    const known = new Set(this.known.load())
    const thereById = new Map(there.map((m) => [m.id, m]))
    let changed = false
    for (const motif of there) {
      const mine = here.find((m) => m.id === motif.id)
      if (!mine || editedAt(motif) > editedAt(mine)) {
        await this.local.putMotif(motif)
        changed = true
      }
    }
    for (const motif of here) {
      const theirs = thereById.get(motif.id)
      if (!theirs && known.has(motif.id)) {
        // On the server before, and gone now: deleted on another device.
        await this.local.removeMotif(motif.id)
        changed = true
      } else if (!theirs || editedAt(motif) > editedAt(theirs)) {
        await this.remote.putMotif(motif)
      }
    }
    this.known.save([...new Set([...there.map((m) => m.id), ...here.filter((m) => thereById.has(m.id) || !known.has(m.id)).map((m) => m.id)])])
    return changed
  }

  private remember(id: string, present: boolean): void {
    const ids = new Set(this.known.load())
    if (present) ids.add(id)
    else ids.delete(id)
    this.known.save([...ids])
  }
}
