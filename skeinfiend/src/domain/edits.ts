import { floatsSignature, type RowIssue } from './floats'
import { rowsPerCm, sameGauge, stitchesPerCm, type Gauge } from './gauge'
import { NONE, resizeGrid, type Grid } from './grid'
import { MAX_YARNS, remapAfterRemoval, STARTER_YARNS, type Yarn } from './palette'
import type { PieceSize, Project, ProjectPiece, Swatch } from './project'
import { bandTile, centeredOffset, centeredX, createBand, mapMotifs, MAX_SCALE, motifYarns, nextBandRows, SCALE_STEP, scaledSize, scaleOf, sourceIndex, type Band, type Placement } from './bands'
import { editedAt, motifInYarns, type SavedMotif } from './saved-motifs'
import { buildOutline, type Construction, type SchematicPiece } from './pieces'

/**
 * Every change a person can make to a project, as a pure function. The editor
 * applies these through its undo history; nothing here knows about the UI.
 */

export function rename(project: Project, name: string): Project {
  const trimmed = name.trim()
  return trimmed && trimmed !== project.name ? { ...project, name: trimmed } : project
}

/** Sets a row's long floats aside (`y` top-based), as they are: if they change, the row is flagged again. */
export function dismissFloats(project: Project, y: number, rowIssues: readonly RowIssue[]): Project {
  const row = String(project.outline.height - y)
  return { ...project, dismissedFloats: { ...project.dismissedFloats, [row]: floatsSignature(rowIssues) } }
}

/** Worked flat or in the round. Its outline follows: worked flat, it's shaped on right-side rows. */
export function setConstruction(project: Project, construction: Construction): Project {
  const next = { ...project, construction }
  return project.piece.kind === 'schematic' && construction !== project.construction
    ? reshape(next, buildOutline(schematicOf(next), next.gauge, construction))
    : next
}

// The piece

/**
 * Fits the project to a new outline, keeping the design where it was on the
 * fabric. Rows count up from the cast-on edge, so a layer keeps its distance
 * above it (scaled to the new gauge, if that changed, to stay the same in
 * centimeters), and its number of rows. A single motif keeps its distance from
 * the piece's center; a centered band on a flat piece stays centered. Knitting
 * progress keeps its place the same way.
 */
function reshape(project: Project, outline: Grid, gauge = project.gauge): Project {
  const before = project.outline
  const rowScale = rowsPerCm(gauge) / rowsPerCm(project.gauge)
  const stitchScale = stitchesPerCm(gauge) / stitchesPerCm(project.gauge)
  const rowsUp = (y: number) => Math.round((before.height - 1 - y) * rowScale)
  const fromBottom = (up: number) => outline.height - 1 - up
  const relayout = (band: Band): Band => {
    let next = band
    if (band.rows) {
      const span = band.rows.bottom - band.rows.top
      const bottom = Math.min(outline.height - 1, Math.max(span, fromBottom(rowsUp(band.rows.bottom))))
      next = { ...next, rows: { top: bottom - span, bottom } }
    }
    if (band.once) {
      const width = bandTile(band).width
      const center = outline.width / 2 + (band.offsetX + width / 2 - before.width / 2) * stitchScale
      next = { ...next, offsetX: Math.min(outline.width - width, Math.max(0, Math.round(center - width / 2))) }
    } else if (project.construction === 'flat' && isCentered(band, before.width)) {
      next = { ...next, offsetX: centeredX(band, outline.width) }
    }
    return next
  }
  return {
    ...project,
    gauge,
    outline,
    bands: project.bands.map(relayout),
  }
}

// Sizes

/** The size shown, as the knitter has it now: edits made to it included. */
function currentShape(project: Project): PieceSize['shape'] {
  const { name: _, credit: __, ...shape } = project.piece
  return shape
}

/** The size shown: an index into `sizes`, the first until one's picked. */
export function sizeIndex(project: Project): number {
  return project.size ?? 0
}

/** Shows another size of the pattern, colorwork and all. The one shown keeps any changes made to it. */
export function switchSize(project: Project, index: number): Project {
  const sizes = project.sizes
  if (!sizes?.[index]) return project
  const current = sizeIndex(project)
  if (index === current) return project.size === index ? project : { ...project, size: index }
  const kept = sizes.map((s, i) => (i === current ? { ...s, shape: currentShape(project) } : s))
  return applyShape({ ...project, sizes: kept, size: index }, kept[index]!.shape)
}

/**
 * Gives the piece a published pattern's sizes, showing `shown` (the first,
 * until the knitter picks one). With just one, the piece has no sizes: it's
 * just that shape.
 */
export function setSizes(project: Project, sizes: readonly PieceSize[], shown?: number): Project {
  const { sizes: _, size: __, ...rest } = project
  const first = sizes[shown ?? 0]
  if (!first) return rest
  const shaped = applyShape(rest, first.shape)
  return sizes.length < 2 ? shaped : { ...shaped, sizes, ...(shown !== undefined && { size: shown }) }
}

/** The piece takes a size's shape, keeping its name and credit; the colorwork stays where it was on the fabric. */
function applyShape(project: Project, shape: PieceSize['shape']): Project {
  const { name, credit } = project.piece
  const piece: ProjectPiece = { ...shape, name, ...(credit && { credit }) }
  return reshape({ ...project, piece }, buildOutline(shape, project.gauge, project.construction))
}

/** The piece's schematic, without its name and credit. */
export function schematicOf(project: Project): SchematicPiece {
  const { name: _, credit: __, ...schematic } = project.piece
  return schematic
}

/** Changes the schematic, rebuilding the outline from it at the gauge. */
export function setSchematic(project: Project, schematic: SchematicPiece): Project {
  const { name, credit } = project.piece
  const piece: ProjectPiece = { ...schematic, name, ...(credit && { credit }) }
  return reshape({ ...project, piece }, buildOutline(schematic, project.gauge, project.construction))
}

export function renamePiece(project: Project, name: string): Project {
  const trimmed = name.trim()
  return trimmed ? { ...project, piece: { ...project.piece, name: trimmed } } : project
}

/** A new gauge keeps the piece the same size in centimeters: its outline is rebuilt. */
export function setGauge(project: Project, gauge: Gauge): Project {
  // The same gauge counted over another length still changes what's shown, but nothing moves.
  if (sameGauge(gauge, project.gauge)) return gauge.over === project.gauge.over ? project : { ...project, gauge }
  return reshape(project, buildOutline(schematicOf(project), gauge, project.construction), gauge)
}

/**
 * A layer made from a library motif takes the library's newer version: the
 * new drawing, in the layer's own yarns (its first contrast stays first), in
 * the same place.
 */
export function takeLibraryVersion(project: Project, bandId: string, saved: SavedMotif): Project {
  const band = project.bands.find((b) => b.id === bandId)
  if (!band) return project
  const first = motifYarns(band.motif).find((y) => y !== project.background) ?? (project.background + 1) % project.yarns.length
  const motif = motifInYarns(saved.grid, project.yarns.length, project.background, first)
  const updated = adjustBand(project, bandId, { motif, details: undefined })
  return updateBand(updated, bandId, { fromLibrary: { motifId: saved.id, editedAt: editedAt(saved) } })
}

/**
 * A library motif added to a chart that isn't open, from the library: in
 * the chart's yarns, centered, in free rows, remembering where it came from.
 */
export function addLibraryMotif(project: Project, saved: SavedMotif, bandId: string): Project {
  const first = (project.background + 1) % project.yarns.length
  const motif = motifInYarns(saved.grid, project.yarns.length, project.background, first)
  const rows = nextBandRows(project.bands, project.outline.height, motif.height)
  const band: Band = {
    ...createBand(bandId, saved.name, motif, rows),
    offsetX: centeredOffset(project.outline.width, motif.width, 0),
    fromLibrary: { motifId: saved.id, editedAt: editedAt(saved) },
  }
  return addBand(project, band)
}

// Yarns

export function addYarn(project: Project): Project {
  if (project.yarns.length >= MAX_YARNS) return project
  const used = new Set(project.yarns.map((y) => y.id))
  const yarn: Yarn = STARTER_YARNS.find((y) => !used.has(y.id)) ?? {
    id: `yarn-${project.yarns.length + 1}-${Date.now().toString(36)}`,
    name: `Yarn ${project.yarns.length + 1}`,
    hex: '#9a8f80',
  }
  return { ...project, yarns: [...project.yarns, yarn] }
}

/** The knitter's weighed swatch, or none. */
export function setSwatch(project: Project, swatch: Swatch | undefined): Project {
  const { swatch: _, ...rest } = project
  return swatch ? { ...rest, swatch } : rest
}

export function updateYarn(project: Project, index: number, changes: Partial<Omit<Yarn, 'id'>>): Project {
  if (!project.yarns[index]) return project
  return { ...project, yarns: project.yarns.map((y, i) => (i === index ? { ...y, ...changes } : y)) }
}

export function setBackground(project: Project, index: number): Project {
  return index >= 0 && index < project.yarns.length ? { ...project, background: index } : project
}

/**
 * Removes a yarn. Stitches knitted in it switch to the main color (or, if it
 * was the main color, to the first remaining yarn), everywhere it's used.
 */
export function removeYarn(project: Project, index: number): Project {
  if (project.yarns.length <= 1 || !project.yarns[index]) return project
  const replacement = index === project.background ? (index === 0 ? 1 : 0) : project.background
  return {
    ...project,
    yarns: project.yarns.filter((_, i) => i !== index),
    // The replacement becomes the main color; indices above the removed yarn shift down.
    background: replacement > index ? replacement - 1 : replacement,
    // Motif stitches in the removed yarn become transparent, so the main color shows.
    bands: project.bands.map((b) => ({ ...b, ...mapMotifs(b, (grid) => remapAfterRemoval(grid, index, NONE)) })),
  }
}

// Pattern bands

export function addBand(project: Project, band: Band): Project {
  return { ...project, bands: [...project.bands, band] }
}

export function updateBand(project: Project, id: string, changes: Partial<Omit<Band, 'id'>>): Project {
  return { ...project, bands: project.bands.map((b) => (b.id === id ? { ...b, ...changes } : b)) }
}

export function removeBand(project: Project, id: string): Project {
  return { ...project, bands: project.bands.filter((b) => b.id !== id) }
}

export function renameBand(project: Project, id: string, name: string): Project {
  const trimmed = name.trim()
  return trimmed ? updateBand(project, id, { name: trimmed }) : project
}

/** Resizes a band's motif (and its finer drawings, to match) around its bottom-right corner, keeping what's drawn. */
export function resizeBandMotif(project: Project, id: string, width: number, height: number): Project {
  const band = project.bands.find((b) => b.id === id)
  if (!band) return project
  return adjustBand(project, id, {
    ...mapMotifs(band, (grid, scale) => resizeGrid(grid, scaledSize(width, scale), scaledSize(height, scale))),
    ...(band.stitches && { stitches: resizeGrid(band.stitches, width, height, 0) }),
  })
}

/**
 * The motif as drawn in the layer's window, at its scale. At 1× it's the motif:
 * a stitch changed there changes as a block in any finer drawing too, keeping
 * the rest of that detail. At a larger scale it's that scale's finer drawing.
 */
export function drawMotif(project: Project, id: string, grid: Grid): Project {
  const band = project.bands.find((b) => b.id === id)
  if (!band) return project
  const scale = scaleOf(band)
  if (scale > 1) return updateBand(project, id, { details: { ...band.details, [scale]: grid } })
  const before = band.motif
  const { details } = mapMotifs(band, (detail, s) => {
    if (s === 1) return detail
    // Every stitch of the finer drawing that comes from a changed stitch changes with it.
    const next = { ...detail, cells: detail.cells.slice() }
    for (let y = 0; y < detail.height; y++) {
      const sy = sourceIndex(y, grid.height, detail.height)
      for (let x = 0; x < detail.width; x++) {
        const i = sy * grid.width + sourceIndex(x, grid.width, detail.width)
        if (grid.cells[i] !== before.cells[i]) next.cells[y * detail.width + x] = grid.cells[i]!
      }
    }
    return next
  })
  return updateBand(project, id, { motif: grid, details })
}

/** A layer's stitches as drawn (at its own size, one per motif stitch): purls, twisted stitches, decreases. */
export function drawStitches(project: Project, id: string, grid: Grid): Project {
  return updateBand(project, id, { stitches: grid })
}

/** Knits the motif larger, in tenths from 1× to 4×. The motif keeps its own size, so this is undone exactly. */
export function setScale(project: Project, id: string, scale: number): Project {
  // In tenths, and exactly: 1.5, not 1.5000000000000002.
  const clamped = Number(Math.max(1, Math.min(MAX_SCALE, Math.round(scale / SCALE_STEP) * SCALE_STEP)).toFixed(1))
  const band = project.bands.find((b) => b.id === id)
  return !band || scaleOf(band) === clamped ? project : adjustBand(project, id, { scale: clamped })
}

/**
 * Changes how a band repeats. On a flat piece, a band that was centered stays
 * centered as its spacing or motif changes; in the round there's no center.
 */
export function adjustBand(project: Project, id: string, changes: Partial<Band>): Project {
  const before = project.bands.find((b) => b.id === id)
  const next = fitPlacedMotif(fitBandRows(updateBand(project, id, changes), before), id)
  if (!before || project.construction !== 'flat' || !isCentered(before, project.outline.width)) return next
  const after = next.bands.find((b) => b.id === id)!
  return updateBand(next, id, { offsetX: centeredX(after, project.outline.width) })
}

/**
 * Where a band sits: across some rows, all over, or once. A placed motif
 * starts centered, in rows of its own height; stitching on after knitting
 * only applies to placed motifs.
 */
export function setPlacement(project: Project, id: string, placement: Placement, rows: { top: number; bottom: number }): Project {
  const band = project.bands.find((b) => b.id === id)
  if (!band) return project
  const { width } = project.outline
  const next = placement === 'tile'
    ? updateBand(project, id, { rows: null, once: false, afterKnitting: false })
    : placement === 'band'
      ? updateBand(project, id, { rows: band.rows ?? rows, once: false, afterKnitting: false })
      : updateBand(project, id, { rows: band.rows ?? rows, once: true, afterKnitting: true, offsetX: Math.floor((width - bandTile(band).width) / 2), offsetY: 0 })
  return fitPlacedMotif(next, id)
}

/** Recolors a layer: every stitch of one yarn in its motif becomes another. */
export function recolorBand(project: Project, id: string, from: number, to: number): Project {
  const band = project.bands.find((b) => b.id === id)
  if (!band || from === to) return project
  return updateBand(project, id, mapMotifs(band, (grid) => ({ ...grid, cells: grid.cells.map((c) => (c === from ? to : c)) })))
}

/** Moves a layer to `index` in the stack (0 is the bottom, drawn first). */
export function reorderBand(project: Project, id: string, index: number): Project {
  const from = project.bands.findIndex((b) => b.id === id)
  if (from < 0) return project
  const to = Math.max(0, Math.min(project.bands.length - 1, index))
  if (to === from) return project
  const bands = [...project.bands]
  const [band] = bands.splice(from, 1)
  bands.splice(to, 0, band!)
  return { ...project, bands }
}

/** A copy of a layer, just above it in the stack, in the given rows (so it doesn't hide the original). */
export function duplicateBand(project: Project, id: string, copyId: string, rows: { top: number; bottom: number }): Project {
  const index = project.bands.findIndex((b) => b.id === id)
  const band = project.bands[index]
  if (!band) return project
  const copy: Band = { ...band, id: copyId, name: `${band.name} copy`, rows: band.rows && rows }
  const bands = [...project.bands]
  bands.splice(index + 1, 0, copy)
  return { ...project, bands }
}

/**
 * A band's rows follow its motif's height (after scaling or rotating, say):
 * a band exactly one motif tall stays exactly one motif tall, and none is
 * left shorter than its motif. It grows and shrinks from its bottom row.
 */
function fitBandRows(project: Project, before: Band | undefined): Project {
  const band = before && project.bands.find((b) => b.id === before.id)
  if (!band?.rows || !before?.rows || band.once) return project
  const span = band.rows.bottom - band.rows.top + 1
  const [was, now] = [bandTile(before).height, bandTile(band).height]
  if (was === now || (span !== was && span >= now)) return project
  const height = span === was ? now : Math.max(span, now)
  return updateBand(project, band.id, { rows: { top: Math.max(0, band.rows.bottom - height + 1), bottom: band.rows.bottom } })
}

/** A placed motif's rows are exactly its height (after rotating), keeping its bottom row. */
function fitPlacedMotif(project: Project, id: string): Project {
  const band = project.bands.find((b) => b.id === id)
  if (!band?.once || !band.rows) return project
  const height = bandTile(band).height
  const bottom = Math.min(project.outline.height - 1, Math.max(height - 1, band.rows.bottom))
  const rows = { top: bottom - height + 1, bottom }
  return rows.top === band.rows.top && rows.bottom === band.rows.bottom ? project : updateBand(project, id, { rows })
}

function isCentered(band: Band, width: number): boolean {
  if (band.once) return band.offsetX === centeredX(band, width)
  const period = bandTile(band).width + Math.max(0, band.gapX)
  const wrap = (n: number) => ((n % period) + period) % period
  return wrap(band.offsetX) === wrap(centeredX(band, width))
}

/**
 * Moves a band by whole stitches and rows. Banded rows move within the chart;
 * an all-over pattern shifts instead.
 */
export function moveBand(project: Project, id: string, dx: number, dy: number): Project {
  const band = project.bands.find((b) => b.id === id)
  if (!band || (dx === 0 && dy === 0)) return project
  const height = project.outline.height
  if (!band.rows) return updateBand(project, id, { offsetX: band.offsetX + dx, offsetY: band.offsetY - dy })
  const span = band.rows.bottom - band.rows.top
  const top = Math.min(height - 1 - span, Math.max(0, band.rows.top + dy))
  // A placed motif stays on the piece; repeats just shift along.
  const offsetX = band.once
    ? Math.min(project.outline.width - bandTile(band).width, Math.max(0, band.offsetX + dx))
    : band.offsetX + dx
  return updateBand(project, id, { offsetX, rows: { top, bottom: top + span } })
}

/** Moves one edge of a band to a row, keeping at least one row. */
export function setBandEdge(project: Project, id: string, edge: 'top' | 'bottom', row: number): Project {
  const band = project.bands.find((b) => b.id === id)
  // A placed motif is exactly as tall as its motif.
  if (!band?.rows || band.once) return project
  const clamped = Math.min(project.outline.height - 1, Math.max(0, row))
  const rows = edge === 'top'
    ? { top: Math.min(clamped, band.rows.bottom), bottom: band.rows.bottom }
    : { top: band.rows.top, bottom: Math.max(clamped, band.rows.top) }
  return rows.top === band.rows.top && rows.bottom === band.rows.bottom ? project : updateBand(project, id, { rows })
}
