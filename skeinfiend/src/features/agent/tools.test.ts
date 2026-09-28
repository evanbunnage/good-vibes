import { describe, expect, it } from 'vitest'
import { rowRuns } from '@/domain/numbering'
import { PURL, workedAs } from '@/domain/stitches'
import { composeChart, composeStitches, createProject } from '@/domain/project'
import { EditorStore } from '@/editor/store'
import { agentTools } from './tools'
import { publishedPattern } from '@/domain/published-patterns.fixture'

function setup() {
  const template = publishedPattern('hat')
  const store = new EditorStore(createProject({ id: 'p', name: 'Test', template, gauge: template.gauge, now: 0 }))
  const tools = agentTools(store)
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
    await call('set_yarns', { yarns: [{ yarn: 'Charcoal', name: 'Canary', hex: '#f2cf1d' }] })
    const added = await call('add_chart', { name: 'Chart A', rows: ['.X..', 'X.X.', '.X..'], key: { '.': 'main', X: 'Canary' }, placement: 'row', bottomRow: 13 })
    expect(added.text).toContain('rows 13–15')
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
    const uneven = await call('add_chart', { name: 'A', rows: ['.X', 'X'], key: { '.': 'main', X: 'Charcoal' }, placement: 'row' })
    expect(uneven.error).toBe(true)
    expect(uneven.text).toContain('row 2: 2, row 1: 1')
    const unkeyed = await call('add_chart', { name: 'A', rows: ['.Z'], key: { '.': 'main' }, placement: 'row' })
    expect([unkeyed.error, unkeyed.text.includes('"Z"')]).toEqual([true, true])
    const missing = await call('update_layer', { layer: 'Nope' })
    expect([missing.error, missing.text.includes('"Nope"')]).toEqual([true, true])
  })

  it('moves and recolors a layer', async () => {
    const { store, call } = setup()
    await call('add_chart', { name: 'B', rows: ['XO'], key: { X: 'Charcoal', O: 'Madder' }, placement: 'row', bottomRow: 5 })
    const moved = await call('update_layer', { layer: 'b', bottomRow: 20, rows: 4, recolor: { from: 'Madder', to: 'Indigo' } })
    expect(moved.text).toMatch(/repeated across rows 20–23/)
    expect([...new Set(store.project.bands[0]!.motif.cells)].sort()).toEqual([1, 3])
  })

  it('knits purl stitches from the key, and reads them back', async () => {
    const { store, call } = setup()
    // A seed-stitch band in the main color, with a Madder stitch purled.
    await call('add_chart', { name: 'Seed', rows: ['.-', '-M'], key: { '.': 'main', '-': 'main purl', M: 'Madder purl' }, placement: 'row', bottomRow: 3 })
    const stitches = composeStitches(store.project)!
    const { width, height } = store.project.outline
    // Four stitches from the middle, in from the brim's shaping.
    const middle = width / 2
    const at = (row: number) => Array.from(stitches.cells.slice((height - row) * width + middle, (height - row) * width + middle + 4))
    // The chart's bottom row is all purls; the one above alternates.
    expect(at(3)).toEqual([1, 1, 1, 1])
    expect(at(4).join('')).toMatch(/^(0101|1010)$/)
    // Runs keep each stitch as charted, in the round or flat; worked from the wrong side, a charted purl is knitted.
    const purled = (construction: 'round' | 'flat') => rowRuns(composeChart(store.project), height - 4, construction, 1, stitches)
      .reduce((n, r) => n + (r.kind === 'stitches' && r.stitch === PURL ? r.count : 0), 0)
    const charted = Array.from(stitches.cells.slice((height - 4) * width, (height - 3) * width)).filter((c) => c === PURL).length
    expect([purled('round'), purled('flat')]).toEqual([charted, charted])
    expect([workedAs(PURL, true), workedAs(PURL, false), workedAs(2, false)]).toEqual(['p', 'k', 'p1 tbl'])
    const pattern = JSON.parse((await call('get_chart')).text)
    expect(pattern.layers[0]).toEqual(expect.objectContaining({ chart: ['.X', 'XO'], key: { '.': 'main', X: 'main purl', O: 'Madder purl' } }))
  })

  it('leaves the stitches alone when nothing is purled', async () => {
    const { store, call } = setup()
    await call('add_chart', { name: 'A', rows: ['X.'], key: { '.': 'main', X: 'Madder' }, placement: 'row' })
    expect(composeStitches(store.project)).toBeNull()
  })

  it("shapes a piece from a pattern's stitch counts, and says where a repeat won't go evenly around", async () => {
    const { store, call } = setup()
    // The Classic's yoke, size 1: 136 stitches, 336 after 40 rounds, 348 after 43.
    const shaped = await call('shape_piece', {
      name: 'Yoke', worked: 'round', gauge: { stitches: 21, rows: 28, over: 10 },
      shape: [{ row: 0, stitches: 136 }, { row: 40, stitches: 336 }, { row: 43, stitches: 348 }],
    })
    expect(shaped.error).toBe(false)
    const { outline } = store.project
    const count = (row: number) => Array.from(outline.cells.slice((outline.height - row) * outline.width, (outline.height - row + 1) * outline.width)).filter((c) => c !== 255).length
    expect([outline.height, count(1), count(43)]).toEqual([43, 136, 348])
    const added = await call('add_chart', { name: 'Violets', rows: ['AAAAAA'], key: { A: 'Charcoal' }, placement: 'row', bottomRow: 1 })
    // It says where the repeat breaks: round 1, at 136 stitches.
    expect(added.text).toContain('136 sts')
    const colorway = await call('set_yarns', { yarns: [{ yarn: 'Natural', name: 'B', hex: '#b8b4d8', main: true }, { name: 'F', hex: '#f1e3b0' }] })
    expect(colorway.error).toBe(false)
    expect(store.project.yarns[store.project.background]).toMatchObject({ name: 'B', hex: '#b8b4d8' })
    expect(store.project.yarns.at(-1)).toMatchObject({ name: 'F', hex: '#f1e3b0' })
    // One step to undo the whole colorway.
    store.undo()
    expect(store.project.yarns.map((y) => y.name)).not.toContain('F')
  })

  it("makes every size a pattern gives, reports each, and switches between them", async () => {
    const { store, call } = setup()
    const made = await call('shape_piece', {
      name: 'Yoke', worked: 'round', gauge: { stitches: 21, rows: 28, over: 10 },
      sizes: [
        { name: '1', shape: [{ row: 0, stitches: 136 }, { row: 43, stitches: 348 }] },
        { name: '2', shape: [{ row: 0, stitches: 138 }, { row: 47, stitches: 368 }] },
      ],
    })
    expect(made.error).toBe(false)
    expect(store.project.sizes?.map((s) => s.name)).toEqual(['1', '2'])
    await call('add_chart', { name: 'Six', rows: ['AAAAAA'], key: { A: 'Charcoal' }, placement: 'row', bottomRow: 1 })
    const chart = JSON.parse((await call('get_chart')).text)
    // 136 isn't a multiple of 6, 138 is.
    expect(chart.sizes).toEqual([
      expect.objectContaining({ name: '1', shown: true, stitches: 348, rows: 43, repeatBreaksIn: ['Six'] }),
      expect.objectContaining({ name: '2', stitches: 368, rows: 47 }),
    ])
    expect(chart.sizes[1].repeatBreaksIn).toBeUndefined()
    await call('set_size', { size: '2' })
    expect([store.project.size, store.project.outline.height]).toEqual([1, 47])
    expect((await call('set_size', { size: 'XL' })).error).toBe(true)
  })

  it('reads stitches from a chart key, with or without a yarn, and writes them back the same way', async () => {
    const { store, call } = setup()
    await call('set_yarns', { yarns: [{ yarn: 'Madder', name: 'Spanish Coin' }] })
    const added = await call('add_chart', {
      name: 'Waves', placement: 'tile',
      rows: ['.-Q/', 'M\\PB'],
      key: { '.': 'main', '-': 'purl', Q: 'k1 tbl', '/': 'k2tog', M: 'M1', '\\': 'ssk', P: 'Spanish Coin M1 p-st', B: 'Charcoal bobble' },
    })
    expect(added.error).toBe(false)
    const band = store.project.bands[0]!
    expect(Array.from(band.stitches!.cells)).toEqual([0, 1, 2, 4, 6, 5, 7, 9])
    const layer = JSON.parse((await call('get_chart')).text).layers[0]
    expect(layer.chart).toEqual(['.XOA', 'BCDE'])
    expect(layer.key).toEqual({ '.': 'main', X: 'main purl', O: 'main k1 tbl', A: 'main k2tog', B: 'main M1', C: 'main ssk', D: 'Spanish Coin M1 p-st', E: 'Charcoal bobble' })
    expect((await call('add_chart', { name: 'Bad', placement: 'tile', rows: ['z'], key: { z: 'k3tog' } })).text).toMatch(/isn't a yarn or a stitch/)
    // A misread fixed in place, and shown to the knitter.
    await call('update_layer', { layer: 'Waves', chart: { rows: ['-'], key: { '-': 'purl' } } })
    expect(Array.from(store.project.bands[0]!.stitches!.cells)).toEqual([1])
    await call('show', { stitches: true, floats: true })
    expect(store.getState()).toMatchObject({ showingStitches: true, showingFloats: true, showingSizing: false })
  })

  it('takes yarns from their ball bands, and says how many skeins the chart takes', async () => {
    const { store, call } = setup()
    const set = await call('set_yarns', { yarns: [
      { yarn: 'Natural', brand: 'Jamieson’s Spindrift', weight: 'Fingering', fiber: '100% Shetland wool', yards: 115, grams: 25 },
      { yarn: 'Charcoal', meters: 105, grams: 25 },
    ] })
    expect(set.error).toBe(false)
    expect(store.project.yarns[0]).toMatchObject({ brand: 'Jamieson’s Spindrift', weight: 'fingering', fiber: '100% Shetland wool', gramsPerSkein: 25 })
    // Yards become meters.
    expect(store.project.yarns[0]!.metersPerSkein).toBeCloseTo(105.156, 3)
    await call('add_chart', { name: 'Dots', rows: ['X...'], key: { '.': 'main', X: 'Charcoal' }, placement: 'tile' })
    // What it reports is the store's estimate: skeins where the ball band's given.
    expect((await call('estimate_yarn')).error).toBe(false)
    const [natural, charcoal] = store.estimate().yarns
    expect([natural!.skeins, charcoal!.floatStitches > 0, store.estimate().fromSwatch]).toEqual([2, true, false])
    // A detail cleared, and a weight that isn't one.
    await call('set_yarns', { yarns: [{ yarn: 'Natural', fiber: null }] })
    expect(store.project.yarns[0]!.fiber).toBeUndefined()
    expect((await call('set_yarns', { yarns: [{ yarn: 'Natural', weight: 'heavy' }] })).error).toBe(true)
    // A weighed swatch, once every yarn in the chart has a ball band.
    await call('set_swatch', { width: 15, height: 15, grams: 9 })
    expect(store.project.swatch).toEqual({ widthCm: 15, heightCm: 15, grams: 9 })
    expect(store.estimate().fromSwatch).toBe(true)
  })

  it('writes rows out, paints single stitches, ignores floats, reorders layers, and undoes', async () => {
    const { store, call } = setup()
    await call('add_chart', { name: 'Dots', rows: ['X...'], key: { '.': 'main', X: 'Charcoal' }, placement: 'row', bottomRow: 1 })
    const written = (await call('get_written_rows', { from: 1, to: 2 })).text
    expect(written).toContain('MC = Natural')
    expect(written).toContain('CC = Charcoal')
    expect(written.split('\n').filter((l) => /^Rnd \d+:/.test(l))).toHaveLength(2)

    // Row 5, the middle stitch, in Madder, purled. (Stitches count from the right edge.)
    const { width, height } = store.project.outline
    const middle = Math.floor(width / 2)
    expect((await call('paint_stitches', { stitches: [{ row: 5, stitch: middle, yarn: 'Madder', type: 'purl' }] })).text).toMatch(/^Painted 1 of 1/)
    const madder = store.project.yarns.findIndex((y) => y.name === 'Madder')
    const [x, y] = [width - middle, height - 5]
    expect(store.chart().cells[y * width + x]).toBe(madder)
    expect(store.stitches()!.cells[y * width + x]).toBe(1)
    expect((await call('paint_stitches', { stitches: [{ row: 5, stitch: middle }] })).error).toBe(true)

    // The drawn layer is on top; sent to the back, the dots cover it.
    await call('update_layer', { layer: 'Drawn colorwork', order: 'back' })
    expect(store.project.bands.map((b) => b.name)).toEqual(['Drawn colorwork', 'Dots'])

    await call('undo')
    expect(store.project.bands.map((b) => b.name)).toEqual(['Dots', 'Drawn colorwork'])

    const flagged = store.issues().length
    if (flagged) {
      await call('ignore_floats', { all: true })
      expect(store.issues()).toEqual([])
    }
  })

  it('keeps the Drawn colorwork layer in place: it can only be renamed, hidden, reordered, or recolored', async () => {
    const { store, call } = setup()
    await call('paint_stitches', { stitches: [{ row: 5, stitch: 5, yarn: '1' }] })
    const before = composeChart(store.project)
    const moved = await call('update_layer', { layer: 'Drawn colorwork', scale: 2 })
    expect(moved.error).toBe(true)
    expect(composeChart(store.project).cells).toEqual(before.cells)
    const renamed = await call('update_layer', { layer: 'Drawn colorwork', name: 'Fixes' })
    expect(renamed.error).toBe(false)
    expect(store.project.bands.some((b) => b.painted && b.name === 'Fixes')).toBe(true)
  })
})

