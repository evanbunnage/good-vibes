import { describe, expect, it } from 'vitest'
import { NONE } from '@/domain/grid'
import { rowRuns } from '@/domain/numbering'
import { PURL, workedAs } from '@/domain/stitches'
import { ribRows } from '@/domain/pieces'
import { composeChart, composeStitches, createProject } from '@/domain/project'
import { EditorStore } from '@/editor/store'
import { QueryClient } from '@tanstack/react-query'
import type { Project } from '@/domain/project'
import type { SavedMotif } from '@/domain/saved-motifs'
import { summarize, type ProjectRepository } from '@/data/repository'
import { agentTools, type LibraryAccess } from './tools'
import { appTools } from './app-tools'
import { publishedPattern } from '@/domain/published-patterns.fixture'

/** The knitter's saved motifs, in memory. */
function memoryLibrary() {
  const saved = new Map<string, SavedMotif>()
  let changes = 0
  const library: LibraryAccess = {
    motifs: async () => [...saved.values()],
    putMotif: async (m) => void saved.set(m.id, m),
    removeMotif: async (id) => void saved.delete(id),
    changed: () => void changes++,
  }
  return { library, saved, changes: () => changes }
}

function setup(library?: LibraryAccess) {
  const template = publishedPattern('hat')
  const store = new EditorStore(createProject({ id: 'p', name: 'Test', template, gauge: template.gauge, now: 0 }))
  const tools = agentTools(store, library)
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const result = await tools.find((t) => t.name === name)!.execute(input)
    const first = result.content[0]!
    return { text: first.type === 'text' ? first.text : '', error: result.isError ?? false }
  }
  return { store, call }
}

describe('agent tools', () => {
  it("puts a chart read from a pattern on the piece, in the knitter's yarns", async () => {
    const { store, call } = setup()
    await call('set-yarns', { yarns: [{ yarn: 'Charcoal', name: 'Canary', hex: '#f2cf1d' }] })
    const added = await call('add-layer', { name: 'Chart A', rows: ['.X..', 'X.X.', '.X..'], key: { '.': 'main', X: 'Canary' }, placement: 'row', bottomRow: 13 })
    expect(added.text).toContain('rounds 13–15')
    // Knitted row 14 (the chart's middle row) has Canary on stitches 1 and 3 of every repeat, from the left as drawn.
    const { width, height } = store.project.outline
    const chart = composeChart(store.project)
    const y = height - 14
    const canary = store.project.yarns.findIndex((yarn) => yarn.name === 'Canary')
    const row = Array.from({ length: width }, (_, x) => chart.cells[y * width + x] === canary)
    expect(row.filter(Boolean)).toHaveLength((width / 4) * 2)
  })

  it('explains what to fix when a chart is written wrong', async () => {
    const { call } = setup()
    // Errors that point at what's wrong: which rows, which key, which layer. (The facts, not the wording.)
    const uneven = await call('add-layer', { name: 'A', rows: ['.X', 'X'], key: { '.': 'main', X: 'Charcoal' }, placement: 'row' })
    expect(uneven.error).toBe(true)
    expect(uneven.text).toContain('row 2: 2, row 1: 1')
    const unkeyed = await call('add-layer', { name: 'A', rows: ['.Z'], key: { '.': 'main' }, placement: 'row' })
    expect([unkeyed.error, unkeyed.text.includes('"Z"')]).toEqual([true, true])
    const missing = await call('update-layer', { layer: 'Nope' })
    expect([missing.error, missing.text.includes('"Nope"')]).toEqual([true, true])
  })

  it('moves and recolors a layer', async () => {
    const { store, call } = setup()
    await call('add-layer', { name: 'B', rows: ['XO'], key: { X: 'Charcoal', O: 'Madder' }, placement: 'row', bottomRow: 5 })
    const moved = await call('update-layer', { layer: 'b', bottomRow: 20, rows: 4, recolor: { from: 'Madder', to: 'Indigo' } })
    expect(moved.text).toMatch(/tiled over rounds 20–23/)
    expect([...new Set(store.project.bands[0]!.motif.cells)].sort()).toEqual([1, 3])
  })

  it('knits purl stitches from the key, and reads them back', async () => {
    const { store, call } = setup()
    // A seed-stitch band in the main color, with a Madder stitch purled: above the hem's rib, which is purled too.
    await call('add-layer', { name: 'Seed', rows: ['.-', '-M'], key: { '.': 'main', '-': 'main purl', M: 'Madder purl' }, placement: 'row', bottomRow: 30 })
    const stitches = composeStitches(store.project)!
    const { width, height } = store.project.outline
    // Four stitches from the middle, in from the brim's shaping.
    const middle = width / 2
    const at = (row: number) => Array.from(stitches.cells.slice((height - row) * width + middle, (height - row) * width + middle + 4))
    // The chart's bottom row is all purls; the one above alternates.
    expect(at(30)).toEqual([1, 1, 1, 1])
    expect(at(31).join('')).toMatch(/^(0101|1010)$/)
    // Runs keep each stitch as charted, in the round or flat; worked from the wrong side, a charted purl is knitted.
    const purled = (construction: 'round' | 'flat') => rowRuns(composeChart(store.project), height - 31, construction, 1, stitches)
      .reduce((n, r) => n + (r.kind === 'stitches' && r.stitch === PURL ? r.count : 0), 0)
    const charted = Array.from(stitches.cells.slice((height - 31) * width, (height - 30) * width)).filter((c) => c === PURL).length
    expect([purled('round'), purled('flat')]).toEqual([charted, charted])
    expect([workedAs(PURL, true), workedAs(PURL, false), workedAs(2, false)]).toEqual(['p', 'k', 'p1 tbl'])
    const pattern = JSON.parse((await call('get-chart')).text)
    expect(pattern.layers[0]).toEqual(expect.objectContaining({ chart: ['.-', '-m'], key: { '.': 'main', '-': 'main purl', m: 'Madder purl' } }))
  })

  it('leaves the stitches alone when nothing is purled, but the rib', async () => {
    const { store, call } = setup()
    await call('add-layer', { name: 'A', rows: ['X.'], key: { '.': 'main', X: 'Madder' }, placement: 'row' })
    const stitches = composeStitches(store.project)!
    const { width, height } = store.project.outline
    // The hem's rib is k1, p1; above it, everything is knit.
    const ribTop = Math.max(...ribRows(store.project.piece, store.project.gauge, store.project.construction).map((r) => r.to))
    expect(ribTop).toBeGreaterThan(0)
    const purledRows = new Set<number>()
    stitches.cells.forEach((c, i) => {
      if (c === PURL) purledRows.add(height - Math.floor(i / width))
    })
    expect(Math.max(...purledRows)).toBeLessThanOrEqual(ribTop)
    // Written as the rib it is.
    const rows = (await call('get-written-rows', { from: 1, to: 1 })).text
    expect(rows).toMatch(/k1 MC, p1 MC|k1, p1/)
  })

  it("shapes a piece from a pattern's stitch counts, and says where a repeat won't go evenly around", async () => {
    const { store, call } = setup()
    // The Classic's yoke, size 1: 136 stitches, 336 after 40 rounds, 348 after 43.
    const shaped = await call('shape-piece', {
      name: 'Yoke', worked: 'round', gauge: { stitches: 21, rows: 28, over: 10 },
      shape: [{ row: 0, stitches: 136 }, { row: 40, stitches: 336 }, { row: 43, stitches: 348 }],
    })
    expect(shaped.error).toBe(false)
    const { outline } = store.project
    const count = (row: number) => Array.from(outline.cells.slice((outline.height - row) * outline.width, (outline.height - row + 1) * outline.width)).filter((c) => c !== 255).length
    expect([outline.height, count(1), count(43)]).toEqual([43, 136, 348])
    const added = await call('add-layer', { name: 'Violets', rows: ['AAAAAA'], key: { A: 'Charcoal' }, placement: 'row', bottomRow: 1 })
    // It says where the repeat breaks: round 1, at 136 stitches.
    expect(added.text).toContain('136 sts')
    const colorway = await call('set-yarns', { yarns: [{ yarn: 'Natural', name: 'B', hex: '#b8b4d8', main: true }, { name: 'F', hex: '#f1e3b0' }] })
    expect(colorway.error).toBe(false)
    expect(store.project.yarns[store.project.background]).toMatchObject({ name: 'B', hex: '#b8b4d8' })
    expect(store.project.yarns.at(-1)).toMatchObject({ name: 'F', hex: '#f1e3b0' })
    // One step to undo the whole colorway.
    store.undo()
    expect(store.project.yarns.map((y) => y.name)).not.toContain('F')
  })

  it("makes every size a pattern gives, reports each, and switches between them", async () => {
    const { store, call } = setup()
    const made = await call('shape-piece', {
      name: 'Yoke', worked: 'round', gauge: { stitches: 21, rows: 28, over: 10 },
      sizes: [
        { name: '1', shape: [{ row: 0, stitches: 136 }, { row: 43, stitches: 348 }] },
        { name: '2', shape: [{ row: 0, stitches: 138 }, { row: 47, stitches: 368 }] },
      ],
    })
    expect(made.error).toBe(false)
    expect(store.project.sizes?.map((s) => s.name)).toEqual(['1', '2'])
    await call('add-layer', { name: 'Six', rows: ['AAAAAA'], key: { A: 'Charcoal' }, placement: 'row', bottomRow: 1 })
    const chart = JSON.parse((await call('get-chart')).text)
    // 136 isn't a multiple of 6, 138 is.
    expect(chart.sizes).toEqual([
      expect.objectContaining({ name: '1', shown: true, stitches: 348, rows: 43, repeatBreaksIn: ['Six'] }),
      expect.objectContaining({ name: '2', stitches: 368, rows: 47 }),
    ])
    expect(chart.sizes[1].repeatBreaksIn).toBeUndefined()
    await call('update-chart', { size: '2' })
    expect([store.project.size, store.project.outline.height]).toEqual([1, 47])
    expect((await call('update-chart', { size: 'XL' })).error).toBe(true)
  })

  it('reads stitches from a chart key, with or without a yarn, and writes them back the same way', async () => {
    const { store, call } = setup()
    await call('set-yarns', { yarns: [{ yarn: 'Madder', name: 'Spanish Coin' }] })
    const added = await call('add-layer', {
      name: 'Waves', placement: 'tile',
      rows: ['.-Q/', 'M\\PB'],
      key: { '.': 'main', '-': 'purl', Q: 'k1 tbl', '/': 'k2tog', M: 'M1', '\\': 'ssk', P: 'Spanish Coin M1 p-st', B: 'Charcoal bobble' },
    })
    expect(added.error).toBe(false)
    const band = store.project.bands[0]!
    expect(Array.from(band.stitches!.cells)).toEqual([0, 1, 2, 4, 6, 5, 7, 9])
    const layer = JSON.parse((await call('get-chart')).text).layers[0]
    // Written back readably: "." main, "-" a purl in it, other stitches the next spare letters.
    expect(layer.chart).toEqual(['.-XO', 'ABCD'])
    expect(layer.key).toEqual({ '.': 'main', '-': 'main purl', X: 'main k1 tbl', O: 'main k2tog', A: 'main M1', B: 'main ssk', C: 'Spanish Coin M1 p-st', D: 'Charcoal bobble' })
    expect((await call('add-layer', { name: 'Bad', placement: 'tile', rows: ['z'], key: { z: 'k3tog' } })).text).toMatch(/isn't a yarn or a stitch/)
    // A misread fixed in place.
    await call('update-layer', { layer: 'Waves', chart: { rows: ['-'], key: { '-': 'purl' } } })
    expect(Array.from(store.project.bands[0]!.stitches!.cells)).toEqual([1])
  })

  it('takes yarns from their ball bands, and says how many skeins the chart takes', async () => {
    const { store, call } = setup()
    const set = await call('set-yarns', { yarns: [
      { yarn: 'Natural', brand: 'Jamieson’s Spindrift', weight: 'Fingering', fiber: '100% Shetland wool', yards: 115, grams: 25 },
      { yarn: 'Charcoal', meters: 105, grams: 25 },
    ] })
    expect(set.error).toBe(false)
    expect(store.project.yarns[0]).toMatchObject({ brand: 'Jamieson’s Spindrift', weight: 'fingering', fiber: '100% Shetland wool', gramsPerSkein: 25 })
    // Yards become meters.
    expect(store.project.yarns[0]!.metersPerSkein).toBeCloseTo(105.156, 3)
    await call('add-layer', { name: 'Dots', rows: ['X...'], key: { '.': 'main', X: 'Charcoal' }, placement: 'tile' })
    // What it reports is the store's estimate: skeins where the ball band's given.
    expect((await call('estimate-yarn')).error).toBe(false)
    const [natural, charcoal] = store.estimate().yarns
    expect([natural!.skeins, charcoal!.floatStitches > 0, store.estimate().fromSwatch]).toEqual([2, true, false])
    // A detail cleared, and a weight that isn't one.
    await call('set-yarns', { yarns: [{ yarn: 'Natural', fiber: null }] })
    expect(store.project.yarns[0]!.fiber).toBeUndefined()
    expect((await call('set-yarns', { yarns: [{ yarn: 'Natural', weight: 'heavy' }] })).error).toBe(true)
    // A weighed swatch, once every yarn in the chart has a ball band.
    await call('update-chart', { swatch: { width: 15, height: 15, grams: 9 } })
    expect(store.project.swatch).toEqual({ widthCm: 15, heightCm: 15, grams: 9 })
    expect(store.estimate().fromSwatch).toBe(true)
  })

  it('writes rows out, paints single stitches, ignores floats, reorders layers, and undoes', async () => {
    const { store, call } = setup()
    await call('add-layer', { name: 'Dots', rows: ['X...'], key: { '.': 'main', X: 'Charcoal' }, placement: 'row', bottomRow: 1 })
    const written = (await call('get-written-rows', { from: 1, to: 2 })).text
    expect(written).toContain('MC = Natural')
    expect(written).toContain('CC = Charcoal')
    expect(written.split('\n').filter((l) => /^Rnd \d+:/.test(l))).toHaveLength(2)

    // Row 5, the middle stitch, in Madder, purled. (Stitches count from the right edge.)
    const { width, height } = store.project.outline
    const middle = Math.floor(width / 2)
    expect((await call('paint-stitches', { stitches: [{ row: 5, stitch: middle, yarn: 'Madder', type: 'purl' }] })).text).toMatch(/^Painted 1 of 1/)
    const madder = store.project.yarns.findIndex((y) => y.name === 'Madder')
    // Stitch numbers count along the row's own stitches, from its right end, where it begins.
    const y = height - 5
    const x = Array.from({ length: width }, (_, i) => width - 1 - i).filter((i) => store.project.outline.cells[y * width + i] !== NONE)[middle - 1]!
    expect(store.chart().cells[y * width + x]).toBe(madder)
    expect(store.stitches()!.cells[y * width + x]).toBe(1)
    expect((await call('paint-stitches', { stitches: [{ row: 5, stitch: middle }] })).error).toBe(true)

    // The drawn layer is on top; sent to the back, the dots cover it.
    await call('update-layer', { layer: 'Drawn colorwork', order: 'back' })
    expect(store.project.bands.map((b) => b.name)).toEqual(['Drawn colorwork', 'Dots'])

    await call('undo')
    expect(store.project.bands.map((b) => b.name)).toEqual(['Dots', 'Drawn colorwork'])

    const flagged = store.issues().length
    if (flagged) {
      await call('update-chart', { ignoreFloats: 'all' })
      expect(store.issues()).toEqual([])
    }
  })

  it('keeps the Drawn colorwork layer in place: it can only be renamed, hidden, reordered, or recolored', async () => {
    const { store, call } = setup()
    await call('paint-stitches', { stitches: [{ row: 5, stitch: 5, yarn: '1' }] })
    const before = composeChart(store.project)
    const moved = await call('update-layer', { layer: 'Drawn colorwork', scale: 2 })
    expect(moved.error).toBe(true)
    expect(composeChart(store.project).cells).toEqual(before.cells)
    const renamed = await call('update-layer', { layer: 'Drawn colorwork', name: 'Fixes' })
    expect(renamed.error).toBe(false)
    expect(store.project.bands.some((b) => b.painted && b.name === 'Fixes')).toBe(true)
  })

  it('changes the chart as the knitter can, in one step: its name, gauge, widths, float limit, and swatch', async () => {
    const { store, call } = setup()
    const before = store.project
    const done = await call('update-chart', {
      name: 'Yoke test',
      gauge: { stitches: 24, rows: 30 },
      widths: [
        { name: 'Band', height: 5, width: 60 },
        { name: 'Brim', rename: 'Hem' },
        { name: 'Crown', row: 50, stitches: 100 },
      ],
      floatLimit: 3,
      swatch: { width: 10, height: 10, grams: 6 },
    })
    expect(done.error).toBe(false)
    const { project } = store
    expect(project.name).toBe('Yoke test')
    expect(project.floatRules.maxFloatCm).toBe(3)
    expect(project.swatch).toEqual({ widthCm: 10, heightCm: 10, grams: 6 })
    const widths = Object.fromEntries(project.piece.measurements.map((m) => [m.name, m]))
    expect(widths.Band).toMatchObject({ height: 5, width: 60 })
    expect(widths.Hem).toBeDefined()
    // The pattern's own counts, at the new gauge: 100 stitches at 24 per 10 cm, reached on row 50 (not past it).
    expect(widths.Crown!.height).toBeLessThan(50 / 3)
    expect(widths.Crown!.height).toBeGreaterThan(49 / 3)
    expect(widths.Crown!.width).toBeCloseTo(100 / 2.4)
    const chart = JSON.parse((await call('get-chart')).text)
    expect(chart.piece.widths.map((w: { name: string }) => w.name)).toContain('Band')
    // Read back as it was given.
    expect(chart.piece.widths.find((w: { name: string }) => w.name === 'Crown').row).toBe(50)
    expect(chart.floatLimit).toMatch(/^3 cm/)
    // One undo puts it all back.
    await call('undo')
    expect(store.project).toBe(before)
    await call('redo')
    expect(store.project.name).toBe('Yoke test')
    expect((await call('update-chart', { removeWidths: store.project.piece.measurements.map((m) => m.name) })).error).toBe(true)
    expect((await call('update-chart', { widths: [{ name: 'Nowhere', width: 3 }] })).text).toMatch(/give its height/)
  })

  it('removes a yarn: its stitches go clear, and another becomes the main color if it was', async () => {
    const { store, call } = setup()
    await call('add-layer', { name: 'Dots', rows: ['X.'], key: { '.': 'main', X: 'Madder' }, placement: 'tile' })
    const count = store.project.yarns.length
    await call('set-yarns', { yarns: [{ yarn: 'Madder', remove: true }] })
    expect(store.project.yarns.map((y) => y.name)).not.toContain('Madder')
    expect(store.project.yarns).toHaveLength(count - 1)
    expect((await call('set-yarns', { yarns: store.project.yarns.map((y) => ({ yarn: y.name, remove: true })) })).error).toBe(true)
  })

  it('places library motifs, saves a layer to the library, and takes a saved motif’s newer version', async () => {
    const { library, saved, changes } = memoryLibrary()
    const { store, call } = setup(library)
    const listed = JSON.parse((await call('get-library')).text)
    const first = listed.builtIn[0].name
    const placedOne = await call('add-layer', { motif: first, placement: 'row' })
    expect(placedOne.error).toBe(false)
    expect(store.project.bands.at(-1)).toMatchObject({ name: first, fromLibrary: { editedAt: 0 } })

    await call('add-layer', { name: 'Mine', rows: ['X.X'], key: { '.': 'main', X: 'Madder' }, placement: 'row' })
    await call('update-library', { save: 'Mine', name: 'Tiny dots' })
    expect([...saved.values()].map((m) => m.name)).toEqual(['Tiny dots'])
    expect(changes()).toBe(1)
    expect(JSON.parse((await call('get-library')).text).mine[0]).toMatchObject({ name: 'Tiny dots', chart: ['A.A'] })

    // Edited in the library since: the layer's offered it, and takes it on request.
    const motif = [...saved.values()][0]!
    saved.set(motif.id, { ...motif, grid: { ...motif.grid, cells: new Uint8Array([0, 0, 0]) }, editedAt: motif.savedAt + 1 })
    const layer = JSON.parse((await call('get-chart')).text).layers.find((l: { name: string }) => l.name === 'Mine')
    expect(layer).toMatchObject({ fromLibrary: 'Tiny dots', newerInLibrary: true })
    expect((await call('update-layer', { layer: 'Mine', updateFromLibrary: true })).error).toBe(false)
    expect((await call('update-layer', { layer: 'Mine', updateFromLibrary: true })).error).toBe(true)

    expect((await call('update-library', { remove: first })).error).toBe(true)
    await call('update-library', { remove: 'Tiny dots' })
    expect(saved.size).toBe(0)
  })

  it('changes a layer as its window does: placement, duplicate stitch, turn, mirror, spacing, and copies', async () => {
    const { store, call } = setup()
    await call('add-layer', { name: 'Star', rows: ['X.', 'XX'], key: { '.': 'main', X: 'Madder' }, placement: 'row' })
    await call('update-layer', { layer: 'Star', placement: 'single' })
    expect(store.project.bands[0]).toMatchObject({ once: true, afterKnitting: true })
    await call('update-layer', { layer: 'Star', afterKnitting: false, rotation: 90, mirror: true })
    expect(store.project.bands[0]).toMatchObject({ afterKnitting: false, rotation: 90, mirror: true })
    await call('update-layer', { layer: 'Star', placement: 'tile', gapUp: 2 })
    expect(store.project.bands[0]).toMatchObject({ rows: null, gapY: 2 })
    expect((await call('update-layer', { layer: 'Star', afterKnitting: true })).error).toBe(true)
    await call('update-layer', { layer: 'Star', duplicate: true })
    expect(store.project.bands.map((b) => b.name)).toEqual(['Star', 'Star copy'])
  })

  it('erases painted stitches', async () => {
    const { store, call } = setup()
    await call('paint-stitches', { stitches: [{ row: 5, stitch: 5, yarn: 'Madder' }] })
    const madder = store.project.yarns.findIndex((y) => y.name === 'Madder')
    expect(composeChart(store.project).cells).toContain(madder)
    await call('paint-stitches', { stitches: [{ row: 5, stitch: 5, erase: true }] })
    expect(composeChart(store.project).cells).not.toContain(madder)
  })
})

describe('agent tools, checked like a careful knitter would', () => {
  it('refuses numbers that are not numbers, rather than storing them', async () => {
    const { store, call } = setup()
    const bands = store.project.bands.length
    const bad = await call('add-layer', { rows: ['X.'], key: { X: 'Madder', '.': 'main' }, placement: 'row', bottomRow: 'ten' })
    expect(bad.error).toBe(true)
    expect(bad.text).toMatch(/bottomRow.*must be a number/)
    expect(store.project.bands.length).toBe(bands)
    expect((await call('paint-stitches', { stitches: [{ row: 5, stitch: 2.5, yarn: 'Madder' }] })).error).toBe(true)
  })

  it('finds a layer by part of its name, when only one has it', async () => {
    const { call } = setup()
    await call('add-layer', { name: 'DMC 1922, plate 1: triangles', rows: ['X.'], key: { X: 'Madder', '.': 'main' }, placement: 'row', bottomRow: 20 })
    await call('add-layer', { name: 'DMC 1922, plate 1: zigzag', rows: ['X.'], key: { X: 'Madder', '.': 'main' }, placement: 'row', bottomRow: 30 })
    expect((await call('update-layer', { layer: 'triangles', gap: 1 })).error).toBe(false)
    const ambiguous = await call('update-layer', { layer: 'plate 1', gap: 1 })
    expect(ambiguous.error).toBe(true)
    expect(ambiguous.text).toMatch(/more than one/)
  })

  it('refuses inputs a tool doesn’t take, and says when a change changes nothing', async () => {
    const { call } = setup()
    await call('add-layer', { name: 'Dots', rows: ['X.'], key: { X: 'Madder', '.': 'main' }, placement: 'row', bottomRow: 30 })
    const misnamed = await call('update-layer', { layer: 'Dots', spacing: 2 })
    expect(misnamed.error).toBe(true)
    expect(misnamed.text).toMatch(/doesn’t take `spacing`: nothing was changed\. It takes .*`gap`/)
    const same = await call('update-layer', { layer: 'Dots', visible: true })
    expect(same.text).toMatch(/^Nothing changed in "Dots": it already had the `visible` given/)
    expect((await call('update-layer', { layer: 'Dots', gap: 2 })).text).not.toMatch(/Nothing changed/)
  })

  it('saves a motif’s purls with it, and places them again', async () => {
    const { library, saved } = memoryLibrary()
    const { store, call } = setup(library)
    await call('add-layer', { name: 'Ridge', rows: ['XX', '--'], key: { X: 'Madder', '-': 'main purl' }, placement: 'row', bottomRow: 30 })
    await call('update-library', { save: 'Ridge' })
    const motif = [...saved.values()][0]!
    expect(motif.stitches?.cells.filter((c) => c !== 0)).toHaveLength(2)
    expect(JSON.parse((await call('get-library')).text).mine[0]).toMatchObject({ stitches: ['..', 'pp'], stitchKey: { p: 'purl' } })
    await call('add-layer', { name: 'Ridge again', motif: 'Ridge', placement: 'row', bottomRow: 40 })
    const again = store.project.bands.find((b) => b.name === 'Ridge again')!
    expect([...again.stitches!.cells]).toEqual([...motif.stitches!.cells])
    // Saving it again unchanged isn't a new version; a stitch changed is.
    expect((await call('update-library', { save: 'Ridge again' })).text).toMatch(/Nothing changed/)
    await call('update-layer', { layer: 'Ridge again', chart: { rows: ['XX', '-.'], key: { X: 'Madder', '-': 'main purl', '.': 'main' } } })
    expect((await call('update-library', { save: 'Ridge again' })).text).toMatch(/Updated/)
  })

  it('saves a layer over the motif it came from, so charts using it are offered the new version', async () => {
    const { library, saved } = memoryLibrary()
    const { store, call } = setup(library)
    await call('add-layer', { name: 'Tree', rows: ['.X.', 'XXX'], key: { X: 'Madder', '.': 'main' }, placement: 'row', bottomRow: 20 })
    expect((await call('update-library', { save: 'Tree' })).text).toMatch(/Saved "Tree"/)
    const [motif] = [...saved.values()]
    await call('update-layer', { layer: 'Tree', chart: { rows: ['XXX', 'XXX'], key: { X: 'Madder' } } })
    const again = await call('update-library', { save: 'Tree' })
    expect(again.text).toMatch(/Updated "Tree"/)
    expect(saved.size).toBe(1)
    expect(saved.get(motif!.id)!.editedAt).toBeGreaterThan(0)
    // Renamed with `name`: still the one motif.
    await call('update-library', { save: 'Tree', name: 'Pine' })
    expect([...saved.values()].map((m) => m.name)).toEqual(['Pine'])
    expect(store.project.bands.find((b) => b.name === 'Tree')!.fromLibrary!.motifId).toBe(motif!.id)
  })

  it('keeps a layer its height: moved past the top, it is refused rather than cut short', async () => {
    const { store, call } = setup()
    await call('add-layer', { name: 'Tall', rows: ['X', 'X', 'X', 'X'], key: { X: 'Madder' }, placement: 'row', bottomRow: 3 })
    const height = store.project.outline.height
    const moved = await call('update-layer', { layer: 'Tall', bottomRow: height - 1 })
    expect(moved.error).toBe(true)
    expect(moved.text).toMatch(/can be 1 to/)
    expect((await call('update-layer', { layer: 'Tall', bottomRow: 10 })).text).toMatch(/10–13/)
  })

  it('lets two yarns swap names in one call', async () => {
    const { store, call } = setup()
    await call('set-yarns', { yarns: [{ yarn: 'Madder', name: 'Indigo' }, { yarn: 'Indigo', name: 'Madder' }] })
    expect(store.project.yarns.map((y) => y.name)).toEqual(['Natural', 'Charcoal', 'Indigo', 'Madder'])
  })

  it("won't save a layer over a newer version of its library motif", async () => {
    const { library, saved } = memoryLibrary()
    const { call } = setup(library)
    await call('add-layer', { name: 'Tree', rows: ['.X.', 'XXX'], key: { X: 'Madder', '.': 'main' }, placement: 'row', bottomRow: 20 })
    await call('update-library', { save: 'Tree' })
    const [motif] = [...saved.values()]
    // Changed from another chart since.
    saved.set(motif!.id, { ...motif!, grid: { ...motif!.grid, cells: motif!.grid.cells.map(() => 0) }, editedAt: Date.now() + 1000 })
    const stale = await call('update-library', { save: 'Tree' })
    expect(stale.error).toBe(true)
    expect(stale.text).toMatch(/newer version/)
  })

  it("puts a pattern's counts on the rounds it says: 96 after round 50 is 96 on round 50", async () => {
    const { call } = setup()
    await call('shape-piece', { name: 'Hat', worked: 'round', gauge: { stitches: 26, rows: 28 }, shape: [{ row: 0, stitches: 128 }, { row: 42, stitches: 128 }, { row: 50, stitches: 96 }, { row: 60, stitches: 16 }] })
    const rows = (await call('get-written-rows', { from: 42, to: 60 })).text
    expect(rows).toMatch(/Rnds 42–43: k128\. \(128 sts\)/)
    expect(rows).toMatch(/Rnd 50: [^\n]*\(96 sts\)/)
    expect(rows).toMatch(/Rnd 60: [^\n]*\(16 sts\)/)
    // As a pattern works them: 8 every other round to round 50, then 8 every round, a stitch in each of 8 sections.
    expect(rows).toMatch(/Rnd 44: \*k14, k2tog; rep from \* to end\. \(120 sts\)/)
    expect(rows).toMatch(/Rnd 51: \*k10, k2tog; rep from \* to end\. \(88 sts\)/)
  })

  it('shapes a crown at the points the pattern says, and writes it so', async () => {
    const { call, store } = setup()
    await call('shape-piece', { name: 'Hat', worked: 'round', gauge: { stitches: 24, rows: 30 }, shape: [{ row: 0, stitches: 120 }, { row: 40, stitches: 120 }, { row: 58, stitches: 12, sections: 6 }] })
    const rows = (await call('get-written-rows', { from: 41, to: 58 })).text
    expect(rows).toMatch(/Rnd 41: \*k18, k2tog; rep from \* to end\. \(114 sts\)/)
    expect(rows).toMatch(/Rnd 58: \*k1, k2tog; rep from \* to end\. \(12 sts\)/)
    const widths = JSON.parse((await call('get-chart')).text).piece.widths
    expect(widths.at(-1).shapedAt).toBe('6 points around')
    // The chart's wedges: on the top round, 2 stitches in each of 6 sections of 20.
    const { outline } = store.project
    const top = Array.from({ length: outline.width }, (_, x) => outline.cells[x] !== 255)
    expect(top.filter(Boolean)).toHaveLength(12)
    expect([0, 1, 2, 3, 4, 5].map((j) => top.slice(j * 20, j * 20 + 20).filter(Boolean).length)).toEqual([2, 2, 2, 2, 2, 2])
    // Changed to 8 points, and back to the default.
    await call('update-chart', { widths: [{ name: 'End', sections: 8 }] })
    expect(JSON.parse((await call('get-chart')).text).piece.widths.at(-1).shapedAt).toBe('8 points around')
    await call('update-chart', { widths: [{ name: 'End', sections: 0 }] })
    expect(JSON.parse((await call('get-chart')).text).piece.widths.at(-1).shapedAt).toMatch(/\(the default\)/)
    expect((await call('shape-piece', { name: 'Flat', worked: 'flat', gauge: { stitches: 24, rows: 30 }, shape: [{ row: 0, stitches: 60 }, { row: 10, stitches: 40, sections: 4 }] })).error).toBe(true)
  })

  it('keeps layers where they were when a shorter size is looked at, and back', async () => {
    const { call } = setup()
    await call('shape-piece', { name: 'Body', worked: 'round', gauge: { stitches: 22, rows: 30 }, sizes: [
      { name: 'S', shape: [{ row: 0, stitches: 120 }, { row: 60, stitches: 120 }] },
      { name: 'L', shape: [{ row: 0, stitches: 120 }, { row: 80, stitches: 120 }] },
    ], size: 'L' })
    await call('add-layer', { name: 'Band', rows: ['X.', '.X', 'X.'], key: { X: 'Madder', '.': 'main' }, placement: 'row', bottomRow: 70 })
    const where = async () => JSON.parse((await call('get-chart')).text).layers[0].where as string
    expect(await where()).toMatch(/70–72/)
    await call('update-chart', { size: 'S' })
    expect(await where()).toMatch(/58–60/)
    await call('update-chart', { size: 'L' })
    expect(await where()).toMatch(/70–72/)
  })

  it('tiles a motif over some rows only: from a round up to the top, off the rib', async () => {
    const { store, call } = setup()
    const added = await call('add-layer', { name: 'Lice', rows: ['X...', '..X.'], key: { X: 'Madder', '.': 'main' }, placement: 'tile', bottomRow: 30 })
    const top = store.project.outline.height
    expect(added.text).toContain(`tiled over rounds 30–${top}`)
    expect((await call('update-layer', { layer: 'Lice', bottomRow: 40 })).text).toContain(`tiled over rounds 40–${top}`)
  })

  it('flags rows with more than two colors, and pattern colors too faint to read', async () => {
    const { call } = setup()
    await call('add-layer', { name: 'Three', rows: ['MI..'], key: { M: 'Madder', I: 'Indigo', '.': 'main' }, placement: 'row', bottomRow: 30 })
    const chart = JSON.parse((await call('get-chart')).text)
    expect(chart.tooManyColors[0]).toMatch(/^Round 30: 3 colors/)
    const faint = await call('set-yarns', { yarns: [{ yarn: 'Madder', hex: '#f0e6d2' }] })
    expect(faint.text).toMatch(/Low contrast: Madder on Natural/)
  })

  it('counts yarn for a motif duplicate stitched after knitting', async () => {
    const { call } = setup()
    await call('set-yarns', { yarns: [{ name: 'Fjord', hex: '#336699' }] })
    await call('add-layer', { name: 'Star', rows: ['X'], key: { X: 'Fjord' }, placement: 'single', bottomRow: 20 })
    expect((await call('estimate-yarn')).text).toMatch(/Fjord: about/)
  })
})

describe('app tools', () => {
  it('lists, starts, and opens charts', async () => {
    const charts = new Map<string, Project>()
    const repository: ProjectRepository = {
      list: async () => [...charts.values()].map(summarize),
      get: async (id) => charts.get(id),
      put: async (p) => void charts.set(p.id, p),
      remove: async (id) => void charts.delete(id),
    }
    const opened: string[] = []
    const tools = appTools({ repository, queryClient: new QueryClient(), open: async (id) => void opened.push(id), openId: null })
    const call = async (name: string, input: Record<string, unknown> = {}) => {
      const result = await tools.find((t) => t.name === name)!.execute(input)
      return { text: (result.content[0] as { text: string }).text, error: result.isError ?? false }
    }
    expect((await call('list-charts')).text).toMatch(/No charts yet/)
    await call('new-chart', { name: 'Flax yoke' })
    expect([...charts.values()].map((c) => c.name)).toEqual(['Flax yoke'])
    expect(opened).toHaveLength(1)
    await call('open-chart', { chart: 'flax yoke' })
    expect(opened).toHaveLength(2)
    expect((await call('open-chart', { chart: 'Nope' })).error).toBe(true)
  })
})

