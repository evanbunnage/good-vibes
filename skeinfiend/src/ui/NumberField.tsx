import { useEffect, useId, useRef, useState } from 'react'
import styles from './number-field.module.css'

/** Pixels of horizontal drag per step when scrubbing. */
const PX_PER_STEP = 6
/** A drag shorter than this is a click (to type), not a scrub. */
const DRAG_THRESHOLD = 3
/** Wheel and arrow-key changes commit this long after the last one, as one step. */
const SETTLE_MS = 400
/** Trackpads scroll in small increments: this much accumulated distance is one step. */
const WHEEL_PER_STEP = 40
/** A single wheel event at least this large is a mouse-wheel notch: one step each. */
const WHEEL_NOTCH = 50

/**
 * A number field for small whole-number settings, adjusted however is handiest:
 * drag sideways on it (or its label) to scrub, scroll or use the arrow keys
 * while it's focused (Shift for bigger steps), type a value, or use the step
 * buttons.
 *
 * `onPreview` (optional) shows the value live while scrubbing, scrolling, or typing;
 * `onChange` commits once the adjustment ends, so each is one undo step, and
 * `onPreviewEnd` is called instead if it ends where it started.
 */
export function NumberField({ label, hideLabel = false, compact = false, value, onChange, onPreview, onPreviewEnd, min = -Infinity, max = Infinity, step = 1, decrement = '−', increment = '+', hint }: {
  label: string
  /** For fields labeled by what's around them, like a row of settings: the label is only read out. */
  hideLabel?: boolean
  /** Just the number, without step buttons: still scrubbed, scrolled, typed, or stepped with the arrow keys. */
  compact?: boolean
  value: number
  onChange: (value: number) => void
  onPreview?: (value: number) => void
  onPreviewEnd?: () => void
  min?: number
  max?: number
  step?: number
  decrement?: string
  increment?: string
  hint?: string
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))
  const [live, setLive] = useState<number | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The committed value when the current adjustment began. The `value` prop
  // itself follows the live preview, so it can't tell whether anything changed.
  const origin = useRef<number | null>(null)
  // The in-progress value, readable between renders so rapid events accumulate.
  const liveRef = useRef<number | null>(null)
  const latest = useRef({ value, onChange, onPreview, onPreviewEnd })
  latest.current = { value, onChange, onPreview, onPreviewEnd }
  const shown = live ?? value

  useEffect(() => setDraft(String(shown)), [shown])

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step))

  // Previews can be costly (a whole piece rebuilt), so at most one per frame, with the latest value.
  const previewFrame = useRef(0)

  /** Shows a value mid-adjustment. */
  const adjust = (next: number) => {
    origin.current ??= value
    const clamped = clamp(next)
    liveRef.current = clamped
    setLive(clamped)
    cancelAnimationFrame(previewFrame.current)
    previewFrame.current = requestAnimationFrame(() => latest.current.onPreview?.(clamped))
    return clamped
  }

  /** Ends an adjustment, committing the value if it changed. */
  const finish = (final: number | null) => {
    clearTimeout(settle.current)
    cancelAnimationFrame(previewFrame.current)
    const start = origin.current ?? latest.current.value
    origin.current = null
    liveRef.current = null
    setLive(null)
    if (final !== null && final !== start) latest.current.onChange(final)
    else latest.current.onPreviewEnd?.()
  }

  /** Wheel and keys: adjust now, commit after a pause. */
  const nudge = (steps: number) => {
    const next = adjust((liveRef.current ?? value) + steps * step)
    clearTimeout(settle.current)
    settle.current = setTimeout(() => finish(next), SETTLE_MS)
  }

  const commitTyped = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(origin.current ?? value))
      if (origin.current !== null) finish(null)
    } else finish(clamp(n))
  }

  /** Typing previews each whole value in range as it's typed, so what depends on it follows along. */
  const type = (text: string) => {
    setDraft(text)
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max || clamp(n) !== n) return
    origin.current ??= value
    cancelAnimationFrame(previewFrame.current)
    previewFrame.current = requestAnimationFrame(() => latest.current.onPreview?.(n))
  }

  // Scrubbing: drag sideways on the label or the field.
  const onPointerDown = (e: React.PointerEvent) => {
    // Once the field is focused for typing, dragging in it selects text as usual.
    if (e.button !== 0 || (e.currentTarget === input.current && document.activeElement === input.current)) return
    const target = e.currentTarget as HTMLElement
    const startX = e.clientX
    const startValue = liveRef.current ?? value
    let scrubbing = false
    let current = startValue
    target.setPointerCapture(e.pointerId)

    const move = (m: PointerEvent) => {
      const dx = m.clientX - startX
      if (!scrubbing && Math.abs(dx) < DRAG_THRESHOLD) return
      if (!scrubbing) {
        scrubbing = true
        input.current?.blur()
        document.body.dataset.scrubbing = 'true'
      }
      current = adjust(startValue + Math.trunc(dx / PX_PER_STEP) * step * (m.shiftKey ? 5 : 1))
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      delete document.body.dataset.scrubbing
      if (scrubbing) finish(current)
      else if (target !== input.current) input.current?.focus()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  // Wheel needs a non-passive listener to keep the panel from scrolling.
  useEffect(() => {
    const field = input.current
    if (!field) return
    let accumulated = 0
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== field) return
      e.preventDefault()
      const notch = e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(e.deltaY) >= WHEEL_NOTCH
      if (notch) {
        accumulated = 0
        nudgeRef.current(-Math.sign(e.deltaY) * (e.shiftKey ? 5 : 1))
        return
      }
      accumulated += -e.deltaY
      const steps = Math.trunc(accumulated / WHEEL_PER_STEP)
      if (steps === 0) return
      accumulated -= steps * WHEEL_PER_STEP
      nudgeRef.current(steps * (e.shiftKey ? 5 : 1))
    }
    field.addEventListener('wheel', onWheel, { passive: false })
    return () => field.removeEventListener('wheel', onWheel)
  }, [])
  const nudgeRef = useRef(nudge)
  nudgeRef.current = nudge

  useEffect(() => () => {
    clearTimeout(settle.current)
    cancelAnimationFrame(previewFrame.current)
  }, [])

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : styles.label} onPointerDown={onPointerDown}>
        {label}
      </label>
      <div className={styles.control} data-compact={compact || undefined}>
        {!compact && <button type="button" aria-label={`${label}: decrease`} disabled={shown <= min} onClick={() => finish(clamp(shown - step))}>
          {decrement}
        </button>}
        <input
          ref={input}
          id={id}
          inputMode="decimal"
          value={draft}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onPointerDown={onPointerDown}
          onChange={(e) => type(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTyped()
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1))
            }
          }}
        />
        {!compact && <button type="button" aria-label={`${label}: increase`} disabled={shown >= max} onClick={() => finish(clamp(shown + step))}>
          {increment}
        </button>}
      </div>
      {hint && <span id={`${id}-hint`} className={styles.hint}>{hint}</span>}
    </div>
  )
}
