import styles from './ui.module.css'

const PATHS = {
  brush: 'M14.5 4.5l5 5L10 19H5v-5z M12.5 6.5l5 5',
  eraser: 'M7 20h10 M4.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 18H8z M9 10l5 5',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4 M11 8v6 M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4 M8 11h6',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  knit: 'M8 4c0 5 8 5 8 10s-8 5-8 6 M16 4c0 5-8 5-8 10s8 5 8 6',
  print: 'M7 9V4h10v5 M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2 M7 14h10v6H7z',
  plus: 'M12 5v14 M5 12h14',
  // Space between two things, side by side and stacked.
  spaceAcross: 'M4 5v14 M20 5v14 M8 12h8 M10.5 9.5L8 12l2.5 2.5 M13.5 9.5L16 12l-2.5 2.5',
  spaceUp: 'M5 4h14 M5 20h14 M12 8v8 M9.5 10.5L12 8l2.5 2.5 M9.5 13.5L12 16l2.5-2.5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  back: 'M15 18l-6-6 6-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1 M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  mirror: 'M12 3v18 M8 7l-4 5 4 5z M16 7l4 5-4 5z',
  warning: 'M12 4l9 16H3z M12 10v4 M12 17.5v.5',
  // How a layer repeats: across its rows, or all over.
  repeatAcross: 'M4 12h16 M8 8l-4 4 4 4 M16 8l4 4-4 4',
  repeatAll: 'M5 5h5v5H5z M14 5h5v5h-5z M5 14h5v5H5z M14 14h5v5h-5z',
  // A chart key's square with a purl dash: the stitches.
  stitches: 'M5 5h14v14H5z M8.5 12h7',
  // A ruler, laid across: sizing the piece.
  ruler: 'M3 16.5L16.5 3 21 7.5 7.5 21z M7.5 12l2 2 M10.5 9l2 2 M13.5 6l2 2',
  // A strand carried across the back, between two stitches.
  floats: 'M4 16h.01 M20 16h.01 M4.5 15c3-7 12-7 15 0 M4 20h16',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12 M18 6L6 18',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20a7.5 7.5 0 0 1 15 0',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  chevronUp: 'M6 15l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
  insertAbove: 'M4 14h16v6H4z M12 3v8 M8 7h8',
  insertBelow: 'M4 4h16v6H4z M12 13v8 M8 17h8',
  insertLeft: 'M14 4h6v16h-6z M3 12h8 M7 8v8',
  insertRight: 'M4 4h6v16H4z M13 12h8 M17 8v8',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  move: 'M12 3v18 M3 12h18 M12 3l-3 3 M12 3l3 3 M12 21l-3-3 M12 21l3-3 M3 12l3-3 M3 12l3 3 M21 12l-3-3 M21 12l-3 3',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: labelled icons get a <title>; the rest are hidden
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined}>
      {label && <title>{label}</title>}
      <path d={PATHS[name]} />
    </svg>
  )
}
