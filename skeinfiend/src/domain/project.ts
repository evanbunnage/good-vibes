import { applyBand, applyBandStitches, bandSpan, bandTile, hasStitches, type Band } from './bands'
import { K2TOG, KNIT, M1L, M1R, SSK } from './stitches'
import { DEFAULT_RULES, floatsSignature, rulesAt, type FloatRules, type RowIssue } from './floats'
import { DEFAULT_GAUGE, type Gauge } from './gauge'
import { createGrid, NONE, type Grid } from './grid'
import { STARTER_YARNS, type Yarn } from './palette'
import { BUILT_IN_TEMPLATES, buildOutline, type Construction, type PieceTemplate, type SchematicPiece } from './pieces'

export const SCHEMA_VERSION = 9

/**
 * Everything about one design. A plain, serializable value: the editor, local
 * storage, and (later) the server all pass this same shape around.
 *
 * The finished chart isn't stored. It's composed from layers, bottom to top:
 * the background yarn, then each colorwork layer in order, all clipped to the
 * piece's outline.
 */
export interface Project {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly id: string
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly gauge: Gauge
  readonly construction: Construction
  readonly yarns: readonly Yarn[]
  /** Palette index of the main color, knitted wherever nothing else is. */
  readonly background: number
  /** What's being knitted: its schematic. */
  readonly piece: ProjectPiece
  /** Which cells are stitches (`STITCH`) and which are outside the piece (`NONE`), built from `piece`. */
  readonly outline: Grid
  /** The colorwork layers, back to front: later ones are drawn on top. */
  readonly bands: readonly Band[]
  /** The knitter's limit for float warnings. */
  readonly floatRules: FloatRules
  /**
   * The sizes a published pattern gives, each its own shape; the colorwork is
   * shared. Only a chart made from someone's pattern has them: a knitter's own
   * design is just its one shape. `piece` is the size shown, as it's edited.
   */
  readonly sizes?: readonly PieceSize[]
  /** Which of `sizes` is shown. Until the knitter picks one, the first is shown. */
  readonly size?: number
  /**
   * Rows whose long floats the knitter has seen and set aside, by row number
   * (1 is the cast-on row), each with what its floats were (`floatsSignature`).
   * A row whose floats have changed since is flagged again.
   */
  readonly dismissedFloats?: Readonly<Record<string, string>>
  /**
   * A swatch the knitter weighed: its size and weight, knitted in the
   * colorwork (or plain, for one yarn). It makes the yarn estimate their own.
   */
  readonly swatch?: Swatch
}

export interface Swatch {
  readonly widthCm: number
  readonly heightCm: number
  readonly grams: number
}

/** One size of a published pattern: its name there ("S", "Adult M") and its shape. */
export interface PieceSize {
  readonly name: string
  readonly shape: SchematicPiece
}

/** A project's piece: its schematic, named. */
export type ProjectPiece = {
  readonly name: string
  /** The published pattern it started from, to credit. */
  readonly credit?: PieceTemplate['credit']
} & SchematicPiece

export function pieceFromTemplate(template: PieceTemplate): ProjectPiece {
  return { name: template.name, ...(template.credit && { credit: template.credit }), ...template.spec }
}

export interface NewProjectOptions {
  readonly id: string
  readonly name: string
  readonly template?: PieceTemplate
  readonly gauge?: Gauge
  readonly now: number
}

export function createProject({ id, name, template = BUILT_IN_TEMPLATES[0]!, gauge = DEFAULT_GAUGE, now }: NewProjectOptions): Project {
  const mask = buildOutline(template.spec, gauge, template.construction)
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    gauge,
    construction: template.construction,
    piece: pieceFromTemplate(template),
    yarns: STARTER_YARNS.slice(0, 4),
    background: 0,
    outline: mask,
    bands: [],
    floatRules: DEFAULT_RULES,
    ...(template.sizes && template.sizes.length > 1 && {
      sizes: template.sizes.map(({ name, spec }) => ({ name, shape: spec })),
    }),
  }
}

/**
 * The finished chart: one palette index per stitch, `NONE` outside the outline.
 * `knitted` leaves out motifs stitched on after knitting: what's knitted, for
 * float checks and row-by-row instructions.
 */
export function composeChart(project: Pick<Project, 'outline' | 'background' | 'bands'>, { knitted = false } = {}): Grid {
  const { outline } = project
  const chart = createGrid(outline.width, outline.height)
  for (let i = 0; i < chart.cells.length; i++) {
    if (outline.cells[i] !== NONE) chart.cells[i] = project.background
  }
  for (const band of project.bands) if (!(knitted && band.afterKnitting)) applyBand(chart, outline, band)
  return chart
}

/**
 * How each stitch is worked (a `StitchType` code: knit, purl, k1 tbl…), as
 * seen from the right side, `NONE` outside the outline. Null when everything's
 * knit, which is most colorwork.
 */
export function composeStitches(project: Pick<Project, 'outline' | 'bands'> & { construction?: Construction }, { knitted = false } = {}): Grid | null {
  const bands = project.bands.filter((b) => b.visible && !(knitted && b.afterKnitting))
  const { outline } = project
  // Marked on flat pieces, shaped at their edges. In the round there are no edges: the row's written line says how.
  const shaping = (project.construction ?? 'flat') === 'flat' ? shapingStitches(outline) : []
  if (!bands.some(hasStitches) && !shaping.length) return null
  const stitches = createGrid(outline.width, outline.height)
  for (let i = 0; i < stitches.cells.length; i++) if (outline.cells[i] !== NONE) stitches.cells[i] = KNIT
  for (const band of bands) applyBandStitches(stitches, outline, band)
  // Where a chart has its own stitch (its own shaping, say), that wins.
  for (const { i, stitch } of shaping) if (stitches.cells[i] === KNIT) stitches.cells[i] = stitch
  return stitches
}

/**
 * The increases and decreases a piece's shape calls for, worked out from its
 * outline rather than drawn: wherever a row has a stitch or two more (or fewer)
 * than the row below, one stitch in from each edge that moved, the way patterns
 * write it: "k1, M1L … M1R, k1", "k1, ssk … k2tog, k1". A bigger step is cast
 * on or bound off, which the instructions say; those aren't marked.
 */
export function shapingStitches(outline: Grid): Array<{ i: number; stitch: number }> {
  const edges = (y: number) => {
    let [left, right] = [-1, -1]
    for (let x = 0; x < outline.width; x++) {
      if (outline.cells[y * outline.width + x] === NONE) continue
      if (left < 0) left = x
      right = x
    }
    return left < 0 ? null : { left, right }
  }
  const marks: Array<{ i: number; stitch: number }> = []
  // Rows are knitted from the bottom: each compared with the one below it.
  for (let y = outline.height - 2; y >= 0; y--) {
    const [row, below] = [edges(y), edges(y + 1)]
    if (!row || !below || row.right - row.left < 3) continue
    const grewLeft = below.left - row.left
    const grewRight = row.right - below.right
    const at = (x: number) => y * outline.width + x
    // Charts read right to left on the right side: the row begins at the right edge ("k1, M1L" or "k1, ssk") and ends at the left.
    if (grewRight === 1) marks.push({ i: at(row.right - 1), stitch: M1L })
    if (grewRight === -1) marks.push({ i: at(row.right - 1), stitch: SSK })
    if (grewLeft === 1) marks.push({ i: at(row.left + 1), stitch: M1R })
    if (grewLeft === -1) marks.push({ i: at(row.left + 1), stitch: K2TOG })
  }
  return marks
}

/** Whether a row's floats were dismissed as they are now (`y` top-based): a changed row isn't. */
export function floatsDismissed(project: Pick<Project, 'dismissedFloats' | 'outline'>, y: number, rowIssues: readonly RowIssue[]): boolean {
  const saved = project.dismissedFloats?.[String(project.outline.height - y)]
  return saved !== undefined && rowIssues.length > 0 && saved === floatsSignature(rowIssues)
}

/** The float limit in stitches at the project's gauge: floats longer than this are flagged. */
export function floatRulesOf(project: Pick<Project, 'floatRules' | 'gauge'>): FloatRules {
  return rulesAt(project.floatRules, project.gauge)
}

/** A motif stitched on after knitting, and where it goes: its stitches across (right exclusive) and rows (top-based, inclusive). */
export interface StitchedOn {
  readonly band: Band
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * What's stitched on after knitting: those motifs' stitches alone (`NONE`
 * everywhere else), to show over the knitted chart, and where each one goes.
 */
export function stitchedOn(project: Pick<Project, 'outline' | 'bands'>): { grid: Grid; motifs: StitchedOn[] } {
  const { outline } = project
  const grid = createGrid(outline.width, outline.height)
  const motifs: StitchedOn[] = []
  for (const band of project.bands) {
    if (!band.afterKnitting || !band.visible || !band.once) continue
    applyBand(grid, outline, band)
    const { top, bottom } = bandSpan(band, outline.height)
    motifs.push({ band, left: band.offsetX, right: band.offsetX + bandTile(band).width, top, bottom })
  }
  return { grid, motifs }
}
