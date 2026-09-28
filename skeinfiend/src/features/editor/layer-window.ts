import { useSyncExternalStore } from 'react'
import type { Place } from '@/ui/FloatingWindow'
import { createPreference } from '@/ui/preference'

let previewing: string | null = null
const listeners = new Set<() => void>()

/**
 * A colorwork motif picked from the strip, shown in the layer window before
 * it's on the chart (by its key, `built-in:…` or `saved:…`): a look first,
 * and a button to add it. For this page only.
 */
export const motifPreview = {
  get: () => previewing,
  set(key: string | null) {
    if (key === previewing) return
    previewing = key
    for (const listener of listeners) listener()
  },
  use: () => useSyncExternalStore((l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }, () => previewing),
}

let editing: string | null = null
const editingListeners = new Set<() => void>()

/**
 * The layer window: which layer it's open on, and its place over the chart,
 * remembered in this browser. It opens only to edit: a motif dragged onto the
 * chart, or Edit (a motif's, or a layer's pencil). Selecting a layer, or
 * adding one, doesn't open it. For this page only.
 */
export const layerWindow = {
  editing: {
    get: () => editing,
    set(id: string | null) {
      if (id === editing) return
      editing = id
      for (const listener of editingListeners) listener()
    },
    use: () => useSyncExternalStore((l) => {
      editingListeners.add(l)
      return () => editingListeners.delete(l)
    }, () => editing),
  },
  /**
   * From the chart area's right edge, in pixels, so it stays put as the panel
   * beside it resizes. It starts at the bottom right, clear of the chart's top
   * rows; once moved, it's kept where it was put. (A new key, so windows moved
   * before start at the new default.)
   */
  position: createPreference<Place>('skeinfiend.layerWindowPlace', { bottom: 12, right: 12 }),
}
