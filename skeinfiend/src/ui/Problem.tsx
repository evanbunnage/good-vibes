import { Link } from '@tanstack/react-router'
import styles from './problem.module.css'
import ui from './ui.module.css'

/** A readable message for anything thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <main className={styles.problem}>
      <h1>{title}</h1>
      <p>{detail}</p>
      <Link to="/" className={ui.button} data-variant="primary">
        Back to charts
      </Link>
    </main>
  )
}
