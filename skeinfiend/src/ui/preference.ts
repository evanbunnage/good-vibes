import { useSyncExternalStore } from 'react'

/**
 * A small setting remembered in this browser (like centimeters or inches),
 * shared by every component that reads it. Storage can be unavailable
 * (private windows, blocked site data); then it lasts for the page instead.
 */
/** Any value that survives JSON: a word, a flag, or a small object like a position. */
type Stored = string | number | boolean | { readonly [key: string]: Stored }

export function createPreference<T extends Stored>(key: string, fallback: T) {
  const listeners = new Set<() => void>()
  let current: T = read()

  function read(): T {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : (JSON.parse(stored) as T)
    } catch {
      // Not stored, unreadable, or not JSON: the default.
      return fallback
    }
  }

  function set(value: T): void {
    if (value === current) return
    current = value
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Not remembered, but still changed for this page.
    }
    for (const listener of listeners) listener()
  }

  // A hook, called as `preference.use()` from components.
  function use(): T {
    // biome-ignore lint/correctness/useHookAtTopLevel: `use` is itself the hook
    return useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => current,
    )
  }

  return { get: () => current, set, use }
}
