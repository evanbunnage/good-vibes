/**
 * Undo and redo over immutable values. Each committed edit (a whole paint
 * stroke, not every cell it touched) is one entry.
 */
export interface History<T> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

export const HISTORY_LIMIT = 100

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export function commit<T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, history.present)) return history
  const past = [...history.past, history.present]
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] }
}

/** Updates the present without an undo step, for changes like knitting progress. */
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next }
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1]
  if (previous === undefined) return history
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...future] = history.future
  if (next === undefined) return history
  return { past: [...history.past, history.present], present: next, future }
}
