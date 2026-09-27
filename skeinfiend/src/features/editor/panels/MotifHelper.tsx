import { useEffect } from 'react'
import type { EditorState, EditorStore } from '@/editor/store'
import { Icon } from '@/ui/Icon'
import { createPreference } from '@/ui/preference'
import { useEditor } from '../editor-context'
import styles from './panels.module.css'

/** Whether this browser's knitter has put colorwork on a chart yet, or waved the helper away: it only shows once. */
const seen = createPreference<boolean>('skeinfiend.seenMotifHelper', false)

const selectHasLayers = (_: EditorState, store: EditorStore) => store.project.bands.length > 0

/**
 * The first step, shown once, right by the motifs it's about: a motif tile
 * sliding onto a scrap of chart, and a line saying what that does. Gone for
 * good once there's colorwork on a chart, or when dismissed.
 */
export function MotifHelper() {
  const shown = !seen.use()
  const hasLayers = useEditor(selectHasLayers)
  useEffect(() => {
    if (hasLayers) seen.set(true)
  }, [hasLayers])
  if (!shown || hasLayers) return null
  return (
    <div className={styles.helper} role="status">
      <span className={styles.helperDemo} aria-hidden>
        <span className={styles.helperChart} />
        <span className={styles.helperTile}>
          <svg viewBox="0 0 7 7" aria-hidden="true">
            <path d="M3 0h1v1H3zM2 1h1v1H2zM4 1h1v1H4zM1 2h1v1H1zM5 2h1v1H5zM0 3h1v1H0zM6 3h1v1H6zM1 4h1v1H1zM5 4h1v1H5zM2 5h1v1H2zM4 5h1v1H4zM3 6h1v1H3z" />
          </svg>
        </span>
      </span>
      <p>Drag a colorwork motif onto the chart to start.</p>
      <button type="button" className={styles.helperClose} aria-label="Dismiss" title="Dismiss" onClick={() => seen.set(true)}>
        <Icon name="close" />
      </button>
    </div>
  )
}
