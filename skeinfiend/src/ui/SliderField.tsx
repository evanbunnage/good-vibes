import { useEffect, useId, useRef } from 'react'
import styles from './slider-field.module.css'

/**
 * A short slider for a small whole number, with the value spelled out beside it.
 * Dragging previews each value live (`onPreview`); letting go, or a key
 * press, commits it (`onChange`), so a whole drag is one undo step.
 */
export function SliderField({ label, hideLabel = false, value, min = 0, max, step = 1, format, onChange, onPreview, onPreviewEnd }: {
  label: string
  /** For sliders labeled by the row they sit in: the label is only read out. */
  hideLabel?: boolean
  value: number
  min?: number
  max: number
  step?: number
  /** The value as shown beside the slider: '2 stitches', '3×'. */
  format: (value: number) => string
  onChange: (value: number) => void
  onPreview?: (value: number) => void
  onPreviewEnd?: () => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const callbacks = useRef({ onChange, onPreviewEnd, value })
  callbacks.current = { onChange, onPreviewEnd, value }
  // The value before a drag began: `value` follows the live preview while dragging.
  const origin = useRef<number | null>(null)

  // React's onChange fires on every movement; the native change event fires once, on release.
  useEffect(() => {
    const el = input.current
    if (!el) return
    const commit = () => {
      const next = el.valueAsNumber
      const before = origin.current ?? callbacks.current.value
      origin.current = null
      if (next === before) callbacks.current.onPreviewEnd?.()
      else callbacks.current.onChange(next)
    }
    el.addEventListener('change', commit)
    return () => el.removeEventListener('change', commit)
  }, [])

  return (
    <div className={styles.field} data-hide-label={hideLabel || undefined}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>{label}</label>
      <input ref={input} id={id} type="range" min={min} max={max} step={step} value={value}
        onInput={(e) => {
          origin.current ??= value
          onPreview?.(e.currentTarget.valueAsNumber)
        }}
        onChange={() => undefined} />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  )
}
