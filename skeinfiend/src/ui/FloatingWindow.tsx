import { useRef, useState, type ReactNode } from 'react'
import { CommitInput } from './CommitInput'
import { Icon } from './Icon'
import styles from './floating-window.module.css'

/**
 * Where a window sits, in pixels from its area's right edge and its top, or
 * its bottom until it's first moved: remembered as a preference.
 */
export type Place = { top: number; right: number } | { bottom: number; right: number }

export interface WindowPosition {
  use(): Place
  set(position: { top: number; right: number }): void
}

/**
 * A small window over a drawing area (the chart, the schematic) for whatever's
 * selected there. Its title is the selection's name, renamed in place; drag
 * it by the rest of its title bar. Its position is remembered, and it stays
 * inside its area.
 */
export function FloatingWindow({ name, nameLabel, onRename, onClose, position, children, leading, focusName = false, ...data }: {
  name: string
  nameLabel: string
  /** Without it, the name is just the title. */
  onRename?: (name: string) => void
  onClose: () => void
  position: WindowPosition
  children: ReactNode
  /** Before the name in the title bar: a yarn's color, say. */
  leading?: ReactNode
  /** Opens with the name selected, to type a new one: for something just added. */
  focusName?: boolean
  /** Marks it, for finding it in the page ("data-yarn-window"). */
  [data: `data-${string}`]: unknown
}) {
  const saved = position.use()
  const [dragging, setDragging] = useState<{ top: number; right: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const place = dragging ?? saved
  const right = place.right

  function onTitlePointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button, input') || !root.current?.offsetParent) return
    const area = (root.current.offsetParent as HTMLElement).getBoundingClientRect()
    const box = root.current.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, top: box.top - area.top, right: area.right - box.right }
    const place = (x: number, y: number) => ({
      top: Math.max(0, Math.min(area.height - 48, start.top + y - start.y)),
      right: Math.max(0, Math.min(area.width - box.width, start.right - (x - start.x))),
    })
    const move = (m: PointerEvent) => setDragging(place(m.clientX, m.clientY))
    const up = (u: PointerEvent) => {
      position.set(place(u.clientX, u.clientY))
      setDragging(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  return (
    // Kept inside its area if the browser window is smaller than when it was placed.
    <div ref={root} className={styles.window} data-dragging={dragging ? '' : undefined}
      style={{
        ...('top' in place ? { top: `min(${place.top}px, 100% - 3rem)` } : { bottom: `${place.bottom}px` }),
        right: `min(${right}px, 100% - min(17rem, 100% - 1.5rem))`,
      }}
      role="dialog" aria-label={name} {...data}>
      <header className={styles.title} onPointerDown={onTitlePointerDown}>
        {/* The name, editable in place: click to rename, Enter or click away to keep it. */}
        {leading}
        {onRename ? (
          <CommitInput className={styles.name} value={name} aria-label={nameLabel} spellCheck={false} autoFocus={focusName}
            onFocus={(e) => e.currentTarget.select()} onCommit={(value) => onRename(value.trim())} />
        ) : (
          <h2 className={styles.name}>{name}</h2>
        )}
        <button type="button" className={styles.close} aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {children}
    </div>
  )
}
