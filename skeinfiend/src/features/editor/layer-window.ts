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

/**
 * The layer window's place over the chart, remembered in this browser.
 * Closing it is remembered too, so it stays out of the way; a layer's pencil
 * opens it again. Its position is kept whether it's open or not.
 */
export const layerWindow = {
  open: createPreference<boolean>('skeinfiend.motifWindowOpen', true),
  /**
   * From the chart area's right edge, in pixels, so it stays put as the panel
   * beside it resizes. It starts at the bottom right, clear of the chart's top
   * rows; once moved, it's kept where it was put. (A new key, so windows moved
   * before start at the new default.)
   */
  position: createPreference<Place>('skeinfiend.layerWindowPlace', { bottom: 12, right: 12 }),
}
