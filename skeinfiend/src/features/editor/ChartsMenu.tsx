import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { forgetLastChart, rememberLastChart } from '@/data/last-chart'
import { duplicate, projectListQuery, projectQuery, useAddProject, useDeleteProject, useRepository } from '@/data/projects'
import type { ProjectSummary } from '@/data/repository'
import { createExampleProject } from '@/domain/example'
import { NewProjectDialog } from '@/features/projects/NewProjectDialog'
import { ChartPreview } from '@/render/ChartPreview'
import { DeleteButton } from '@/ui/DeleteButton'
import { Icon } from '@/ui/Icon'
import { offerMotifHelper } from './panels/motif-helper-state'
import ui from '@/ui/ui.module.css'
import styles from './charts-menu.module.css'
import { runAction } from '@/ui/run-action'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/**
 * Every chart, a click away from the one open: switch to another, start a new
 * one or open an example, duplicate or delete. There's no home page; the app
 * opens on a chart, and the others are here.
 */
export function ChartsMenu({ currentId }: { currentId: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const newChart = useRef<HTMLDialogElement>(null)
  const repository = useRepository()
  const { data: charts = [] } = useQuery(projectListQuery(repository))
  const addProject = useAddProject()
  const navigate = useNavigate()

  // Put away by pressing elsewhere, or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function openExample() {
    const project = createExampleProject(crypto.randomUUID(), Date.now())
    await addProject.mutateAsync(project)
    offerMotifHelper(project.id)
    setOpen(false)
    void navigate({ to: '/p/$projectId', params: { projectId: project.id } })
  }

  return (
    <div ref={root} className={styles.menu}>
      <button type="button" className={`${ui.button} ${styles.trigger}`} data-variant="ghost" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        Charts <Icon name="chevronDown" />
      </button>
      {open && (
        <div className={styles.panel} role="menu" aria-label="Charts">
          <div className={styles.starts}>
            <button type="button" className={ui.button} data-variant="primary" onClick={() => {
              setOpen(false)
              newChart.current?.showModal()
            }}>
              <Icon name="plus" /> New chart
            </button>
            <button type="button" className={ui.button} data-variant="ghost" disabled={addProject.isPending} onClick={() => runAction(openExample)}>Open an example</button>
          </div>
          <ul className={styles.list}>
            {charts.map((chart) => (
              <ChartRow key={chart.id} chart={chart} current={chart.id === currentId} others={charts.filter((c) => c.id !== chart.id)} onGo={() => setOpen(false)} />
            ))}
          </ul>
        </div>
      )}
      <NewProjectDialog dialog={newChart} />
    </div>
  )
}

function ChartRow({ chart, current, others, onGo }: { chart: ProjectSummary; current: boolean; others: readonly ProjectSummary[]; onGo: () => void }) {
  const repository = useRepository()
  const client = useQueryClient()
  const addProject = useAddProject()
  const deleteProject = useDeleteProject()
  const navigate = useNavigate()
  async function copy() {
    const source = await client.fetchQuery(projectQuery(repository, chart.id))
    addProject.mutate(duplicate(source, crypto.randomUUID(), Date.now()))
  }

  async function remove() {
    if (current) {
      // Off it first, so nothing saves it back: to the most recent other chart, or a new blank one.
      const next = others[0]
      if (next) rememberLastChart(next.id)
      else forgetLastChart()
      onGo()
      await navigate({ to: '/' })
    }
    deleteProject.mutate(chart.id)
  }

  return (
    <li className={styles.row} data-current={current || undefined}>
      <Link to="/p/$projectId" params={{ projectId: chart.id }} className={styles.open} onClick={onGo} role="menuitem">
            <span className={styles.thumb}>
              <ChartPreview grid={chart.preview} colors={chart.colors} aspect={chart.aspect} fill />
            </span>
            <span className={styles.name}>{chart.name}</span>
            <span className={styles.date}>{dateFormat.format(chart.updatedAt)}</span>
          </Link>
          <button type="button" className={ui.button} data-variant="ghost" data-size="icon" aria-label={`Duplicate ${chart.name}`} title="Duplicate" onClick={() => runAction(copy)}>
            <Icon name="copy" />
          </button>
      <DeleteButton label={chart.name} onDelete={() => runAction(remove)} />
    </li>
  )
}
