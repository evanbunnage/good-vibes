import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './panels.module.css'

/**
 * A titled, collapsible group in the editor's side panel. Changing `revealKey`
 * opens it and scrolls it into view, for things elsewhere that point to it.
 */
export function Section({ title, step, action, children, defaultOpen = true, revealKey, scrolls = false, collapsed }: {
  title: string
  /** A number, where sections are steps to work through in order. */
  step?: number
  action?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  revealKey?: number
  /**
   * Gives up height to the sections below it when the panel's full, scrolling
   * instead, its title staying put. 'first' gives it up before the others.
   */
  scrolls?: boolean | 'first'
  /** Shown in the title while it's closed: what's inside, at a glance (a yarn's colors, say). */
  collapsed?: ReactNode
}) {
  const id = useId()
  const details = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    if (!revealKey || !details.current) return
    details.current.open = true
    details.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [revealKey])
  return (
    <details ref={details} className={styles.section} open={defaultOpen} data-scrolls={scrolls === 'first' ? 'first' : scrolls ? '' : undefined}
      onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.summary}>
        {step !== undefined && <span className={styles.step} aria-hidden>{step}</span>}
        <h2 id={id}>{step !== undefined && <span className="visually-hidden">Step {step}: </span>}{title}</h2>
        {!open && collapsed && <span className={styles.collapsed}>{collapsed}</span>}
        {/* Clicking the action (a button inside) doesn't also open or close the section. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: only stops the click reaching the summary */}
        {action && <span className={styles.summaryAction} onClick={(e) => e.preventDefault()}>{action}</span>}
      </summary>
      <div className={styles.body} role="group" aria-labelledby={id}>
        {children}
      </div>
    </details>
  )
}
