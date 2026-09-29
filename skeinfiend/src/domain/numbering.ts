import { KNIT, NO_STITCH } from './stitches'
import { NONE, type Grid } from './grid'
import type { Construction } from './pieces'

/**
 * Knitting charts are read from the bottom: row 1 is the first row knitted.
 * Stitches are numbered from the right, where a right-side row begins.
 */
export function rowNumber(y: number, height: number): number {
  return height - y
}

export function stitchNumber(x: number, width: number): number {
  return width - x
}

/**
 * A stitch as a knitter counts it on its own row: stitch 1 is the row's first
 * from the right, however the row's shaped, so on a crown round of 60 the
 * last is 60, wherever it sits on the chart. Null off the piece.
 */
export function stitchOnRow(outline: Grid, y: number, x: number): { stitch: number; of: number } | null {
  if (outline.cells[y * outline.width + x] === NONE) return null
  let [stitch, of] = [0, 0]
  for (let i = outline.width - 1; i >= 0; i--) {
    if (outline.cells[y * outline.width + i] === NONE) continue
    of++
    if (i >= x) stitch++
  }
  return { stitch, of }
}

export function yForRow(row: number, height: number): number {
  return height - row
}

/**
 * In the round, every row is a right-side row read right to left. Worked flat,
 * rows alternate from the first flat row (row 1, unless the piece starts in
 * the round): right-side rows read right to left, wrong-side rows left to right.
 */
export function readsRightToLeft(row: number, construction: Construction, firstFlatRow = 1): boolean {
  return isRightSide(row, construction, firstFlatRow)
}

export function isRightSide(row: number, construction: Construction, firstFlatRow = 1): boolean {
  return construction === 'round' || (row - firstFlatRow) % 2 === 0
}

/**
 * A row written the way patterns are: "*1 Natural, 1 Indigo; repeat from *
 * 16 times", then any stitches left over. Null when the row doesn't repeat
 * (or is split into separately worked pieces).
 */
export interface RowPattern {
  readonly repeat: readonly Run[]
  readonly stitchesPerRepeat: number
  readonly times: number
  readonly rest: readonly Run[]
}

export function rowPattern(chart: Grid, y: number, construction: Construction, firstFlatRow = 1, stitches: Grid | null = null): RowPattern | null {
  const row = rowNumber(y, chart.height)
  const xs = Array.from({ length: chart.width }, (_, i) => i)
  if (readsRightToLeft(row, construction, firstFlatRow)) xs.reverse()
  const stitchAt = chartStitch(stitches, y)
  // A place with no stitch isn't knitted: like a decreased-away stitch, the row goes on without it.
  const cells = xs.map((x) => (stitchAt(x) === NO_STITCH ? NONE : chart.cells[y * chart.width + x]!))
  let at: number[]
  if (construction === 'round') {
    // Empty cells are decreased-away stitches; the row is continuous without them.
    at = xs.filter((_, i) => cells[i] !== NONE)
  } else {
    // Empty cells at the ends are shaping. Empty cells inside split the row into
    // pieces knitted separately, which aren't written as one repeat.
    const first = cells.findIndex((c) => c !== NONE)
    const last = cells.findLastIndex((c) => c !== NONE)
    if (first < 0) at = []
    else if (cells.slice(first, last + 1).includes(NONE)) return null
    else at = xs.slice(first, last + 1)
  }
  const sts = at.map((x) => ({ yarn: chart.cells[y * chart.width + x]!, stitch: stitchAt(x) }))
  const same = (a: Stitch, b: Stitch) => a.yarn === b.yarn && a.stitch === b.stitch

  const n = sts.length
  for (let period = 1; period <= n / 2; period++) {
    let repeats = true
    for (let i = period; i < n && repeats; i++) repeats = same(sts[i]!, sts[i - period]!)
    if (!repeats) continue
    const times = Math.floor(n / period)
    return {
      repeat: toRuns(sts.slice(0, period)),
      stitchesPerRepeat: period,
      times,
      rest: toRuns(sts.slice(times * period)),
    }
  }
  return null
}

interface Stitch {
  readonly yarn: number
  /** How it's charted (a `StitchType` code), as seen from the right side. */
  readonly stitch: number
}

/** The charted stitch at each place in a row: knit, unless the chart's stitches say otherwise. */
function chartStitch(stitches: Grid | null, y: number): (x: number) => number {
  return (x) => {
    const code = stitches?.cells[y * stitches.width + x]
    return code === undefined || code === NONE ? KNIT : code
  }
}

function toRuns(stitches: readonly Stitch[]): Run[] {
  const runs: Run[] = []
  for (const { yarn, stitch } of stitches) {
    const last = runs[runs.length - 1]
    if (last?.kind === 'stitches' && last.yarn === yarn && last.stitch === stitch) runs[runs.length - 1] = { ...last, count: last.count + 1 }
    else runs.push({ kind: 'stitches', yarn, stitch, count: 1 })
  }
  return runs
}

/**
 * Stitches of one yarn worked the same way (`stitch`, as charted: from the
 * wrong side, it's worked as its reverse, see `workedAs`), or a gap between
 * separately worked pieces.
 */
export type Run = { readonly kind: 'stitches'; readonly yarn: number; readonly stitch: number; readonly count: number } | { readonly kind: 'gap' }

/**
 * A row as knitting instructions, in the order it's knitted: "4 Natural,
 * 1 Madder, …". Worked flat, gaps in the outline split the row into pieces.
 */
export function rowRuns(chart: Grid, y: number, construction: Construction, firstFlatRow = 1, stitches: Grid | null = null): Run[] {
  const row = rowNumber(y, chart.height)
  const xs = Array.from({ length: chart.width }, (_, i) => i)
  if (readsRightToLeft(row, construction, firstFlatRow)) xs.reverse()
  const stitchAt = chartStitch(stitches, y)

  const runs: Run[] = []
  let current: { yarn: number; stitch: number; count: number } | null = null
  let pendingGap = false
  for (const x of xs) {
    const yarn = chart.cells[y * chart.width + x]!
    const stitch = stitchAt(x)
    if (yarn === NONE || stitch === NO_STITCH) {
      if (yarn === NONE && construction === 'flat' && current) pendingGap = true
      continue
    }
    if (pendingGap && current) {
      runs.push({ kind: 'stitches', ...current }, { kind: 'gap' })
      current = null
      pendingGap = false
    }
    if (current && current.yarn === yarn && current.stitch === stitch) current.count++
    else {
      if (current) runs.push({ kind: 'stitches', ...current })
      current = { yarn, stitch, count: 1 }
    }
  }
  if (current) runs.push({ kind: 'stitches', ...current })
  return runs
}
