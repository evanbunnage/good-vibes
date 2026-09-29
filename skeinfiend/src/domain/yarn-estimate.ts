import type { FloatIssue } from './floats'
import { rowsPerCm, stitchesPerCm, type Gauge } from './gauge'
import { NONE, type Grid } from './grid'
import type { Yarn } from './palette'
import type { Swatch } from './project'
import { NO_STITCH } from './stitches'

/**
 * How much of each yarn a chart takes. The stitches in each yarn and the
 * floats behind them are counted from the chart, so only the length of yarn
 * in one stitch is estimated. From the gauge, that's Munden's loop-length
 * relation: stitches per cm × rows per cm × (cm of yarn per stitch)² is about
 * constant for plain knitting. A float is as long as the stitches it spans.
 * A weighed swatch replaces the estimate with the knitter's own.
 */
export interface YarnEstimate {
  readonly yarn: number
  /** Stitches knitted in it. */
  readonly stitches: number
  /** Stitches its floats pass behind. */
  readonly floatStitches: number
  /** With `MARGIN` added. */
  readonly meters: number
  /** When the ball band's given. */
  readonly grams: number | null
  readonly skeins: number | null
}

export interface ChartEstimate {
  readonly yarns: readonly YarnEstimate[]
  /** Centimeters of yarn in a stitch. */
  readonly perStitchCm: number
  /** From the knitter's swatch, rather than the gauge alone. */
  readonly fromSwatch: boolean
}

/** Munden's constant for relaxed plain knitting: stitches/cm × rows/cm × (yarn/stitch in cm)². */
export const LOOP_CONSTANT = 21
/** Extra, for the swatch, joins and weaving in: what patterns add. */
export const MARGIN = 0.1

/** Yarn in one stitch, in centimeters, at a gauge. */
export function stitchLengthCm(gauge: Gauge): number {
  return Math.sqrt(LOOP_CONSTANT / (stitchesPerCm(gauge) * rowsPerCm(gauge)))
}

/**
 * `chart` as knitted (NONE off the piece), `stitches` for places with no
 * stitch, `floats` every float in it however short (`maxFloat: 0`).
 * `finished`, the chart once motifs are duplicate stitched on after knitting:
 * each of those stitches takes about a stitch's worth of its yarn too.
 */
export function estimateYarn(chart: Grid, stitches: Grid | null, floats: readonly FloatIssue[], yarns: readonly Yarn[], gauge: Gauge, swatch?: Swatch, finished?: Grid): ChartEstimate {
  const counts = yarns.map(() => 0)
  let knitted = 0
  chart.cells.forEach((cell, i) => {
    if (cell === NONE || stitches?.cells[i] === NO_STITCH || counts[cell] === undefined) return
    counts[cell]!++
    knitted++
  })
  // Duplicate stitched over the knitting: more of that yarn, on the same fabric (so not in the swatch's area).
  if (finished && finished !== chart) {
    finished.cells.forEach((cell, i) => {
      if (cell !== NONE && cell !== chart.cells[i] && chart.cells[i] !== NONE && counts[cell] !== undefined) counts[cell]!++
    })
  }
  const floatCounts = yarns.map(() => 0)
  for (const f of floats) if (floatCounts[f.yarn] !== undefined) floatCounts[f.yarn]! += f.length

  const stitchWidth = 1 / stitchesPerCm(gauge)
  const lengthsAt = (perStitch: number) => counts.map((n, i) => (n * perStitch + floatCounts[i]! * stitchWidth) / 100)
  let perStitch = stitchLengthCm(gauge)
  let fromSwatch = false
  // The swatch's weight per area, against what the estimate says the same fabric weighs: every used yarn's ball band is needed for that.
  const perGram = yarns.map((y) => (y.metersPerSkein && y.gramsPerSkein ? y.metersPerSkein / y.gramsPerSkein : null))
  if (swatch && swatch.grams > 0 && swatch.widthCm > 0 && swatch.heightCm > 0 && knitted && counts.every((n, i) => !n || perGram[i])) {
    const area = knitted / (stitchesPerCm(gauge) * rowsPerCm(gauge))
    // Grams as a function of the stitch length: floats don't change with it.
    const stitchGrams = counts.reduce((sum, n, i) => sum + (n ? (n / 100) / perGram[i]! : 0), 0)
    const floatGrams = floatCounts.reduce((sum, n, i) => sum + (n && counts[i] ? (n * stitchWidth / 100) / perGram[i]! : 0), 0)
    const wanted = (swatch.grams / (swatch.widthCm * swatch.heightCm)) * area
    const fitted = (wanted - floatGrams) / stitchGrams
    if (fitted > 0) {
      perStitch = fitted
      fromSwatch = true
    }
  }
  const lengths = lengthsAt(perStitch)
  return {
    perStitchCm: perStitch,
    fromSwatch,
    yarns: yarns.flatMap((yarn, i) => {
      if (!counts[i]) return []
      const meters = lengths[i]! * (1 + MARGIN)
      const grams = perGram[i] ? meters / perGram[i]! : null
      const skeins = yarn.metersPerSkein ? Math.ceil(meters / yarn.metersPerSkein - 1e-9) : null
      return [{ yarn: i, stitches: counts[i]!, floatStitches: floatCounts[i]!, meters, grams, skeins }]
    }),
  }
}

export const METERS_PER_YARD = 0.9144

/** An estimated length as a pattern gives it: rounded up to 5 (meters, or yards in inches), since it's a guess. */
export function formatYarnLength(meters: number, units: 'cm' | 'in'): string {
  const n = units === 'in' ? meters / METERS_PER_YARD : meters
  return `${Math.max(5, Math.ceil(n / 5) * 5)} ${units === 'in' ? 'yd' : 'm'}`
}
