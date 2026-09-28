/** The chart open last in this browser: where the app opens next time. */
const KEY = 'skeinfiend.lastChart'

export function rememberLastChart(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Not remembered: the most recently edited chart opens instead.
  }
}

export function lastChart(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** The chart open last was deleted: the most recently edited one opens next instead. */
export function forgetLastChart(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
