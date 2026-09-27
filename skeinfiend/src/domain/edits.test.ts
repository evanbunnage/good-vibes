import { describe, expect, it } from 'vitest'
import { createBand } from './bands'
import { addBand, addYarn, takeLibraryVersion, removeBand, removeYarn, schematicOf, setGauge, setSchematic, updateBand } from './edits'
import { createExampleProject } from './example'
import { analyzeChart } from './floats'
import { gridFromRows, NONE } from './grid'
import { MAX_YARNS } from './palette'
import { composeChart, createProject } from './project'
import { builtInTemplate } from './pieces'
import { publishedPattern } from './published-patterns.fixture'

const base = () => createProject({ id: 'p', name: 'Test', template: builtInTemplate('swatch'), now: 0 })

describe('project edits', () => {
  it('removes a yarn everywhere it is used, keeping the rest pointing at the right yarns', () => {
    const project = {
      ...base(),
      background: 0,
      bands: [createBand('b', 'M', gridFromRows(['12'], { 1: 1, 2: 2 }), null)],
    }
    const next = removeYarn(project, 1)
    expect(next.yarns.map((y) => y.id)).toEqual(['natural', 'madder', 'indigo'])
    expect([...next.bands[0]!.motif.cells]).toEqual([NONE, 1]) // removed yarn goes transparent, not a phantom color
  })

  it('picks a new main color when the main color is removed', () => {
    const next = removeYarn({ ...base(), background: 2 }, 2)
    expect(next.background).toBe(0)
    expect(removeYarn({ ...base(), background: 0 }, 0).background).toBe(0)
  })

  it('never removes the last yarn, and caps how many can be added', () => {
    const one = { ...base(), yarns: base().yarns.slice(0, 1) }
    expect(removeYarn(one, 0)).toBe(one)
    let many = base()
    for (let i = 0; i < 30; i++) many = addYarn(many)
    expect(many.yarns.length).toBe(MAX_YARNS)
    expect(new Set(many.yarns.map((y) => y.id)).size).toBe(MAX_YARNS)
  })

  it('adds, updates, and removes bands', () => {
    const band = createBand('b', 'Dot', gridFromRows(['1'], { 1: 1 }), null)
    const added = addBand(addBand(base(), band), { ...band, id: 'c' })
    expect(updateBand(added, 'c', { offsetX: 3 }).bands.map((b) => b.offsetX)).toEqual([0, 3])
    expect(removeBand(added, 'b').bands.map((b) => b.id)).toEqual(['c'])
  })

  it('builds an example with visible snowflake and peerie bands', () => {
    const example = createExampleProject('e', 0)
    const counts = new Map<number, number>()
    for (const c of composeChart(example).cells) counts.set(c, (counts.get(c) ?? 0) + 1)
    expect(counts.get(3)).toBeGreaterThan(100) // indigo snowflakes
    expect(counts.get(2)).toBeGreaterThan(20) // madder peeries
  })

  it('offers an example that knits well: no long floats or crowded rows', () => {
    const example = createExampleProject('e', 0)
    expect(analyzeChart(composeChart(example), example.construction)).toEqual([])
  })

  it('keeps the design in place on the fabric when the gauge changes', () => {
    const project = createProject({ id: 'p', name: 'Hat', template: publishedPattern('hat'), gauge: { stitches: 20, rows: 20 }, now: 0 })
    const { height } = project.outline
    // A band 10 rows up (5 cm at 20 rows per 10 cm), 2 rows tall.
    const band = createBand('b', 'Dot', gridFromRows(['1', '1'], { 1: 1 }), { top: height - 12, bottom: height - 11 })
    const finer = setGauge({ ...project, bands: [band] }, { stitches: 20, rows: 40 })
    // Twice the rows per cm: 20 rows up, still 2 rows tall.
    expect(finer.outline.height).toBeGreaterThan(height)
    expect(finer.bands[0]!.rows).toEqual({ top: finer.outline.height - 22, bottom: finer.outline.height - 21 })
  })

  it('changes the schematic at any time, keeping layers the same distance above the cast-on edge', () => {
    const project = base()
    const band = createBand('b', 'Dot', gridFromRows(['1'], { 1: 1 }), { top: project.outline.height - 6, bottom: project.outline.height - 6 })
    const schematic = schematicOf(project)
    const taller = setSchematic({ ...project, bands: [band] }, { ...schematic, measurements: schematic.measurements.map((m) => (m.height > 0 ? { ...m, height: m.height * 2 } : m)) })
    expect(taller.outline.height).toBeGreaterThan(project.outline.height)
    expect(taller.bands[0]!.rows).toEqual({ top: taller.outline.height - 6, bottom: taller.outline.height - 6 })
  })

  it('keeps every part of the schematic through an edit: ribbing, and where it turns flat', () => {
    const project = base()
    const schematic = { ...schematicOf(project), sections: [{ id: 'rib', name: 'Rib', stitch: 'rib' as const, bottom: 0, height: 2 }], flatFrom: 5 }
    const edited = setSchematic(project, schematic)
    expect(schematicOf(edited)).toMatchObject({ sections: [{ id: 'rib' }], flatFrom: 5 })
  })

  it("keeps a published pattern's credit through edits", () => {
    const project = createProject({ id: 'p', name: 'P', template: publishedPattern('dog-sweater'), now: 0 })
    expect(project.piece.credit?.designer).toBe('CalicoRadio Knits')
    const edited = setSchematic(project, schematicOf(project))
    expect(edited.piece.credit?.designer).toBe('CalicoRadio Knits')
    expect('credit' in schematicOf(edited)).toBe(false)
  })
})

describe('sizes of a published pattern', () => {
  // Two sizes of a plain tube, 10 cm around (S) and 20 cm (M), 10 and 15 cm tall.
  const tube = (width: number, height: number) => ({
    kind: 'schematic' as const, multiple: 1, openings: [],
    measurements: [{ id: 'a', name: 'Cast on', height: 0, width }, { id: 'b', name: 'Top', height, width }],
  })
  const sized = async () => {
    const { setSizes } = await import('./edits')
    const project = { ...base(), gauge: { stitches: 20, rows: 20 }, bands: [createBand('b', 'Band', gridFromRows(['1'], { 1: 1 }), { top: 0, bottom: 0 })] }
    return setSizes(project, [{ name: 'S', shape: tube(10, 10) }, { name: 'M', shape: tube(20, 15) }])
  }

  it('shows the first size until one is picked, and switches with the colorwork kept from the cast-on', async () => {
    const { switchSize, sizeIndex } = await import('./edits')
    const project = await sized()
    expect([project.size, sizeIndex(project), project.outline.width, project.outline.height]).toEqual([undefined, 0, 20, 20])
    // The band 5 rows up from the cast-on stays 5 rows up in the other size.
    const placed = updateBand(project, 'b', { rows: { top: 14, bottom: 14 } })
    const m = switchSize(placed, 1)
    expect([m.size, m.outline.width, m.outline.height]).toEqual([1, 40, 30])
    expect(m.bands[0]!.rows).toEqual({ top: 24, bottom: 24 })
  })

  it('keeps changes made to the size shown when switching away and back', async () => {
    const { switchSize } = await import('./edits')
    const project = await sized()
    const edited = setSchematic(project, tube(12, 10))
    const back = switchSize(switchSize(edited, 1), 0)
    expect(back.outline.width).toBe(24)
    expect(schematicOf(back).measurements[0]!.width).toBe(12)
  })
})

describe('library motifs in charts', () => {
  it('takes a newer library version in the layer’s own yarns, in the same place', () => {
    const project = createProject({ id: 'p', name: 'P', template: builtInTemplate('swatch'), now: 0 })
    // Charcoal (1) dots, from a library motif saved at time 1.
    const band = { ...createBand('b', 'Dots', gridFromRows(['1.'], { 1: 1, '.': NONE }), { top: 3, bottom: 3 }), fromLibrary: { motifId: 'm', editedAt: 1 } }
    const saved = { id: 'm', name: 'Dots', grid: gridFromRows(['00'], { 0: 0 }), savedAt: 1, editedAt: 5 }
    const next = takeLibraryVersion({ ...project, bands: [band] }, 'b', saved)
    expect(Array.from(next.bands[0]!.motif.cells)).toEqual([1, 1])
    expect(next.bands[0]!.rows).toEqual({ top: 3, bottom: 3 })
    expect(next.bands[0]!.fromLibrary).toEqual({ motifId: 'm', editedAt: 5 })
  })
})
