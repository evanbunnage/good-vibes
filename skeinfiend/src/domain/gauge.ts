/**
 * Gauge: how many stitches and rows fit in a length of a swatch, 10 cm unless
 * the knitter counted over another (4 inches, say), kept as they counted it.
 * Knitted stitches are wider than they are tall, so a chart drawn on square
 * cells distorts every motif. Everything that draws or sizes a chart goes
 * through these functions.
 */
export interface Gauge {
  /** Stitches across `over`. */
  readonly stitches: number
  /** Rows up `over`. */
  readonly rows: number
  /** The length counted over, in centimeters: 10 if not given. */
  readonly over?: number
}

export const stitchesPerCm = (gauge: Gauge) => gauge.stitches / (gauge.over ?? 10)
export const rowsPerCm = (gauge: Gauge) => gauge.rows / (gauge.over ?? 10)

/** The same gauge, whatever length each was counted over. */
export function sameGauge(a: Gauge, b: Gauge): boolean {
  return stitchesPerCm(a) === stitchesPerCm(b) && rowsPerCm(a) === rowsPerCm(b)
}

/** A typical fingering or sport weight gauge for colorwork. */
export const DEFAULT_GAUGE: Gauge = { stitches: 28, rows: 32 }

export const CM_PER_INCH = 2.54

/** Height of one stitch relative to its width. Below 1: stitches are wider than tall. */
export function cellAspect(gauge: Gauge): number {
  return gauge.stitches / gauge.rows
}

export function widthCm(stitches: number, gauge: Gauge): number {
  return stitches / stitchesPerCm(gauge)
}

export function heightCm(rows: number, gauge: Gauge): number {
  return rows / rowsPerCm(gauge)
}

export function stitchesForCm(cm: number, gauge: Gauge): number {
  return Math.max(1, Math.round(cm * stitchesPerCm(gauge)))
}

export function rowsForCm(cm: number, gauge: Gauge): number {
  return Math.max(1, Math.round(cm * rowsPerCm(gauge)))
}

export type Units = 'cm' | 'in'

/** A length as a knitter would say it: "10 cm", "40.6 cm", "1.25 in", without trailing zeros. Centimeters to a tenth, inches to a quarter's precision. */
export function formatShortLength(cm: number, units: Units): string {
  return units === 'in' ? `${Math.round((cm / CM_PER_INCH) * 100) / 100} in` : `${Math.round(cm * 10) / 10} cm`
}

export function formatLength(cm: number, units: Units): string {
  return units === 'cm' ? `${cm.toFixed(1)} cm` : `${(cm / CM_PER_INCH).toFixed(1)} in`
}

/** Between 4 and 80 stitches (and rows) in 10 cm: anything from bulky yarn to lace. */
export function isValidGauge(gauge: Gauge): boolean {
  const ok = (perCm: number) => Number.isFinite(perCm) && perCm >= 0.4 && perCm <= 8
  const over = gauge.over ?? 10
  return over > 0 && ok(stitchesPerCm(gauge)) && ok(rowsPerCm(gauge))
}
