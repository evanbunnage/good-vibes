import { stitchesPerCm, type Gauge } from './gauge'
import { NONE, type Grid } from './grid'
import type { Construction } from './pieces'

/**
 * Stranded colorwork carries every yarn in the row behind the work. Where a
 * yarn isn't used for a while, its strand (a "float") gets long enough to
 * snag fingers and pucker the fabric.
 */
export interface FloatIssue {
  readonly kind: 'float'
  /** Top-based row. */
  readonly y: number
  readonly yarn: number
  readonly length: number
  /** Cell indices the float passes behind, for highlighting. */
  readonly cells: readonly number[]
}

/** What's flagged in a row: long floats, and only those. */
export type RowIssue = FloatIssue

export interface FloatRules {
  /** Longest acceptable float, in stitches: what a length limit comes to at the gauge (see `rulesAt`). */
  readonly maxFloat: number
  /**
   * Longest acceptable float as a length: what knitters go by, since a stitch
   * count means a different length at every gauge.
   */
  readonly maxFloatCm: number
}

/**
 * Floats are caught past about an inch: the usual rule (Interweave, Purl Soho,
 * Modern Daily Knitting). Longer can do in grippy wool; shorter in mittens.
 */
export const DEFAULT_FLOAT_CM = 2.5

export const DEFAULT_RULES: FloatRules = { maxFloat: 5, maxFloatCm: DEFAULT_FLOAT_CM }

/**
 * What a row's long floats are, as a short string: which yarn, how long, and
 * where. A row dismissed with this stays dismissed until it changes.
 */
export function floatsSignature(issues: readonly RowIssue[]): string {
  return issues.map((i) => `${i.yarn}:${i.length}:${i.cells[0] ?? ''}`).sort().join('|')
}

/** The rules in stitches at a gauge: a length limit is the most whole stitches that fit in it. */
export function rulesAt(rules: FloatRules, gauge: Gauge): FloatRules {
  return { ...rules, maxFloat: Math.max(1, Math.floor(rules.maxFloatCm * stitchesPerCm(gauge) + 1e-9)) }
}

/** `construction` can differ by row (top-based), for a piece worked in the round and then flat. */
export function analyzeChart(chart: Grid, construction: Construction | ((y: number) => Construction), rules: Pick<FloatRules, 'maxFloat'> = DEFAULT_RULES): RowIssue[] {
  const issues: RowIssue[] = []
  const at = typeof construction === 'function' ? construction : () => construction
  for (let y = 0; y < chart.height; y++) issues.push(...analyzeRow(chart, y, at(y), rules))
  return issues
}

/**
 * Worked flat, an empty cell (a neckline, say) splits the row into pieces
 * knitted separately. Worked in the round, empty cells are decreased-away
 * stitches, so the row is continuous and wraps from its last stitch to its first.
 */
export function analyzeRow(chart: Grid, y: number, construction: Construction, rules: Pick<FloatRules, 'maxFloat'> = DEFAULT_RULES): RowIssue[] {
  const issues: RowIssue[] = []
  const rowStart = y * chart.width
  const indices: number[] = []
  for (let x = 0; x < chart.width; x++) indices.push(rowStart + x)

  const segments = construction === 'round' ? [indices.filter((i) => chart.cells[i] !== NONE)] : splitOnGaps(chart, indices)
  for (const segment of segments) issues.push(...segmentFloats(chart, y, segment, construction === 'round', rules.maxFloat))
  return issues
}

function splitOnGaps(chart: Grid, indices: readonly number[]): number[][] {
  const segments: number[][] = []
  let current: number[] = []
  for (const i of indices) {
    if (chart.cells[i] === NONE) {
      if (current.length) segments.push(current)
      current = []
    } else current.push(i)
  }
  if (current.length) segments.push(current)
  return segments
}

function segmentFloats(chart: Grid, y: number, segment: readonly number[], wraps: boolean, maxFloat: number): FloatIssue[] {
  const positions = new Map<number, number[]>()
  segment.forEach((i, p) => {
    const yarn = chart.cells[i]!
    const list = positions.get(yarn)
    if (list) list.push(p)
    else positions.set(yarn, [p])
  })
  // A yarn used alone in a segment is the only strand: nothing floats.
  if (positions.size < 2) return []

  const issues: FloatIssue[] = []
  for (const [yarn, at] of positions) {
    const gaps: Array<[number, number]> = []
    for (let k = 1; k < at.length; k++) gaps.push([at[k - 1]!, at[k]!])
    if (wraps) gaps.push([at[at.length - 1]!, at[0]! + segment.length])
    for (const [from, to] of gaps) {
      const length = to - from - 1
      if (length <= maxFloat) continue
      const cells: number[] = []
      for (let p = from + 1; p < to; p++) cells.push(segment[p % segment.length]!)
      issues.push({ kind: 'float', y, yarn, length, cells })
    }
  }
  return issues
}

/**
 * Where to catch (trap) a float so no stretch of it is longer than the limit:
 * the stitches, counted along the float from 0, to catch it behind. Evenly
 * spaced, as few as it takes. None for a float within the limit.
 */
export function catchPoints(length: number, maxFloat: number): number[] {
  if (length <= maxFloat || maxFloat < 1) return []
  const catches = Math.ceil(length / maxFloat) - 1
  return Array.from({ length: catches }, (_, i) => Math.round(((i + 1) * length) / (catches + 1)))
}
