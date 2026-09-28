import type { Project } from '@/domain/project'
import type { SavedMotif } from '@/domain/saved-motifs'
import type { LibraryRepository } from './library'
import type { LocalRepository } from './local-repository'
import { ChartConflictError, type RemoteRepository } from './remote-repository'
import type { ProjectRepository, ProjectSummary } from './repository'

/**
 * Where charts and colorwork motifs live: in the account, signed in, or in
 * this browser (IndexedDB), signed out. Never both at once, so there's
 * nothing to keep in step. On signing in, what was made here signed out
 * moves into the account.
 */
export class AccountRepository implements ProjectRepository, LibraryRepository {
  private signedIn = false
  private moved: Promise<void> | null = null

  constructor(
    private readonly local: LocalRepository,
    private readonly remote: RemoteRepository,
  ) {}

  private get store(): ProjectRepository & LibraryRepository {
    return this.signedIn ? this.remote : this.local
  }

  /**
   * Signed in or out, as the page now knows it. Returns whether that changed
   * (and so what's cached is someone else's). Signing in moves this
   * browser's charts and motifs into the account first.
   */
  async use(signedIn: boolean): Promise<boolean> {
    if (signedIn === this.signedIn) return false
    this.signedIn = signedIn
    if (signedIn) {
      this.moved ??= this.moveIntoAccount()
        // Not reached (offline, say): what's left stays here, and moves on the next visit.
        .catch((error: unknown) => console.warn('Couldn’t move this browser’s charts into the account yet.', error))
        .finally(() => {
          this.moved = null
        })
      await this.moved
    }
    return true
  }

  /** Each chart and motif made here while signed out goes to the account, then leaves this browser. */
  private async moveIntoAccount(): Promise<void> {
    for (const { id } of await this.local.list()) {
      const project = await this.local.get(id).catch(() => undefined)
      if (!project) continue
      try {
        await this.remote.put(project)
      } catch (error) {
        // Already there (moved before, from another tab): nothing to add.
        if (!(error instanceof ChartConflictError)) throw error
      }
      await this.local.remove(id)
    }
    for (const motif of await this.local.motifs()) {
      await this.remote.putMotif(motif)
      await this.local.removeMotif(motif.id)
    }
  }

  list(): Promise<ProjectSummary[]> {
    return this.store.list()
  }

  get(id: string): Promise<Project | undefined> {
    return this.store.get(id)
  }

  put(project: Project): Promise<void> {
    return this.store.put(project)
  }

  remove(id: string): Promise<void> {
    return this.store.remove(id)
  }

  motifs(): Promise<SavedMotif[]> {
    return this.store.motifs()
  }

  putMotif(motif: SavedMotif): Promise<void> {
    return this.store.putMotif(motif)
  }

  removeMotif(id: string): Promise<void> {
    return this.store.removeMotif(id)
  }
}
