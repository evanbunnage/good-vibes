import { useCallback, useSyncExternalStore } from 'react'

/**
 * Where the knitter is in a chart: the row they're on, counted up from the
 * cast-on (row 1). It's the knitter's, not the design's, so it's kept apart
 * from the chart, in this browser: moving through rows doesn't edit the
 * chart, change when it was last edited, or race the designer's changes.
 * Counted from the cast-on, it stays on the same row if the piece is
 * reshaped above it. Until the knitter moves, it's the cast-on row.
 */
const key = (projectId: string) => `skeinfiend.progress.${projectId}`
const listeners = new Set<() => void>()

function read(projectId: string): number | null {
  try {
    const stored = localStorage.getItem(key(projectId))
    const row = stored === null ? NaN : Number(stored)
    return Number.isInteger(row) && row >= 1 ? row : null
  } catch {
    return null
  }
}

/** The knitter's row, top-based (as the chart counts), and a way to move it. */
export function useProgress(projectId: string, height: number): [number, (y: number) => void] {
  const stored = useSyncExternalStore((l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }, () => read(projectId))
  const y = height - (stored ?? 1)
  const clamped = Math.min(height - 1, Math.max(0, y))
  const set = useCallback((next: number) => {
    const row = height - Math.min(height - 1, Math.max(0, next))
    try {
      localStorage.setItem(key(projectId), String(row))
    } catch {
      // Not remembered, but still moved for this page.
    }
    for (const listener of listeners) listener()
  }, [projectId, height])
  return [clamped, set]
}
