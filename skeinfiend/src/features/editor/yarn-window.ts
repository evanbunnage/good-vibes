import { useSyncExternalStore } from 'react'
import type { Place } from '@/ui/FloatingWindow'
import { createPreference } from '@/ui/preference'

let open: string | null = null
/** A yarn just added: its window opens with the name ready to type. */
let naming: string | null = null
const listeners = new Set<() => void>()

/**
 * The yarn window: which yarn's details are open (by id, for this page only),
 * and where the window sits over the chart, remembered. It starts at the top
 * right, clear of the layer window at the bottom right.
 *
 * It's there only while it's wanted: its pencil opens it (another yarn's
 * pencil switches it), and it closes with that pencil, its ×, Escape, pressing
 * on the chart, choosing a different yarn to draw with, or leaving the chart.
 */
export const yarnWindow = {
  yarn: {
    get: () => open,
    set(id: string | null) {
      if (id === open) return
      naming = null
      open = id
      for (const listener of listeners) listener()
    },
    use: () => useSyncExternalStore((l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }, () => open),
  },
  /** Opens a yarn just added, its name selected to type over. */
  openNew(id: string) {
    yarnWindow.yarn.set(id)
    naming = id
  },
  /** Whether this yarn's window was opened to name it: until it's closed or switched. */
  isNaming: (id: string) => naming === id,
  /**
   * Closes it, keeping a field being typed in: pressing on the chart doesn't
   * move focus, so the field is left first, which saves it.
   */
  close() {
    if (open === null) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('[data-yarn-window]')) focused.blur()
    yarnWindow.yarn.set(null)
  },
  position: createPreference<Place>('skeinfiend.yarnWindowPlace', { top: 12, right: 12 }),
}
