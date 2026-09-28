
import { describe, expect, it } from 'vitest'
import { applyBand, bandTiles, centeredOffset, createBand, motifCellAt, nextBandRows, scaledMotif, type Band } from './bands'
import { drawMotif, duplicateBand, moveBand, recolorBand, reorderBand, setBandEdge, setPlacement, setScale } from './edits'
import { getCell, gridFromRows, NONE, type Grid } from './grid'
import { checkVersion } from './version'
import { composeChart, stitchedOn, createProject, SCHEMA_VERSION } from './project'
import { orient, type Rotation } from './transform'
import { builtInTemplate } from './pieces'

const chart = (...rows: string[]) => gridFromRows(rows, { '-': NONE, 0: 0, 1: 1, 2: 2, 3: 3 })
const rowsOf = (grid: Grid) =>
  Array.from({ length: grid.height }, (_, y) =>
    Array.from({ length: grid.width }, (_, x) => (getCell(grid, x, y) === NONE ? '-' : String(getCell(grid, x, y)))).join(''),
  )
const stamp = (target: Grid, band: Band) => {
  applyBand(target, target, band)
  return rowsOf(target)
}

describe('pattern bands', () => {
  it('tiles a motif across its rows, starting on the band\'s bottom row', () => {
    // The motif's bottom row (blank) sits on the band's bottom row (2), so its dots land on row 1.
    const band = createBand('b', 'Dot', chart('1-', '--'), { top: 1, bottom: 2 })
    expect(stamp(chart('0000', '0000', '0000', '0000'), band)).toEqual(['0000', '1010', '0000', '0000'])
  })

  it('repeats over the whole chart when the band has no rows', () => {
    expect(stamp(chart('000', '000'), createBand('b', 'Dot', chart('1'), null))).toEqual(['111', '111'])
  })

  it('skips transparent motif cells and cells outside the outline', () => {
    expect(stamp(chart('00', '--'), createBand('b', 'Dot', chart('1'), null))).toEqual(['11', '--'])
  })

  it('spaces repeats and shifts them, including before the edge', () => {
    const band = { ...createBand('b', 'Dot', chart('1'), null), gapX: 1, offsetX: -1 }
    expect(stamp(chart('0000'), band)).toEqual(['0101'])
  })

  it('shifts rows up from the band\'s bottom with offsetY', () => {
    const band = { ...createBand('b', 'Dot', chart('1'), { top: 0, bottom: 2 }), gapY: 2, offsetY: 1 }
    expect(stamp(chart('0', '0', '0'), band)).toEqual(['0', '1', '0'])
  })

  it('maps every chart stitch back to the motif cell it shows, in all eight orientations', () => {
    const motif = chart('012', '3--')
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const mirror of [false, true]) {
        const band = { ...createBand('b', 'M', motif, null), rotation, mirror }
        const tile = orient(motif, band)
        const target = chart(...Array.from({ length: tile.height }, () => '0'.repeat(tile.width)))
        applyBand(target, target, band)
        for (let y = 0; y < tile.height; y++) {
          for (let x = 0; x < tile.width; x++) {
            const cell = motifCellAt(band, x, y, tile.height)!
            const source = getCell(motif, cell.x, cell.y)
            expect(getCell(target, x, y)).toBe(source === NONE ? 0 : source)
          }
        }
      }
    }
  })

  it('outlines each repeat, clipped to the band', () => {
    const band = { ...createBand('b', 'M', chart('11', '11'), { top: 1, bottom: 2 }), gapX: 1 }
    expect(bandTiles(band, 6, 4)).toEqual([
      { x: 0, y: 1, width: 2, height: 2 },
      { x: 3, y: 1, width: 2, height: 2 },
    ])
  })

  it('centers whole repeats', () => {
    expect(centeredOffset(10, 3, 0)).toBe(0)
    expect(centeredOffset(11, 3, 1)).toBe(0)
    expect(centeredOffset(13, 3, 1)).toBe(1)
  })

  it('places new bands above the highest band, or near the bottom of an empty chart', () => {
    expect(nextBandRows([], 50, 5)).toEqual({ top: 41, bottom: 45 })
    const existing = createBand('a', 'A', chart('1'), { top: 30, bottom: 35 })
    expect(nextBandRows([existing], 50, 5)).toEqual({ top: 23, bottom: 27 })
    expect(nextBandRows([createBand('a', 'A', chart('1'), { top: 2, bottom: 5 })], 50, 5)).toEqual({ top: 45, bottom: 49 })
  })
})

describe('moving bands', () => {
  const project = () => ({
    ...createProject({ id: 'p', name: 'P', template: builtInTemplate('swatch'), now: 0 }),
    bands: [createBand('b', 'B', chart('1'), { top: 10, bottom: 12 }), createBand('all', 'All', chart('1'), null)],
  })

  it('moves a band between rows, keeping it on the chart', () => {
    const moved = moveBand(project(), 'b', 2, -3).bands[0]!
    expect(moved.rows).toEqual({ top: 7, bottom: 9 })
    expect(moved.offsetX).toBe(2)
    expect(moveBand(project(), 'b', 0, -100).bands[0]!.rows).toEqual({ top: 0, bottom: 2 })
  })

  it('shifts an all-over pattern instead of moving rows', () => {
    const moved = moveBand(project(), 'all', 0, 2).bands[1]!
    expect([moved.rows, moved.offsetY]).toEqual([null, -2])
  })

  it('moves one edge, never past the other', () => {
    expect(setBandEdge(project(), 'b', 'top', 5).bands[0]!.rows).toEqual({ top: 5, bottom: 12 })
    expect(setBandEdge(project(), 'b', 'bottom', 2).bands[0]!.rows).toEqual({ top: 10, bottom: 10 })
  })
})

describe('reading stored projects', () => {
  it('reads only the current form', () => {
    const current = createProject({ id: 'p', name: 'P', template: builtInTemplate('swatch'), now: 0 })
    expect(checkVersion(current)).toBe(current)
    expect(() => checkVersion({ ...current, schemaVersion: SCHEMA_VERSION - 1 })).toThrow(/old form/)
    expect(() => checkVersion({ schemaVersion: 99 })).toThrow(/newer version/)
  })
})

describe('placed motifs', () => {
  const piece = () => ({
    ...createProject({ id: 'p', name: 'P', template: builtInTemplate('swatch'), now: 0 }),
    outline: chart('000000', '000000', '000000', '000000'),
  })
  const dot = () => createBand('b', 'Dot', chart('1-', '11'), { top: 0, bottom: 3 })

  it('places one copy, centered, in rows of its own height', () => {
    const placed = setPlacement({ ...piece(), bands: [dot()] }, 'b', 'single', { top: 0, bottom: 3 })
    expect(placed.bands[0]!.rows).toEqual({ top: 2, bottom: 3 })
    expect(rowsOf(composeChart(placed))).toEqual(['000000', '000000', '001000', '001100'])
  })

  it('stays on the piece when moved', () => {
    const placed = setPlacement({ ...piece(), bands: [dot()] }, 'b', 'single', { top: 0, bottom: 3 })
    expect(moveBand(placed, 'b', 10, -5).bands[0]).toMatchObject({ offsetX: 4, rows: { top: 0, bottom: 1 } })
  })

  it('is stitched on after knitting unless knitted in, and left out of the knitted chart', () => {
    const placed = setPlacement({ ...piece(), bands: [dot()] }, 'b', 'single', { top: 0, bottom: 3 })
    expect(placed.bands[0]!.afterKnitting).toBe(true)
    const knittedIn = { ...placed, bands: placed.bands.map((b) => ({ ...b, afterKnitting: false })) }
    expect(rowsOf(composeChart(placed))).toEqual(rowsOf(composeChart(knittedIn)))
    expect(rowsOf(composeChart(placed, { knitted: true }))).toEqual(['000000', '000000', '000000', '000000'])
    expect(setPlacement(placed, 'b', 'band', { top: 0, bottom: 3 }).bands[0]!.afterKnitting).toBe(false)
  })

  it('lists what to stitch on after knitting, and where', () => {
    const placed = setPlacement({ ...piece(), bands: [dot()] }, 'b', 'single', { top: 0, bottom: 3 })
    const { grid, motifs } = stitchedOn(placed)
    expect(motifs).toMatchObject([{ left: 2, right: 4, top: 2, bottom: 3 }])
    expect(rowsOf(grid).map((r) => r.replace(/[^1]/g, '-'))).toEqual(['------', '------', '--1---', '--11--'])
  })
})

describe('colorwork layers', () => {
  const piece = () => ({
    ...createProject({ id: 'p', name: 'P', template: builtInTemplate('swatch'), now: 0 }),
    outline: chart('0000', '0000', '0000'),
  })

  it('recolors a layer: every stitch of one yarn becomes another', () => {
    const project = { ...piece(), bands: [createBand('b', 'B', chart('12', '1-'), { top: 0, bottom: 1 })] }
    expect(rowsOf(recolorBand(project, 'b', 1, 3).bands[0]!.motif)).toEqual(['32', '3-'])
  })

  it('reorders layers, later ones drawn on top', () => {
    const under = createBand('under', 'Under', chart('1'), { top: 0, bottom: 0 })
    const over = createBand('over', 'Over', chart('2'), { top: 0, bottom: 0 })
    const project = { ...piece(), bands: [under, over] }
    expect(rowsOf(composeChart(project))[0]).toBe('2222')
    expect(rowsOf(composeChart(reorderBand(project, 'over', 0)))[0]).toBe('1111')
  })

  it('duplicates a layer just above it, in other rows', () => {
    const project = { ...piece(), bands: [createBand('b', 'B', chart('1'), { top: 0, bottom: 0 })] }
    const next = duplicateBand(project, 'b', 'c', { top: 2, bottom: 2 })
    expect(next.bands.map((b) => [b.id, b.rows])).toEqual([['b', { top: 0, bottom: 0 }], ['c', { top: 2, bottom: 2 }]])
    expect(next.bands[1]!.name).toBe('B copy')
  })
})

describe('scaling a motif', () => {
  const piece = () => ({ ...createProject({ id: 'p', name: 'P', template: builtInTemplate('swatch'), now: 0 }), outline: chart('000000', '000000', '000000', '000000') })
  const corner = () => ({ ...createBand('b', 'B', chart('1-', '--'), { top: 2, bottom: 3 }), once: true })

  it('knits each motif stitch as a block, keeping the motif itself, so scaling back down is exact', () => {
    const project = { ...piece(), bands: [corner()] }
    const doubled = setScale(project, 'b', 2)
    expect(doubled.bands[0]!.rows).toEqual({ top: 0, bottom: 3 })
    expect(rowsOf(composeChart(doubled))).toEqual(['110000', '110000', '000000', '000000'])
    expect(rowsOf(doubled.bands[0]!.motif)).toEqual(['1-', '--'])
    const back = setScale(doubled, 'b', 1)
    expect(rowsOf(composeChart(back))).toEqual(rowsOf(composeChart(project)))
  })

  it('maps a stitch on a scaled repeat to its stitch in the scaled motif', () => {
    const band = { ...createBand('b', 'B', chart('12', '30'), { top: 0, bottom: 3 }), scale: 2 }
    expect(motifCellAt(band, 3, 0, 4)).toEqual({ x: 3, y: 0 })
    expect(motifCellAt(band, 1, 3, 4)).toEqual({ x: 1, y: 3 })
  })

  it('draws finer detail at a larger scale, kept for that scale when scaling down and back up', () => {
    const doubled = setScale({ ...piece(), bands: [corner()] }, 'b', 2)
    const fine = scaledMotif(doubled.bands[0]!)
    const detailed = drawMotif(doubled, 'b', { ...fine, cells: fine.cells.map((c, i) => (i === 5 ? NONE : c)) })
    expect(rowsOf(composeChart(detailed))).toEqual(['110000', '100000', '000000', '000000'])
    // The motif at 1× is untouched; the detail comes back at 2×.
    const back = setScale(detailed, 'b', 1)
    expect(rowsOf(composeChart(back))).toEqual(rowsOf(composeChart({ ...piece(), bands: [corner()] })))
    expect(rowsOf(composeChart(setScale(back, 'b', 2)))).toEqual(rowsOf(composeChart(detailed)))
  })

  it('carries a change at 1× into finer drawings as a block, keeping their other detail', () => {
    const doubled = setScale({ ...piece(), bands: [corner()] }, 'b', 2)
    const fine = scaledMotif(doubled.bands[0]!)
    const detailed = setScale(drawMotif(doubled, 'b', { ...fine, cells: fine.cells.map((c, i) => (i === 5 ? NONE : c)) }), 'b', 1)
    // Fill the bottom-right motif stitch at 1×.
    const base = detailed.bands[0]!.motif
    const filled = setScale(drawMotif(detailed, 'b', { ...base, cells: base.cells.map((c, i) => (i === 3 ? 1 : c)) }), 'b', 2)
    expect(rowsOf(scaledMotif(filled.bands[0]!))).toEqual(['11--', '1---', '--11', '--11'])
  })
})


describe('scaling a motif by fractions', () => {
  it('doubles some stitches evenly at 1.5×, and blocks them at whole scales', async () => {
    const { scaleUp } = await import('./bands')
    const { gridFromRows } = await import('./grid')
    const motif = gridFromRows(['ab', 'cd'], { a: 0, b: 1, c: 2, d: 3 })
    const rows = (g: { width: number; height: number; cells: Uint8Array }) =>
      Array.from({ length: g.height }, (_, y) => Array.from(g.cells.slice(y * g.width, (y + 1) * g.width)).join(''))
    expect(rows(scaleUp(motif, 2))).toEqual(['0011', '0011', '2233', '2233'])
    expect(rows(scaleUp(motif, 1.5))).toEqual(['001', '001', '223'])
  })

  it('rounds the scale to tenths', async () => {
    const { setScale } = await import('./edits')
    const { createBand } = await import('./bands')
    const { createGrid } = await import('./grid')
    const { createProject } = await import('./project')
    const project = { ...createProject({ id: 'p', name: 'P', now: 0 }), bands: [createBand('b', 'B', createGrid(14, 4, 1), { top: 0, bottom: 3 })] }
    const scaled = setScale(project, 'b', 1.4999)
    expect(scaled.bands[0]!.scale).toBe(1.5)
    const { bandTile } = await import('./bands')
    expect(bandTile(scaled.bands[0]!).width).toBe(21)
  })
})
