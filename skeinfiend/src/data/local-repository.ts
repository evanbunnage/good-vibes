import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { checkVersion } from '@/domain/version'
import type { Project } from '@/domain/project'
import type { SavedMotif } from '@/domain/saved-motifs'
import type { LibraryRepository } from './library'
import { summarize, type ProjectRepository, type ProjectSummary } from './repository'

interface SkeinDB extends DBSchema {
  projects: { key: string; value: Project }
  summaries: { key: string; value: ProjectSummary; indexes: { updatedAt: number } }
  motifs: { key: string; value: SavedMotif }
}

/**
 * Projects, and the designer's own colorwork motifs, stored in the browser's IndexedDB. Typed arrays are stored as-is
 * (structured clone), so a chart round-trips without any encoding.
 *
 * Summaries are kept in their own store so the project list stays fast no
 * matter how large each project's layers get.
 */
export class LocalRepository implements ProjectRepository, LibraryRepository {
  private readonly db: Promise<IDBPDatabase<SkeinDB>>

  constructor(name = 'skeinfiend') {
    this.db = openDB<SkeinDB>(name, 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' })
          db.createObjectStore('summaries', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt')
        }
        if (oldVersion < 2) db.createObjectStore('motifs', { keyPath: 'id' })
        // Saved piece templates were dropped; nothing ever used the store.
        if (oldVersion === 2) (db as unknown as IDBPDatabase).deleteObjectStore('templates')
      },
      // A newer version of the app, open in another tab, needs to upgrade the database: this tab's
      // connection would hold it up indefinitely, so it lets go and reloads as the newer version.
      blocking(_current, _blocked, event) {
        ;(event.target as IDBDatabase).close()
        if (typeof location !== 'undefined') location.reload()
      },
    })
  }

  async list(): Promise<ProjectSummary[]> {
    const summaries = await (await this.db).getAllFromIndex('summaries', 'updatedAt')
    return summaries.reverse()
  }

  async get(id: string): Promise<Project | undefined> {
    const project = await (await this.db).get('projects', id)
    return project && checkVersion(project)
  }

  async put(project: Project): Promise<void> {
    const tx = (await this.db).transaction(['projects', 'summaries'], 'readwrite')
    await Promise.all([tx.objectStore('projects').put(project), tx.objectStore('summaries').put(summarize(project)), tx.done])
  }

  async remove(id: string): Promise<void> {
    const tx = (await this.db).transaction(['projects', 'summaries'], 'readwrite')
    await Promise.all([tx.objectStore('projects').delete(id), tx.objectStore('summaries').delete(id), tx.done])
  }

  // The library

  async motifs(): Promise<SavedMotif[]> {
    const motifs = await (await this.db).getAll('motifs')
    return motifs.sort((a, b) => a.savedAt - b.savedAt)
  }

  async putMotif(motif: SavedMotif): Promise<void> {
    await (await this.db).put('motifs', motif)
  }

  async removeMotif(id: string): Promise<void> {
    await (await this.db).delete('motifs', id)
  }
}
