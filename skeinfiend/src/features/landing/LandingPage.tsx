import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useState } from 'react'
import { useAddProject, projectListQuery, useRepository } from '@/data/projects'
import { createExampleProject } from '@/domain/example'
import { createProject } from '@/domain/project'
import { isReturning } from '@/data/auth'
import { lastChart } from '@/data/last-chart'
import { AccountMenu } from '@/features/editor/AccountMenu'
import { offerMotifHelper, startedChart } from '@/features/editor/panels/motif-helper-state'
import { ChartPreview } from '@/render/ChartPreview'
import { Logo } from '@/ui/Logo'
import { Wordmark } from '@/ui/Wordmark'
import ui from '@/ui/ui.module.css'
import styles from './landing.module.css'
import { runAction } from '@/ui/run-action'

/**
 * Where someone starts who has nothing open yet: signed out, or signed in
 * without a chart. What SkeinFiend is, and two ways in: a blank chart of
 * their own, or an example. Signed out with charts already in this browser,
 * the most recent is a click away too.
 */
export function LandingPage() {
  const repository = useRepository()
  const { data: charts = [] } = useQuery(projectListQuery(repository))
  const addProject = useAddProject()
  const navigate = useNavigate()
  const { user } = useRouteContext({ from: '__root__' })
  // The chart being made, on its way to opening: never offered to continue as it goes.
  const [starting, setStarting] = useState<string | null>(null)
  const others = charts.filter((c) => c.id !== starting)
  // The chart opened last in this browser, or else the one edited most recently.
  const recent = others.find((c) => c.id === lastChart()) ?? others[0]

  async function start(project: ReturnType<typeof createProject>, example = false) {
    setStarting(project.id)
    try {
      await addProject.mutateAsync(project)
    } catch (error) {
      setStarting(null)
      throw error
    }
    // The drag-a-motif helper: always on an example; on a chart of their own, if it's new to them.
    if (example) offerMotifHelper(project.id)
    else startedChart(project.id, { signedIn: Boolean(user), otherCharts: charts.length })
    void navigate({ to: '/p/$projectId', params: { projectId: project.id } })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <Logo />
          <Wordmark />
        </span>
        {/* The editor's own account menu: signing in, or the account and signing out. */}
        <AccountMenu returnTo="/" />
      </header>

      <main className={styles.hero}>
        <h1>Colorwork chart design for <span className={styles.knitters}>Knitters</span></h1>
        <div className={styles.actions}>
          <button type="button" className={ui.button} data-variant="primary" disabled={starting !== null}
            onClick={() => runAction(() => start(createProject({ id: crypto.randomUUID(), name: 'New chart', now: Date.now() })))}>
            Create a chart
          </button>
          <button type="button" className={ui.button} disabled={starting !== null} onClick={() => runAction(() => start(createExampleProject(crypto.randomUUID(), Date.now()), true))}>
            Open an example
          </button>
        </div>
        {/* Its room is kept even before the charts arrive (just after signing in), so nothing above it moves. */}
        <div className={styles.continueSlot}>
        {recent && (
          <Link to="/p/$projectId" params={{ projectId: recent.id }} className={styles.continue}>
            {/* The chart itself, small: which one this is, at a glance. */}
            <span className={styles.thumb}>
              <ChartPreview grid={recent.preview} colors={recent.colors} aspect={recent.aspect} fill />
            </span>
            <span className={styles.continueText}>Continue “{recent.name}”</span>
          </Link>
        )}
        {/* Signed out, their charts are only in this browser: as in the editor, the way to keep them. */}
        {recent && !user && (
          <Link to="/sign-in" search={{ redirect: '/' }} className={styles.signInToSave}>
            {isReturning() ? 'Sign in to save' : 'Create an account to save'}
          </Link>
        )}
        </div>
      </main>
    </div>
  )
}
