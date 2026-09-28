import { useRouteContext } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPreference } from '@/ui/preference'

/** Whether this browser's knitter has put a motif on a chart yet, or closed the helper. */
const done = createPreference<boolean>('skeinfiend.draggedMotif', false)

/** Charts just started that it's shown on, whatever's been done before: for this page only. */
const offered = new Set<string>()
/** A motif's been picked up to look at: they've found the motifs, so it's put away for this page. */
let looked = false
const listeners = new Set<() => void>()
let version = 0
function changed(): void {
  version++
  for (const listener of listeners) listener()
}

/**
 * Shows the helper on a chart just started: on an example, always; on a
 * chart of their own, `startedChart` decides.
 */
export function offerMotifHelper(id: string): void {
  offered.add(id)
  changed()
}

/**
 * A chart of their own, just made: the helper's offered to someone signed out,
 * or on an account's first chart. Otherwise they've done this before.
 */
export function startedChart(id: string, { signedIn, otherCharts }: { signedIn: boolean; otherCharts: number }): void {
  if (!signedIn || otherCharts === 0) offerMotifHelper(id)
}

/** A motif was tapped or clicked to look at: the helper's put away until the page is next opened. */
export function motifLooked(): void {
  if (looked) return
  looked = true
  changed()
}

/** A motif was put on the chart (dragged there, or added): the helper's done its job. */
export function motifAdded(): void {
  done.set(true)
  offered.clear()
  changed()
}

/**
 * Whether the helper's wanted on this chart now: on a chart just started as
 * an example, or a first one of their own; otherwise, for someone signed out,
 * until they've done it. A few seconds after the chart opens, once they've had
 * a look. With how to close it, for this chart.
 */
export function useMotifHelper(chartId: string): { wanted: boolean; close: () => void } {
  const { user } = useRouteContext({ from: '__root__' })
  const dismissed = done.use()
  useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, () => version)
  const [due, setDue] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setDue(true), 3000)
    return () => clearTimeout(timer)
  }, [])
  return {
    wanted: due && !looked && (offered.has(chartId) || (!user && !dismissed)),
    close: () => {
      done.set(true)
      offered.delete(chartId)
      changed()
    },
  }
}
