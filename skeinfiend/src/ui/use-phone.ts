import { useSyncExternalStore } from 'react'

/** Phone-sized screens: where charts are knitted from and looked at, not laid out. The same width the layout switches at. */
const QUERY = '(width < 44rem)'

export function usePhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(QUERY)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(QUERY).matches,
  )
}
