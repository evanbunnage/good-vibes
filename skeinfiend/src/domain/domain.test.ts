import { describe, expect, it } from 'vitest'
import { lineCells } from './lines'
import { analyzeRow, type FloatIssue } from './floats'
import { cellAspect, heightCm, isValidGauge, sameGauge, stitchesForCm, widthCm } from './gauge'
import { createGrid, getCell, gridFromRows, NONE, resizeGrid } from './grid'
import { commit, redo, startHistory, undo } from './history'
import { MOTIF_LIBRARY } from './motifs'
import { readsRightToLeft, rowNumber, rowPattern, rowRuns, stitchNumber } from './numbering'
import { isDark, remapAfterRemoval, yarnCounts } from './palette'
import { composeChart, createProject } from './project'
import { MAIN, motifInYarns, toSavedMotif, uniqueMotifName } from './saved-motifs'
import { BUILT_IN_TEMPLATES, buildOutline, builtInTemplate, describeShaping, layoutSchematic, rectangle, shapingSteps, STITCH, stitchCount, type SchematicPiece } from './pieces'
import { createBand } from './bands'
import { orient } from './transform'
import { publishedPattern } from './published-patterns.fixture'

/** Chart rows as strings: digits are yarns, `-` is no stitch. */
const chart = (...rows: string[]) =>
  gridFromRows(rows, { '-': NONE, 0: 0, 1: 1, 2: 2, 3: 3 })
const rowsOf = (grid: ReturnType<typeof chart>) =>
  Array.from({ length: grid.height }, (_, y) =>
    Array.from({ length: grid.width }, (_, x) => {
      const v = getCell(grid, x, y)
      return v === NONE ? '-' : String(v)
    }).join(''),
  )

describe('grid', () => {
  it('resizes around the bottom-right corner so row and stitch numbers are kept', () => {
    const grown = resizeGrid(chart('01', '23'), 3, 3)
    expect(rowsOf(grown)).toEqual(['---', '-01', '-23'])
    expect(rowsOf(resizeGrid(chart('012', '123', '230'), 2, 2))).toEqual(['23', '30'])
  })

  it('rejects rows of uneven length', () => {
    expect(() => chart('01', '0')).toThrow(/Row 1/)
  })
})

describe('gauge', () => {
  it('draws stitches wider than tall when there are more rows than stitches per 10 cm', () => {
    expect(cellAspect({ stitches: 28, rows: 32 })).toBeCloseTo(0.875)
  })

  it('converts between stitches and centimeters', () => {
    const gauge = { stitches: 20, rows: 28 }
    expect(widthCm(40, gauge)).toBe(20)
    expect(heightCm(14, gauge)).toBe(5)
    expect(stitchesForCm(15, gauge)).toBe(30)
  })
})

describe('orient', () => {
  const l = chart('10', '10', '11')

  it('rotates clockwise', () => {
    expect(rowsOf(orient(l, { rotation: 90, mirror: false }))).toEqual(['111', '100'])
    expect(rowsOf(orient(l, { rotation: 180, mirror: false }))).toEqual(['11', '01', '01'])
  })

  it('mirrors before rotating', () => {
    expect(rowsOf(orient(l, { rotation: 0, mirror: true }))).toEqual(['01', '01', '11'])
  })
})

describe('composeChart', () => {
  it('layers the background, then each layer in order, clipped to the outline', () => {
    const project = createProject({ id: 'p', name: 'Test', template: builtInTemplate('swatch'), now: 0 })
    const composed = composeChart({
      ...project,
      outline: chart('000', '0-0'),
      background: 0,
      bands: [{ ...createBand('b', 'Dot', chart('1'), null), gapX: 1 }, { ...createBand('c', 'Dot', chart('2'), { top: 0, bottom: 0 }), once: true, offsetX: 2 }],
    })
    expect(rowsOf(composed)).toEqual(['102', '1-1'])
  })
})

describe('pieces', () => {
  const gauge = { stitches: 24, rows: 32 }
  const outlineOf = (id: 'swatch' | 'hat' | 'sweater' | 'dog-sweater') => buildOutline((id === 'swatch' ? builtInTemplate(id) : publishedPattern(id)).spec, gauge)
  const stitchesInRow = (grid: ReturnType<typeof rectangle>, y: number) => grid.cells.slice(y * grid.width, (y + 1) * grid.width).filter((c) => c === STITCH).length
  const piece = (measurements: Array<[number, number]>, extra: Partial<SchematicPiece> = {}): SchematicPiece => ({
    kind: 'schematic',
    measurements: measurements.map(([height, width], i) => ({ id: `m${i}`, name: `M${i}`, height, width })),
    openings: [],
    multiple: 1,
    ...extra,
  })

  it('builds every starting shape from its measurements at the gauge', () => {
    for (const template of BUILT_IN_TEMPLATES) expect(stitchCount(buildOutline(template.spec, gauge))).toBeGreaterThan(0)
    const swatch = outlineOf('swatch')
    expect([swatch.width, swatch.height]).toEqual([36, 48])
  })

  it('shapes evenly between measurements, centered, and steps where two share a height', () => {
    // 10 cm wide (24 stitches) up to 10 cm (32 rows), then 20 cm (48 stitches) at 20 cm: rows 32-63 widen.
    const { outline, placed } = layoutSchematic(piece([[0, 10], [10, 10], [20, 20]]), gauge)
    expect(placed.map((p) => [p.row, p.stitches])).toEqual([[0, 24], [32, 24], [63, 48]])
    const rowUp = (row: number) => outline.height - 1 - row
    expect(stitchesInRow(outline, rowUp(0))).toBe(24)
    expect(stitchesInRow(outline, rowUp(48))).toBe(Math.round(24 + (24 * 16) / 31))
    expect(stitchesInRow(outline, rowUp(63))).toBe(48)
    // Centered: as many empty cells either side (give or take one).
    const y = rowUp(0)
    const first = outline.cells.slice(y * outline.width, (y + 1) * outline.width).indexOf(STITCH)
    expect(first).toBe(12)
    // A step: 20 cm wide below 10 cm, 10 cm from there up.
    const stepped = layoutSchematic(piece([[0, 20], [10, 20], [10, 10], [20, 10]]), gauge).outline
    expect(stitchesInRow(stepped, stepped.height - 1 - 31)).toBe(48)
    expect(stitchesInRow(stepped, stepped.height - 1 - 32)).toBe(24)
  })

  it('rounds each measurement to the stitch multiple', () => {
    const { placed } = layoutSchematic(piece([[0, 10], [10, 10]], { multiple: 7 }), gauge)
    expect(placed.every((p) => p.stitches % 7 === 0)).toBe(true)
    expect(outlineOf('hat').width % 4).toBe(0)
  })

  it("shapes the Clayoquot hat: brim narrower than the body, crown narrowing to the top", () => {
    const hat = outlineOf('hat')
    const [brim, top] = [stitchesInRow(hat, hat.height - 1), stitchesInRow(hat, 0)]
    expect(brim).toBeLessThan(hat.width)
    expect(top).toBeLessThan(brim / 4)
  })

  it('cuts openings out: a neckline from the top edge, and pairs mirrored across the middle', () => {
    const front = buildOutline(piece([[0, 50], [60, 50]], { openings: [{ id: 'neck', name: 'Neckline', shape: 'oval', bottom: 52, height: 16, width: 18, offset: 0, pair: false }] }), gauge)
    const middle = Math.floor(front.width / 2)
    expect(getCell(front, middle, 0)).toBe(NONE)
    expect(getCell(front, middle, front.height - 1)).toBe(STITCH)
    const dog = outlineOf('dog-sweater')
    // Leg openings 8-13 cm up, 20 cm either side of the middle.
    const y = dog.height - 1 - Math.round(10.5 * 3.2)
    const at = (cm: number) => Math.floor(dog.width / 2 + cm * 2.4)
    expect(getCell(dog, at(20), y)).toBe(NONE)
    expect(getCell(dog, at(-20) - 1, y)).toBe(NONE)
    expect(getCell(dog, at(0), y)).toBe(STITCH)
  })

  it('writes the shaping as a pattern would', () => {
    const steps = shapingSteps(layoutSchematic(piece([[0, 10], [10, 10], [20, 20]]), gauge))
    expect(steps).toMatchObject([{ fromRow: 34, toRow: 64, fromStitches: 24, toStitches: 48 }])
    expect(describeShaping(steps[0]!, 'flat')).toBe('Increase 1 stitch at each edge every 2nd or 3rd row, 12 times')
    expect(describeShaping(steps[0]!, 'round')).toBe('Increase 2 stitches every 2nd or 3rd round, 12 times')
    const [bindOff] = shapingSteps(layoutSchematic(piece([[0, 20], [10, 20], [10, 10], [20, 10]]), gauge))
    expect(describeShaping(bindOff!, 'flat')).toBe('Bind off 24 stitches (12 stitches at each edge)')
    // 22 stitches over 9 rows: too many to shape a pair a row, so some are bound off first.
    const [armhole] = shapingSteps(layoutSchematic(piece([[0, 20], [10, 20], [12.5, 10.8], [20, 10.8]]), gauge))
    expect(armhole).toMatchObject({ fromStitches: 48, toStitches: 26 })
    expect(describeShaping(armhole!, 'flat')).toBe(`Bind off ${11 - (armhole!.toRow - armhole!.fromRow)} stitches at each edge, then decrease 1 stitch at each edge every row, ${armhole!.toRow - armhole!.fromRow} times`)
  })

})

describe('float analysis', () => {
  const floats = (issues: ReturnType<typeof analyzeRow>) =>
    issues.filter((i): i is FloatIssue => i.kind === 'float').map((i) => [i.yarn, i.length])

  it('flags floats longer than the limit', () => {
    expect(floats(analyzeRow(chart('1000001'), 0, 'flat'))).toEqual([])
    expect(floats(analyzeRow(chart('10000001'), 0, 'flat'))).toEqual([[1, 6]])
  })

  it('ignores a yarn knitted alone, since nothing is stranded', () => {
    expect(analyzeRow(chart('0000000000'), 0, 'flat')).toEqual([])
  })

  it('treats a gap as separate pieces when worked flat', () => {
    expect(floats(analyzeRow(chart('1000-0001'), 0, 'flat'))).toEqual([])
  })

  it('wraps around the round and skips decreased stitches', () => {
    // Within the row the 1s are 3 apart; around the join they're 3 or 6 apart.
    expect(floats(analyzeRow(chart('0001000100'), 0, 'round'))).toEqual([])
    expect(floats(analyzeRow(chart('00100010000'), 0, 'round'))).toEqual([[1, 6]])
    // Seven cells apart on the chart, but only three stitches once decreases are removed.
    expect(floats(analyzeRow(chart('1-0-0-0-1'), 0, 'round'))).toEqual([])
  })

  it('reports the cells a float passes behind', () => {
    const [issue] = analyzeRow(chart('100000001'), 0, 'flat', { maxFloat: 5 })
    expect(issue).toMatchObject({ kind: 'float', length: 7, cells: [1, 2, 3, 4, 5, 6, 7] })
  })
})

describe('numbering and instructions', () => {
  it('numbers rows from the bottom and stitches from the right', () => {
    expect(rowNumber(0, 10)).toBe(10)
    expect(rowNumber(9, 10)).toBe(1)
    expect(stitchNumber(0, 8)).toBe(8)
  })

  it('reads right-side rows right to left, wrong-side rows left to right when flat', () => {
    expect(readsRightToLeft(1, 'flat')).toBe(true)
    expect(readsRightToLeft(2, 'flat')).toBe(false)
    expect(readsRightToLeft(2, 'round')).toBe(true)
  })

  it('turns a row into runs in knitting order', () => {
    const grid = chart('0011', '1100')
    // Row 1 is the bottom row, read right to left.
    expect(rowRuns(grid, 1, 'flat')).toEqual([
      { kind: 'stitches', yarn: 0, stitch: 0, count: 2 },
      { kind: 'stitches', yarn: 1, stitch: 0, count: 2 },
    ])
    // Row 2 is a wrong-side row, read left to right, and purled: stockinette from the right side.
    expect(rowRuns(grid, 0, 'flat')).toEqual([
      { kind: 'stitches', yarn: 0, stitch: 0, count: 2 },
      { kind: 'stitches', yarn: 1, stitch: 0, count: 2 },
    ])
  })

  it('writes repeating rows as a repeat and a count, like a printed pattern', () => {
    // 0011 repeated 3 times, plus 0 left over, read right to left.
    expect(rowPattern(chart('00110011001100'), 0, 'round')).toEqual({
      repeat: [{ kind: 'stitches', yarn: 0, stitch: 0, count: 2 }, { kind: 'stitches', yarn: 1, stitch: 0, count: 2 }],
      stitchesPerRepeat: 4,
      times: 3,
      rest: [{ kind: 'stitches', yarn: 0, stitch: 0, count: 2 }],
    })
  })

  it('finds the shortest repeat, skipping decreases in the round and shaping at the ends when flat', () => {
    expect(rowPattern(chart('0-1-0-1'), 0, 'round')?.stitchesPerRepeat).toBe(2)
    expect(rowPattern(chart('--010101--'), 0, 'flat')?.times).toBe(3)
  })

  it('does not summarize rows that do not repeat or are worked in pieces', () => {
    expect(rowPattern(chart('0012'), 0, 'flat')).toBeNull()
    expect(rowPattern(chart('0101--0101'), 0, 'flat')).toBeNull()
  })

  it('marks separately worked pieces', () => {
    expect(rowRuns(chart('00--11'), 0, 'flat')).toEqual([
      { kind: 'stitches', yarn: 1, stitch: 0, count: 2 },
      { kind: 'gap' },
      { kind: 'stitches', yarn: 0, stitch: 0, count: 2 },
    ])
  })
})

describe('counts and lines', () => {
  it('counts stitches per yarn', () => {
    expect(yarnCounts(chart('011', '2-1'), 3)).toEqual([1, 3, 1])
  })

  it('draws lines between points', () => {
    expect(lineCells(0, 0, 3, 1)).toEqual([[0, 0], [1, 0], [2, 1], [3, 1]])
  })
})

describe('palette', () => {
  it('remaps cells when a yarn is removed', () => {
    expect(rowsOf(remapAfterRemoval(chart('0123'), 1, 0))).toEqual(['0012'])
    expect(rowsOf(remapAfterRemoval(chart('0123'), 1, 3))).toEqual(['0212'])
  })

  it('knows which colors need light text', () => {
    expect(isDark('#35322e')).toBe(true)
    expect(isDark('#ddc9a3')).toBe(false)
  })
})

describe('history', () => {
  it('undoes and redoes, and drops the redo stack on a new edit', () => {
    let h = startHistory(1)
    h = commit(h, 2)
    h = commit(h, 3)
    h = undo(h)
    expect(h.present).toBe(2)
    h = redo(h)
    expect(h.present).toBe(3)
    h = commit(undo(h), 4)
    expect(h.future).toEqual([])
    expect(undo(undo(undo(h))).present).toBe(1)
  })

  it('keeps a bounded number of steps', () => {
    let h = startHistory(0)
    for (let i = 1; i <= 5; i++) h = commit(h, i, 3)
    expect(h.past).toEqual([2, 3, 4])
  })
})

describe('motif library', () => {
  it('builds every motif with the chosen yarn and transparent background', () => {
    for (const motif of MOTIF_LIBRARY) {
      const grid = motif.build(3)
      expect(grid.cells.every((c) => c === 3 || c === NONE)).toBe(true)
      expect(grid.cells.includes(3)).toBe(true)
    }
  })

  it('starts new projects with no layers, on the plain background', () => {
    const project = createProject({ id: 'p', name: 'Hat', template: publishedPattern('hat'), now: 0 })
    expect(project.bands).toEqual([])
    expect(rectangle(2, 2).cells.every((c) => c === STITCH)).toBe(true)
    expect(createGrid(2, 1).cells).toEqual(new Uint8Array([NONE, NONE]))
  })
})

describe('saved motifs', () => {
  it('saves colors as slots and takes on the yarns of the project it is used in', () => {
    // Yarns 2 and 3 on a main color of 0.
    const saved = toSavedMotif(gridFromRows(['23', '0-'], { 0: 0, 2: 2, 3: 3, '-': NONE }), 0, 'm', 'Tree', 1)
    expect([...saved.grid.cells]).toEqual([0, 1, MAIN, NONE])
    // In a project painting with yarn 1: contrast 1 is yarn 1, contrast 2 the next yarn that isn't the main color.
    expect([...motifInYarns(saved.grid, 4, 0, 1).cells]).toEqual([1, 2, 0, NONE])
    // Painting with the main color: contrasts start from the first other yarn.
    expect([...motifInYarns(saved.grid, 2, 0, 0).cells]).toEqual([1, 1, 0, NONE])
  })
})

describe('gauge counted over any length', () => {
  it('sizes the same whatever length it was counted over', () => {
    const perTen = { stitches: 20, rows: 30 }
    const perFourInches = { stitches: 20 * 1.016, rows: 30 * 1.016, over: 10.16 }
    expect(widthCm(40, perFourInches)).toBeCloseTo(widthCm(40, perTen))
    expect(stitchesForCm(15, perFourInches)).toBe(stitchesForCm(15, perTen))
    expect(sameGauge(perTen, perFourInches)).toBe(true)
    expect(isValidGauge({ stitches: 23, rows: 30, over: 9.5 })).toBe(true)
    expect(isValidGauge({ stitches: 200, rows: 30, over: 1 })).toBe(false)
  })
})


describe('catching long floats', () => {
  it('spaces as few catches as it takes to keep every stretch within the limit', async () => {
    const { catchPoints } = await import('./floats')
    expect(catchPoints(5, 5)).toEqual([])
    expect(catchPoints(7, 5)).toEqual([4])
    expect(catchPoints(12, 5)).toEqual([4, 8])
    // Each stretch between catches (and the ends) stays within 5.
    const at = catchPoints(23, 5)
    const stretches = [at[0]!, ...at.slice(1).map((p, i) => p - at[i]!), 23 - at.at(-1)!]
    expect(Math.max(...stretches)).toBeLessThanOrEqual(5)
  })
})

describe('uniqueMotifName', () => {
  const grid = gridFromRows(['0'], { 0: 0 })
  const saved = [toSavedMotif(grid, 0, 'a', 'Tree', 1), toSavedMotif(grid, 0, 'b', 'Tree 2', 2)]

  it('numbers a name that is taken, by a saved motif or a built-in one', () => {
    expect(uniqueMotifName({ id: 'c', name: 'tree' }, saved, [])).toBe('tree 3')
    expect(uniqueMotifName({ id: 'c', name: 'Snowflake' }, saved, ['Snowflake'])).toBe('Snowflake 2')
    expect(uniqueMotifName({ id: 'c', name: 'Star' }, saved, ['Snowflake'])).toBe('Star')
  })

  it('lets a motif keep its own name', () => {
    expect(uniqueMotifName({ id: 'a', name: 'Tree' }, saved, [])).toBe('Tree')
  })
})
