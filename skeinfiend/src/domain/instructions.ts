import { rowsPerCm, stitchesPerCm, type Gauge } from './gauge'
import { rowNumber } from './numbering'
import { describeShaping, inOpening, layoutSchematic, ribRows, shapingSteps, type Construction, type Opening, type SchematicPiece } from './pieces'
import type { Project } from './project'

/**
 * A piece's schematic as written instructions, in the order they're knitted:
 * casting on, ribbing, shaping between measurements, openings, turning to work
 * flat, and binding off. What a pattern's instructions would say, worked out
 * from the measurements, so they're right whenever the schematic changes.
 */
export interface PatternStep {
  /** What the step is about (a measurement, opening, or section), for pointing at it in the schematic. */
  readonly id: string
  /** Knitted row numbers: row 1 is the cast-on row. */
  readonly fromRow: number
  readonly toRow: number
  /** "Rounds 12–35", or "Row 69" once worked flat. */
  readonly where: string
  readonly title: string
  readonly text: string
}

/**
 * How a row is worked. Worked in the round, a row is a loop; a gap in it (an
 * opening, or stitches bound off at the start of the round) means turning at
 * the gap and working back and forth: flat.
 */
export type RowWork = 'round' | 'flat'

export interface WorkedRow {
  readonly work: RowWork
  /** The row (row 1 is the cast-on row) this stretch of working the same way began on: rows alternate sides from it. */
  readonly since: number
}

/** Stitches a steek adds across an opening: a bridge, cut open after knitting. */
export const STEEK_STITCHES = 5

/** An opening only one row tall is a slit (bound off, then cast on again): the round isn't broken. */
function isSlit(opening: Opening, rowAt: (cm: number) => number): boolean {
  return rowAt(opening.bottom + opening.height) - rowAt(opening.bottom) <= 1
}

/**
 * How each row of the piece is worked (index 0 is row 1), from its shape
 * rather than by choice: which rows have a gap in them. Slits and steeked
 * openings don't break the round.
 */
export function rowsWorked(piece: SchematicPiece, gauge: Gauge, construction: Construction): WorkedRow[] {
  const layout = layoutSchematic(piece, gauge, construction)
  const { width, height } = layout.outline
  const breaking = piece.openings.filter((o) => !(construction === 'round' && o.steek) && !isSlit(o, layout.rowAt))
  // Worked in the round, stitches bound off in one row (a step down between two
  // measurements at the same height) open the loop at the start of the round,
  // until stitches cast on in one row (a step up) close it again.
  const binds = new Map<number, boolean>()
  for (let i = 1; i < layout.placed.length; i++) {
    const [a, b] = [layout.placed[i - 1]!, layout.placed[i]!]
    if (a.row === b.row && a.stitches !== b.stitches) binds.set(b.row, b.stitches < a.stitches)
  }

  const worked: WorkedRow[] = []
  let open = false
  for (let row = 0; row < height; row++) {
    if (binds.has(row)) open = binds.get(row)!
    const stitches = layout.rowStitches[row] ?? width
    const left = Math.floor((width - stitches) / 2)
    const up = (row + 0.5) / rowsPerCm(gauge)
    const gone = Array.from({ length: stitches }, (_, i) => {
      const across = (left + i + 0.5 - width / 2) / stitchesPerCm(gauge)
      return breaking.some((o) => inOpening(o, across, up))
    })
    // The round starts (and a bound-off gap sits) between the last stitch and the first.
    const gap = open || gone.some(Boolean)
    const work: RowWork = construction === 'round' && !gap ? 'round' : 'flat'
    const previous = worked.at(-1)
    worked.push({ work, since: previous?.work === work ? previous.since : row + 1 })
  }
  return worked
}

/** How each chart row (top-based) of the project is worked. */
export function projectRowsWorked(project: Project): (y: number) => WorkedRow {
  const worked = rowsWorked(project.piece, project.gauge, project.construction)
  // Should the outline ever not match its schematic row for row, it's worked one way throughout.
  const fits = worked.length === project.outline.height
  const whole: WorkedRow = { work: project.construction === 'round' ? 'round' : 'flat', since: 1 }
  return (y) => (fits ? worked[rowNumber(y, project.outline.height) - 1]! : whole)
}

/** Worked in the round, or back and forth in rows. */
export function constructionOf(row: WorkedRow): Construction {
  return row.work === 'round' ? 'round' : 'flat'
}

export function patternSteps(piece: SchematicPiece, gauge: Gauge, construction: Construction): PatternStep[] {
  const layout = layoutSchematic(piece, gauge, construction)
  const rows = layout.outline.height
  const worked = rowsWorked(piece, gauge, construction)
  const workAt = (row: number) => worked[Math.min(rows, Math.max(1, row)) - 1]?.work ?? 'flat'
  const unit = (row: number) => (workAt(row) === 'round' ? 'round' : 'row')
  const where = (from: number, to: number) => {
    const u = unit(from)
    const name = u[0]!.toUpperCase() + u.slice(1)
    return from >= to ? `${name} ${from}` : `${name}s ${from}–${to}`
  }
  const steps: PatternStep[] = []
  const add = (id: string, fromRow: number, toRow: number, title: string, text: string) =>
    steps.push({ id, fromRow, toRow, where: where(fromRow, toRow), title, text })

  const first = layout.placed[0]
  const last = layout.placed.at(-1)
  if (!first || !last) return []
  add(first.measurement.id, 1, 1, 'Cast on', `Cast on ${first.stitches} stitches${construction === 'round' ? ' and join to work in the round' : ''}.`)

  for (const rib of ribRows(piece, gauge, construction)) add(rib.id, rib.from, rib.to, rib.name, 'Work in K1, P1 rib.')

  for (const step of shapingSteps(layout)) {
    add(step.to.id, step.fromRow, step.toRow, `${step.from.name} to ${step.to.name}`, `${describeShaping(step, workAt(step.fromRow) === 'round' ? 'round' : 'flat')}.`)
  }

  const top = last.measurement.height
  for (const opening of piece.openings) {
    const stitches = Math.max(1, Math.round(opening.width * stitchesPerCm(gauge)))
    const from = layout.rowAt(opening.bottom) + 1
    const closes = opening.bottom + opening.height < top
    const to = closes ? layout.rowAt(opening.bottom + opening.height) + 1 : rows
    const each = opening.pair ? ' for each' : ''
    const gap = opening.pair ? 'each gap' : 'the gap'
    const steeked = construction === 'round' && opening.steek && !isSlit(opening, layout.rowAt)
    const text = steeked
      ? `Bind off ${stitches} stitches${each}, and cast on ${STEEK_STITCHES} steek stitches over ${gap} to keep working in the round.${closes ? ` On round ${to}, bind off the steek stitches and cast on ${stitches}.` : ''} Cut the steek open after knitting.`
      : opening.shape === 'oval' && to - from > 2
        ? `Shape as charted: about ${stitches} stitches${each}, over ${to - from} ${unit(from)}s.`
        : closes
          ? `Bind off ${stitches} stitches${each}. On ${unit(to)} ${to}, cast on ${stitches} stitches over ${gap}.`
          : `Bind off ${stitches} stitches${each}.`
    add(opening.id, from, to, opening.name, text)
  }

  // Where the way of working changes: turning to rows at a gap, and joining in the round again.
  for (let row = 2; row <= rows; row++) {
    const [before, now] = [workAt(row - 1), workAt(row)]
    if (before === now) continue
    if (now === 'flat') add('worked', row, row, 'Worked flat', 'Turn at the gap and work back and forth in rows, starting with a right-side row.')
    else add('worked', row, row, 'In the round', 'Join and work in the round again.')
  }

  add(last.measurement.id, rows, rows, 'Bind off', `Bind off the remaining ${last.stitches} stitches.`)
  return steps.map((step, i) => ({ step, i })).sort((a, b) => a.step.fromRow - b.step.fromRow || a.i - b.i).map(({ step }) => step)
}
