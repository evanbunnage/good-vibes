import { bandSpan, bandStitchTile, bandTile, centeredOffset, createBand, MAX_SCALE, placementOf, scaledMotif, scaledStitches, type Band, type Placement } from '@/domain/bands'
import { uniqueName } from '@/domain/names'
import { MOTIF_LIBRARY } from '@/domain/motifs'
import { editedAt, MAIN, motifInYarns, sameDrawing, toSavedMotif, uniqueMotifName, type SavedMotif } from '@/domain/saved-motifs'
import type { Rotation } from '@/domain/transform'
import { KNIT, STITCHES, stitchNamed, stitchType } from '@/domain/stitches'
import { addBand, addYarn, adjustBand, dismissFloats, duplicateBand, removeBand, removeYarn, rename, renamePiece, reorderBand, schematicOf, setBackground, setConstruction, setGauge, setPlacement, setScale, setSchematic, setSizes, setSwatch, sizeIndex, switchSize, takeLibraryVersion, updateBand, updateYarn } from '@/domain/edits'
import { isValidGauge, rowsPerCm, stitchesPerCm, type Gauge } from '@/domain/gauge'
import { createGrid, MAX_SIZE, NONE, type Grid } from '@/domain/grid'
import { rowNumber } from '@/domain/numbering'
import { constructionOf, projectRowsWorked } from '@/domain/instructions'
import { writeRow, yarnLabels } from '@/domain/written'
import { isHexColor, MAX_YARNS, YARN_WEIGHTS, yarnCounts, type Yarn } from '@/domain/palette'
import { formatYarnLength, MARGIN, METERS_PER_YARD } from '@/domain/yarn-estimate'
import { layoutSchematic, ribRows } from '@/domain/pieces'
import type { Measurement, SchematicPiece } from '@/domain/pieces'
import { floatRulesOf, type Project } from '@/domain/project'
import type { EditorStore } from '@/editor/store'
import { renderChartImage } from '@/render/export-image'

/**
 * Tools for the designer's own AI agent ("bring your own agent"), over WebMCP:
 * the page offers them, and an agent the designer already uses reads a chart
 * from a photo or PDF and puts it on a piece in their yarns. Nothing is sent
 * anywhere from here; the agent does the reading.
 */
export interface AgentTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: object
  readonly execute: (input: Record<string, unknown>) => Promise<ToolResult> | ToolResult
}

export interface ToolResult {
  readonly content: ReadonlyArray<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }>
  readonly isError?: boolean
}

/** The knitter's own colorwork motifs, for the library tools: what's saved, saving, and removing. */
export interface LibraryAccess {
  motifs(): Promise<SavedMotif[]>
  putMotif(motif: SavedMotif): Promise<void>
  removeMotif(id: string): Promise<void>
  /** Told after a save or removal, so the page's list of motifs catches up. */
  changed(): void
}

class ToolError extends Error {}

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] })

const SECTIONS =
  'Worked in the round: the points around the shaping up to here is made at, a stitch at each, every so many rounds (“k2tog at each of 8 markers”): the chart shows them as wedges. As the pattern says: 8 for most crowns, 8 for a raglan’s 8 increases. Default: 2 or fewer a round are made where the round begins, and more at as few points as fit the counts, up to 8 every other round.'

const SHAPE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'What’s here, e.g. "Cast on" or "Underarm".' },
      row: { type: 'number', description: 'Rounds (or rows) worked so far: 0 where the part starts.' },
      stitches: { type: 'number', description: 'Stitches around (or across) here.' },
      sections: { type: 'number', description: SECTIONS },
    },
    required: ['row', 'stitches'],
  },
}

const RIB_SCHEMA = {
  type: 'array',
  description: 'Stretches worked in rib (a hem, a cuff, a collar), by rows worked where each starts and ends.',
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' } },
    required: ['from', 'to'],
  },
}

/** Turned upside down, not mirrored: a half turn, mirrored back. */
const UPSIDE_DOWN = { rotation: 180, mirror: true } as const

const layerRef = { type: 'string', description: 'The layer, by name or id (from get-chart).' }
const yarnRef = { type: 'string', description: 'A yarn in the chart, by name (or its number from get-chart, counting from 0: the first yarn is 0).' }
const GAUGE_SCHEMA = {
  type: 'object',
  properties: {
    stitches: { type: 'number' },
    rows: { type: 'number' },
    over: { type: 'number', description: 'Centimeters the stitches and rows are counted over: 10 for 10 cm, 10.16 for 4 inches.' },
  },
  required: ['stitches', 'rows'],
}

/** A library motif's chart as characters: "." clear, "M" the main color, and A, B… its contrast colors in order. */
function libraryChart(grid: Grid): string[] {
  // Contrast colors A, B, C…, skipping M, which is the main color.
  const letter = (c: number) => (c === NONE ? '.' : c === MAIN ? 'M' : 'ABCDEFGHIJKLNOPQRSTUVWXYZ'[c] ?? '?')
  return Array.from({ length: grid.height }, (_, y) => Array.from({ length: grid.width }, (_, x) => letter(grid.cells[y * grid.width + x]!)).join(''))
}

export function agentTools(store: EditorStore, library?: LibraryAccess): AgentTool[] {
  const needLibrary = (): LibraryAccess => {
    if (!library) throw new ToolError('The colorwork motif library isn’t available here.')
    return library
  }

  /** A motif from the library, by name: SkeinFiend's own, or one the knitter saved. */
  const findMotif = async (ref: unknown) => {
    const name = String(ref ?? '').trim().toLowerCase()
    const saved = library ? await library.motifs() : []
    const mine = saved.find((m) => m.name.toLowerCase() === name || m.id === name)
    if (mine) return { mine }
    const builtIn = MOTIF_LIBRARY.find((m) => m.name.toLowerCase() === name || m.id === name)
    if (builtIn) return { builtIn }
    throw new ToolError(`No colorwork motif "${ref}". See get-library for them all.`)
  }
  const yarnIndex = (ref: unknown, project = store.project): number => {
    const value = String(ref ?? '').trim()
    const byName = project.yarns.findIndex((y) => y.name.toLowerCase() === value.toLowerCase())
    const index = byName >= 0 ? byName : /^\d+$/.test(value) ? Number(value) : -1
    if (!project.yarns[index]) throw new ToolError(`No yarn "${value}". The yarns are: ${project.yarns.map((y) => y.name).join(', ')}.`)
    return index
  }

  const findLayer = (ref: unknown): Band => {
    const value = String(ref ?? '').trim()
    const lower = value.toLowerCase()
    const bands = store.project.bands
    // By id, by name, or by part of a name only one layer has ("triangles" for "DMC 1922, plate 1: triangles").
    const partly = lower ? bands.filter((b) => b.name.toLowerCase().includes(lower)) : []
    const named = bands.filter((b) => b.name.toLowerCase() === lower)
    if (named.length > 1) throw new ToolError(`More than one layer is called "${value}": give its id (${named.map((b) => b.id).join(', ')}), from get-chart.`)
    const band = bands.find((b) => b.id === value) ?? named[0] ?? (partly.length === 1 ? partly[0] : undefined)
    if (!band && partly.length > 1) throw new ToolError(`"${value}" is part of more than one layer's name: ${partly.map((b) => b.name).join(', ')}. Give the whole name.`)
    if (!band) throw new ToolError(`No layer "${value}". The layers are: ${store.project.bands.map((b) => b.name).join(', ') || 'none yet'}.`)
    return band
  }

  /** The chart rows a layer covers, `rows` tall with its bottom on knitted row `bottomRow` (row 1 is the cast-on). */
  const rowsFrom = (bottomRow: number, rows: number, project = store.project) => {
    const { height } = project.outline
    const bottom = Math.min(height - 1, Math.max(0, height - Math.round(bottomRow)))
    return { top: Math.max(0, bottom - rows + 1), bottom }
  }

  /**
   * Where a layer `rows` tall goes, bottom on knitted row `bottomRow`: a whole row on the piece, with room for
   * all of it below the top. Refused rather than cut short or moved (a chart taller than the piece is cut to it).
   */
  const placeRows = (bottomRow: unknown, rows: number, project = store.project) => {
    const { height } = project.outline
    const unit = project.construction === 'round' ? 'round' : 'row'
    const bottom = Number(bottomRow)
    if (!Number.isInteger(bottom) || bottom < 1 || bottom > height) throw new ToolError(`\`bottomRow\` is a whole ${unit} from 1 to ${height}, not ${JSON.stringify(bottomRow)}.`)
    const highest = height - Math.min(rows, height) + 1
    if (bottom > highest) throw new ToolError(`It's ${rows} ${unit}s tall, so its bottom ${unit} can be 1 to ${highest}: at ${bottom} it would run past the top (${unit} ${height}).`)
    return rowsFrom(bottom, rows, project)
  }
  /** A whole number of stitches or rows, from `min` up: said so if not. */
  const whole = (value: unknown, name: string, min = 0, max = Number.POSITIVE_INFINITY) => {
    const n = Number(value)
    if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`\`${name}\` is a whole number${max < Number.POSITIVE_INFINITY ? ` from ${min} to ${max}` : ` of ${min} or more`}, not ${JSON.stringify(value)}.`)
    return n
  }

  /**
   * Long floats, as the Floats panel counts them: on a layer's own rows, after placing or changing it (so it's
   * this layer's doing); or across the chart, after a change to the whole of it.
   */
  const floatNote = (id?: string) => {
    const band = id ? store.project.bands.find((b) => b.id === id) : undefined
    const span = band && bandSpan(band, store.project.outline.height)
    const rows = new Set(store.allIssues().map((i) => i.y).filter((y) => !span || (y >= span.top && y <= span.bottom))).size
    if (!rows) return ''
    const unit = store.project.construction === 'round' ? 'round' : 'row'
    const count = `${rows} ${rows === 1 ? `${unit} has` : `${unit}s have`}`
    return span ? ` ${rows === 1 ? `1 of its ${unit}s has` : `${count.replace(/^\d+ /, `${rows} of its `)}`} long floats: see get-chart's problems.` : ` ${count} long floats: see get-chart's problems.`
  }

  /** How a layer's repeat fits the rows it's on, for the result of placing it; and whether it's over the rib. */
  const fitNote = (id: string) => {
    const project = store.project
    const band = project.bands.find((b) => b.id === id)
    const fit = band && repeatFit(band, project)
    // Colors over the rib make corrugated rib; a layer with stitches of its own replaces the rib there, as it says.
    const colors = band && !band.stitches && band.motif.cells.some((c) => c !== NONE)
    const span = band && colors && !band.once && placementOf(band) !== 'tile' ? bandSpan(band, project.outline.height) : null
    const [first, last] = span ? [rowNumber(span.bottom, project.outline.height), rowNumber(span.top, project.outline.height)] : [0, -1]
    const rib = span ? ribRows(schematicOf(project), project.gauge, project.construction).find((r) => r.from <= last && r.to >= first) : undefined
    const onRib = rib ? ` It's on ${rib.name}, worked in k1, p1 rib (${project.construction === 'round' ? 'rounds' : 'rows'} ${rib.from}–${rib.to}): its colors there make corrugated rib (knit stitches in color, purls as they are); move it above if that isn't meant.` : ''
    return `${fit ? ` ${fit}` : ''}${onRib}`
  }

  const run = (execute: AgentTool['execute'], schema: AgentTool['inputSchema']): AgentTool['execute'] => async (input) => {
    try {
      // A name the tool doesn't take is refused, not ignored: an agent that misnames one would think it had done it.
      const known = Object.keys((schema as Schema).properties ?? {})
      const unknown = Object.keys(input ?? {}).filter((key) => !known.includes(key))
      if (unknown.length) {
        throw new ToolError(`This tool doesn’t take ${unknown.map((k) => `\`${k}\``).join(', ')}: nothing was changed. It takes ${known.length ? known.map((k) => `\`${k}\``).join(', ') : 'nothing'}.`)
      }
      // Checked against the tool's own schema first: a number that isn't one ("ten", NaN) is refused, not stored.
      const before = store.project
      const result = await execute((checkInput(input ?? {}, schema, '') ?? {}) as Record<string, unknown>)
      // The chart changed: all of it back in view, so what was done is on screen for the knitter watching.
      if (store.project !== before) store.fitChart()
      return result
    } catch (error) {
      if (!(error instanceof ToolError || error instanceof RangeError)) throw error
      return { ...text(error.message), isError: true }
    }
  }

  const tools: AgentTool[] = [
    {
      name: 'get-chart',
      description:
        'The colorwork chart open in SkeinFiend: the piece it goes on (its gauge, whether it’s knitted in the round or flat, its size in stitches and rows, and the named widths that shape it), the yarns, the colorwork layers stacked on it (each with its chart and settings), the float limit, and the knitter’s swatch. Rows are numbered as knitters do: row 1 is the cast-on row, at the bottom. Also lists rows with floats too long to knit comfortably (`problems`), rows carrying more than two colors (`tooManyColors`), and pattern yarns too close in lightness to the main color to read (`lowContrast`).',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => text(JSON.stringify(describe(store.project, store, library ? await library.motifs() : []), null, 1)),
    },
    {
      name: 'set-yarns',
      description:
        'Adds yarns, changes them, or removes them: a name, a color, which is the main color (knitted wherever no layer has a stitch). To try the chart in other colors, change the yarns rather than the charts: every layer follows. Also what each yarn is, from its ball band (a photo of the label, or the yarn’s page in a shop): brand, weight, fiber, a skein’s length and weight, and a link. With a skein’s length, estimate-yarn says how many skeins the chart takes. Give null to clear a detail. All the changes are one step the knitter can undo, so each colorway tried is one undo away from the last.',
      inputSchema: {
        type: 'object',
        properties: {
          yarns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                yarn: { ...yarnRef, description: 'The yarn to change, by name or number. Leave out to add a new one.' },
                name: { type: 'string', description: 'What the knitter calls it: a shade name, or the pattern’s letter ("A").' },
                hex: { type: 'string', description: 'Its color as #rrggbb.' },
                main: { type: 'boolean', description: 'Make it the main color.' },
                brand: { type: ['string', 'null'], description: 'The maker and yarn: "Jamieson’s Spindrift".' },
                weight: { type: ['string', 'null'], enum: [...YARN_WEIGHTS, null], description: 'The Craft Yarn Council weight. Jumper weight and 2-ply are fingering.' },
                fiber: { type: ['string', 'null'], description: '"100% Shetland wool".' },
                meters: { type: ['number', 'null'], description: 'Length of one skein in meters, from the ball band.' },
                yards: { type: ['number', 'null'], description: 'Or its length in yards.' },
                grams: { type: ['number', 'null'], description: 'Weight of one skein in grams.' },
                url: { type: ['string', 'null'], description: 'The yarn’s page.' },
                remove: { type: 'boolean', description: 'Remove this yarn. Its stitches in the layers go clear, so the main color shows; if it was the main color, another becomes it.' },
              },
            },
          },
        },
        required: ['yarns'],
      },
      execute: ({ yarns }) => {
        if (!Array.isArray(yarns) || !yarns.length) throw new ToolError('`yarns` must list the yarns to add or change.')
        let next = store.project
        const removing: string[] = []
        // Each yarn named as it was before this call: so two can swap names ("Sky" to "Cobalt", "Cobalt" to "Sky").
        const before = store.project
        const refs = (yarns as Array<Record<string, unknown>>).map((entry) => (entry.yarn === undefined ? undefined : yarnIndex(entry.yarn, before)))
        const mains = (yarns as Array<Record<string, unknown>>).filter((entry) => entry.main === true).length
        if (mains > 1) throw new ToolError('Only one yarn can be the main color.')
        for (const [n, entry] of (yarns as Array<Record<string, unknown>>).entries()) {
          const { name, hex, main } = entry
          if (entry.remove === true) {
            // Removed last, by name: removing shifts the others' numbers.
            removing.push(next.yarns[refs[n]!]!.name)
            continue
          }
          if (hex !== undefined && !isHexColor(String(hex))) throw new ToolError(`Color must be #rrggbb, not "${hex}".`)
          let index: number
          if (refs[n] === undefined) {
            if (next.yarns.length >= MAX_YARNS) throw new ToolError(`A chart has at most ${MAX_YARNS} yarns.`)
            index = next.yarns.length
            next = addYarn(next)
          } else index = refs[n]!
          next = updateYarn(next, index, { ...(name !== undefined && { name: String(name) }), ...(hex !== undefined && { hex: String(hex).toLowerCase() }), ...yarnDetails(entry) })
          if (main) next = setBackground(next, index)
        }
        for (const name of removing) {
          if (next.yarns.length <= 1) throw new ToolError('A chart needs at least one yarn.')
          next = removeYarn(next, yarnIndex(name, next))
        }
        // Yarns are found by name (in charts' keys, recoloring, the written rows' legend): no two can share one.
        const names = next.yarns.map((y) => y.name.trim().toLowerCase())
        const twice = next.yarns.find((y, i) => names.indexOf(y.name.trim().toLowerCase()) !== i)
        if (twice) throw new ToolError(`Two yarns would both be called "${twice.name}": each needs its own name.`)
        if (next.yarns.some((y) => !y.name.trim())) throw new ToolError('Each yarn needs a name.')
        const result = next
        store.update(() => result)
        const list = store.project.yarns.map((y, i) => `${y.name} ${y.hex}${i === store.project.background ? ' (main)' : ''}${describeYarn(y)}`).join('; ')
        const faint = colorProblems(store.project, store.knittedChart()).lowContrast
        return text(`Yarns: ${list}.${faint.length ? ` Low contrast: ${faint.join(' ')}` : ''}${floatNote()}`)
      },
    },
    {
      name: 'shape-piece',
      description:
        'Makes the piece from a pattern’s own numbers, to put colorwork on a part of it (a yoke, a sleeve, a hat’s body). Give its gauge and the stitch count after each stretch of shaping, as the pattern says “you should now have”: e.g. a top-down yoke that starts at 136 stitches (row 0) and has 336 after 40 rounds (row 40). Stitches in between change evenly. The chart is as many rounds tall as the last point. Layers already on the piece stay where they are. When the pattern gives sizes (“cast on 96 (96, 104, 112) sts”), give every size in `sizes` instead of `shape`: the knitter switches between them, with the colorwork on each, and picks theirs.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What the part is, e.g. "Yoke".' },
          worked: { type: 'string', enum: ['round', 'flat'] },
          gauge: {
            type: 'object',
            properties: {
              stitches: { type: 'number' },
              rows: { type: 'number' },
              over: { type: 'number', description: 'Centimeters the stitches and rows are counted over: 10 for 10 cm, 10.16 for 4 inches.' },
            },
            required: ['stitches', 'rows'],
          },
          shape: { ...SHAPE_SCHEMA, description: 'For one size: at least two points, first round first.' },
          rib: RIB_SCHEMA,
          sizes: {
            type: 'array',
            description: 'Every size the pattern gives, smallest first, each with its own shape (and rib, if it differs by size).',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'The size as the pattern names it: "S", "Adult M", "2".' },
                shape: SHAPE_SCHEMA,
                rib: RIB_SCHEMA,
              },
              required: ['name', 'shape'],
            },
          },
          size: { type: 'string', description: 'With `sizes`: the one to show, if the knitter said which is theirs. Otherwise the first is shown and they pick.' },
          credit: {
            type: 'object',
            description: 'The published pattern it comes from, to credit its designer.',
            properties: { designer: { type: 'string' }, pattern: { type: 'string' }, size: { type: 'string' }, url: { type: 'string' } },
          },
        },
        required: ['name', 'worked', 'gauge'],
      },
      execute: ({ name, worked, gauge, shape, rib, sizes, size, credit }) => {
        const g = gauge as Partial<Gauge> | undefined
        const measured: Gauge = { stitches: Number(g?.stitches), rows: Number(g?.rows), ...(g?.over !== undefined && { over: Number(g.over) }) }
        if (!isValidGauge(measured)) throw new ToolError('That gauge doesn’t look right: give stitches and rows, and the centimeters they’re counted over.')
        if (worked !== 'round' && worked !== 'flat') throw new ToolError('`worked` must be round or flat.')
        const given = Array.isArray(sizes) ? (sizes as Array<{ name?: string; shape?: unknown; rib?: unknown }>) : []
        if (!given.length && shape === undefined) throw new ToolError('Give the piece’s `shape`, or its `sizes`.')
        const points = [shape, ...given.map((s) => s.shape)].flatMap((sh) => (Array.isArray(sh) ? (sh as Array<{ sections?: unknown }>) : []))
        if (worked === 'flat' && points.some((p) => p.sections !== undefined)) throw new ToolError('`sections` is for shaping in the round: worked flat, the shaping is made at the edges.')
        const built = given.length
          ? given.map((s, i) => ({ name: String(s.name || `Size ${i + 1}`), ...schematicFrom(s.shape, s.rib ?? rib, measured, `Size ${s.name}: `) }))
          : [{ name: '', ...schematicFrom(shape, rib, measured) }]
        const shownName = size === undefined ? undefined : String(size).trim().toLowerCase()
        const shown = shownName === undefined ? undefined : built.findIndex((b) => b.name.toLowerCase() === shownName)
        if (shown === -1) throw new ToolError(`No size "${size}". The sizes are: ${built.map((b) => b.name).join(', ')}.`)
        const by = credit as { designer?: string; pattern?: string; size?: string; url?: string } | undefined
        store.update((p) => {
          let next = setConstruction(setGauge(p, measured), worked)
          next = built.length > 1
            ? setSizes(next, built.map((b) => ({ name: b.name, shape: b.schematic })), shown)
            : setSchematic(setSizes(next, []), built[0]!.schematic)
          next = renamePiece(next, String(name || 'Piece'))
          if (by?.designer && by.pattern) next = { ...next, piece: { ...next.piece, credit: { designer: by.designer, pattern: by.pattern, size: built.length > 1 ? '' : (by.size ?? ''), url: by.url ?? '' } } }
          return next
        })
        const { width, height } = store.project.outline
        const unit = worked === 'round' ? 'rounds' : 'rows'
        // Rib is worked straight: a stitch count that changes inside it would be increased (or decreased) in the rib.
        const layout = layoutSchematic(schematicOf(store.project), store.project.gauge, store.project.construction)
        const shapedRib = ribRows(schematicOf(store.project), store.project.gauge, store.project.construction)
          .find((r) => layout.rowStitches.slice(r.from - 1, r.to).some((n) => n !== layout.rowStitches[r.from - 1]))
        const ribNote = shapedRib ? ` The stitch count changes inside ${shapedRib.name} (${unit} ${shapedRib.from}–${shapedRib.to}): to work the rib straight, add a point with the cast-on count at row ${shapedRib.to}.` : ''
        if (built.length > 1) {
          const current = store.project.sizes?.[sizeIndex(store.project)]?.name
          return text(`The piece is now ${store.project.piece.name}, in ${built.length} sizes (${built.map((b) => b.name).join(', ')}). Showing ${current}: ${height} ${unit}, up to ${width} stitches.${shown === undefined ? ' The knitter picks their size at the top.' : ''}${ribNote}${floatNote()}`)
        }
        return text(`The piece is now ${store.project.piece.name}: ${height} ${unit}, up to ${width} stitches (${built[0]!.counts}).${ribNote}${floatNote()}`)
      },
    },
    {
      name: 'update-chart',
      description:
        'Changes the chart itself, as the knitter can: its name; the piece’s name, gauge, and whether it’s worked in the round or flat; the size shown, for a pattern with sizes; the piece’s widths, which shape it (add, change, rename, or remove them, in centimeters or the pattern’s own rows and stitches); the float limit; the knitter’s weighed swatch; and long floats to stop flagging. Everything given is one step the knitter can undo. Layers stay where they are on the fabric.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The chart’s name.' },
          piece: { type: 'string', description: 'The piece’s name, e.g. "Yoke".' },
          gauge: GAUGE_SCHEMA,
          worked: { type: 'string', enum: ['round', 'flat'] },
          size: { type: 'string', description: 'The size to show, by its name (from get-chart). Widths given here change that size.' },
          widths: {
            type: 'array',
            description: 'Widths to add or change, by name: a name the piece doesn’t have adds one. Each is how wide the piece is at a height up it; its outline runs straight between them.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Which width, e.g. "Cast on", "Underarm", "Top".' },
                rename: { type: 'string', description: 'A new name for it.' },
                height: { type: 'number', description: 'Centimeters up from the cast-on edge.' },
                width: { type: 'number', description: 'Centimeters across (around, in the round).' },
                row: { type: 'number', description: 'Or the pattern’s own count: rows worked to reach it (0 at the cast-on).' },
                stitches: { type: 'number', description: 'Or: stitches across (around) there.' },
                sections: { type: 'number', description: `${SECTIONS} 0 for the default.` },
              },
              required: ['name'],
            },
          },
          removeWidths: { type: 'array', items: { type: 'string' }, description: 'Widths to remove, by name. At least two stay.' },
          floatLimit: { type: 'number', description: 'The longest float, in centimeters, before a row is flagged: 2.5 is the usual rule.' },
          swatch: {
            type: ['object', 'null'],
            description: 'The knitter’s swatch, knitted in the colorwork: its size and weight make the yarn estimate their own (once every yarn has a skein’s length and weight, from set-yarns). null removes it.',
            properties: { width: { type: 'number', description: 'Centimeters.' }, height: { type: 'number', description: 'Centimeters.' }, grams: { type: 'number' } },
          },
          ignoreFloats: {
            description: 'Rows whose long floats the knitter is happy with (they’ll catch them, or the yarn is grippy), by number, or "all": they stop being flagged until they change.',
            oneOf: [{ type: 'array', items: { type: 'number' } }, { type: 'string', enum: ['all'] }],
          },
        },
      },
      execute: (input) => {
        const done: string[] = []
        store.update((p) => {
          let next = p
          if (input.name !== undefined) {
            if (!String(input.name).trim()) throw new ToolError('A chart needs a name.')
            next = rename(next, String(input.name).trim().slice(0, 200))
          }
          if (input.piece !== undefined) next = renamePiece(next, String(input.piece))
          if (input.gauge !== undefined) {
            const g = input.gauge as Partial<Gauge>
            const gauge: Gauge = { stitches: Number(g.stitches), rows: Number(g.rows), ...(g.over !== undefined && { over: Number(g.over) }) }
            if (!isValidGauge(gauge)) throw new ToolError('That gauge doesn’t look right: give stitches and rows, and the centimeters they’re counted over.')
            next = setGauge(next, gauge)
          }
          if (input.worked !== undefined) {
            if (input.worked !== 'round' && input.worked !== 'flat') throw new ToolError('`worked` is round or flat.')
            next = setConstruction(next, input.worked)
          }
          if (input.size !== undefined) {
            const sizes = next.sizes
            if (!sizes) throw new ToolError('This piece has one size: shape it with `sizes` in shape-piece to have several.')
            const index = sizes.findIndex((s) => s.name.toLowerCase() === String(input.size).trim().toLowerCase())
            if (index < 0) throw new ToolError(`No size "${input.size}". The sizes are: ${sizes.map((s) => s.name).join(', ')}.`)
            next = switchSize(next, index)
          }
          if (input.widths !== undefined || input.removeWidths !== undefined) next = setSchematic(next, editWidths(schematicOf(next), next, input.widths, input.removeWidths))
          if (input.floatLimit !== undefined) {
            const cm = Number(input.floatLimit)
            if (!(cm > 0)) throw new ToolError('`floatLimit` is a length in centimeters, like 2.5.')
            next = { ...next, floatRules: { ...next.floatRules, maxFloatCm: cm } }
          }
          if (input.swatch !== undefined) {
            const sw = input.swatch as { width?: unknown; height?: unknown; grams?: unknown } | null
            const [w, h, g] = [Number(sw?.width), Number(sw?.height), Number(sw?.grams)]
            if (sw && !(w > 0 && h > 0 && g > 0)) throw new ToolError('Give the swatch’s width and height in centimeters, and its weight in grams (or null to remove it).')
            next = setSwatch(next, sw ? { widthCm: w, heightCm: h, grams: g } : undefined)
          }
          if (input.ignoreFloats !== undefined) {
            const { height } = next.outline
            const flagged = new Map<number, ReturnType<typeof store.issues>>()
            for (const issue of store.issues(next)) flagged.set(issue.y, [...(flagged.get(issue.y) ?? []), issue])
            const wanted = input.ignoreFloats === 'all' ? [...flagged.keys()] : (Array.isArray(input.ignoreFloats) ? input.ignoreFloats : []).map((r) => height - Math.round(Number(r)))
            const ignoring = wanted.filter((y) => flagged.has(y))
            next = ignoring.reduce((n, y) => dismissFloats(n, y, flagged.get(y)!), next)
            done.push(ignoring.length ? `Ignoring long floats in rows ${ignoring.map((y) => height - y).sort((a, b) => a - b).join(', ')}, until they change.` : 'None of those rows have long floats flagged.')
          }
          return next
        })
        const project = store.project
        const { width, height } = project.outline
        const widths = [...project.piece.measurements].sort((a, b) => a.height - b.height).map((m) => `${m.name} ${round1(m.width)} cm at ${round1(m.height)} cm`).join(', ')
        return text(`"${project.name}": ${project.piece.name}, ${height} ${project.construction === 'round' ? 'rounds' : 'rows'}, up to ${width} stitches. Widths: ${widths}.${done.length ? ` ${done.join(' ')}` : ''}${floatNote()}`)
      },
    },
    {
      name: 'add-layer',
      description:
        'Adds a colorwork chart as a layer on the piece: a chart read from a pattern, or a colorwork motif from the library (`motif`, see get-library). Write a chart one character per stitch, rows top first, exactly as it reads on the page (the bottom row is knitted first, stitches as seen). `key` says which yarn each character is. "main" is see-through: the main color, or a layer behind, shows there (so layers can stack); the main yarn by its name (e.g. "Natural") is solid, covering what’s behind. Add " purl" for purl stitches (the chart’s dot or dash symbol): "Canary purl", or "main purl" for a purl in the main color. Everything else is knit. A layer with purls (or other stitches) sets every stitch in its area, knit where the chart says knit; one that’s only colors leaves the stitches as they are (over the piece’s rib, that makes corrugated rib). Placement: "row" repeats it across the piece over its rows (a yoke or brim band), "tile" repeats it all over (or, with bottomRow and topRow, over those rows only), "single" puts one copy in the middle (duplicate stitched after knitting until update-layer’s afterKnitting: false).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What the chart is called, e.g. "Chart A". Default: the motif’s name.' },
          motif: { type: 'string', description: 'Instead of `rows` and `key`: a colorwork motif from the library, by name (see get-library).' },
          yarn: { ...yarnRef, description: 'With `motif`: the yarn for its first contrast color. Default: the first yarn that isn’t the main color.' },
          rows: { type: 'array', items: { type: 'string' }, description: 'The chart, top row first, one character per stitch. Every row the same length.' },
          key: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Each character used, to a yarn name from get-chart (or "main" to show the main color), a stitch, or both: "Madder", "k1 tbl", "main purl", "Madder k2tog". Stitches: purl, k1 tbl, yo, k2tog, ssk, M1, M1L, M1R, M1 p-st, sl, bobble, no stitch; anything else is knit. Match the chart’s own key to these: books draw them differently (a dash or a dot for purl, a loop for k1 tbl). E.g. {".": "main", "X": "Madder", "-": "purl", "Q": "k1 tbl"}.',
          },
          placement: { type: 'string', enum: ['row', 'tile', 'single'] },
          bottomRow: { type: 'number', description: 'The knitted row the chart’s bottom row falls on (row 1 is the cast-on). Defaults to a free spot (for a tile, the cast-on).' },
          topRow: { type: 'number', description: 'For "row" or "tile": the last row it covers, its chart repeating up to it (e.g. a tile from row 44 to the top). Default: the chart’s own height (a tile: the top).' },
          gapUp: { type: 'number', description: 'Rows of main color between repeats stacked up, when the chart repeats up its rows.' },
          gap: { type: 'number', description: 'Stitches of main color between repeats across. Default 0 (or the motif’s own spacing).' },
          upsideDown: { type: 'boolean', description: 'Flip the chart top to bottom: for a piece knitted top-down (a yoke from the neck), so a chart drawn bottom-up still reads the right way up when worn. To turn a motif round instead (the far end of a scarf, so it reads upright hanging down), use update-layer’s rotation: 180.' },
        },
        required: ['placement'],
      },
      execute: async ({ name, motif, yarn, rows, key, placement, bottomRow, topRow, gapUp, gap, upsideDown }) => {
        const project = store.project
        let chart: Grid
        let stitches: Grid | null = null
        let spacing = 0
        let fromLibrary: Band['fromLibrary']
        let motifName: string | undefined
        if (motif !== undefined) {
          // As the knitter adds one from the strip: in this chart's yarns, remembering where it came from.
          const found = await findMotif(motif)
          const contrast = yarn !== undefined ? yarnIndex(yarn) : (project.background + 1) % project.yarns.length
          if (found.builtIn) {
            chart = found.builtIn.build(contrast)
            spacing = found.builtIn.spacing
            fromLibrary = { motifId: `built-in:${found.builtIn.id}`, editedAt: 0 }
            motifName = found.builtIn.name
          } else {
            chart = motifInYarns(found.mine!.grid, project.yarns.length, project.background, contrast)
            stitches = found.mine!.stitches ?? null
            fromLibrary = { motifId: found.mine!.id, editedAt: editedAt(found.mine!) }
            motifName = found.mine!.name
          }
        } else {
          ;({ colors: chart, stitches } = parseChart(rows, key, (ref) => yarnIndex(ref)))
        }
        if (motif !== undefined && (rows !== undefined || key !== undefined)) throw new ToolError('Give a library `motif`, or `rows` and `key`: not both.')
        const asked = placementFrom(placement)
        // A tile over some rows only (from bottomRow, to topRow or the top) is a band its chart repeats up.
        const partTile = asked === 'tile' && (bottomRow !== undefined || topRow !== undefined)
        const where = partTile ? 'band' : asked
        const height = project.outline.height
        const bottomAt = bottomRow ?? (partTile ? 1 : undefined)
        if (topRow !== undefined && asked === 'single') throw new ToolError('A single motif is its own height: `topRow` is for "row" or "tile".')
        const top = topRow === undefined ? (partTile ? height : undefined) : whole(topRow, 'topRow', 1, height)
        if (top !== undefined && bottomAt !== undefined && top < Number(bottomAt)) throw new ToolError(`\`topRow\` (${top}) is below \`bottomRow\` (${bottomAt}).`)
        const covers = top !== undefined ? top - Number(bottomAt ?? 1) + 1 : chart.height
        const span = bottomAt === undefined ? store.rowsForNewBand(covers) : placeRows(bottomAt, covers)
        const gapX = gap === undefined ? spacing : whole(gap, 'gap', 0, project.outline.width)
        const width = project.outline.width
        const band: Band = {
          // A name no other layer has: layers are found by name, so two can't share one.
          ...createBand(crypto.randomUUID(), uniqueName(String(name || motifName || `Chart ${project.bands.length + 1}`), project.bands.map((b) => b.name), 'Colorwork'), chart, where === 'tile' ? null : span),
          gapX,
          offsetX: where === 'single' ? Math.floor((width - chart.width) / 2) : centeredOffset(width, chart.width, gapX),
          ...(where === 'single' && { once: true, afterKnitting: true }),
          ...(gapUp !== undefined && { gapY: whole(gapUp, 'gapUp', 0, height) }),
          ...(stitches && { stitches }),
          ...(fromLibrary && { fromLibrary }),
          ...(upsideDown === true && UPSIDE_DOWN),
        }
        // Just on the chart, as the knitter's Add to chart puts one: not selected, so the chart isn't faded around it.
        store.update((p) => addBand(p, band))
        // What isn't obvious from where it went: a single motif is duplicate stitched, and a chart running off the top is cut short.
        const stitched = where === 'single' ? ' To knit it in instead, update-layer with afterKnitting: false.' : ''
        const placedSpan = where === 'tile' ? null : bandSpan(band, store.project.outline.height)
        const cut = placedSpan && placedSpan.bottom - placedSpan.top + 1 < chart.height ? ` Only ${placedSpan.bottom - placedSpan.top + 1} of its ${chart.height} rows fit below the top of the piece.` : ''
        return text(`Added "${band.name}" (${chart.width} × ${chart.height}) ${placed(band, store.project)}.${stitched}${cut}${fitNote(band.id)}${floatNote(band.id)}`)
      },
    },
    {
      name: 'update-layer',
      description: 'Changes a layer, as the knitter can in its window: its name, which rows it sits on, how it repeats, its spacing, its scale (each stitch knitted as a block), its turn and mirroring, whether a single motif is duplicate stitched after knitting, whether it shows, where it is in the stack (a layer in front covers the ones behind), its chart, one yarn for another, or the newer version of the library motif it came from. Or makes a copy of it. One step the knitter can undo.',
      inputSchema: {
        type: 'object',
        properties: {
          layer: layerRef,
          name: { type: 'string' },
          placement: { type: 'string', enum: ['row', 'tile', 'single'] },
          bottomRow: { type: 'number', description: 'The knitted row its bottom falls on (row 1 is the cast-on).' },
          rows: { type: 'number', description: 'How many rows the band covers; its chart repeats up them.' },
          gap: { type: 'number', description: 'Stitches between repeats across.' },
          gapUp: { type: 'number', description: 'Rows between repeats stacked up the piece, for a tiled layer.' },
          shift: { type: 'number', description: 'Stitches to move the repeats (or single motif) by: right, or left if negative. It adds to where it is (get-chart’s `shift`, from its centered place); to put it back, move it by minus that.' },
          scale: { type: 'number', description: 'How much larger to knit the chart, 1 to 4 in tenths: 1.5 makes a 14-stitch chart 21 stitches, doubling some stitches.' },
          visible: { type: 'boolean' },
          order: { type: 'string', enum: ['front', 'back', 'forward', 'backward'], description: 'Moves it in the stack: to the front or back, or one step.' },
          rotation: { type: 'number', enum: [0, 90, 180, 270], description: 'Degrees turned clockwise. Upside down, for a piece knitted top-down, is 180 with `mirror`.' },
          mirror: { type: 'boolean', description: 'Flipped left to right.' },
          afterKnitting: { type: 'boolean', description: 'For a single motif: duplicate stitched after knitting, rather than knitted in (so it makes no floats).' },
          duplicate: { type: 'boolean', description: 'Make a copy of the layer, in the next free rows.' },
          updateFromLibrary: { type: 'boolean', description: 'Take the newer version of the library motif this layer came from (get-chart says when there is one).' },
          recolor: {
            type: 'object',
            properties: { from: yarnRef, to: yarnRef },
            description: 'Switch one yarn for another in this layer only.',
          },
          chart: {
            type: 'object',
            description: 'A new chart for the layer, as add-layer takes it: to fix a misread, or add its stitches. It keeps its place.',
            properties: { rows: { type: 'array', items: { type: 'string' } }, key: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['rows', 'key'],
          },
        },
        required: ['layer'],
      },
      execute: async (input) => {
        const band = findLayer(input.layer)
        const { id } = band
        // Painted stitch by stitch, one layer stitch per chart stitch: moving or reshaping it would scramble them.
        const fixed = ['placement', 'bottomRow', 'rows', 'gap', 'gapUp', 'shift', 'scale', 'rotation', 'mirror', 'afterKnitting', 'duplicate', 'updateFromLibrary', 'chart'].filter((k) => input[k] !== undefined)
        if (band.painted && fixed.length) {
          throw new ToolError(`"${band.name}" is painted stitch by stitch, so it can't take ${fixed.join(', ')}: it can be renamed, hidden, reordered, or recolored. Change its stitches with paint-stitches.`)
        }
        if (input.duplicate === true) {
          const span = bandSpan(band, store.project.outline.height)
          const copyId = crypto.randomUUID()
          store.update((p) => {
            const copied = duplicateBand(p, id, copyId, store.rowsForNewBand(span.bottom - span.top + 1))
            // Its own name, as every layer has: "Tree copy", "Tree copy 2"…
            const made = copied.bands.find((b) => b.id === copyId)
            return made ? updateBand(copied, copyId, { name: uniqueName(made.name, copied.bands.filter((b) => b.id !== copyId).map((b) => b.name), 'Colorwork') }) : copied
          })
          const copy = findLayer(copyId)
          return text(`Made "${copy.name}", ${placed(copy, store.project)}.${floatNote(copyId)}`)
        }
        // The newer version of its library motif, fetched first: taking it is part of this one step.
        let newer: SavedMotif | undefined
        if (input.updateFromLibrary === true) {
          const saved = band.fromLibrary && library ? (await library.motifs()).find((m) => m.id === band.fromLibrary!.motifId) : undefined
          if (!saved || editedAt(saved) <= band.fromLibrary!.editedAt) throw new ToolError(`"${band.name}" is already its library motif's latest version, or didn't come from one of the knitter's saved motifs.`)
          newer = saved
        }
        const was = layerState(store.project, id)
        store.update((p) => {
          let next = p
          const current = () => next.bands.find((b) => b.id === id)!
          if (input.name !== undefined) {
            if (!String(input.name).trim()) throw new ToolError('A layer needs a name.')
            next = updateBand(next, id, { name: uniqueName(String(input.name), next.bands.filter((b) => b.id !== id).map((b) => b.name), 'Colorwork') })
          }
          if (newer) next = takeLibraryVersion(next, id, newer)
          if (input.scale !== undefined) {
            const scale = Number(input.scale)
            if (scale < 1 || scale > MAX_SCALE) throw new ToolError(`\`scale\` is from 1 to ${MAX_SCALE}, not ${scale}.`)
            next = setScale(next, id, scale)
          }
          // As the layer window does it: a single motif is centered, and duplicate stitched unless said otherwise.
          if (input.placement !== undefined) next = setPlacement(next, id, placementFrom(input.placement), store.rowsForNewBand(bandTile(current()).height))
          if (input.afterKnitting !== undefined) {
            if (!current().once) throw new ToolError('Only a single motif (placement "single") is duplicate stitched after knitting.')
            next = adjustBand(next, id, { afterKnitting: Boolean(input.afterKnitting) })
          }
          if (input.bottomRow !== undefined || input.rows !== undefined) {
            const span = bandSpan(current(), next.outline.height)
            // Its own height kept: moved near the top, it's refused rather than cut short (and short for good).
            // A tile, or a layer tiled up to the top of the piece: moving its bottom keeps it reaching the top.
            const tiled = current().rows === null || (span.top === 0 && span.bottom - span.top + 1 > bandTile(current()).height)
            const bottom = input.bottomRow !== undefined ? input.bottomRow : rowNumber(span.bottom, next.outline.height)
            // A tile given a bottom row covers from there to the top (its chart repeating up), unless told how many rows.
            const toTop = next.outline.height - Number(bottom) + 1
            const height = input.rows !== undefined ? whole(input.rows, 'rows', 1, next.outline.height) : tiled ? toTop : Math.max(span.bottom - span.top + 1, bandTile(current()).height)
            next = updateBand(next, id, { rows: placeRows(bottom, height, next) })
          }
          if (input.gap !== undefined) next = adjustBand(next, id, { gapX: whole(input.gap, 'gap', 0, next.outline.width) })
          if (input.gapUp !== undefined) next = adjustBand(next, id, { gapY: whole(input.gapUp, 'gapUp', 0, next.outline.height) })
          if (input.shift !== undefined) next = updateBand(next, id, { offsetX: current().offsetX + whole(input.shift, 'shift', -next.outline.width, next.outline.width) })
          if (input.visible !== undefined) next = updateBand(next, id, { visible: Boolean(input.visible) })
          if (input.order !== undefined) {
            // Layers are kept back to front.
            const at = next.bands.findIndex((b) => b.id === id)
            const to = { front: next.bands.length - 1, back: 0, forward: at + 1, backward: at - 1 }[String(input.order) as 'front']
            if (to === undefined) throw new ToolError('`order` is front, back, forward, or backward.')
            next = reorderBand(next, id, Math.max(0, Math.min(next.bands.length - 1, to)))
          }
          if (input.rotation !== undefined) {
            const rotation = Number(input.rotation)
            if (![0, 90, 180, 270].includes(rotation)) throw new ToolError('`rotation` is 0, 90, 180, or 270.')
            next = adjustBand(next, id, { rotation: rotation as Rotation })
          }
          if (input.mirror !== undefined) next = adjustBand(next, id, { mirror: Boolean(input.mirror) })
          const chart = input.chart as { rows?: unknown; key?: unknown } | undefined
          if (chart) {
            const { colors, stitches } = parseChart(chart.rows, chart.key, (ref) => yarnIndex(ref, next))
            // Rows follow the new chart's height, as when a motif's resized.
            const before = current()
            next = adjustBand(next, id, { motif: colors, stitches: stitches ?? undefined, details: undefined })
            // A single motif keeps its middle where it was (centered stays centered), not its left edge.
            if (before.once) {
              const middle = before.offsetX + bandTile(before).width / 2
              next = updateBand(next, id, { offsetX: Math.round(middle - bandTile(current()).width / 2) })
            }
          }
          const recolor = input.recolor as { from?: unknown; to?: unknown } | undefined
          if (recolor) {
            const [from, to] = [yarnIndex(recolor.from, next), yarnIndex(recolor.to, next)]
            const swap = (grid: Grid) => ({ ...grid, cells: grid.cells.map((c) => (c === from ? to : c)) })
            const b = current()
            next = updateBand(next, id, { motif: swap(b.motif), details: b.details && Object.fromEntries(Object.entries(b.details).map(([s, g]) => [s, swap(g)])) })
          }
          return next
        })
        const after = findLayer(id)
        // Given only what it already was: said so, so it's not taken for a change.
        if (layerState(store.project, id) === was) {
          const given = Object.keys(input).filter((k) => k !== 'layer')
          return text(`Nothing changed in "${after.name}": ${given.length ? `it already had the ${given.map((k) => `\`${k}\``).join(', ')} given` : 'give what to change (see the tool’s inputs)'}. It's ${placed(after, store.project)}.`)
        }
        // What changed that its place doesn't say.
        const recolor = input.recolor as { from?: unknown; to?: unknown } | undefined
        const done = [
          input.chart && 'Its chart is replaced.',
          newer && `It has the library's newer "${newer.name}".`,
          recolor && `${String(recolor.from)} is now ${String(recolor.to)} in it.`,
          input.shift !== undefined && `Shifted ${after.offsetX - band.offsetX === 0 ? 'nowhere' : `${Math.abs(after.offsetX - band.offsetX)} stitches ${after.offsetX > band.offsetX ? 'right' : 'left'}`}.`,
        ].filter(Boolean).join(' ')
        return text(`${done ? `${done} ` : ''}"${after.name}" is ${placed(after, store.project)}.${fitNote(id)}${floatNote(id)}`)
      },
    },
    {
      name: 'render-chart',
      description:
        'A picture of the chart, to check it against the pattern it came from: the whole piece in its yarns, with row numbers up the side (row 1 at the bottom) and each stitch’s symbol (a dash for purl, / for k2tog…). Give `fromRow` and `toRow` for just those rows (a crown, one band), or a layer to see one repeat of its chart, larger. With `floats`, long floats are drawn out, and rows with them marked.',
      inputSchema: {
        type: 'object',
        properties: {
          layer: { ...layerRef, description: 'Just this layer’s chart, by name or id. Leave out for the whole piece.' },
          floats: { type: 'boolean', description: 'Draw the long floats over the whole piece.' },
          fromRow: { type: 'number', description: 'The lowest row to show (1 is the cast-on). Default: 1.' },
          toRow: { type: 'number', description: 'The highest row to show. Default: the top.' },
        },
      },
      execute: ({ layer, floats, fromRow, toRow }) => {
        const project = store.project
        let canvas: HTMLCanvasElement
        if (layer === undefined) {
          const chart = store.chart()
          const issues = store.allIssues()
          const [low, high] = [whole(fromRow ?? 1, 'fromRow', 1, chart.height), whole(toRow ?? chart.height, 'toRow', 1, chart.height)]
          if (low > high) throw new ToolError(`\`fromRow\` (${low}) is above \`toRow\` (${high}).`)
          canvas = renderChartImage(project, chart, clamp(Math.floor(1100 / chart.width), 4, 16), 1, store.stitches(), {
            ...(floats === true && { floats: { issues, strands: issues, maxFloat: floatRulesOf(project).maxFloat, issueRows: [...new Set(issues.map((i) => i.y))] } }),
            ...((low > 1 || high < chart.height) && { rows: { top: chart.height - high, bottom: chart.height - low } }),
          })
        } else {
          if (fromRow !== undefined || toRow !== undefined) throw new ToolError('`fromRow` and `toRow` are for the whole piece: a layer’s chart is shown whole.')
          const band = findLayer(layer)
          const tile = bandTile(band)
          const onMain = { ...tile, cells: tile.cells.map((c) => (c === NONE ? project.background : c)) }
          canvas = renderChartImage(project, onMain, clamp(Math.floor(600 / tile.width), 8, 32), 1, bandStitchTile(band))
        }
        const data = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
        return { content: [{ type: 'image', data, mimeType: 'image/png' }] }
      },
    },
    {
      name: 'estimate-yarn',
      description:
        `How much of each yarn the piece takes, in the size shown: stitches in it, stitches its floats pass behind, and meters (with ${Math.round(MARGIN * 100)}% extra for the swatch and weaving in). With a skein’s length and weight from set-yarns, also grams and skeins. From the gauge unless the knitter weighed a swatch (update-chart’s swatch). For another size, show it first (update-chart’s size).`,
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const project = store.project
        const estimate = store.estimate()
        if (!estimate.yarns.length) return text('Nothing is knitted yet: the piece has no stitches.')
        const lines = estimate.yarns.map((e) => {
          const y = project.yarns[e.yarn]!
          // As the knitter sees it in the Yarns panel: rounded up to 5, as patterns give it.
          const amounts = [`about ${formatYarnLength(e.meters, 'cm')} (${formatYarnLength(e.meters, 'in')})`, e.grams !== null && `${Math.ceil(e.grams)} g`, e.skeins !== null && `${e.skeins} skein${e.skeins === 1 ? '' : 's'}`].filter(Boolean).join(', ')
          const missing = e.skeins === null ? '; no skein length given' : ''
          return `${y.name}: ${amounts} for ${e.stitches} stitches and floats behind ${e.floatStitches}${missing}.`
        })
        const size = project.sizes?.length ? ` Size ${project.sizes[sizeIndex(project)]?.name}.` : ''
        const basis = estimate.fromSwatch
          ? `From the knitter’s swatch: ${estimate.perStitchCm.toFixed(2)} cm of yarn a stitch.`
          : `From the gauge: about ${estimate.perStitchCm.toFixed(2)} cm of yarn a stitch${project.swatch ? ' (the swatch can’t be used until every yarn in the chart has a skein’s length and weight)' : ''}. A weighed swatch makes it the knitter’s own.`
        return text(`${lines.join('\n')}\n${basis}${size}`)
      },
    },
    {
      name: 'get-written-rows',
      description: 'The chart written out row by row, as a pattern writes it ("Rnd 12: *k2 MC, k1 CC; rep from * to end. (144 sts)"), with its yarns as MC, CC1…. Compare it with the pattern’s written instructions, where it has them, to catch a misread chart. Rows are numbered from 1 at the cast-on.',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'number', description: 'First row, from 1. Default 1.' }, to: { type: 'number', description: 'Last row. Default: 60 rows on, or the top.' } },
      },
      execute: ({ from, to }) => {
        const project = store.project
        const chart = store.knittedChart()
        const stitches = store.stitches(project, { knitted: true })
        const labels = yarnLabels(yarnCounts(chart, project.yarns.length), project.background)
        const worked = projectRowsWorked(project)
        const unit = project.construction === 'round' ? 'Rounds' : 'Rows'
        const first = Math.max(1, Math.round(Number(from ?? 1)))
        const last = Math.min(chart.height, Math.round(Number(to ?? first + 59)))
        if (to !== undefined && Number(to) < 1) throw new ToolError(`\`to\` is a ${unit.toLowerCase().slice(0, -1)} from 1 to ${chart.height}, not ${to}.`)
        if (first > chart.height) throw new ToolError(`\`from\` is past the top: the chart has ${unit.toLowerCase()} 1 to ${chart.height}.`)
        if (first > last) throw new ToolError(`\`from\` (${from}) is after \`to\` (${to}).`)
        const finished = store.chart()
        const lines: Array<{ row: number; heading: string; body: string }> = []
        for (let row = first; row <= last; row++) {
          const y = chart.height - row
          const how = worked(y)
          const written = writeRow(chart, y, constructionOf(how), how.since, stitches, labels, project.background)
          // Stitched on after knitting: not in the row as knitted, but not forgotten either, and where.
          const after = project.bands.filter((b) => b.visible && b.afterKnitting && (({ top, bottom }) => y >= top && y <= bottom)(bandSpan(b, chart.height)))
          const where = after.length ? duplicateStitches(finished, chart, y, project) : ''
          const then = after.length ? ` Afterwards, duplicate stitch ${after.map((b) => `"${b.name}"`).join(' and ')} on this ${project.construction === 'round' ? 'round' : 'row'}${where ? `: ${where}` : ''}.` : ''
          lines.push({ row, heading: written.heading, body: `${written.text}${written.stitches ? ` (${written.stitches} sts)` : ''}${then}` })
        }
        // Rounds alike one after another as one line, as patterns write them ("Rnds 24–57: With MC, k144.").
        // Flat rows alternate sides, so each is its own.
        const grouped: string[] = []
        for (let i = 0; i < lines.length; ) {
          let j = i
          while (project.construction === 'round' && j + 1 < lines.length && lines[j + 1]!.body === lines[i]!.body && lines[j + 1]!.heading.startsWith('Rnd')) j++
          grouped.push(j > i ? `Rnds ${lines[i]!.row}–${lines[j]!.row}: ${lines[i]!.body}` : `${lines[i]!.heading}: ${lines[i]!.body}`)
          i = j + 1
        }
        const key = [...labels].map(([yarn, label]) => `${label} = ${project.yarns[yarn]?.name}`).join(', ')
        return text(`${key}\n${grouped.join('\n')}${last < chart.height ? `\n(${unit} ${last + 1}–${chart.height} follow.)` : ''}`)
      },
    },
    {
      name: 'paint-stitches',
      description: 'Paints single stitches on the chart, for small fixes a layer can’t make: each a yarn, a stitch, or both, by row (1 at the cast-on) and stitch (counted along the row’s own stitches from its right end, as seen from the right side, on every row: stitch 1 is the rightmost, on wrong-side rows too), or erases them. A yarn alone changes only the color: to take a purl back to knit, give type "knit". They go in the chart’s “Drawn colorwork” layer, on top. One step the knitter can undo.',
      inputSchema: {
        type: 'object',
        properties: {
          stitches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                row: { type: 'number' },
                stitch: { type: 'number' },
                yarn: yarnRef,
                type: { type: 'string', description: 'A stitch, as in add-layer’s key: "purl", "k2tog"…' },
                erase: { type: 'boolean', description: 'Clear what was painted here, so the layers below show.' },
              },
              required: ['row', 'stitch'],
            },
          },
        },
        required: ['stitches'],
      },
      execute: ({ stitches }) => {
        if (!Array.isArray(stitches) || !stitches.length) throw new ToolError('`stitches` lists the stitches to paint.')
        const { outline } = store.project
        const { width, height } = outline
        // A row's stitches from its right end, where it begins: stitch 1 is the first the row has, however it's shaped.
        const rowStitches = (y: number) => {
          const xs: number[] = []
          for (let x = width - 1; x >= 0; x--) if (outline.cells[y * width + x] !== NONE) xs.push(x)
          return xs
        }
        const problems: string[] = []
        const skip = (problem: string): [] => {
          problems.push(problem)
          return []
        }
        const cells = (stitches as Array<Record<string, unknown>>).flatMap((s, i) => {
          const which = `stitches[${i}] (row ${s.row}, stitch ${s.stitch})`
          const [row, at] = [Number(s.row), Number(s.stitch)]
          if (!Number.isInteger(row) || !Number.isInteger(at)) return skip(`${which}: row and stitch are whole numbers.`)
          if (row < 1 || row > height) return skip(`${which}: the chart has rows 1–${height}.`)
          const xs = rowStitches(height - row)
          if (at < 1 || at > xs.length) return skip(`${which}: row ${row} has stitches 1–${xs.length}.`)
          const place = { x: xs[at - 1]!, y: height - row }
          if (s.erase === true) {
            if (s.yarn !== undefined || s.type !== undefined) return skip(`${which}: erase, or paint a yarn or stitch, not both.`)
            return [{ ...place, yarn: NONE, stitch: KNIT }]
          }
          if (s.yarn === undefined && s.type === undefined) return skip(`${which}: needs a yarn, a type, or both (or \`erase\`).`)
          const type = s.type === undefined ? undefined : stitchNamed(String(s.type))
          if (s.type !== undefined && !type) return skip(`${which}: "${s.type}" isn't a stitch this knows (${STITCHES.map((t) => t.id).join(', ')}).`)
          try {
            return [{ ...place, ...(s.yarn !== undefined && { yarn: yarnIndex(s.yarn) }), ...(type && { stitch: type.code }) }]
          } catch (error) {
            return skip(`${which}: ${(error as Error).message}`)
          }
        })
        const seen = new Set<string>()
        for (const c of cells) {
          const at = `${c.x},${c.y}`
          if (seen.has(at)) problems.push(`Two entries paint the same stitch on row ${height - c.y}: once is enough.`)
          seen.add(at)
        }
        // All of them fixed together, or none painted: one clear list of what's wrong.
        if (problems.length) throw new ToolError(`Nothing painted. ${problems.join(' ')}`)
        const painted = store.paintCells(cells)
        return text(`${cells.every((c) => c.yarn === NONE) ? 'Erased' : 'Painted'} ${painted} of ${cells.length} ${cells.length === 1 ? 'stitch' : 'stitches'}.${floatNote()}`)
      },
    },
    {
      name: 'get-library',
      description:
        'The colorwork motifs the knitter can put on any chart: SkeinFiend’s own, and ones they saved. Each chart is written as add-layer takes it: "." is clear (the main color shows through), "M" the main color, and A, B… its contrast colors, which take on the chart’s yarns when it’s placed. A saved one with stitches other than knit (purls, twisted stitches) has them too, stitch by stitch, with their key: they come with it. Place one with add-layer’s `motif`.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const saved = library ? await library.motifs() : []
        return text(JSON.stringify({
          // Newest first, as the motifs are shown in the editor.
          mine: [...saved].sort((a, b) => editedAt(b) - editedAt(a)).map((m) => ({ name: m.name, chart: libraryChart(m.grid), ...(m.stitches && libraryStitches(m.stitches)) })),
          builtIn: MOTIF_LIBRARY.map((m) => ({ name: m.name, chart: libraryChart(m.build(0)), ...(m.spacing && { gap: m.spacing }) })),
        }, null, 1))
      },
    },
    {
      name: 'update-library',
      description: 'Saves a layer’s chart to the knitter’s colorwork motifs, for use on any chart (the layer is then that motif’s, and offered its later versions), or removes one they saved. A layer made from one of their saved motifs saves over it: the motif is updated (renamed too, with `name`), and every chart using it is offered the new version. SkeinFiend’s own motifs stay.',
      inputSchema: {
        type: 'object',
        properties: {
          save: { ...layerRef, description: 'A layer to save, by name or id.' },
          name: { type: 'string', description: 'What to call it in the library. Default: the layer’s name (or, saving over a motif, its own).' },
          asNew: { type: 'boolean', description: 'Save a new motif even if the layer came from one of theirs.' },
          remove: { type: 'string', description: 'One of the knitter’s saved motifs to remove, by name.' },
        },
      },
      execute: async ({ save, name, remove, asNew }) => {
        const lib = needLibrary()
        if (save !== undefined && remove !== undefined) throw new ToolError('Give `save` or `remove`, one at a time.')
        if (save !== undefined) {
          const band = findLayer(save)
          if (band.painted) throw new ToolError(`"${band.name}" is painted over the whole chart, not a motif: add it as a layer with add-layer first.`)
          const saved = await lib.motifs()
          const own = asNew === true ? undefined : saved.find((m) => m.id === band.fromLibrary?.motifId)
          if (own) {
            // Behind the library (it was changed from another chart since): saving would lose that. Take it first, or keep both.
            if (editedAt(own) > band.fromLibrary!.editedAt) {
              throw new ToolError(`"${own.name}" has a newer version in the library than this layer (changed from another chart). Take it first with update-layer updateFromLibrary, or save this one separately with asNew: true.`)
            }
            // Saved over the motif it came from, as the knitter's Save does: the same motif, drawn again (and renamed if asked).
            const drawn = toSavedMotif(scaledMotif(band), store.project.background, own.id, own.name, own.savedAt, scaledStitches(band))
            const redrawn = !sameDrawing(drawn, own)
            const wanted = name === undefined ? own.name : String(name).trim()
            const named = uniqueMotifName({ id: own.id, name: wanted }, saved, MOTIF_LIBRARY.map((m) => m.name))
            // Only a new drawing is a new version: a rename alone isn't offered to other charts.
            const updated = { ...drawn, name: named, ...(redrawn ? { editedAt: Date.now() } : own.editedAt !== undefined && { editedAt: own.editedAt }) }
            await lib.putMotif(updated)
            lib.changed()
            store.updateQuietly((p) => updateBand(p, band.id, { fromLibrary: { motifId: own.id, editedAt: editedAt(updated) } }))
            const taken = named !== wanted ? ` ("${wanted}" was taken)` : ''
            const change = redrawn ? 'Updated' : named !== own.name ? 'Renamed' : 'Nothing changed in'
            return text(`${change} "${named}" in the knitter’s colorwork motifs${named !== own.name ? ` (was "${own.name}")` : ''}${taken}.${redrawn ? ' Other charts using it are offered the new version.' : ''}`)
          }
          const drafted = toSavedMotif(scaledMotif(band), store.project.background, crypto.randomUUID(), String(name ?? band.name).trim() || band.name, Date.now(), scaledStitches(band))
          // Under a name no other motif has, as when the knitter saves one.
          const motif = { ...drafted, name: uniqueMotifName(drafted, await lib.motifs(), MOTIF_LIBRARY.map((m) => m.name)) }
          await lib.putMotif(motif)
          lib.changed()
          // The layer is now the library motif's, as when the knitter saves it.
          store.updateQuietly((p) => updateBand(p, band.id, { fromLibrary: { motifId: motif.id, editedAt: motif.savedAt } }))
          const why = motif.name !== drafted.name ? ` ("${drafted.name}" was taken${MOTIF_LIBRARY.some((m) => m.name.toLowerCase() === drafted.name.toLowerCase()) ? ' by one of SkeinFiend’s own' : ''})` : ''
          return text(`Saved "${motif.name}" to the knitter’s colorwork motifs${why}.`)
        }
        if (remove !== undefined) {
          const found = await findMotif(remove)
          if (!found.mine) throw new ToolError(`"${remove}" is one of SkeinFiend’s own motifs, which stay.`)
          await lib.removeMotif(found.mine.id)
          lib.changed()
          return text(`Removed "${found.mine.name}" from the knitter’s colorwork motifs. Layers made from it keep their charts.`)
        }
        throw new ToolError('Give `save` (a layer) or `remove` (a saved motif).')
      },
    },
    {
      name: 'undo',
      description: 'Undoes the last change to the chart, yours or the knitter’s, as their Undo button does.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        if (!store.canUndo) return text('There’s nothing to undo.')
        store.undo()
        return text('Undone.')
      },
    },
    {
      name: 'redo',
      description: 'Redoes the last change undone, as the knitter’s Redo button does.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        if (!store.canRedo) return text('There’s nothing to redo.')
        store.redo()
        return text('Redone.')
      },
    },
    {
      name: 'remove-layer',
      description: 'Removes a layer. The knitter can undo it.',
      inputSchema: { type: 'object', properties: { layer: layerRef }, required: ['layer'] },
      execute: ({ layer }) => {
        const band = findLayer(layer)
        store.update((p) => removeBand(p, band.id))
        return text(`Removed "${band.name}".`)
      },
    },
  ]
  return tools.map((tool) => ({ ...tool, execute: run(tool.execute, tool.inputSchema) }))
}

/** A yarn's details from the agent: null clears one, and yards become meters. */
function yarnDetails(entry: Record<string, unknown>): Partial<Omit<Yarn, 'id'>> {
  const changes: Record<string, unknown> = {}
  const str = (key: string, to = key) => {
    if (entry[key] === undefined) return
    changes[to] = entry[key] === null || String(entry[key]).trim() === '' ? undefined : String(entry[key]).trim()
  }
  const num = (value: unknown, to: string, scale = 1) => {
    if (value === undefined) return
    const n = Number(value)
    if (value !== null && !(n >= 0)) throw new ToolError(`${to} must be a number, not "${value}".`)
    changes[to] = value === null ? undefined : n * scale
  }
  str('brand')
  str('fiber')
  str('url')
  if (entry.weight !== undefined) {
    const weight = entry.weight === null ? undefined : YARN_WEIGHTS.find((w) => w.toLowerCase() === String(entry.weight).toLowerCase())
    if (entry.weight !== null && !weight) throw new ToolError(`Weight is one of ${YARN_WEIGHTS.join(', ')}.`)
    changes.weight = weight
  }
  num(entry.meters, 'metersPerSkein')
  num(entry.yards, 'metersPerSkein', METERS_PER_YARD)
  num(entry.grams, 'gramsPerSkein')
  return changes as Partial<Omit<Yarn, 'id'>>
}

/** A yarn's details, for the agent: " — Jamieson's Spindrift, fingering, 105 m / 25 g a skein". */
function describeYarn(y: Yarn): string {
  const skein = y.metersPerSkein ? `${Math.round(y.metersPerSkein)} m${y.gramsPerSkein ? ` / ${y.gramsPerSkein} g` : ''} a skein` : ''
  const parts = [y.brand, y.weight, y.fiber, skein, y.url].filter(Boolean)
  return parts.length ? ` — ${parts.join(', ')}` : ''
}

/** A chart written as rows of characters, in the chart's yarns: "main" is left clear, so the main color shows. */
export function parseChart(rows: unknown, key: unknown, yarn: (ref: string) => number): { colors: Grid; stitches: Grid | null } {
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r) => typeof r === 'string' && r.length > 0)) {
    throw new ToolError('`rows` must be a list of strings, one per chart row, top first.')
  }
  const lengths = new Set(rows.map((r: string) => [...r].length))
  if (lengths.size > 1) {
    const widths = rows.map((r: string, i) => `row ${rows.length - i}: ${[...r].length}`).join(', ')
    throw new ToolError(`Every row needs the same number of stitches. Counted (numbered from the bottom): ${widths}.`)
  }
  if (!key || typeof key !== 'object') throw new ToolError('`key` must say which yarn each character is.')
  const legend: Record<string, { color: number; stitch: number }> = {}
  for (const [char, ref] of Object.entries(key as Record<string, unknown>)) {
    // A blank would quietly be the main color, and the layer invisible: it says so instead.
    if (!String(ref ?? '').trim()) throw new ToolError(`The key gives "${char}" no yarn: name one, or "main" for the main color.`)
    if ([...char].length !== 1) throw new ToolError(`Each key is one character, as in the chart's rows: not "${char}".`)
    legend[char] = keyEntry(String(ref), yarn)
  }
  const missing = [...new Set(rows.join(''))].filter((c) => !(c in legend))
  if (missing.length) throw new ToolError(`The key doesn't say which yarn ${missing.map((c) => `"${c}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'}.`)
  // Characters, not UTF-16 units, so symbols like ● count as one stitch.
  const chars = rows.map((r: string) => [...r])
  const colors = createGrid(chars[0]!.length, chars.length)
  const stitches = createGrid(colors.width, colors.height, KNIT)
  chars.forEach((row, y) => {
    row.forEach((c, x) => {
      colors.cells[y * colors.width + x] = legend[c]!.color
      stitches.cells[y * colors.width + x] = legend[c]!.stitch
    })
  })
  return { colors, stitches: stitches.cells.some((s) => s !== KNIT) ? stitches : null }
}

/**
 * What a chart key says a character is: a yarn, a stitch, or both. "Canary",
 * "k1 tbl" (in the main color), "Madder purl", "main k2tog", "Spanish Coin
 * M1 p-st". The yarn comes first; its name can have spaces.
 */
function keyEntry(text: string, yarn: (ref: string) => number): { color: number; stitch: number } {
  const words = text.trim().split(/\s+/)
  const colorOf = (name: string) => (!name || name.toLowerCase() === 'main' ? NONE : yarn(name))
  // The longest yarn name that leaves a stitch (or nothing) after it.
  for (let split = words.length; split >= 0; split--) {
    const [name, rest] = [words.slice(0, split).join(' '), words.slice(split).join(' ')]
    const stitch = rest ? stitchNamed(rest) : STITCHES[KNIT]
    if (!stitch) continue
    try {
      return { color: colorOf(name), stitch: stitch.code }
    } catch (error) {
      if (split === 0 || !(error instanceof ToolError)) throw error
    }
  }
  throw new ToolError(`The key's "${text}" isn't a yarn or a stitch. Stitches: ${STITCHES.map((s) => s.id).join(', ')}.`)
}

/**
 * Worked in the round, a repeat only goes evenly around a round whose stitches
 * are a multiple of it; otherwise the repeat breaks where the round begins.
 * Says which of the layer's rounds that happens on, or null if it fits.
 */
type Schema = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, Schema>; items?: Schema }

/**
 * An input as its schema says it should be, or a clear error: numbers are
 * finite numbers (not "ten", not NaN), true/false are booleans, text is text,
 * enums are one of theirs (in any case: "Row" is "row"), and nested objects and
 * lists the same. A `null` where null isn't allowed is as good as leaving it out.
 */
function checkInput(value: unknown, schema: Schema | undefined, path: string): unknown {
  if (!schema || value === undefined) return value
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const at = path || 'input'
  if (value === null) return types.includes('null') ? null : undefined
  if (schema.enum) {
    const listed = schema.enum.find((e) => e === value || (typeof e === 'string' && typeof value === 'string' && e.toLowerCase() === value.trim().toLowerCase()))
    if (listed === undefined) throw new ToolError(`\`${at}\` is one of ${schema.enum.filter((e) => e !== null).map((e) => JSON.stringify(e)).join(', ')}, not ${JSON.stringify(value)}.`)
    return listed
  }
  const only = (type: string) => types.includes(type) && !types.some((t) => t !== type && t !== 'null')
  if (only('number') && !(typeof value === 'number' && Number.isFinite(value))) throw new ToolError(`\`${at}\` must be a number, not ${JSON.stringify(value)}.`)
  if (only('boolean') && typeof value !== 'boolean') throw new ToolError(`\`${at}\` must be true or false, not ${JSON.stringify(value)}.`)
  if (only('string') && typeof value !== 'string') throw new ToolError(`\`${at}\` must be text, not ${JSON.stringify(value)}.`)
  if (schema.properties && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    for (const [key, sub] of Object.entries(schema.properties)) {
      const checked = checkInput(out[key], sub, path ? `${path}.${key}` : key)
      if (checked === undefined) delete out[key]
      else out[key] = checked
    }
    return out
  }
  if (schema.items && Array.isArray(value)) return value.map((item, i) => checkInput(item, schema.items, `${at}[${i}]`))
  return value
}

/** A layer as it is, and where it is in the stack, to tell whether anything about it changed. */
function layerState(project: Project, id: string): string {
  const at = project.bands.findIndex((b) => b.id === id)
  return JSON.stringify({ at, band: project.bands[at] }, (_key, value) => (value instanceof Uint8Array ? Array.from(value).join(',') : value))
}

export function repeatFit(band: Band, project: Project): string | null {
  if (band.once || project.construction !== 'round') return null
  const period = bandTile(band).width + Math.max(0, band.gapX)
  const { outline } = project
  const { top, bottom } = bandSpan(band, outline.height)
  const off: Array<{ from: number; to: number; stitches: number }> = []
  for (let y = bottom; y >= Math.max(0, top); y--) {
    let stitches = 0
    for (let x = 0; x < outline.width; x++) if (outline.cells[y * outline.width + x] !== NONE) stitches++
    if (stitches === 0 || stitches % period === 0) continue
    const row = rowNumber(y, outline.height)
    const last = off.at(-1)
    if (last && last.to === row - 1 && last.stitches % period === stitches % period && Math.abs(last.stitches - stitches) < period * 4) last.to = row
    else off.push({ from: row, to: row, stitches })
  }
  if (!off.length) return null
  const where = off.slice(0, 4).map((r) => (r.from === r.to ? `round ${r.from} (${r.stitches} sts)` : `rounds ${r.from}–${r.to} (${r.stitches} sts at first)`)).join(', ')
  return `Its repeat is ${period} stitches, which doesn't divide ${where}${off.length > 4 ? ', …' : ''}: the pattern breaks where each of those rounds begins. A width that divides the stitch count (or a gap) fixes it.`
}

/** A placement as the app shows it ("row"), or as it's stored ("band"). */
function placementFrom(value: unknown): Placement {
  const where = value === 'row' ? 'band' : value
  if (where !== 'band' && where !== 'tile' && where !== 'single') throw new ToolError('Placement must be row, tile, or single.')
  return where
}

/** To the nearest millimeter. */
const round1 = (cm: number) => Math.round(cm * 10) / 10

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/**
 * The piece's widths, added, changed, renamed, or removed as update-chart gives
 * them: by name, in centimeters or the pattern's own rows and stitches (at the
 * chart's gauge). At least two stay, and the top one is above the cast-on edge.
 */
/** A width's sections, as given: a whole number of points around, or 0 for the default. */
function sectionsFrom(value: unknown, where: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > MAX_SIZE) throw new ToolError(`${where}: \`sections\` is how many points around the shaping is made at, a whole number (0 for the default).`)
  return n
}

function editWidths(schematic: SchematicPiece, project: Project, widths: unknown, remove: unknown): SchematicPiece {
  const [perStitch, perRow] = [stitchesPerCm(project.gauge), rowsPerCm(project.gauge)]
  const measurements: Measurement[] = [...schematic.measurements]
  // Widths given by their rows: placed once the top's known (it's exact; one below it sits on its row).
  const byRow = new Map<string, number>()
  const names = () => measurements.map((m) => m.name).join(', ')
  const find = (name: string) => measurements.findIndex((m) => m.name.toLowerCase() === name.trim().toLowerCase())
  for (const entry of (Array.isArray(widths) ? widths : []) as Array<Record<string, unknown>>) {
    const name = String(entry.name ?? '').trim()
    if (!name) throw new ToolError('Each width needs a `name`.')
    const height = entry.height !== undefined ? Number(entry.height) : entry.row !== undefined ? Number(entry.row) / perRow : undefined
    const givenRow = entry.height === undefined && entry.row !== undefined ? Number(entry.row) : undefined
    const width = entry.width !== undefined ? Number(entry.width) : entry.stitches !== undefined ? Number(entry.stitches) / perStitch : undefined
    if (height !== undefined && !(height >= 0)) throw new ToolError(`${name}: its height is how far up from the cast-on it is, 0 or more.`)
    if (width !== undefined && !(width > 0)) throw new ToolError(`${name}: its width has to be more than 0.`)
    const renamed = entry.rename === undefined ? undefined : String(entry.rename).trim() || undefined
    const sections = entry.sections === undefined ? undefined : sectionsFrom(entry.sections, name)
    const at = find(name)
    if (at >= 0) {
      const { sections: _, ...was } = measurements[at]!
      measurements[at] = { ...was, ...(sections === undefined ? measurements[at]!.sections && { sections: measurements[at]!.sections } : sections && { sections }), ...(height !== undefined && { height }), ...(width !== undefined && { width }), ...(renamed && { name: renamed }) }
      if (givenRow !== undefined) byRow.set(measurements[at]!.id, givenRow)
    } else {
      if (height === undefined || width === undefined) throw new ToolError(`No width "${name}" yet: to add it, give its height and width (or row and stitches). The widths are: ${names()}.`)
      const id = crypto.randomUUID()
      measurements.push({ id, name: renamed ?? name, height, width, ...(sections && { sections }) })
      if (givenRow !== undefined) byRow.set(id, givenRow)
    }
  }
  for (const name of (Array.isArray(remove) ? remove : []) as unknown[]) {
    const at = find(String(name))
    if (at < 0) throw new ToolError(`No width "${name}". The widths are: ${names()}.`)
    measurements.splice(at, 1)
  }
  if (measurements.length < 2) throw new ToolError('A piece needs at least two widths: where it starts, and where it ends.')
  measurements.sort((a, b) => a.height - b.height)
  const top = measurements.at(-1)!
  const placed = measurements.map((m) => (byRow.has(m.id) ? { ...m, height: heightOfRow(byRow.get(m.id)!, perRow, m === top) } : m))
  if (!(placed.at(-1)!.height > 0)) throw new ToolError('The top width needs to be above the cast-on edge.')
  return { ...schematic, measurements: placed.sort((a, b) => a.height - b.height) }
}

/**
 * A pattern's "after N rows" as a height up the piece, so its count is on row N
 * itself ("96 after round 50": round 50 has 96, and round 51 starts the next
 * stretch). The cast-on and the top are exact; one in between sits a little
 * under row N, where the piece's rows fall (a row's count is reached on it).
 */
const heightOfRow = (row: number, perRow: number, top: boolean) => (row <= 0 || top ? row / perRow : (row - 0.6) / perRow)
/** A width's height back as the rows worked to reach it, as it was given. */
const rowOfHeight = (height: number, perRow: number) => Math.max(0, Math.ceil(height * perRow - 1e-6))

/** A schematic from a pattern's stitch counts after so many rows, at its gauge. `where` says which size a problem's in. */
function schematicFrom(shape: unknown, rib: unknown, gauge: Gauge, where = ''): { schematic: SchematicPiece; counts: string } {
  const points = (Array.isArray(shape) ? shape : []) as Array<{ name?: string; row: number; stitches: number }>
  if (points.length < 2) throw new ToolError(`${where}the shape needs at least two points: where it starts, and where it ends.`)
  const sorted = [...points].sort((a, b) => a.row - b.row)
  if (sorted.some((p) => !(p.row >= 0) || !(p.stitches >= 1))) throw new ToolError(`${where}each point needs a row (0 or more) and a stitch count.`)
  if ((sorted[0] as { sections?: unknown }).sections !== undefined) throw new ToolError(`${where}\`sections\` is how the shaping up to a point is made: the first point has none.`)
  const widest = Math.max(...sorted.map((p) => p.stitches))
  const tallest = sorted.at(-1)!.row
  if (tallest < 1) throw new ToolError(`${where}the last point needs to be at least one round up.`)
  if (widest > MAX_SIZE || tallest > MAX_SIZE) throw new ToolError(`${where}charts go up to ${MAX_SIZE} stitches and ${MAX_SIZE} rows: chart a part of the piece.`)
  const [perStitch, perRow] = [stitchesPerCm(gauge), rowsPerCm(gauge)]
  const schematic: SchematicPiece = {
    kind: 'schematic',
    multiple: 1,
    openings: [],
    measurements: sorted.map((p, i) => ({
      id: crypto.randomUUID(),
      name: p.name?.trim() || (i === 0 ? 'Start' : i === sorted.length - 1 ? 'End' : `Point ${i + 1}`),
      height: heightOfRow(p.row, perRow, i === sorted.length - 1),
      width: p.stitches / perStitch,
      ...((p as { sections?: unknown }).sections !== undefined && sectionsFrom((p as { sections?: unknown }).sections, `${where}the point at row ${p.row}`) && { sections: Number((p as { sections?: unknown }).sections) }),
    })),
    sections: ((Array.isArray(rib) ? rib : []) as Array<{ name?: string; from: number; to: number }>)
      .filter((r) => r.to > r.from)
      .map((r, i, all) => ({ id: crypto.randomUUID(), name: r.name?.trim() || (all.length > 1 ? `Rib ${i + 1}` : 'Rib'), stitch: 'rib' as const, bottom: r.from / perRow, height: (r.to - r.from) / perRow })),
  }
  const counts = sorted.map((p) => (p.row === 0 ? `${p.stitches} to start` : `${p.stitches} after ${p.row}`)).join(', ')
  return { schematic, counts }
}

/**
 * Every size of the pattern, and how the shared colorwork does in each: rows
 * with long floats, and layers whose repeat breaks where the round begins.
 */
function sizesSummary(project: Project, store: EditorStore) {
  const shown = sizeIndex(project)
  const others = new Map(store.sizeFloats(project).map((s) => [s.index, s.rows]))
  return (project.sizes ?? []).map((size, index) => {
    const sized = index === shown ? project : switchSize(project, index)
    const breaks = sized.bands.filter((b) => repeatFit(b, sized)).map((b) => b.name)
    return {
      name: size.name,
      ...(index === shown && { shown: true }),
      stitches: sized.outline.width,
      rows: sized.outline.height,
      rowsWithLongFloats: index === shown ? new Set(store.allIssues().map((i) => i.y)).size : (others.get(index) ?? 0),
      ...(breaks.length && { repeatBreaksIn: breaks }),
    }
  })
}

/** A saved motif's stitches, a character each, as its chart is: "." knit, and a letter for each other stitch it has. */
function libraryStitches(stitches: Grid): { stitches: string[]; stitchKey: Record<string, string> } {
  const letters = new Map<number, string>()
  const taken = new Set(['.'])
  const letter = (code: number) => {
    if (code === KNIT || code === NONE) return '.'
    if (!letters.has(code)) {
      const id = stitchType(code).id
      const pick = [...id.toLowerCase()].find((c) => /[a-z]/.test(c) && !taken.has(c)) ?? [...'abcdefghijklmnopqrstuvwxyz'].find((c) => !taken.has(c))!
      taken.add(pick)
      letters.set(code, pick)
    }
    return letters.get(code)!
  }
  const rows = Array.from({ length: stitches.height }, (_, y) => Array.from({ length: stitches.width }, (_, x) => letter(stitches.cells[y * stitches.width + x]!)).join(''))
  return { stitches: rows, stitchKey: Object.fromEntries([...letters].map(([code, c]) => [c, stitchType(code).id])) }
}

/** Where a layer sits, in knitters' terms: "repeated across rows 12–20, 8 stitches apart". */
function placed(band: Band, project: Project): string {
  const { height } = project.outline
  const { top, bottom } = bandSpan(band, height)
  const [first, last] = [rowNumber(bottom, height), rowNumber(top, height)]
  const unit = project.construction === 'round' ? 'round' : 'row'
  const rows = first === last ? `${unit} ${first}` : `${unit}s ${first}–${last}`
  // A band taller than its chart repeats it up its rows too: tiled over them.
  const tiledUp = placementOf(band) === 'band' && last - first + 1 > bandTile(band).height
  const where: Record<Placement, string> = {
    band: tiledUp ? `tiled over ${rows}` : `repeated across ${rows}`,
    tile: 'repeated over the whole piece',
    single: `once, on ${rows}${band.afterKnitting ? ', duplicate stitched after knitting' : ', knitted in'}`,
  }
  const upsideDown = band.rotation === 180 && band.mirror
  return where[placementOf(band)] + (band.gapX ? `, ${band.gapX} ${band.gapX === 1 ? 'stitch' : 'stitches'} apart` : '') + (upsideDown ? ', upside down' : '') + (band.visible ? '' : ' (hidden)')
}

/** Characters for a layer's chart in get-chart, after "." for the main color. */
// Letters only: a "-" would read as purl, whatever it stood for.
const SYMBOLS = 'XOABCDEFGHIJKLMNPQRSTUVWYZ'

/** The chart as the agent sees it. */
/**
 * The character for a chart meaning, as a knitter might have written it:
 * "." the main color, "-" a purl in it, a yarn's initial ("R" for Rust), and
 * its lowercase for that yarn purled. Taken already (two yarns starting with
 * the same letter), or any other stitch: the next spare letter.
 */
function symbolFor(yarn: string | null, stitch: string | null, taken: Set<string>): string {
  const initial = yarn?.trim()[0] ?? ''
  const wanted =
    yarn === null ? (stitch === null ? '.' : stitch === 'purl' ? '-' : '')
    : /[A-Za-z]/.test(initial) ? (stitch === null ? initial.toUpperCase() : stitch === 'purl' ? initial.toLowerCase() : '') : ''
  if (wanted && !taken.has(wanted)) return wanted
  return [...SYMBOLS].find((c) => !taken.has(c) && !taken.has(c.toLowerCase())) ?? '?'
}

/**
 * How far a layer sits from its centered place, in stitches (right, or left if
 * negative): a single motif from the middle; a band within one repeat, since a
 * whole repeat over looks the same. A tile has none.
 */
function shiftOf(band: Band, project: Project): number {
  if (placementOf(band) === 'tile') return 0
  const width = bandTile(band).width
  if (band.once) return band.offsetX - Math.floor((project.outline.width - width) / 2)
  const period = width + Math.max(0, band.gapX)
  const off = (((band.offsetX - centeredOffset(project.outline.width, width, band.gapX)) % period) + period) % period
  return off > period / 2 ? off - period : off
}

/**
 * Where to duplicate stitch on a row, as a knitter counts it (stitch 1 at the
 * row's right end, along its own stitches): runs by yarn, "stitches 31–33 in
 * Navy, 36 in Navy". What the finished chart has that the knitted one doesn't.
 */
function duplicateStitches(finished: Grid, knitted: Grid, y: number, project: Project): string {
  const runs: Array<{ from: number; to: number; yarn: number }> = []
  let n = 0
  for (let x = finished.width - 1; x >= 0; x--) {
    const i = y * finished.width + x
    if (knitted.cells[i] === NONE) continue
    n++
    const yarn = finished.cells[i]!
    if (yarn === knitted.cells[i] || yarn === NONE) continue
    const last = runs.at(-1)
    if (last && last.yarn === yarn && last.to === n - 1) last.to = n
    else runs.push({ from: n, to: n, yarn })
  }
  if (!runs.length) return ''
  const shown = runs.slice(0, 12).map((r) => `${r.from === r.to ? `stitch ${r.from}` : `stitches ${r.from}–${r.to}`} in ${project.yarns[r.yarn]?.name}`)
  return `${shown.join(', ')}${runs.length > 12 ? `, and ${runs.length - 12} more runs (see render-chart)` : ''}`
}

/** How far apart two colors are in lightness, as WCAG measures it: 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

/** Below this, a pattern color against the main color hardly reads: the motif disappears. */
const LOW_CONTRAST = 2

/**
 * What a knitter would want flagged besides floats: rows carrying more than
 * two colors (stranded knitting carries two), and pattern yarns too close in
 * lightness to the main color to read.
 */
export function colorProblems(project: Project, chart: Grid): { rows: string[]; more: number; lowContrast: string[] } {
  const unit = project.construction === 'round' ? 'Round' : 'Row'
  const crowded: string[] = []
  const used = new Set<number>()
  for (let y = chart.height - 1; y >= 0; y--) {
    const yarns = new Set<number>()
    for (let x = 0; x < chart.width; x++) {
      const c = chart.cells[y * chart.width + x]!
      if (c !== NONE) yarns.add(c)
    }
    for (const yarn of yarns) used.add(yarn)
    if (yarns.size > 2) crowded.push(`${unit} ${rowNumber(y, chart.height)}: ${yarns.size} colors (${[...yarns].map((i) => project.yarns[i]?.name).join(', ')}): stranded knitting carries two; duplicate stitch the extra, or change it.`)
  }
  const main = project.yarns[project.background]?.hex
  const lowContrast = main ? [...used].filter((i) => i !== project.background).flatMap((i) => {
    const yarn = project.yarns[i]
    const ratio = yarn ? contrast(yarn.hex, main) : 99
    return yarn && ratio < LOW_CONTRAST ? [`${yarn.name} on ${project.yarns[project.background]!.name}: ${ratio.toFixed(1)}:1, too close in lightness to read as a pattern.`] : []
  }) : []
  return { rows: crowded.slice(0, 20), more: Math.max(0, crowded.length - 20), lowContrast }
}

function describe(project: Project, store: EditorStore, saved: readonly SavedMotif[]) {
  const { width, height } = project.outline
  const issues = store.allIssues()
  return {
    name: project.name,
    piece: {
      name: project.piece.name,
      stitches: width,
      rows: height,
      worked: project.construction === 'round' ? 'in the round' : 'flat',
      // Worked in k1, p1 rib (a brim, hem, or cuff), by the rows knitters count.
      ...(ribRows(schematicOf(project), project.gauge, project.construction).length && {
        rib: ribRows(schematicOf(project), project.gauge, project.construction).map((r) => `${r.name}: ${project.construction === 'round' ? 'rounds' : 'rows'} ${r.from}–${r.to}`),
      }),
      gauge: `${project.gauge.stitches} stitches and ${project.gauge.rows} rows in ${project.gauge.over ?? 10} cm`,
      // Each width as update-chart takes it, with where it falls in the knitting.
      widths: [...layoutSchematic(project.piece, project.gauge, project.construction).placed]
        .sort((a, b) => a.measurement.height - b.measurement.height)
        // `row` exactly as update-chart and shape-piece take it (rows worked to reach it, 0 at the cast-on), so it goes back in unchanged.
        .map(({ measurement: m, stitches, sections }, i, all) => ({
          name: m.name, height: `${round1(m.height)} cm`, width: `${round1(m.width)} cm`, row: rowOfHeight(m.height, rowsPerCm(project.gauge)), stitches,
          // Worked in the round, where the shaping up to here is made: as `sections` sets it.
          ...(project.construction === 'round' && i > 0 && stitches !== all[i - 1]!.stitches && all[i - 1]!.row !== all[i]!.row && {
            shapedAt: sections ? `${sections} ${sections === 1 ? 'point' : 'points'} around${m.sections ? '' : ' (the default)'}` : 'each end of the round (the default)',
          }),
        })),
    },
    floatLimit: `${project.floatRules.maxFloatCm} cm (${floatRulesOf(project).maxFloat} stitches at this gauge)`,
    ...(project.swatch && { swatch: `${project.swatch.widthCm} × ${project.swatch.heightCm} cm, ${project.swatch.grams} g` }),
    yarns: project.yarns.map(({ id: _, ...y }, i) => ({ number: i, ...y, ...(i === project.background && { main: true }) })),
    layers: project.bands.map((band) => {
      // A character for each yarn and stitch the chart uses, the way add-layer takes them.
      const { motif, stitches } = band
      const symbols = new Map<string, string>()
      const chart = Array.from({ length: motif.height }, (_, y) =>
        Array.from({ length: motif.width }, (_, x) => {
          const i = y * motif.width + x
          const color = motif.cells[i]!
          const stitch = stitches?.cells[i] ?? KNIT
          const meaning = `${color === NONE ? 'main' : (project.yarns[color]?.name ?? String(color))}${stitch !== KNIT ? ` ${stitchType(stitch).id}` : ''}`
          if (!symbols.has(meaning)) symbols.set(meaning, symbolFor(color === NONE ? null : (project.yarns[color]?.name ?? ''), stitch !== KNIT ? stitchType(stitch).id : null, new Set(symbols.values())))
          return symbols.get(meaning)!
        }).join(''),
      )
      const fromSaved = band.fromLibrary && saved.find((m) => m.id === band.fromLibrary!.motifId)
      const fromBuiltIn = band.fromLibrary && MOTIF_LIBRARY.find((m) => `built-in:${m.id}` === band.fromLibrary!.motifId)
      return {
        id: band.id,
        name: band.name,
        where: placed(band, project),
        // Stitches it's moved from its centered place (update-layer's shift): right, or left if negative.
        ...((shift) => (shift ? { shift } : {}))(shiftOf(band, project)),
        ...(band.painted && { painted: 'stitch by stitch (paint-stitches)' }),
        ...(band.once && band.afterKnitting && { afterKnitting: 'duplicate stitched after knitting' }),
        ...(band.gapY && { gapUp: band.gapY }),
        ...(band.rotation && { rotation: band.rotation }),
        ...(band.mirror && { mirror: true }),
        ...((fromSaved || fromBuiltIn) && {
          fromLibrary: fromSaved ? fromSaved.name : fromBuiltIn!.name,
          ...(fromSaved && editedAt(fromSaved) > band.fromLibrary!.editedAt && { newerInLibrary: true }),
        }),
        ...(band.scale && band.scale > 1 && { scale: band.scale }),
        ...(repeatFit(band, project) && { fit: repeatFit(band, project) }),
        chart,
        key: Object.fromEntries([...symbols].map(([meaning, char]) => [char, meaning])),
      }
    }),
    ...(project.sizes && { sizes: sizesSummary(project, store) }),
    // Each row once, bottom (row 1) up, its floats counted by yarn and length: "Row 27: 9 Peat floats of 9 stitches".
    problems: [...new Set(issues.map((i) => i.y))].sort((a, b) => b - a).slice(0, 20).map((y) => {
      const counts = new Map<string, number>()
      for (const i of issues.filter((i) => i.y === y)) {
        const what = `${project.yarns[i.yarn]?.name} ${i.length}`
        counts.set(what, (counts.get(what) ?? 0) + 1)
      }
      const floats = [...counts].map(([what, n]) => {
        const [yarn, length] = [what.slice(0, what.lastIndexOf(' ')), what.slice(what.lastIndexOf(' ') + 1)]
        return `${n} ${yarn} ${n === 1 ? 'float' : 'floats'} of ${length} stitches`
      })
      return `${project.construction === 'round' ? 'Round' : 'Row'} ${rowNumber(y, height)}: ${floats.join(', ')}`
    }),
    ...(() => {
      const colors = colorProblems(project, store.knittedChart(project))
      return {
        ...(colors.rows.length && { tooManyColors: colors.more ? [...colors.rows, `…and ${colors.more} more.`] : colors.rows }),
        ...(colors.lowContrast.length && { lowContrast: colors.lowContrast }),
      }
    })(),
    ...(new Set(issues.map((i) => i.y)).size > 20 && { moreProblems: `…and ${new Set(issues.map((i) => i.y)).size - 20} more ${project.construction === 'round' ? 'rounds' : 'rows'} with long floats, higher up.` }),
  }
}
