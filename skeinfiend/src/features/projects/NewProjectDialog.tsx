import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { projectListQuery, useAddProject, useRepository } from '@/data/projects'
import { DEFAULT_GAUGE, isValidGauge, type Gauge } from '@/domain/gauge'
import { createExampleProject } from '@/domain/example'
import { createProject } from '@/domain/project'
import { offerMotifHelper, startedChart } from '@/features/editor/panels/motif-helper-state'
import { GaugeFields } from '@/features/pieces/GaugeFields'
import ui from '@/ui/ui.module.css'
import styles from './projects.module.css'
import { runAction } from '@/ui/run-action'

/**
 * Starting a chart: just the gauge from the swatch. It opens on a plain piece,
 * sized in the side panel; the name is changed in the editor's header. Or an
 * example to look around in.
 */
export function NewProjectDialog({ dialog }: { dialog: React.RefObject<HTMLDialogElement | null> }) {
  const navigate = useNavigate()
  const addProject = useAddProject()
  const { user } = useRouteContext({ from: '__root__' })
  const repository = useRepository()
  const { data: charts = [] } = useQuery(projectListQuery(repository))
  const titleId = useId()
  const [gauge, setGauge] = useState<Gauge>(DEFAULT_GAUGE)
  const valid = isValidGauge(gauge)

  /** An example to look around in, instead: a finished chart, ready to try things on. */
  async function openExample() {
    const project = createExampleProject(crypto.randomUUID(), Date.now())
    await addProject.mutateAsync(project)
    offerMotifHelper(project.id)
    dialog.current?.close()
    void navigate({ to: '/p/$projectId', params: { projectId: project.id } })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    const project = createProject({ id: crypto.randomUUID(), name: 'New chart', gauge, now: Date.now() })
    await addProject.mutateAsync(project)
    startedChart(project.id, { signedIn: Boolean(user), otherCharts: charts.filter((c) => c.id !== project.id).length })
    dialog.current?.close()
    void navigate({ to: '/p/$projectId', params: { projectId: project.id } })
  }

  return (
    <dialog ref={dialog} className={`${ui.dialog} ${styles.newProject}`} aria-labelledby={titleId}>
      <form method="dialog" onSubmit={submit}>
        <h2 id={titleId}>New chart</h2>

        <fieldset className={styles.gauge}>
          <legend>Gauge</legend>
          <GaugeFields gauge={gauge} onChange={setGauge} />
        </fieldset>

        {/* In the same place, so the dialog keeps its height: what's wrong with the gauge, or that it can wait. */}
        {valid
          ? <p className={styles.gaugeNote}>The gauge can be changed later.</p>
          : <p className={styles.sizeNote}>Check the gauge.</p>}

        <div className={ui.actions}>
          <button type="button" className={`${ui.button} ${styles.example}`} data-variant="ghost" disabled={addProject.isPending} onClick={() => runAction(openExample)}>
            Open an example
          </button>
          <button type="button" className={ui.button} data-variant="ghost" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" className={ui.button} data-variant="primary" disabled={!valid || addProject.isPending}>
            Create
          </button>
        </div>
      </form>
    </dialog>
  )
}
