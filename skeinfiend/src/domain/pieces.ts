import { rowsForCm, rowsPerCm, stitchesForCm, stitchesPerCm, type Gauge } from './gauge'
import { createGrid, NONE, type Grid } from './grid'

/**
 * A piece is what gets knitted: a hat, a sweater front, a dog sweater. Its
 * designer describes it the way a pattern's schematic does, in measurements:
 * how wide (or how far around) it is at points up its length, and any
 * openings cut into it. The stitch outline is built from those at the
 * project's gauge, and rebuilt whenever either changes, so nothing about the
 * shape is ever fixed.
 *
 * A piece whose outline has been adjusted stitch by stitch is "drawn": it
 * keeps its outline, and rescales it when the gauge changes.
 */

/** Outline cell for "there is a stitch here". Anything else is `NONE`. */
export const STITCH = 0

/** Knitted flat (rows alternate direction) or in the round (always right to left). */
export type Construction = 'flat' | 'round'

/**
 * How wide the piece is at one height: its width, or its circumference when
 * worked in the round. Between two measurements the piece shapes evenly from
 * one to the other. Two at the same height make a step, as when casting off
 * for an armhole: the later one applies from there up.
 */
export interface Measurement {
  readonly id: string
  readonly name: string
  /** Centimeters up from the cast-on edge. */
  readonly height: number
  /** Centimeters across, or around. */
  readonly width: number
  /**
   * Narrowing to this width puts stitches on hold rather than binding them
   * off: dividing for the sleeves of a sweater knit from the top down.
   */
  readonly hold?: boolean
}

/**
 * A hole in the piece, or a cut into its edge if it reaches past one: a leg
 * opening, a neckline, an armhole. In centimeters.
 */
export interface Opening {
  readonly id: string
  readonly name: string
  readonly shape: 'oval' | 'rectangle'
  /** Its lowest point, up from the cast-on edge. */
  readonly bottom: number
  readonly height: number
  readonly width: number
  /** Its center's distance right of the piece's center (left, if negative). */
  readonly offset: number
  /** Mirrored on the other side of center too: a pair of leg openings. */
  readonly pair: boolean
  /**
   * Worked in the round, knit a steek across it (extra stitches, cut open
   * after knitting) rather than working flat around it. Colorwork knitters
   * often prefer it: stranding on purl rows is hard to keep even.
   */
  readonly steek?: boolean
}

/**
 * Rows worked in another stitch than stockinette, all the way across: ribbing
 * at a neck, hem, or cuff. In centimeters.
 */
export interface Section {
  readonly id: string
  readonly name: string
  readonly stitch: 'rib'
  /** Its lowest row, up from the cast-on edge. */
  readonly bottom: number
  readonly height: number
}

/** A piece described by its measurements. */
export interface SchematicPiece {
  readonly kind: 'schematic'
  /** Up the piece, in order of height; the highest is the top edge. */
  readonly measurements: readonly Measurement[]
  readonly openings: readonly Opening[]
  readonly sections?: readonly Section[]
  /** Stitches at each measurement round to a multiple of this, so a motif repeats evenly across (or around). */
  readonly multiple: number
}

/** A starting point for a piece: built in, or saved by the designer. */
export interface PieceTemplate {
  readonly id: string
  readonly name: string
  readonly construction: Construction
  readonly spec: SchematicPiece
  readonly builtIn?: boolean
  /** The gauge its measurements were written for, set with it when starting a pattern. */
  readonly gauge?: Gauge
  /** Every size the published pattern gives, when there are several: `spec` is the first, shown until one's picked. */
  readonly sizes?: ReadonlyArray<{ readonly name: string; readonly spec: SchematicPiece }>
  /** A published pattern it's taken from: its designer, as they're known, and where to find it. */
  readonly credit?: { readonly designer: string; readonly pattern: string; readonly size: string; readonly url: string }
}

/** A designer's name, possessive: "Kate Davies's", but "Tin Can Knits'". */
export function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`
}

const measurement = (id: string, name: string, height: number, width: number): Measurement => ({ id, name, height, width })

export const BUILT_IN_TEMPLATES: readonly PieceTemplate[] = [
  {
    // A plain rectangle to make your own. (Its id is from when it was called Swatch.)
    id: 'swatch',
    name: 'Custom shape',
    construction: 'flat',
    builtIn: true,
    spec: {
      kind: 'schematic',
      measurements: [measurement('cast-on', 'Cast on', 0, 15), measurement('top', 'Top', 15, 15)],
      openings: [],
      multiple: 1,
    },
  },
]

export function builtInTemplate(id: 'swatch'): PieceTemplate {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id)!
}

/** The stitch outline for a piece at a gauge. */
export function buildOutline(spec: SchematicPiece, gauge: Gauge, construction: Construction = 'round'): Grid {
  return layoutSchematic(spec, gauge, construction).outline
}

/** A measurement as knitted: the row it's reached on (0 is the cast-on row) and its stitches. */
export interface PlacedMeasurement {
  readonly measurement: Measurement
  readonly row: number
  readonly stitches: number
}

export interface SchematicLayout {
  readonly outline: Grid
  /** The row (0 is the cast-on row) a height falls on. */
  readonly rowAt: (cm: number) => number
  /** In order up the piece. */
  readonly placed: readonly PlacedMeasurement[]
  /**
   * Each row's stitches before openings are cut, from the cast-on row up,
   * centered in the outline: what goes all the way around, worked in the round.
   */
  readonly rowStitches: readonly number[]
}

/**
 * The schematic in stitches and rows. Each measurement rounds to whole
 * stitches (a multiple of `multiple`) on the row nearest its height; rows
 * between two measurements change stitch count evenly from one to the next,
 * shaped at both edges so the piece stays centered. Openings then remove the
 * stitches inside them.
 */
/**
 * How a schematic knits up at a gauge: its outline and the row and stitches
 * of each measurement. Worked flat, width changes are made on right-side rows,
 * as patterns shape: a change that would fall on a wrong-side row waits a row.
 */
export function layoutSchematic(piece: SchematicPiece, gauge: Gauge, construction: Construction = 'round'): SchematicLayout {
  const sorted = [...piece.measurements].sort((a, b) => a.height - b.height)
  const top = Math.max(0.5, sorted.at(-1)?.height ?? 0.5)
  const rows = rowsForCm(top, gauge)
  const rowAt = (cm: number) => Math.min(rows - 1, Math.max(0, Math.round(cm * rowsPerCm(gauge))))
  const multiple = Math.max(1, Math.round(piece.multiple))
  const placed = sorted.map((m) => ({
    measurement: m,
    row: rowAt(m.height),
    stitches: m.width > 0 ? Math.max(multiple, Math.round(stitchesForCm(m.width, gauge) / multiple) * multiple) : 0,
  }))

  const stitchesOnRow = (row: number): number => (construction === 'flat' && row % 2 === 1 ? stitchesBetween(row - 1) : stitchesBetween(row))
  const stitchesBetween = (row: number): number => {
    // The last measurement at or below this row, and the next above it.
    let below = -1
    for (let i = 0; i < placed.length; i++) if (placed[i]!.row <= row) below = i
    if (below < 0) return placed[0]?.stitches ?? 0
    const from = placed[below]!
    const to = placed[below + 1]
    if (!to) return from.stitches
    // Shaped in pairs, a stitch at each end of the same row, as patterns shape: "increase 1 st each end".
    // An odd stitch over, if there is one, is made on the measurement's own row.
    const change = to.stitches - from.stitches
    const pairs = Math.trunc(change / 2)
    return from.stitches + 2 * Math.round((pairs * (row - from.row)) / (to.row - from.row))
  }

  const width = Math.max(1, ...placed.map((p) => p.stitches))
  const outline = createGrid(width, rows, NONE)
  const rowStitches: number[] = []
  const cmAcross = 1 / stitchesPerCm(gauge)
  const cmUp = 1 / rowsPerCm(gauge)
  for (let row = 0; row < rows; row++) {
    const y = rows - 1 - row
    const stitches = stitchesOnRow(row)
    rowStitches.push(stitches)
    const left = Math.floor((width - stitches) / 2)
    const up = (row + 0.5) * cmUp
    for (let x = left; x < left + stitches; x++) {
      const across = (x + 0.5 - width / 2) * cmAcross
      if (!piece.openings.some((o) => inOpening(o, across, up))) outline.cells[y * width + x] = STITCH
    }
  }
  return { outline, rowAt, placed, rowStitches }
}

/** Whether a point (centimeters across from the middle, and up from the cast-on edge) is inside an opening. */
export function inOpening(o: Opening, across: number, up: number): boolean {
  const inside = (center: number) => {
    const dx = (across - center) / (o.width / 2)
    const dy = (up - (o.bottom + o.height / 2)) / (o.height / 2)
    return o.shape === 'oval' ? dx * dx + dy * dy < 1 : Math.abs(dx) <= 1 && Math.abs(dy) <= 1
  }
  return o.width > 0 && o.height > 0 && (inside(o.offset) || (o.pair && inside(-o.offset)))
}

/** One stretch of shaping between two measurements, as a knitter would follow it. */
export interface ShapingStep {
  /** Knitted row numbers (row 1 is the cast-on row), inclusive. */
  readonly fromRow: number
  readonly toRow: number
  readonly fromStitches: number
  readonly toStitches: number
  /** From the measurement below to the one above. */
  readonly from: Measurement
  readonly to: Measurement
  /** Both at the same row: cast on or bound off at once, not shaped over rows. */
  readonly atOnce: boolean
}

/** Where the stitch count changes, between each pair of measurements up the piece. */
export function shapingSteps(layout: SchematicLayout): ShapingStep[] {
  const steps: ShapingStep[] = []
  for (let i = 1; i < layout.placed.length; i++) {
    const from = layout.placed[i - 1]!
    const to = layout.placed[i]!
    if (from.stitches === to.stitches) continue
    // A step at one row is cast on or off on that row; otherwise it's worked over the rows after `from`.
    steps.push({
      fromRow: from.row === to.row ? to.row + 1 : from.row + 2,
      toRow: to.row + 1,
      fromStitches: from.stitches,
      toStitches: to.stitches,
      from: from.measurement,
      to: to.measurement,
      atOnce: from.row === to.row,
    })
  }
  return steps
}

/**
 * A shaping step as a pattern would write it: "Increase 1 stitch at each edge
 * every 4th row, 14 times". Shaping is paired, one at each edge (or two per
 * round, worked in the round), spread as evenly as whole rows allow.
 */
export function describeShaping(step: ShapingStep, construction: Construction): string {
  const change = step.toStitches - step.fromStitches
  const count = Math.abs(change)
  const row = construction === 'round' ? 'round' : 'row'
  const stitches = (n: number) => `${n} ${n === 1 ? 'stitch' : 'stitches'}`
  if (change < 0 && step.to.hold) return `Put the sleeve stitches on hold, casting on at the underarms: ${stitches(step.toStitches)} remain`
  if (step.atOnce) {
    const verb = change < 0 ? 'Bind off' : 'Cast on'
    const sides = construction === 'flat' && count > 1 ? ` (${stitches(Math.ceil(count / 2))} at each edge)` : ''
    return `${verb} ${stitches(count)}${sides}`
  }
  const verb = change < 0 ? 'Decrease' : 'Increase'
  const rows = step.toRow - step.fromRow + 1
  const pairs = Math.floor(count / 2)
  if (rows === 1) return `${verb} ${stitches(count)} evenly`
  const each = construction === 'flat' ? '1 stitch at each edge' : '2 stitches'
  const extra = count % 2 ? `, then ${change < 0 ? 'decrease' : 'increase'} 1 more` : ''
  if (pairs === 0) return `${verb} 1 stitch`
  if (pairs > rows) {
    if (construction === 'round') {
      // Many at a time, as patterns work them: up to 8 every other round (raglans, crowns), or else every round.
      const other = Math.floor(rows / 2)
      if (other > 0 && count % other === 0 && count / other <= 8) return `${verb} ${stitches(count / other)} every other round, ${other} ${other === 1 ? 'time' : 'times'}`
      if (count % rows === 0) return `${verb} ${stitches(count / rows)} every round, ${rows} ${rows === 1 ? 'time' : 'times'}`
      return `${verb} ${stitches(Math.ceil(count / rows))} evenly every round`
    }
    // More shaping than rows: the excess is cast on or bound off at once, the rest shaped a pair a row.
    const atOnce = pairs - (rows - 1)
    const start = change < 0 ? 'Bind off' : 'Cast on'
    const then = rows > 1 ? `, then ${verb.toLowerCase()} 1 stitch at each edge every row, ${rows - 1} ${rows - 1 === 1 ? 'time' : 'times'}` : ''
    return `${start} ${stitches(atOnce)} at each edge${then}${extra}`
  }
  const interval = rows / pairs
  const low = Math.floor(interval)
  const high = Math.ceil(interval)
  // As knitters say it: every row, every other row, every 3rd row.
  const nth = (n: number) => (n === 1 ? `every ${row}` : n === 2 ? `every other ${row}` : `every ${ordinal(n)} ${row}`)
  const every = low === high ? nth(low) : low === 1 ? `every ${row} or every other ${row}` : `every ${ordinal(low)} or ${ordinal(high)} ${row}`
  return `${verb} ${each} ${every}, ${pairs} ${pairs === 1 ? 'time' : 'times'}${extra}`
}

function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

export function rectangle(width: number, height: number): Grid {
  return createGrid(width, height, STITCH)
}

export function stitchCount(outline: Grid): number {
  let n = 0
  for (const cell of outline.cells) if (cell !== NONE) n++
  return n
}

