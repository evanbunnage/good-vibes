import { describe, expect, it } from 'vitest'
import { centeredOffset, createBand, type Band } from '@/domain/bands'
import { getCell, gridFromRows, NONE } from '@/domain/grid'
import { builtInTemplate, rectangle } from '@/domain/pieces'
import { createProject, type Project } from '@/domain/project'
import { EditorStore } from './store'

function smallProject(bands: Band[] = [], width = 4, height = 3): Project {
  const project = createProject({ id: 'p', name: 'Test', template: builtInTemplate('swatch'), now: 0 })
  return { ...project, outline: rectangle(width, height), bands }
}

const dot = (rows: Band['rows'] = { top: 2, bottom: 2 }) => createBand('b', 'Dot', gridFromRows(['1'], { 1: 1 }), rows)

describe('EditorStore: arranging layers on the chart', () => {
  it('grabs the layer under the pointer and moves it, as one undo step', () => {
    const store = new EditorStore(smallProject([dot()]))
    store.pointerDown(1, 2)
    expect(store.getState().selectedBandId).toBe('b')
    store.pointerMove(1, 1)
    store.pointerMove(1, 0)
    expect(store.canUndo).toBe(false)
    store.pointerUp()
    expect(store.project.bands[0]!.rows).toEqual({ top: 0, bottom: 0 })
    store.undo()
    expect(store.project.bands[0]!.rows).toEqual({ top: 2, bottom: 2 })
  })

  it('shows only the long floats a layer makes while it’s moved', () => {
    const wide = (id: string, top: number) => createBand(id, id, gridFromRows(['1.........1'], { 1: 1, '.': 0 }), { top, bottom: top })
    const store = new EditorStore(smallProject([wide('c', 0), wide('b', 2)], 12, 4))
    const rows = (issues: ReadonlyArray<{ y: number }>) => [...new Set(issues.map((i) => i.y))].sort()
    expect(rows(store.issues())).toEqual([0, 2])
    store.pointerDown(5, 2)
    expect(store.getState().arranging).toBe('b')
    store.pointerMove(5, 1)
    // The other layer's row 0 floats are there all along: not the moved layer's doing.
    expect(rows(store.causedIssues())).toEqual([1])
    store.pointerUp()
    expect(store.getState().arranging).toBeNull()
    expect(store.causedIssues()).toEqual([])
  })

  it('selects the layer clicked on the chart', () => {
    const other = createBand('c', 'Other', gridFromRows(['2'], { 2: 2 }), { top: 0, bottom: 0 })
    const store = new EditorStore(smallProject([dot(), other]))
    store.pointerDown(1, 2)
    store.pointerUp()
    expect(store.getState().selectedBandId).toBe('b')
    store.pointerDown(1, 0)
    store.pointerUp()
    expect(store.getState().selectedBandId).toBe('c')
  })

  it('lets go of the selected layer when pressing off the piece', () => {
    const store = new EditorStore(smallProject([dot()]))
    store.selectLayer('b')
    store.pointerDown(9, 0)
    expect(store.getState().selectedBandId).toBeNull()
  })

  it('paints plain stitches into a painted layer, made on the first stroke, and erases with a right-click', () => {
    const store = new EditorStore(smallProject([dot()]))
    store.setYarn(2)
    // Row 0 is plain: pressing there paints, dragging along it paints a line.
    store.pointerDown(0, 0)
    store.pointerMove(2, 0)
    store.pointerUp()
    const painted = store.project.bands.find((b) => b.painted)!
    expect(store.getState().selectedBandId).toBe(painted.id)
    expect(store.project.bands.at(-1)).toBe(painted)
    const chart = () => [0, 1, 2, 3].map((x) => getCell(store.chart(), x, 0))
    expect(chart()).toEqual([2, 2, 2, 0])
    // Making the layer and the first stroke are one step.
    store.undo()
    expect(store.project.bands.some((b) => b.painted)).toBe(false)
    store.redo()
    // Selected, it paints anywhere, even over another layer; a right-click erases.
    store.selectLayer(painted.id)
    store.pointerDown(1, 2)
    store.pointerUp()
    expect(getCell(store.chart(), 1, 2)).toBe(2)
    store.pointerDown(1, 0, { secondary: true })
    store.pointerUp()
    expect(chart()).toEqual([2, 0, 2, 0])
    // The painted layer is never grabbed: pressing a painted stitch paints on.
    expect(store.hitTest(0, 0.5)).toBeNull()
  })

  it('picks the layer you can see at a stitch where layers overlap', () => {
    const under = createBand('under', 'Under', gridFromRows(['1'], { 1: 1 }), { top: 0, bottom: 2 })
    // The top layer only has stitches in its first column of every two.
    const over = createBand('over', 'Over', gridFromRows(['2-'], { 2: 2, '-': NONE }), { top: 0, bottom: 2 })
    const store = new EditorStore(smallProject([under, over]))
    expect(store.hitTest(0, 1.5)?.band.id).toBe('over')
    expect(store.hitTest(1, 1.5)?.band.id).toBe('under')
  })

  it("grabs the selected band's edge to change its rows", () => {
    const store = new EditorStore(smallProject([dot()]))
    store.selectLayer('b')
    expect(store.hitTest(0, 2.1)?.part).toBe('top')
    store.pointerDown(0, 2, { exactY: 2.1 })
    store.pointerMove(0, 0, 0.1)
    store.pointerUp()
    expect(store.project.bands[0]!.rows).toEqual({ top: 0, bottom: 2 })
  })

  it('drags the gap between repeats, keeping a centered band centered on a flat piece', () => {
    const band = { ...createBand('b', 'B', gridFromRows(['11'], { 1: 1 }), { top: 0, bottom: 2 }), offsetX: centeredOffset(12, 2, 1), gapX: 1 }
    const store = new EditorStore({ ...smallProject([band], 12), construction: 'flat' })
    store.selectLayer('b')
    const handle = store.spacingHandle()!
    store.pointerDown(Math.floor(handle.x), 1, { exactY: 1.5 })
    store.pointerMove(Math.floor(handle.x) + 2, 1)
    store.pointerUp()
    const moved = store.project.bands[0]!
    expect(moved.gapX).toBe(3)
    expect(moved.offsetX).toBe(centeredOffset(12, 2, 3))
  })

  it('puts the gap handle in the gap you see, blank motif columns included', () => {
    // Two stitches then a blank column: repeats at 0, 3, 6, 9 with no gap between.
    const band = createBand('b', 'B', gridFromRows(['11-'], { 1: 1, '-': NONE }), { top: 0, bottom: 2 })
    const store = new EditorStore(smallProject([band], 12))
    store.selectLayer('b')
    // The blank column is the gap: its middle is half a stitch in, and never on a stitch.
    expect(store.spacingHandle()!.x % 3).toBe(2.5)
  })

  it('puts a new layer in the free rows nearest the middle of the view, not on top of another', () => {
    const store = new EditorStore(smallProject([dot({ top: 5, bottom: 6 })], 4, 12))
    const rows = store.rowsForNewBand(2)
    // Clear of rows 5-6, with a row between.
    expect(rows.bottom < 4 || rows.top > 7).toBe(true)
    store.setVisibleRows(-5, 0)
    expect(store.rowsForNewBand(2)).toEqual({ top: 0, bottom: 1 })
  })
})

describe('EditorStore: drawing motifs', () => {
  const blank = () => createBand('b', 'B', gridFromRows(['--', '--'], { '-': NONE }), { top: 0, bottom: 1 })

  it('draws the selected layer motif in the motif window, and every repeat follows', () => {
    const store = new EditorStore(smallProject([blank()]))
    store.selectLayer('b')
    store.setYarn(2)
    store.motifPointerDown(1, 0)
    store.motifPointerMove(1, 1)
    store.pointerUp()
    expect([...store.project.bands[0]!.motif.cells]).toEqual([NONE, 2, NONE, 2])
    expect(getCell(store.chart(), 3, 0)).toBe(2)
    store.undo()
    expect([...store.project.bands[0]!.motif.cells]).toEqual([NONE, NONE, NONE, NONE])
  })

  it('erases with the eraser, or with a right-click whatever the tool', () => {
    const store = new EditorStore(smallProject([createBand('b', 'B', gridFromRows(['11'], { 1: 1 }), { top: 0, bottom: 0 })]))
    store.selectLayer('b')
    store.motifPointerDown(0, 0, { secondary: true })
    store.pointerUp()
    store.setMotifTool('eraser')
    store.motifPointerDown(1, 0)
    store.pointerUp()
    expect([...store.project.bands[0]!.motif.cells]).toEqual([NONE, NONE])
    // Choosing a yarn means drawing with it.
    store.chooseYarn(3)
    expect(store.getState().motifTool).toBe('brush')
  })

  it('recolors a layer color with the next yarn chosen, without changing the brush', () => {
    const store = new EditorStore(smallProject([createBand('b', 'B', gridFromRows(['1-'], { 1: 1, '-': NONE }), { top: 0, bottom: 0 })]))
    store.setYarn(2)
    store.recolor('b', 1)
    store.chooseYarn(3)
    expect([...store.project.bands[0]!.motif.cells]).toEqual([3, NONE])
    expect(store.getState()).toMatchObject({ yarn: 2, recoloring: null })
    store.chooseYarn(1)
    expect(store.getState().yarn).toBe(1)
  })
})

describe('EditorStore: history and state', () => {
  it('turns a live preview and its commit into one undo step', () => {
    const store = new EditorStore(smallProject([dot(null)]))
    for (const gapX of [1, 2, 3]) store.preview((p) => ({ ...p, bands: p.bands.map((b) => ({ ...b, gapX })) }))
    expect(store.project.bands[0]!.gapX).toBe(3)
    expect(store.canUndo).toBe(false)
    store.update((p) => ({ ...p, bands: p.bands.map((b) => ({ ...b, gapX: 3 })) }))
    expect(store.getState().draft).toBeNull()
    store.undo()
    expect(store.project.bands[0]!.gapX).toBe(0)
    store.preview((p) => ({ ...p, bands: p.bands.map((b) => ({ ...b, gapX: 5 })) }))
    store.cancelPreview()
    expect(store.project.bands[0]!.gapX).toBe(0)
  })

  it('keeps quiet updates out of undo history', () => {
    const store = new EditorStore(smallProject())
    store.updateQuietly((p) => ({ ...p, size: 1 }))
    expect(store.project.size).toBe(1)
    expect(store.canUndo).toBe(false)
  })

  it('lets go of a layer that is deleted, or undone away', () => {
    const store = new EditorStore(smallProject())
    store.update((p) => ({ ...p, bands: [dot()] }))
    store.selectLayer('b')
    store.undo()
    expect(store.getState().selectedBandId).toBeNull()
  })

  it('shows a problem row, and draws out the floats on a row pointed at', () => {
    const store = new EditorStore(smallProject())
    store.showIssueRow(2)
    store.peekAtRow(1)
    expect(store.getState()).toMatchObject({ issueRow: 2, peekRow: 1 })
    store.toggleFloats()
    expect(store.getState().showingFloats).toBe(true)
  })
})

describe('EditorStore: scaling a motif by its corners', () => {
  // A 2 × 2 motif placed once, at stitches 2–3 and rows 4–5 of a 10 × 10 chart.
  const placed = () => ({ ...createBand('m', 'Motif', gridFromRows(['12', '21'], { 1: 1, 2: 2 }), { top: 4, bottom: 5 }), once: true, offsetX: 2 })

  it('scales a placed motif as its corner is dragged, keeping the opposite corner put', () => {
    const store = new EditorStore(smallProject([placed()], 10, 10))
    store.selectLayer('m')
    expect(store.scaleHandle()).toEqual({ x: 2, y: 4, width: 2, height: 2 })
    // The bottom-right corner, dragged out to 1.5× across (3 stitches) and down.
    expect(store.hitTest(4, 6, 0.3, 4.1, 0.3)?.part).toBe('bottom-right')
    expect(store.hitTest(3, 5, 0.3, 3.5, 0.3)?.part).toBe('body')
    store.pointerDown(4, 6, { exactX: 4, exactY: 6 })
    store.pointerMove(5, 7, 7, 5)
    store.pointerUp()
    const band = store.project.bands[0]!
    expect(band.scale).toBe(1.5)
    expect({ offsetX: band.offsetX, rows: band.rows }).toEqual({ offsetX: 2, rows: { top: 4, bottom: 6 } })
    // Dragging the top-left corner out keeps the bottom-right where it is.
    store.pointerDown(2, 4, { exactX: 2, exactY: 4 })
    store.pointerMove(0, 2, 2, 0)
    store.pointerUp()
    const larger = store.project.bands[0]!
    expect(larger.scale).toBe(2.5)
    expect({ offsetX: larger.offsetX, rows: larger.rows }).toEqual({ offsetX: 0, rows: { top: 2, bottom: 6 } })
    // One undo step each.
    store.undo()
    expect(store.project.bands[0]!.scale).toBe(1.5)
  })

  it("doesn't go below the motif's own size", () => {
    const store = new EditorStore(smallProject([placed()], 10, 10))
    store.selectLayer('m')
    store.pointerDown(4, 6, { exactX: 4, exactY: 6 })
    store.pointerMove(3, 5, 5, 3)
    store.pointerUp()
    expect(store.project.bands[0]!.scale ?? 1).toBe(1)
  })

  it('scales a layer in rows by its outline: dragged taller, its repeats knit larger', () => {
    // A 2-stitch, 2-row motif repeated across rows 6–7 of a 10 × 10 chart.
    const band = createBand('r', 'Row', gridFromRows(['12', '21'], { 1: 1, 2: 2 }), { top: 6, bottom: 7 })
    const store = new EditorStore(smallProject([band], 10, 10))
    store.selectLayer('r')
    expect(store.scaleHandle()).toEqual({ x: 0, y: 6, width: 10, height: 2 })
    // The top-right corner, dragged up two rows: twice as tall, so 2×, growing up from the bottom edge.
    store.pointerDown(9, 6, { exactX: 10, exactY: 6 })
    store.pointerMove(9, 4, 4, 10)
    store.pointerUp()
    expect(store.project.bands[0]).toMatchObject({ scale: 2, rows: { top: 4, bottom: 7 } })
  })

  it("doesn't grab a layer tiled over the whole piece: it's a background, changed in its window", () => {
    const tiled = createBand('t', 'Tiled', gridFromRows(['1'], { 1: 1 }), null)
    const store = new EditorStore(smallProject([tiled, dot()]))
    expect(store.hitTest(1, 0.5)).toBeNull()
    expect(store.hitTest(1, 2.5)?.band.id).toBe('b')
    store.selectLayer('t')
    expect([store.scaleHandle(), store.spacingHandle()]).toEqual([null, null])
  })
})

describe('EditorStore: the brush is what was picked last', () => {
  it('paints the picked stitch, keeping the colors, until a yarn is picked again', () => {
    const store = new EditorStore(smallProject([]))
    store.setStitch(1)
    expect(store.getState()).toMatchObject({ brush: 'stitch', showingStitches: true })
    store.pointerDown(0, 0)
    store.pointerMove(2, 0)
    store.pointerUp()
    expect([0, 1, 2, 3].map((x) => store.stitches()?.cells[x])).toEqual([1, 1, 1, 0])
    // Only stitches were painted: the colors are still the main color.
    expect([0, 1, 2].map((x) => getCell(store.chart(), x, 0))).toEqual([0, 0, 0])
    // Hiding the symbols doesn't change what painting does; picking a yarn does.
    store.toggleStitches()
    expect(store.getState().brush).toBe('stitch')
    store.chooseYarn(2)
    store.pointerDown(3, 0)
    store.pointerUp()
    expect([getCell(store.chart(), 3, 0), store.getState().brush]).toEqual([2, 'yarn'])
  })
})

describe('EditorStore: dismissing a row\'s floats', () => {
  it('hides the row until its floats change, and the agent still sees it', async () => {
    const { dismissFloats } = await import('@/domain/edits')
    // Madder at each end of a 12-stitch row: a 10-stitch float of the main color between.
    const ends = createBand('e', 'Ends', gridFromRows(['2..........2'], { 2: 2, '.': NONE }), { top: 1, bottom: 1 })
    const store = new EditorStore({ ...smallProject([ends], 12, 3), floatRules: { maxFloat: 5, maxFloatCm: 1 } })
    expect(store.issues().length).toBeGreaterThan(0)
    const row = store.issues().filter((i) => i.y === 1)
    store.update((p) => dismissFloats(p, 1, row))
    expect(store.issues().filter((i) => i.y === 1)).toEqual([])
    expect(store.allIssues().filter((i) => i.y === 1).length).toBe(row.length)
    // The row changes, and still floats long (a 6-stitch float now): it's flagged again.
    store.update((p) => ({ ...p, bands: [{ ...p.bands[0]!, motif: gridFromRows(['2......2....'], { 2: 2, '.': NONE }) }] }))
    expect(store.issues().filter((i) => i.y === 1).length).toBeGreaterThan(0)
  })
})

