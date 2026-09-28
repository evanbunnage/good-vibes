import type { ReactNode } from 'react'
import styles from './prompt.module.css'

/**
 * A quiet first-step prompt at the foot of an empty or untouched view. It
 * doesn't need dismissing: whatever shows it stops once the step's been done.
 * `toPanel` adds an arrow toward the panel, where what it asks for is.
 */
export function Prompt({ children, toPanel = false }: { children: ReactNode; toPanel?: boolean }) {
  return (
    <p className={styles.prompt} role="status">
      {children}{toPanel && <span aria-hidden> →</span>}
    </p>
  )
}
