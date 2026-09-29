import { describe, expect, it } from 'vitest'
import { createGrid, gridFromRows } from './grid'
import { writeRow, yarnLabels } from './written'

/** A chart row as seen, with each character's stitch: "." knit, "-" purl, "Q" k1 tbl, "/" k2tog, "M" M1. */
const STITCH: Record<string, number> = { '.': 0, '-': 1, Q: 2, '/': 4, '\\': 5, M: 6, P: 7 }

function oneRow(seen: string, yarns?: string) {
  const width = seen.length
  const stitches = createGrid(width, 1, 0)
  ;[...seen].forEach((c, x) => {
    stitches.cells[x] = STITCH[c]!
  })
  const chart = yarns ? gridFromRows([yarns], { '0': 0, '1': 1, '2': 2 }) : createGrid(width, 1, 0)
  return { chart, stitches }
}

describe('rows written as patterns write them', () => {
  // Vogue Knitting's Horizontal Waves: an edge stitch each side of two 14-stitch repeats.
  const waves = (row: string) => `.${row}${row}.`

  it('writes a right-side row as the book does', () => {
    const { chart, stitches } = oneRow(waves('.......--Q-Q-Q'))
    const row = writeRow({ ...chart, height: 2, cells: new Uint8Array([...chart.cells, ...chart.cells]) }, 1, 'flat', 1, { ...stitches, height: 2, cells: new Uint8Array([...stitches.cells, ...stitches.cells]) }, yarnLabels([30], 0), 0)
    expect(`${row.heading}: ${row.text} (${row.stitches} sts)`).toBe('Row 1 (RS): k1, *[k1 tbl, p1] twice, k1 tbl, p2, k7; rep from * to last st, k1. (30 sts)')
  })

  it('writes a wrong-side row from the stitches as they show on the right side', () => {
    // The book's edge stitches are knit every row: on a wrong-side row, they show as purls.
    const { chart, stitches } = oneRow(`-${'.......--Q-Q-Q'.repeat(2)}-`)
    // Row 2 of 2 (top-based y 0) is a wrong-side row, worked left to right.
    const two = { ...chart, height: 2, cells: new Uint8Array([...chart.cells, ...chart.cells]) }
    const sts = { ...stitches, height: 2, cells: new Uint8Array([...stitches.cells, ...stitches.cells]) }
    expect(writeRow(two, 0, 'flat', 1, sts, yarnLabels([30], 0), 0).text).toBe('k1, *p7, k2, p1 tbl, [k1, p1 tbl] twice; rep from * to last st, k1.')
  })

  it('writes increases and decreases, and names the yarns as the key does when there are several', () => {
    const { chart, stitches } = oneRow(waves('M....../-Q-Q-Q'))
    const row = writeRow({ ...chart, height: 1 }, 0, 'round', 1, stitches, yarnLabels([30], 0), 0)
    expect(`${row.heading}: ${row.text}`).toBe('Rnd 1: k1, *[k1 tbl, p1] 3 times, k2tog, k6, M1; rep from * to last st, k1.')
    const colors = oneRow('......', '001001')
    const two = writeRow(colors.chart, 0, 'round', 1, colors.stitches, yarnLabels([4, 2], 0), 0)
    // Read right to left, as a round is knitted.
    expect([two.text, two.yarns]).toEqual(['*k1 CC, k2 MC; rep from * to end.', [1, 0]])
  })

  it('writes a plain row as a count, not a repeat', () => {
    const { chart, stitches } = oneRow('..........')
    expect(writeRow(chart, 0, 'round', 1, stitches, yarnLabels([10], 0), 0).text).toBe('k10.')
  })
})

describe('shaping, marked as patterns write it', () => {
  it('increases and decreases one stitch in from each edge that moves', async () => {
    const { gridFromRows, NONE } = await import('./grid')
    const { shapingStitches, composeStitches } = await import('./project')
    // Four stitches, widened to six, then back to four: top row first.
    const outline = gridFromRows(['.XXXX.', 'XXXXXX', 'XXXXXX', '.XXXX.'], { '.': NONE, X: 0 })
    expect(shapingStitches(outline)).toEqual([
      { i: 2 * 6 + 4, stitch: 11 }, { i: 2 * 6 + 1, stitch: 12 },
      { i: 0 * 6 + 3, stitch: 5 }, { i: 0 * 6 + 2, stitch: 4 },
    ])
    const stitches = composeStitches({ outline, bands: [] })!
    const chart = { ...outline, cells: outline.cells.map((c) => (c === NONE ? NONE : 0)) }
    const labels = yarnLabels([20], 0)
    // Worked flat, these are wrong-side rows (rows 2 and 4): read left to right, each stitch as its reverse.
    expect(writeRow(chart, 2, 'flat', 1, stitches, labels, 0).text).toBe('p1, M1RP, p2, M1LP, p1.')
    expect(writeRow(chart, 0, 'flat', 1, stitches, labels, 0).text).toBe('p1, p2tog, ssp, p1.')
  })
})

describe('shaping in the round, written as patterns write it', () => {
  it('writes a round\'s shaping where the chart makes it', async () => {
    const { gridFromRows } = await import('./grid')
    const { composeStitches } = await import('./project')
    const labels = yarnLabels([30], 0)
    // 16 stitches, then 14, a stitch gone from the left end of each of 2 sections (top row first): a crown's wedges.
    const crown = gridFromRows(['.XXXXXXX.XXXXXXX', 'XXXXXXXXXXXXXXXX'], { '.': 255, X: 0 })
    expect(composeStitches({ outline: crown, bands: [], construction: 'round' })).toBeNull()
    expect(writeRow(crown, 0, 'round', 1, null, labels, 0).text).toBe('*k6, k2tog; rep from * to end.')
    // Gone at both edges: where the round begins and ends.
    const edges = gridFromRows(['.XXXXXXXXXXXXXX.', 'XXXXXXXXXXXXXXXX'], { '.': 255, X: 0 })
    expect(writeRow(edges, 0, 'round', 1, null, labels, 0).text).toBe('ssk, k12, k2tog.')
    const growing = gridFromRows(['XXXXXXXXXX', '.XXXX.XXXX'], { '.': 255, X: 0 })
    expect(writeRow(growing, 0, 'round', 1, null, labels, 0).text).toBe('*k4, M1; rep from * to end.')
    // More than a stitch or two gone together is cast off (or put on hold), as the pattern's shaping says: just how many.
    const uneven = gridFromRows(['..XXXXXXXXXXX...', 'XXXXXXXXXXXXXXXX'], { '.': 255, X: 0 })
    expect(writeRow(uneven, 0, 'round', 1, null, labels, 0).text).toBe('5 sts fewer than the round below, as the shaping says: k11.')
  })
})


describe('flat shaping, on right-side rows', () => {
  it('changes width only on right-side rows, and a chart\'s own stitch wins over a mark', async () => {
    const { layoutSchematic } = await import('./pieces')
    const { createBand } = await import('./bands')
    const { createGrid } = await import('./grid')
    const { composeStitches } = await import('./project')
    const taper = { kind: 'schematic' as const, multiple: 1, openings: [], measurements: [{ id: 'a', name: 'A', height: 0, width: 20 }, { id: 'b', name: 'B', height: 20, width: 30 }] }
    const { rowStitches, outline } = layoutSchematic(taper, { stitches: 20, rows: 20 }, 'flat')
    // Row 1 is index 0, a right-side row: every change is on an odd-numbered row.
    const changes = rowStitches.map((n, i) => (i > 0 && n !== rowStitches[i - 1] ? i + 1 : 0)).filter(Boolean)
    expect(changes.length).toBeGreaterThan(3)
    expect(changes.every((row) => row % 2 === 1)).toBe(true)
    // A layer over the whole piece with its own stitch where a mark would go: the layer's stays.
    const marked = composeStitches({ outline, bands: [], construction: 'flat' })!
    const i = marked.cells.indexOf(11)
    const own = createGrid(outline.width, outline.height, 0)
    own.cells[i] = 3
    const band = { ...createBand('b', 'B', createGrid(outline.width, outline.height), { top: 0, bottom: outline.height - 1 }), once: true, stitches: own }
    expect(composeStitches({ outline, bands: [band], construction: 'flat' })!.cells[i]).toBe(3)
  })
})

describe('the float limit, as a length', () => {
  it('flags floats past 2.5 cm by default, whatever the gauge', async () => {
    const { rulesAt, DEFAULT_RULES } = await import('./floats')
    expect(DEFAULT_RULES.maxFloatCm).toBe(2.5)
    expect(rulesAt(DEFAULT_RULES, { stitches: 28, rows: 32 }).maxFloat).toBe(7)
    expect(rulesAt(DEFAULT_RULES, { stitches: 18, rows: 24 }).maxFloat).toBe(4)
  })
})

describe('long floats, described by their lengths', () => {
  it('says how long each yarn floats, in stitches and as a length', async () => {
    const { describeRow } = await import('@/features/editor/issues')
    const yarns = [{ name: 'Natural' }, { name: 'Madder' }]
    const gauge = { stitches: 28, rows: 32 }
    const float = (yarn: number, length: number) => ({ kind: 'float' as const, y: 0, yarn, length, cells: [] })
    expect(describeRow([float(0, 7)], yarns, gauge, 'cm')).toBe('Natural float: 7 sts (3 cm)')
    // Whole centimeters: a range that rounds to one length is just that length.
    expect(describeRow([float(1, 8), float(1, 9), float(1, 8)], yarns, gauge, 'cm')).toBe('3 Madder floats: 8–9 sts (3 cm)')
    expect(describeRow([float(1, 8), float(1, 14)], yarns, gauge, 'cm')).toBe('2 Madder floats: 8–14 sts (3–5 cm)')
    expect(describeRow([float(0, 7)], yarns, gauge, 'in')).toBe('Natural float: 7 sts (1 in)')
  })
})

describe('published patterns, round by round', () => {
  it('writes every shaped round where the chart shapes it', async () => {
    const { publishedPattern } = await import('./published-patterns.fixture')
    const { layoutSchematic } = await import('./pieces')
    const { rowNumber } = await import('./numbering')
    const written = (id: 'hat' | 'sweater') => {
      const template = publishedPattern(id)
      const { outline } = layoutSchematic(template.spec as never, template.gauge!, 'round')
      const chart = { ...outline, cells: outline.cells.map((c) => (c === 255 ? 255 : 0)) }
      const labels = yarnLabels([1], 0)
      return new Map(Array.from({ length: chart.height }, (_, y) => [rowNumber(y, chart.height), writeRow(chart, y, 'round', 1, null, labels, 0).text]))
    }
    const hat = written('hat')
    for (const text of hat.values()) expect(text).not.toMatch(/as the shaping says/)
    // The Clayoquot's crown, as the pattern has it: a set-up round, then 8 sections, a stitch from each every other round.
    expect(hat.get(43)).toBe('*k27, k2tog; rep from * to end.')
    expect(hat.get(45)).toBe('*k12, k2tog; rep from * to end.')
    expect(hat.get(10)).toBe('*k13, M1, k14, M1; rep from * to end.')
    expect(hat.get(64)).toBe('*k2tog; rep from * to end.')
    const sweater = written('sweater')
    // All but the round the sleeves go on hold, which the pattern's steps say.
    expect([...sweater.values()].filter((text) => /as the shaping says/.test(text))).toHaveLength(1)
    expect(sweater.get(9)).toBe('*k3, M1; rep from * to end.')
  })
})
