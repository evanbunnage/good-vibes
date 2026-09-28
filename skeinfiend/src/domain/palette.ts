import { NONE, type Grid } from './grid'

export interface Yarn {
  readonly id: string
  readonly name: string
  /** `#rrggbb` */
  readonly hex: string
  /** The yarn itself, as its ball band says: the brand and line ("Jamieson's Spindrift"). */
  readonly brand?: string
  /** Its weight, as the Craft Yarn Council names them. */
  readonly weight?: YarnWeight
  readonly fiber?: string
  /** A skein's length and weight, from the ball band: for how many skeins a chart takes. */
  readonly metersPerSkein?: number
  readonly gramsPerSkein?: number
  /** Where it's sold or described. */
  readonly url?: string
}

/** The Craft Yarn Council's standard weights, finest first. */
export const YARN_WEIGHTS = ['lace', 'fingering', 'sport', 'DK', 'worsted', 'aran', 'bulky', 'super bulky', 'jumbo'] as const
export type YarnWeight = (typeof YARN_WEIGHTS)[number]

export const MAX_YARNS = 16

/** Undyed and naturally dyed wool shades, the traditional colorwork palette. */
export const STARTER_YARNS: readonly Yarn[] = [
  { id: 'natural', name: 'Natural', hex: '#ddc9a3' },
  { id: 'charcoal', name: 'Charcoal', hex: '#35322e' },
  { id: 'madder', name: 'Madder', hex: '#a8322d' },
  { id: 'indigo', name: 'Indigo', hex: '#2c3e66' },
  { id: 'weld', name: 'Weld', hex: '#d9a93f' },
  { id: 'moss', name: 'Moss', hex: '#5f6f3c' },
  { id: 'heather', name: 'Heather', hex: '#8e7a95' },
  { id: 'rust', name: 'Rust', hex: '#b5652e' },
]

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

/**
 * Removes a yarn and rewrites a grid so it keeps pointing at the same yarns:
 * cells using the removed yarn become `replacement`, and higher indices shift
 * down by one.
 */
export function remapAfterRemoval(grid: Grid, removed: number, replacement: number): Grid {
  const cells = grid.cells.slice()
  // `NONE` is a marker, not a palette index: it never shifts.
  const target = replacement !== NONE && replacement > removed ? replacement - 1 : replacement
  for (let i = 0; i < cells.length; i++) {
    const value = cells[i]!
    if (value === NONE) continue
    if (value === removed) cells[i] = target
    else if (value > removed) cells[i] = value - 1
  }
  return { width: grid.width, height: grid.height, cells }
}

/** Relative luminance, used to pick legible text over a yarn color. */
export function isDark(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35
}

/** Stitches of each yarn in the chart, indexed by palette index. */
export function yarnCounts(chart: Grid, yarnCount: number): number[] {
  const counts = new Array<number>(yarnCount).fill(0)
  for (const cell of chart.cells) if (cell !== NONE && cell < yarnCount) counts[cell]!++
  return counts
}
