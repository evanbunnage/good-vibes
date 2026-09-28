import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import ui from './ui.module.css'

/**
 * Deleting that asks without a sentence: the trash icon, clicked, becomes a
 * red "Delete" in its place, and a second click deletes. Moving away, Escape,
 * or a few seconds' wait puts the icon back.
 */
export function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!armed) return
    confirm.current?.focus()
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  if (!armed) {
    return (
      <button type="button" className={ui.button} data-variant="ghost" data-size="icon" aria-label={`Delete ${label}`} title="Delete" onClick={() => setArmed(true)}>
        <Icon name="trash" />
      </button>
    )
  }
  return (
    <button type="button" ref={confirm} className={ui.button} data-variant="danger" data-size="compact" aria-label={`Confirm: delete ${label}`}
      onClick={onDelete} onBlur={() => setArmed(false)} onKeyDown={(e) => e.key === 'Escape' && setArmed(false)}>
      Delete
    </button>
  )
}
