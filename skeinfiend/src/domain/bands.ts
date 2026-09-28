import { createGrid, NONE, type Grid } from './grid'
import { KNIT } from './stitches'
import { orient, sourcePoint, type Orientation } from './transform'

/**
 * A colorwork layer (a "band" in the code): one motif repeated across a
 * range of rows, the way colorwork is designed ("snowflakes at rows 8–16,
 * peeries at 25–27"), or over the whole piece. Layers stack in order, later
 * ones on top, with hand-painted stitches above them all.
 *
 * The motif belongs to the band. Painting on any repeat edits the motif, and
 * every repeat updates.
 *
 * A band can also hold a single placed motif ("a heart on the chest"), and a
 * placed motif can be stitched on after knitting (duplicate stitch) rather
 * than knitted in.
 */
export interface Band extends Orientation {
  readonly id: string
  readonly name: string
  readonly motif: Grid
  readonly visible: boolean
  /** Rows covered, top-based and inclusive. Null repeats the motif over the whole chart. */
  readonly rows: { readonly top: number; readonly bottom: number } | null
  /** Horizontal shift of the repeats, in stitches. */
  readonly offsetX: number
  /** Vertical shift, in rows up from the band's bottom row. */
  readonly offsetY: number
  /** Blank stitches between repeats, across and up. */
  readonly gapX: number
  readonly gapY: number
  /** One copy of the motif at `offsetX`, filling the band's rows, instead of repeats. */
  readonly once?: boolean
  /** Stitched on after knitting: on the chart, but not knitted, so it has no floats. */
  readonly afterKnitting?: boolean
  /**
   * The motif knitted larger, 1 to 4 times (in tenths): at 2×, each stitch is a
   * 2 × 2 block; at 1.5×, some stitches are doubled. The motif itself stays at
   * its own size, so scaling back down loses nothing.
   */
  readonly scale?: number
  /**
   * Finer drawing done at a larger scale, by scale: the motif at that size with
   * stitches of its own. Kept when scaling down, and back when scaling up again.
   * Without one, a scale is the motif's stitches as blocks.
   */
  readonly details?: Readonly<Record<number, Grid>>
  /**
   * How each of the motif's stitches is worked (a `StitchType` code: purl,
   * k1 tbl, k2tog…), the same size as `motif`; knit where it's 0. A stitch on
   * a clear cell works whatever color is underneath: texture in the main color.
   */
  readonly stitches?: Grid
  /**
   * Stitches painted straight onto the chart, rather than a motif: one copy,
   * one stitch per chart stitch, painted on the chart itself (never dragged).
   */
  readonly painted?: boolean
  /**
   * The library motif it was made from (a saved motif's id, or `built-in:…`),
   * and when that motif was last edited then: the layer is a copy, which only
   * changes when the knitter takes a newer version.
   */
  readonly fromLibrary?: { readonly motifId: string; readonly editedAt: number }
}


export const MAX_SCALE = 4
/** Scales go in tenths: 1.5×, not 1.4999×. */
export const SCALE_STEP = 0.1

export function scaleOf(band: Band): number {
  return band.scale ?? 1
}

/** How a layer's motif repeats: across a band of rows, tiled over the whole piece, or a single motif. */
export type Placement = 'band' | 'tile' | 'single'

/**
 * Whether a layer is arranged on the chart itself (grabbed, moved, resized):
 * one in rows or placed once. One tiled over the whole piece is a background,
 * changed in its window.
 */
export function isArranged(band: Band): boolean {
  return !band.painted && (band.once === true || band.rows !== null)
}

/**
 * The painted layer grown (never shrunk) to cover a chart `width` × `height`,
 * its stitches staying where they are on it: so any stitch of the chart can be
 * painted, one layer stitch per chart stitch.
 */
export function coverChart(band: Band, width: number, height: number): Band {
  const { top, bottom } = bandSpan(band, height)
  const tileTop = bottom - band.motif.height + 1
  const [left, right] = [Math.min(0, band.offsetX), Math.max(width, band.offsetX + band.motif.width)]
  const [upper, lower] = [Math.min(0, tileTop), Math.max(height - 1, bottom)]
  if (left === band.offsetX && right === band.offsetX + band.motif.width && upper === tileTop && lower === bottom && top === tileTop) return band
  // Its colors and stitches, moved into a grid over the whole chart.
  const grown = (grid: Grid, fill: number) => {
    const next = createGrid(right - left, lower - upper + 1, fill)
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) next.cells[(tileTop - upper + y) * next.width + (band.offsetX - left + x)] = grid.cells[y * grid.width + x]!
    }
    return next
  }
  return {
    ...band,
    motif: grown(band.motif, NONE),
    ...(band.stitches && { stitches: grown(band.stitches, KNIT) }),
    offsetX: left, rows: { top: upper, bottom: lower }, once: true, scale: 1, details: undefined, rotation: 0, mirror: false,
  }
}

export function placementOf(band: Band): Placement {
  return band.once ? 'single' : band.rows ? 'band' : 'tile'
}

/** The yarns a motif uses, in palette order: the colors it can be recolored from. */
export function motifYarns(motif: Grid): number[] {
  return [...new Set(motif.cells)].filter((c) => c !== NONE).sort((a, b) => a - b)
}

export function createBand(id: string, name: string, motif: Grid, rows: Band['rows']): Band {
  return { id, name, motif, rows, visible: true, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0, rotation: 0, mirror: false }
}

export function blankMotif(width = 8, height = 8): Grid {
  return createGrid(width, height)
}

/** The motif at the layer's scale, before rotating and mirroring: what's shown and drawn on in its window. */
export function scaledMotif(band: Band): Grid {
  const scale = scaleOf(band)
  return scale === 1 ? band.motif : (band.details?.[scale] ?? scaleUp(band.motif, scale))
}

/** The same change to the motif and every finer drawing of it, given each grid and its scale. */
export function mapMotifs(band: Band, change: (grid: Grid, scale: number) => Grid): Pick<Band, 'motif' | 'details'> {
  const details = band.details && Object.fromEntries(Object.entries(band.details).map(([scale, grid]) => [scale, change(grid, Number(scale))]))
  return { motif: change(band.motif, 1), details }
}

/** The motif as it's knitted: scaled up, mirrored, and rotated. */
export function bandTile(band: Band): Grid {
  return orient(scaledMotif(band), band)
}

/** How many stitches (or rows) `n` of them become at `scale`: whole stitches, at least one. */
export function scaledSize(n: number, scale: number): number {
  return Math.max(1, Math.round(n * scale))
}

/**
 * `grid` at `scale`, each stitch taking the stitch it lands on in the original.
 * At a whole scale, each stitch becomes a `scale` × `scale` block; in between
 * (1.5×), some stitches are doubled and some aren't, spread evenly.
 */
export function scaleUp(grid: Grid, scale: number): Grid {
  if (scale === 1) return grid
  const out = createGrid(scaledSize(grid.width, scale), scaledSize(grid.height, scale))
  for (let y = 0; y < out.height; y++) {
    const sy = sourceIndex(y, grid.height, out.height)
    for (let x = 0; x < out.width; x++) out.cells[y * out.width + x] = grid.cells[sy * grid.width + sourceIndex(x, grid.width, out.width)]!
  }
  return out
}

/** The original stitch (of `n`) that stitch `i` of a scaled row (of `scaled`) comes from. */
export function sourceIndex(i: number, n: number, scaled: number): number {
  return Math.floor((i * n) / scaled)
}

/** The cell of the scaled motif (`scaledMotif`) under a point of the knitted tile: undo the rotation and mirroring. */
export function motifPoint(band: Band, tx: number, ty: number): { x: number; y: number } {
  const scale = scaleOf(band)
  return sourcePoint(tx, ty, scaledSize(band.motif.width, scale), scaledSize(band.motif.height, scale), band)
}

export function bandSpan(band: Band, chartHeight: number): { top: number; bottom: number } {
  return band.rows ?? { top: 0, bottom: chartHeight - 1 }
}

/**
 * Where a chart stitch falls in the band's motif: the cell of its scaled motif
 * (`scaledMotif`) before rotating and mirroring, or null if the stitch is outside the band or in the
 * space between repeats. Composition and in-place editing both go through here,
 * so what you see is exactly what you edit.
 */
export function motifCellAt(band: Band, x: number, y: number, chartHeight: number, tile = bandTile(band)): { x: number; y: number } | null {
  const { top, bottom } = bandSpan(band, chartHeight)
  if (y < top || y > bottom) return null
  if (band.once) {
    const tx = x - band.offsetX
    const ty = tile.height - 1 - (bottom - y)
    if (tx < 0 || tx >= tile.width || ty < 0) return null
    return motifPoint(band, tx, ty)
  }
  const periodX = tile.width + Math.max(0, band.gapX)
  const periodY = tile.height + Math.max(0, band.gapY)
  const tx = mod(x - band.offsetX, periodX)
  // Rows count up from the band's bottom, so a motif starts on its first knitted row.
  const up = mod(bottom - y - band.offsetY, periodY)
  if (tx >= tile.width || up >= tile.height) return null
  const ty = tile.height - 1 - up
  return motifPoint(band, tx, ty)
}

/** Stamps a band into `target` in place, skipping transparent motif cells and cells outside `mask`. */
export function applyBand(target: Grid, mask: Grid, band: Band): void {
  if (!band.visible) return
  const tile = bandTile(band)
  const motif = scaledMotif(band)
  const { top, bottom } = bandSpan(band, target.height)
  for (let y = Math.max(0, top); y <= Math.min(target.height - 1, bottom); y++) {
    for (let x = 0; x < target.width; x++) {
      const i = y * target.width + x
      if (mask.cells[i] === NONE) continue
      const cell = motifCellAt(band, x, y, target.height, tile)
      if (!cell) continue
      const value = motif.cells[cell.y * motif.width + cell.x]!
      if (value !== NONE) target.cells[i] = value
    }
  }
}

/**
 * Stamps a band's stitches into `target` in place: each stitch it sets (purl,
 * k1 tbl…), and knit wherever it has a colored stitch it doesn't, so a
 * layer's colorwork covers texture underneath.
 */
export function applyBandStitches(target: Grid, mask: Grid, band: Band): void {
  if (!band.visible) return
  const tile = bandTile(band)
  const motif = scaledMotif(band)
  const { top, bottom } = bandSpan(band, target.height)
  for (let y = Math.max(0, top); y <= Math.min(target.height - 1, bottom); y++) {
    for (let x = 0; x < target.width; x++) {
      const i = y * target.width + x
      if (mask.cells[i] === NONE) continue
      const cell = motifCellAt(band, x, y, target.height, tile)
      if (!cell) continue
      const { width: w, height: h } = band.motif
      const stitch = band.stitches?.cells[sourceIndex(cell.y, h, motif.height) * w + sourceIndex(cell.x, w, motif.width)] ?? KNIT
      if (stitch !== KNIT) target.cells[i] = stitch
      else if (motif.cells[cell.y * motif.width + cell.x] !== NONE) target.cells[i] = KNIT
    }
  }
}

/** Whether a layer works any stitch other than knit. */
export function hasStitches(band: Pick<Band, 'stitches'>): boolean {
  return band.stitches?.cells.some((c) => c !== KNIT) ?? false
}

/** A layer's stitches as knitted, like `bandTile`: scaled up, mirrored, and rotated. Null when they're all knit. */
export function bandStitchTile(band: Band): Grid | null {
  return band.stitches && hasStitches(band) ? orient(scaleUp(band.stitches, scaleOf(band)), band) : null
}

/** Outlines of each repeat within the band, for showing the selected band. */
export function bandTiles(band: Band, chartWidth: number, chartHeight: number) {
  const tile = bandTile(band)
  const { top, bottom } = bandSpan(band, chartHeight)
  if (band.once) {
    const tileTop = Math.max(top, bottom - tile.height + 1)
    return [{ x: band.offsetX, y: tileTop, width: tile.width, height: bottom - tileTop + 1 }]
  }
  const periodX = tile.width + Math.max(0, band.gapX)
  const periodY = tile.height + Math.max(0, band.gapY)
  const tiles: Array<{ x: number; y: number; width: number; height: number }> = []
  // The first repeat's bottom row sits `offsetY` rows above the band's bottom.
  const firstBottom = bottom - mod(band.offsetY, periodY) + periodY
  for (let tileBottom = firstBottom; tileBottom - tile.height + 1 <= bottom + periodY; tileBottom -= periodY) {
    const tileTop = tileBottom - tile.height + 1
    const clippedTop = Math.max(tileTop, top)
    const clippedBottom = Math.min(tileBottom, bottom)
    if (clippedTop > clippedBottom) {
      if (tileBottom < top) break
      continue
    }
    for (let x = mod(band.offsetX, periodX) - periodX; x < chartWidth; x += periodX) {
      if (x + tile.width <= 0) continue
      tiles.push({ x, y: clippedTop, width: tile.width, height: clippedBottom - clippedTop + 1 })
    }
  }
  return tiles
}

/**
 * One repeat of a repeating layer, to box on a printed chart as books do
 * ("14-st rep"): the whole repeat (its spacing included) nearest the middle.
 * Null for a single motif, painted stitches, or a hidden layer.
 */
export function repeatBox(band: Band, chartWidth: number, chartHeight: number): { x: number; y: number; width: number; height: number; stitches: number; rows: number } | null {
  if (!band.visible || band.once || band.painted) return null
  const tile = bandTile(band)
  const [width, height] = [tile.width + Math.max(0, band.gapX), tile.height + Math.max(0, band.gapY)]
  const whole = bandTiles(band, chartWidth, chartHeight).filter((t) => t.height === tile.height && t.x >= 0 && t.x + width <= chartWidth)
  if (!whole.length) return null
  const distance = (t: { x: number; y: number }) => Math.abs(t.x + width / 2 - chartWidth / 2) + Math.abs(t.y + tile.height / 2 - chartHeight / 2) * 0.5
  const best = whole.reduce((a, b) => (distance(b) < distance(a) ? b : a))
  return { x: best.x, y: best.y, width, height: band.rows ? tile.height : Math.min(height, chartHeight - best.y), stitches: width, rows: tile.height }
}

/** The offset that centers a band across `width` stitches: its whole repeats, or its one motif. */
export function centeredX(band: Band, width: number): number {
  const tileWidth = bandTile(band).width
  return band.once ? Math.floor((width - tileWidth) / 2) : centeredOffset(width, tileWidth, band.gapX)
}

/** The offset that centers whole repeats across `width` stitches. */
export function centeredOffset(width: number, tileWidth: number, gap: number): number {
  const period = tileWidth + gap
  const count = Math.max(1, Math.floor((width + gap) / period))
  return Math.floor((width - (count * period - gap)) / 2)
}

/**
 * Rows for a new band of `height` rows: just above the highest existing band
 * (leaving a couple of rows between), or a few rows up from the bottom of an
 * empty chart. Falls back to the bottom if there's no room.
 */
export function nextBandRows(bands: readonly Band[], chartHeight: number, height: number): { top: number; bottom: number } {
  const GAP = 3
  const banded = bands.filter((b) => b.rows).map((b) => b.rows!.top)
  const bottom = banded.length ? Math.min(...banded) - GAP : chartHeight - 1 - 4
  const top = bottom - height + 1
  if (top < 0 || bottom >= chartHeight) return { top: Math.max(0, chartHeight - height), bottom: chartHeight - 1 }
  return { top, bottom }
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}
