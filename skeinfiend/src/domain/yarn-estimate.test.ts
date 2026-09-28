import { describe, expect, it } from 'vitest'
import { analyzeChart } from './floats'
import { createGrid, NONE, type Grid } from './grid'
import type { Yarn } from './palette'
import { estimateYarn, MARGIN, stitchLengthCm } from './yarn-estimate'

const gauge = { stitches: 28, rows: 32 }
const yarns: Yarn[] = [
  { id: 'a', name: 'Natural', hex: '#dddddd', metersPerSkein: 105, gramsPerSkein: 25 },
  { id: 'b', name: 'Madder', hex: '#aa3322', metersPerSkein: 105, gramsPerSkein: 25 },
  { id: 'c', name: 'Unused', hex: '#000000' },
]
const grid = (width: number, height: number, at: (x: number, y: number) => number): Grid => {
  const g = createGrid(width, height)
  return { ...g, cells: g.cells.map((_, i) => at(i % width, Math.floor(i / width))) }
}

describe('yarn estimates', () => {
  it('uses about 1.5 cm of yarn a stitch at 28 sts and 32 rows in 10 cm', () => {
    expect(stitchLengthCm(gauge)).toBeCloseTo(1.53, 2)
  })

  it('counts each yarn’s stitches and floats, with the margin, in skeins', () => {
    // One stitch of Madder in every four: Madder floats behind 3, Natural's runs of three are carried past one.
    const chart = grid(40, 100, (x) => (x % 4 === 0 ? 1 : 0))
    const floats = analyzeChart(chart, 'round', { maxFloat: 0 })
    const { yarns: [natural, madder], fromSwatch } = estimateYarn(chart, null, floats, yarns, gauge)
    expect(fromSwatch).toBe(false)
    expect(natural!.stitches).toBe(3000)
    expect(madder!.stitches).toBe(1000)
    expect(madder!.floatStitches).toBe(3000)
    const perStitch = stitchLengthCm(gauge)
    expect(madder!.meters).toBeCloseTo(((1000 * perStitch + 3000 / 2.8) / 100) * (1 + MARGIN), 5)
    expect(natural!.skeins).toBe(Math.ceil(natural!.meters / 105))
  })

  it('leaves out yarns not in the chart, stitches off the piece, and grams without a ball band', () => {
    const chart = grid(10, 10, (x) => (x < 2 ? NONE : 0))
    const plain = [{ id: 'a', name: 'Natural', hex: '#dddddd' }, ...yarns.slice(1)]
    const { yarns: found } = estimateYarn(chart, null, [], plain, gauge)
    expect(found.map((e) => e.yarn)).toEqual([0])
    expect(found[0]!.stitches).toBe(80)
    expect(found[0]!.grams).toBeNull()
  })

  it('goes by a weighed swatch: its grams per area, over the whole piece', () => {
    const chart = grid(28, 32, () => 0) // 10 × 10 cm of plain knitting
    const swatch = { widthCm: 10, heightCm: 10, grams: 5 }
    const estimate = estimateYarn(chart, null, [], yarns, gauge, swatch)
    expect(estimate.fromSwatch).toBe(true)
    // 5 g, at 4.2 m a gram, plus the margin.
    expect(estimate.yarns[0]!.meters).toBeCloseTo(5 * 4.2 * (1 + MARGIN), 5)
    expect(estimate.yarns[0]!.grams).toBeCloseTo(5 * (1 + MARGIN), 5)
  })
})
