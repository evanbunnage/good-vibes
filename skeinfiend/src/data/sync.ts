import type { Project } from '@/domain/project'
import type { ProjectRepository, ProjectSummary } from './repository'

/**
 * Charts kept on a server as well as in the browser. The browser's copy is the
 * one the editor works on, so editing stays instant and works offline; the
 * server's is a backup that catches up. Not a sync engine: whole charts, one
 * write per pause in editing, last write checked by version.
 *
 * - Saving a chart saves it here at once, and marks it to send.
 * - A few seconds after the last save to it, the whole chart is sent, with
 *   the version it was based on. Hiding or closing the page sends what's
 *   waiting straight away.
 * - The server takes it only if nobody's saved a newer version meanwhile
 *   (another device). If they have, both are kept: theirs becomes the chart,
 *   and this device's is saved alongside as a copy, to look at and keep.
 * - Opening the app fetches the list of charts and their versions, and takes
 *   any that are newer on the server.
 * - Offline or failing, changes wait here and go with the next attempt.
 */
export interface RemoteStore {
  list(): Promise<RemoteEntry[]>
  get(id: string): Promise<{ project: Project; version: number } | undefined>
  /** Saves over `baseVersion` (null for a chart new to the server), or says what's there instead. */
  put(project: Project, baseVersion: number | null, options?: { keepalive?: boolean }): Promise<PutResult>
  remove(id: string): Promise<void>
}

export interface RemoteEntry {
  readonly id: string
  readonly version: number
}

export type PutResult = { readonly ok: true; readonly version: number } | { readonly ok: false; readonly project: Project; readonly version: number }

/** What this browser knows of each chart on the server: the version it has, and whether it has changes to send. */
export interface SyncState {
  load(): Record<string, { version: number | null; dirty: boolean }>
  save(state: Record<string, { version: number | null; dirty: boolean }>): void
}

export const localSyncState: SyncState = {
  load() {
    try {
      return JSON.parse(localStorage.getItem('skeinfiend.sync') ?? '{}')
    } catch {
      return {}
    }
  },
  save(state) {
    try {
      localStorage.setItem('skeinfiend.sync', JSON.stringify(state))
    } catch {
      // Not remembered: everything is sent again next time, which the versions make safe.
    }
  },
}

/**
 * Where a chart stands, for the editor to say: kept only here (no one's
 * signed in), being sent, saved (on the server, or here and waiting to be
 * sent), or not sent because the server couldn't be reached (it's sent when
 * it can be).
 */
export type SyncStatus = 'local' | 'saving' | 'saved' | 'offline'

/** How long after the last save to a chart it's sent. */
export const SEND_AFTER_MS = 4000

export class SyncedRepository implements ProjectRepository {
  private readonly state: Record<string, { version: number | null; dirty: boolean }>
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly sending = new Map<string, Promise<void>>()
  /** Signed in: changes go to the server. Until then they're kept here, marked, and sent once signed in. */
  private active = false
  /** Charts whose last send failed: they're waiting on the connection. */
  private readonly failed = new Set<string>()
  /** Charts being sent right now. */
  private readonly inFlight = new Set<string>()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly local: ProjectRepository,
    private readonly remote: RemoteStore,
    private readonly syncState: SyncState = localSyncState,
    /** Told when charts change from elsewhere (pulled, or a conflict copy made), to refresh the list. */
    private readonly onChange: () => void = () => {},
  ) {
    this.state = syncState.load()
  }

  list(): Promise<ProjectSummary[]> {
    return this.local.list()
  }

  get(id: string): Promise<Project | undefined> {
    return this.local.get(id)
  }

  async put(project: Project): Promise<void> {
    await this.local.put(project)
    this.mark(project.id, { dirty: true })
    if (this.active) this.schedule(project.id)
  }

  /** Someone's signed in: from now on changes are sent, and what's waiting goes with the next pull. */
  activate(): void {
    this.active = true
    this.notify()
  }

  status(id: string): SyncStatus {
    if (!this.active) return 'local'
    const known = this.state[id]
    if (this.inFlight.has(id)) return 'saving'
    // Waiting to be sent is still saved: it's in this browser already.
    return known?.dirty && this.failed.has(id) ? 'offline' : 'saved'
  }

  /** Told when any chart's status might have changed. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  async remove(id: string): Promise<void> {
    await this.local.remove(id)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    delete this.state[id]
    this.syncState.save(this.state)
    if (!this.active) return
    try {
      await this.remote.remove(id)
    } catch {
      // Gone here; the server's copy is removed next time it's asked, or stays as a backup.
    }
  }

  /** Clears this browser's copy (charts, and colorwork motifs kept alongside), and what it knew of the server's. */
  async clearLocal(): Promise<void> {
    await (this.local as ProjectRepository & { clear?: () => Promise<void> }).clear?.()
    for (const key of Object.keys(this.state)) delete this.state[key]
    this.syncState.save(this.state)
    this.active = false
    this.notify()
  }

  /** Whether any chart has changes the server hasn't got. */
  hasUnsent(): boolean {
    return Object.values(this.state).some((s) => s.dirty)
  }

  /** Sends every chart with changes waiting, now: when the page is hidden or closed. Never rejects, as `send` doesn't. */
  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (!this.active) return
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.all(Object.entries(this.state).filter(([, s]) => s.dirty).map(([id]) => this.send(id, options)))
  }

  /**
   * Charts this browser has that the server's never had (from before
   * signing in): marked to send, so they're kept there too. Once, at the
   * first sign-in on this browser.
   */
  async adoptLocal(): Promise<void> {
    for (const summary of await this.local.list()) {
      if (!this.state[summary.id]) this.mark(summary.id, { dirty: true })
    }
  }

  /** Takes charts that are newer on the server, and sends any waiting here. On opening the app. */
  async pull(): Promise<void> {
    const entries = await this.remote.list()
    let changed = false
    for (const { id, version } of entries) {
      const known = this.state[id]
      if (known?.dirty || (known?.version ?? -1) >= version) continue
      const fetched = await this.remote.get(id)
      if (!fetched) continue
      await this.local.put(fetched.project)
      this.mark(id, { version: fetched.version, dirty: false })
      changed = true
    }
    if (changed) this.onChange()
    await this.flush()
  }

  private mark(id: string, changes: Partial<{ version: number | null; dirty: boolean }>): void {
    this.state[id] = { version: null, dirty: false, ...this.state[id], ...changes }
    this.syncState.save(this.state)
    this.notify()
  }

  private schedule(id: string): void {
    clearTimeout(this.timers.get(id))
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id)
      void this.send(id)
    }, SEND_AFTER_MS))
  }

  /** One send per chart at a time: a save during a send is sent after it. Never rejects: a failure is recorded, and retried. */
  private send(id: string, options: { keepalive?: boolean } = {}): Promise<void> {
    const previous = this.sending.get(id) ?? Promise.resolve()
    const next = previous.then(() => {
      this.inFlight.add(id)
      this.notify()
      return this.sendNow(id, options)
    }).then(
      () => {
        this.failed.delete(id)
      },
      () => {
        // Offline or failed: it stays marked, and goes with the next save, flush, or the connection coming back.
        this.failed.add(id)
      },
    ).finally(() => {
      this.inFlight.delete(id)
      this.notify()
    })
    this.sending.set(id, next)
    return next
  }

  private async sendNow(id: string, options: { keepalive?: boolean }): Promise<void> {
    const known = this.state[id]
    if (!known?.dirty) return
    const project = await this.local.get(id)
    if (!project) return
    const result = await this.remote.put(project, known.version, options)
    if (result.ok) {
      // Saved again while this was sending? Then it's still dirty, for the next send.
      const latest = await this.local.get(id)
      this.mark(id, { version: result.version, dirty: latest !== undefined && latest.updatedAt !== project.updatedAt })
      return
    }
    // Someone saved a newer version: keep theirs as the chart, and this device's alongside it.
    const copy: Project = { ...project, id: crypto.randomUUID(), name: `${project.name} (this device)`, updatedAt: Date.now() }
    await this.local.put(copy)
    this.mark(copy.id, { dirty: true })
    await this.local.put(result.project)
    this.mark(id, { version: result.version, dirty: false })
    this.onChange()
    this.schedule(copy.id)
  }
}
