import { useEffect, useState, type InputHTMLAttributes } from 'react'

/**
 * A text input that edits a local draft and commits once, on Enter or blur,
 * so a rename is one undo step rather than one per keystroke. Escape reverts.
 * `onFinish` is called when editing ends, committed or not.
 */
export function CommitInput({ value, onCommit, onFinish, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onCommit: (value: string) => void
  onFinish?: () => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft !== value) onCommit(draft)
        else setDraft(value)
        onFinish?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          const input = e.currentTarget
          requestAnimationFrame(() => input.blur())
        }
      }}
    />
  )
}
