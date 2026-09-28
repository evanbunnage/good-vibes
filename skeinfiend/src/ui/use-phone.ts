import { useSyncExternalStore } from 'react'

/** Phone-sized screens: where charts are knitted from and looked at, not laid out. The same width the layout switches at. */
const QUERY = '(width < 44rem)'

export function usePhone(): boolean {
  return useMedia(QUERY)
}

/**
 * Whether the main pointer is a finger (a phone, a tablet), not a mouse or
 * trackpad: the width says how much room there is, this says how it's used.
 * A laptop's window made narrow is laid out as a phone, but still clicked.
 */
export function useTouch(): boolean {
  return useMedia('(pointer: coarse)')
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}
