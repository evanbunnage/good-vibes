import { bandSpan, bandStitchTile, bandTile, centeredOffset, createBand, placementOf, scaledMotif, type Band, type Placement } from '@/domain/bands'
import { MOTIF_LIBRARY } from '@/domain/motifs'
import { editedAt, MAIN, motifInYarns, toSavedMotif, uniqueMotifName, type SavedMotif } from '@/domain/saved-motifs'
import type { Rotation } from '@/domain/transform'
import { KNIT, STITCHES, stitchNamed, stitchType } from '@/domain/stitches'
import { addBand, addYarn, adjustBand, dismissFloats, duplicateBand, removeBand, removeYarn, rename, renamePiece, reorderBand, schematicOf, setBackground, setConstruction, setGauge, setPlacement, setScale, setSchematic, setSizes, setSwatch, sizeIndex, switchSize, takeLibraryVersion, updateBand, updateYarn } from '@/domain/edits'
import { isValidGauge, rowsPerCm, stitchesPerCm, type Gauge } from '@/domain/gauge'
import { createGrid, MAX_SIZE, NONE, type Grid } from '@/domain/grid'
import { rowNumber } from '@/domain/numbering'
import { constructionOf, projectRowsWorked } from '@/domain/instructions'
import { writeRow, yarnLabels } from '@/domain/written'
import { isHexColor, MAX_YARNS, YARN_WEIGHTS, yarnCounts, type Yarn } from '@/domain/palette'
import { MARGIN, METERS_PER_YARD } from '@/domain/yarn-estimate'
import { layoutSchematic } from '@/domain/pieces'
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

const SHAPE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'What’s here, e.g. "Cast on" or "Underarm".' },
      row: { type: 'number', description: 'Rounds (or rows) worked so far: 0 where the part starts.' },
      stitches: { type: 'number', description: 'Stitches around (or across) here.' },
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
const yarnRef = { type: 'string', description: 'A yarn in the chart, by name (or its number from get-chart).' }
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
    const band = store.project.bands.find((b) => b.id === value) ?? store.project.bands.find((b) => b.name.toLowerCase() === value.toLowerCase())
    if (!band) throw new ToolError(`No layer "${value}". The layers are: ${store.project.bands.map((b) => b.name).join(', ') || 'none yet'}.`)
    return band
  }

  /** The chart rows a layer covers, `rows` tall with its bottom on knitted row `bottomRow` (row 1 is the cast-on). */
  const rowsFrom = (bottomRow: number, rows: number, project = store.project) => {
    const { height } = project.outline
    const bottom = Math.min(height - 1, Math.max(0, height - Math.round(bottomRow)))
    return { top: Math.max(0, bottom - rows + 1), bottom }
  }

  /** What changed made anything harder to knit: the problem rows, as the Floats panel counts them. */
  const floatNote = () => {
    const rows = new Set(store.allIssues().map((i) => i.y)).size
    return rows ? ` ${rows} ${rows === 1 ? 'row has' : 'rows have'} long floats: see get-chart.` : ''
  }

  /** How a layer's repeat fits the rows it's on, for the result of placing it. */
  const fitNote = (id: string) => {
    const band = store.project.bands.find((b) => b.id === id)
    const fit = band && repeatFit(band, store.project)
    return fit ? ` ${fit}` : ''
  }

  const run = (execute: AgentTool['execute']): AgentTool['execute'] => async (input) => {
    try {
      return await execute(input ?? {})
    } catch (error) {
      if (!(error instanceof ToolError || error instanceof RangeError)) throw error
      return { ...text(error.message), isError: true }
    }
  }

  const tools: AgentTool[] = [
    {
      name: 'get-chart',
      description:
        'The colorwork chart open in SkeinFiend: the piece it goes on (its gauge, whether it’s knitted in the round or flat, its size in stitches and rows, and the named widths that shape it), the yarns, the colorwork layers stacked on it (each with its chart and settings), the float limit, and the knitter’s swatch. Rows are numbered as knitters do: row 1 is the cast-on row, at the bottom. Also lists rows with floats too long to knit comfortably.',
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
        for (const entry of yarns as Array<Record<string, unknown>>) {
          const { yarn, name, hex, main } = entry
          if (entry.remove === true) {
            // Removed last, by name: removing shifts the others' numbers.
            removing.push(next.yarns[yarnIndex(yarn, next)]!.name)
            continue
          }
          if (hex !== undefined && !isHexColor(String(hex))) throw new ToolError(`Color must be #rrggbb, not "${hex}".`)
          let index: number
          if (yarn === undefined) {
            if (next.yarns.length >= MAX_YARNS) throw new ToolError(`A chart has at most ${MAX_YARNS} yarns.`)
            index = next.yarns.length
            next = addYarn(next)
          } else index = yarnIndex(yarn, next)
          next = updateYarn(next, index, { ...(name !== undefined && { name: String(name) }), ...(hex !== undefined && { hex: String(hex).toLowerCase() }), ...yarnDetails(entry) })
          if (main) next = setBackground(next, index)
        }
        for (const name of removing) {
          if (next.yarns.length <= 1) throw new ToolError('A chart needs at least one yarn.')
          next = removeYarn(next, yarnIndex(name, next))
        }
        const result = next
        store.update(() => result)
        const list = store.project.yarns.map((y, i) => `${y.name} ${y.hex}${i === store.project.background ? ' (main)' : ''}${describeYarn(y)}`).join('; ')
        return text(`Yarns: ${list}.${floatNote()}`)
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
        if (built.length > 1) {
          const current = store.project.sizes?.[sizeIndex(store.project)]?.name
          return text(`The piece is now ${store.project.piece.name}, in ${built.length} sizes (${built.map((b) => b.name).join(', ')}). Showing ${current}: ${height} ${unit}, up to ${width} stitches.${shown === undefined ? ' The knitter picks their size at the top.' : ''}${floatNote()}`)
        }
        return text(`The piece is now ${store.project.piece.name}: ${height} ${unit}, up to ${width} stitches (${built[0]!.counts}).${floatNote()}`)
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
          if (input.name !== undefined) next = rename(next, String(input.name))
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
        const widths = [...project.piece.measurements].sort((a, b) => a.height - b.height).map((m) => `${m.name} ${m.width} cm at ${m.height} cm`).join(', ')
        return text(`"${project.name}": ${project.piece.name}, ${height} ${project.construction === 'round' ? 'rounds' : 'rows'}, up to ${width} stitches. Widths: ${widths}.${done.length ? ` ${done.join(' ')}` : ''}${floatNote()}`)
      },
    },
    {
      name: 'add-layer',
      description:
        'Adds a colorwork chart as a layer on the piece: a chart read from a pattern, or a colorwork motif from the library (`motif`, see get-library). Write a chart one character per stitch, rows top first, exactly as it reads on the page (the bottom row is knitted first, stitches as seen). `key` says which yarn each character is; map the chart’s background to "main" so the main color shows through and layers can stack. Add " purl" for purl stitches (the chart’s dot or dash symbol): "Canary purl", or "main purl" for a purl in the main color. Everything else is knit. Placement: "row" repeats it across the piece over its rows (a yoke or brim band), "tile" repeats it all over, "single" puts one copy in the middle (to duplicate stitch after knitting, until changed with update-layer).',
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
          bottomRow: { type: 'number', description: 'The knitted row the chart’s bottom row falls on (row 1 is the cast-on). Defaults to a free spot.' },
          gap: { type: 'number', description: 'Stitches of main color between repeats across. Default 0 (or the motif’s own spacing).' },
          upsideDown: { type: 'boolean', description: 'Turn the chart upside down: for a piece knitted top-down (a yoke from the neck), so a chart drawn bottom-up still reads the right way up when worn.' },
        },
        required: ['placement'],
      },
      execute: async ({ name, motif, yarn, rows, key, placement, bottomRow, gap, upsideDown }) => {
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
            fromLibrary = { motifId: found.mine!.id, editedAt: editedAt(found.mine!) }
            motifName = found.mine!.name
          }
        } else {
          ;({ colors: chart, stitches } = parseChart(rows, key, (ref) => yarnIndex(ref)))
        }
        const where = placementFrom(placement)
        const span = bottomRow === undefined ? store.rowsForNewBand(chart.height) : rowsFrom(Number(bottomRow), chart.height)
        const gapX = Math.max(0, Math.round(Number(gap ?? spacing)))
        const width = project.outline.width
        const band: Band = {
          ...createBand(crypto.randomUUID(), String(name || motifName || `Chart ${project.bands.length + 1}`), chart, where === 'tile' ? null : span),
          gapX,
          offsetX: where === 'single' ? Math.floor((width - chart.width) / 2) : centeredOffset(width, chart.width, gapX),
          ...(where === 'single' && { once: true, afterKnitting: true }),
          ...(stitches && { stitches }),
          ...(fromLibrary && { fromLibrary }),
          ...(upsideDown === true && UPSIDE_DOWN),
        }
        store.update((p) => addBand(p, band))
        store.selectLayer(band.id)
        return text(`Added "${band.name}" (${chart.width} × ${chart.height}) ${placed(band, store.project)}.${fitNote(band.id)}${floatNote()}`)
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
          shift: { type: 'number', description: 'Stitches to shift the repeats (or single motif) to the right.' },
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
          store.update((p) => duplicateBand(p, id, copyId, store.rowsForNewBand(span.bottom - span.top + 1)))
          store.selectLayer(copyId)
          const copy = findLayer(copyId)
          return text(`Made "${copy.name}", ${placed(copy, store.project)}.${floatNote()}`)
        }
        // The newer version of its library motif, fetched first: taking it is part of this one step.
        let newer: SavedMotif | undefined
        if (input.updateFromLibrary === true) {
          const saved = band.fromLibrary && library ? (await library.motifs()).find((m) => m.id === band.fromLibrary!.motifId) : undefined
          if (!saved || editedAt(saved) <= band.fromLibrary!.editedAt) throw new ToolError(`"${band.name}" is already its library motif's latest version, or didn't come from one of the knitter's saved motifs.`)
          newer = saved
        }
        store.update((p) => {
          let next = p
          const current = () => next.bands.find((b) => b.id === id)!
          if (input.name !== undefined) next = updateBand(next, id, { name: String(input.name) })
          if (newer) next = takeLibraryVersion(next, id, newer)
          if (input.scale !== undefined) next = setScale(next, id, Number(input.scale))
          // As the layer window does it: a single motif is centered, and duplicate stitched unless said otherwise.
          if (input.placement !== undefined) next = setPlacement(next, id, placementFrom(input.placement), store.rowsForNewBand(bandTile(current()).height))
          if (input.afterKnitting !== undefined) {
            if (!current().once) throw new ToolError('Only a single motif (placement "single") is duplicate stitched after knitting.')
            next = adjustBand(next, id, { afterKnitting: Boolean(input.afterKnitting) })
          }
          if (input.bottomRow !== undefined || input.rows !== undefined) {
            const span = bandSpan(current(), next.outline.height)
            const height = input.rows !== undefined ? Math.max(1, Math.round(Number(input.rows))) : span.bottom - span.top + 1
            const bottom = input.bottomRow !== undefined ? Number(input.bottomRow) : rowNumber(span.bottom, next.outline.height)
            next = updateBand(next, id, { rows: rowsFrom(bottom, height, next) })
          }
          if (input.gap !== undefined) next = adjustBand(next, id, { gapX: Math.max(0, Math.round(Number(input.gap))) })
          if (input.gapUp !== undefined) next = adjustBand(next, id, { gapY: Math.max(0, Math.round(Number(input.gapUp))) })
          if (input.shift !== undefined) next = updateBand(next, id, { offsetX: current().offsetX + Math.round(Number(input.shift)) })
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
            next = adjustBand(next, id, { motif: colors, stitches: stitches ?? undefined, details: undefined })
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
        store.selectLayer(id)
        const after = findLayer(id)
        return text(`"${after.name}" is ${placed(after, store.project)}.${fitNote(id)}${floatNote()}`)
      },
    },
    {
      name: 'render-chart',
      description:
        'A picture of the chart, to check it against the pattern it came from: the whole piece in its yarns, with row numbers up the side (row 1 at the bottom) and each stitch’s symbol (a dash for purl, / for k2tog…). Give a layer to see one repeat of its chart, larger. With `floats`, long floats are drawn out, and rows with them marked.',
      inputSchema: {
        type: 'object',
        properties: {
          layer: { ...layerRef, description: 'Just this layer’s chart, by name or id. Leave out for the whole piece.' },
          floats: { type: 'boolean', description: 'Draw the long floats over the whole piece.' },
        },
      },
      execute: ({ layer, floats }) => {
        const project = store.project
        let canvas: HTMLCanvasElement
        if (layer === undefined) {
          const chart = store.chart()
          const issues = store.allIssues()
          canvas = renderChartImage(project, chart, clamp(Math.floor(1100 / chart.width), 4, 16), 1, store.stitches(), {
            ...(floats === true && { floats: { issues, strands: issues, maxFloat: floatRulesOf(project).maxFloat, issueRows: [...new Set(issues.map((i) => i.y))] } }),
          })
        } else {
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
          const amounts = [`${Math.ceil(e.meters)} m (${Math.ceil(e.meters / METERS_PER_YARD)} yd)`, e.grams !== null && `${Math.ceil(e.grams)} g`, e.skeins !== null && `${e.skeins} skein${e.skeins === 1 ? '' : 's'}`].filter(Boolean).join(', ')
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
        const first = Math.max(1, Math.round(Number(from ?? 1)))
        const last = Math.min(chart.height, Math.round(Number(to ?? first + 59)))
        if (first > last) throw new ToolError(`The chart has rows 1 to ${chart.height}.`)
        const lines: string[] = []
        for (let row = first; row <= last; row++) {
          const y = chart.height - row
          const how = worked(y)
          const written = writeRow(chart, y, constructionOf(how), how.since, stitches, labels, project.background)
          lines.push(`${written.heading}: ${written.text}${written.stitches ? ` (${written.stitches} sts)` : ''}`)
        }
        const key = [...labels].map(([yarn, label]) => `${label} = ${project.yarns[yarn]?.name}`).join(', ')
        return text(`${key}\n${lines.join('\n')}${last < chart.height ? `\n(Rows ${last + 1}–${chart.height} follow.)` : ''}`)
      },
    },
    {
      name: 'paint-stitches',
      description: 'Paints single stitches on the chart, for small fixes a layer can’t make: each a yarn, a stitch, or both, by row (1 at the cast-on) and stitch (1 at the right edge, where a row begins), or erases them. They go in the chart’s “Drawn colorwork” layer, on top. One step the knitter can undo.',
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
        const { width, height } = store.project.outline
        const cells = (stitches as Array<Record<string, unknown>>).map((s) => {
          const [row, at] = [Math.round(Number(s.row)), Math.round(Number(s.stitch))]
          if (!(row >= 1 && row <= height && at >= 1 && at <= width)) throw new ToolError(`Row ${s.row}, stitch ${s.stitch} is off the chart (rows 1–${height}, stitches 1–${width}).`)
          if (s.erase === true) return { x: width - at, y: height - row, yarn: NONE, stitch: KNIT }
          if (s.yarn === undefined && s.type === undefined) throw new ToolError('Each stitch needs a yarn, a type, or both (or `erase`).')
          const type = s.type === undefined ? undefined : stitchNamed(String(s.type))
          if (s.type !== undefined && !type) throw new ToolError(`"${s.type}" isn't a stitch this knows.`)
          return { x: width - at, y: height - row, ...(s.yarn !== undefined && { yarn: yarnIndex(s.yarn) }), ...(type && { stitch: type.code }) }
        })
        const painted = store.paintCells(cells)
        return text(`Painted ${painted} of ${cells.length} stitches${painted < cells.length ? ' (the rest are off the piece)' : ''}.${floatNote()}`)
      },
    },
    {
      name: 'get-library',
      description:
        'The colorwork motifs the knitter can put on any chart: SkeinFiend’s own, and ones they saved. Each chart is written as add-layer takes it: "." is clear (the main color shows through), "M" the main color, and A, B… its contrast colors, which take on the chart’s yarns when it’s placed. Place one with add-layer’s `motif`.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const saved = library ? await library.motifs() : []
        return text(JSON.stringify({
          mine: saved.map((m) => ({ name: m.name, chart: libraryChart(m.grid) })),
          builtIn: MOTIF_LIBRARY.map((m) => ({ name: m.name, chart: libraryChart(m.build(0)), ...(m.spacing && { gap: m.spacing }) })),
        }, null, 1))
      },
    },
    {
      name: 'update-library',
      description: 'Saves a layer’s chart to the knitter’s colorwork motifs, for use on any chart (the layer is then that motif’s, and offered its later versions), or removes one they saved. SkeinFiend’s own motifs stay.',
      inputSchema: {
        type: 'object',
        properties: {
          save: { ...layerRef, description: 'A layer to save, by name or id.' },
          name: { type: 'string', description: 'What to call it in the library. Default: the layer’s name.' },
          remove: { type: 'string', description: 'One of the knitter’s saved motifs to remove, by name.' },
        },
      },
      execute: async ({ save, name, remove }) => {
        const lib = needLibrary()
        if (save !== undefined) {
          const band = findLayer(save)
          if (band.painted) throw new ToolError(`"${band.name}" is painted over the whole chart, not a motif: add it as a layer with add-layer first.`)
          const drafted = toSavedMotif(scaledMotif(band), store.project.background, crypto.randomUUID(), String(name ?? band.name).trim() || band.name, Date.now())
          // Under a name no other motif has, as when the knitter saves one.
          const motif = { ...drafted, name: uniqueMotifName(drafted, await lib.motifs(), MOTIF_LIBRARY.map((m) => m.name)) }
          await lib.putMotif(motif)
          lib.changed()
          // The layer is now the library motif's, as when the knitter saves it.
          store.updateQuietly((p) => updateBand(p, band.id, { fromLibrary: { motifId: motif.id, editedAt: motif.savedAt } }))
          return text(`Saved "${motif.name}" to the knitter’s colorwork motifs.`)
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
  return tools.map((tool) => ({ ...tool, execute: run(tool.execute) }))
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
  for (const [char, ref] of Object.entries(key as Record<string, unknown>)) legend[char] = keyEntry(String(ref), yarn)
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
  const rows = off.reduce((n, r) => n + r.to - r.from + 1, 0)
  const where = off.slice(0, 4).map((r) => (r.from === r.to ? `${r.from} (${r.stitches} sts)` : `${r.from}–${r.to} (from ${r.stitches} sts)`)).join(', ')
  return `Its ${period}-stitch repeat doesn't go evenly around ${rows} ${rows === 1 ? 'round' : 'rounds'}, so the repeat breaks where they begin: rounds ${where}${off.length > 4 ? ', …' : ''}.`
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
function editWidths(schematic: SchematicPiece, project: Project, widths: unknown, remove: unknown): SchematicPiece {
  const [perStitch, perRow] = [stitchesPerCm(project.gauge), rowsPerCm(project.gauge)]
  const measurements: Measurement[] = [...schematic.measurements]
  const names = () => measurements.map((m) => m.name).join(', ')
  const find = (name: string) => measurements.findIndex((m) => m.name.toLowerCase() === name.trim().toLowerCase())
  for (const entry of (Array.isArray(widths) ? widths : []) as Array<Record<string, unknown>>) {
    const name = String(entry.name ?? '').trim()
    if (!name) throw new ToolError('Each width needs a `name`.')
    const height = entry.height !== undefined ? Number(entry.height) : entry.row !== undefined ? Number(entry.row) / perRow : undefined
    const width = entry.width !== undefined ? Number(entry.width) : entry.stitches !== undefined ? Number(entry.stitches) / perStitch : undefined
    if (height !== undefined && !(height >= 0)) throw new ToolError(`${name}: its height is how far up from the cast-on it is, 0 or more.`)
    if (width !== undefined && !(width > 0)) throw new ToolError(`${name}: its width has to be more than 0.`)
    const renamed = entry.rename === undefined ? undefined : String(entry.rename).trim() || undefined
    const at = find(name)
    if (at >= 0) {
      measurements[at] = { ...measurements[at]!, ...(height !== undefined && { height }), ...(width !== undefined && { width }), ...(renamed && { name: renamed }) }
    } else {
      if (height === undefined || width === undefined) throw new ToolError(`No width "${name}" yet: to add it, give its height and width (or row and stitches). The widths are: ${names()}.`)
      measurements.push({ id: crypto.randomUUID(), name: renamed ?? name, height, width })
    }
  }
  for (const name of (Array.isArray(remove) ? remove : []) as unknown[]) {
    const at = find(String(name))
    if (at < 0) throw new ToolError(`No width "${name}". The widths are: ${names()}.`)
    measurements.splice(at, 1)
  }
  if (measurements.length < 2) throw new ToolError('A piece needs at least two widths: where it starts, and where it ends.')
  measurements.sort((a, b) => a.height - b.height)
  if (!(measurements.at(-1)!.height > 0)) throw new ToolError('The top width needs to be above the cast-on edge.')
  return { ...schematic, measurements }
}

/** A schematic from a pattern's stitch counts after so many rows, at its gauge. `where` says which size a problem's in. */
function schematicFrom(shape: unknown, rib: unknown, gauge: Gauge, where = ''): { schematic: SchematicPiece; counts: string } {
  const points = (Array.isArray(shape) ? shape : []) as Array<{ name?: string; row: number; stitches: number }>
  if (points.length < 2) throw new ToolError(`${where}the shape needs at least two points: where it starts, and where it ends.`)
  const sorted = [...points].sort((a, b) => a.row - b.row)
  if (sorted.some((p) => !(p.row >= 0) || !(p.stitches >= 1))) throw new ToolError(`${where}each point needs a row (0 or more) and a stitch count.`)
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
      height: p.row / perRow,
      width: p.stitches / perStitch,
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

/** Where a layer sits, in knitters' terms: "repeated across rows 12–20, 8 stitches apart". */
function placed(band: Band, project: Project): string {
  const { height } = project.outline
  const { top, bottom } = bandSpan(band, height)
  const rows = `rows ${rowNumber(bottom, height)}–${rowNumber(top, height)}`
  const where: Record<Placement, string> = {
    band: `repeated across ${rows}`,
    tile: 'repeated over the whole piece',
    single: `once, on ${rows}`,
  }
  const upsideDown = band.rotation === 180 && band.mirror
  return where[placementOf(band)] + (band.gapX ? `, ${band.gapX} ${band.gapX === 1 ? 'stitch' : 'stitches'} apart` : '') + (upsideDown ? ', upside down' : '') + (band.visible ? '' : ' (hidden)')
}

/** Characters for a layer's chart in get-chart, after "." for the main color. */
// Letters only: a "-" would read as purl, whatever it stood for.
const SYMBOLS = 'XOABCDEFGHIJKLMNPQRSTUVWYZ'

/** The chart as the agent sees it. */
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
      gauge: `${project.gauge.stitches} stitches and ${project.gauge.rows} rows in ${project.gauge.over ?? 10} cm`,
      // Each width as update-chart takes it, with where it falls in the knitting.
      widths: [...layoutSchematic(project.piece, project.gauge, project.construction).placed]
        .sort((a, b) => a.measurement.height - b.measurement.height)
        .map(({ measurement: m, row, stitches }) => ({ name: m.name, height: `${round1(m.height)} cm`, width: `${round1(m.width)} cm`, row: row + 1, stitches })),
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
          if (!symbols.has(meaning)) {
            const used = [...symbols.values()].filter((c) => c !== '.').length
            symbols.set(meaning, meaning === 'main' ? '.' : (SYMBOLS[used] ?? '?'))
          }
          return symbols.get(meaning)!
        }).join(''),
      )
      const fromSaved = band.fromLibrary && saved.find((m) => m.id === band.fromLibrary!.motifId)
      const fromBuiltIn = band.fromLibrary && MOTIF_LIBRARY.find((m) => `built-in:${m.id}` === band.fromLibrary!.motifId)
      return {
        id: band.id,
        name: band.name,
        where: placed(band, project),
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
    problems: [...new Set(issues.map((i) => i.y))].slice(0, 20).map((y) => {
      const row = issues.filter((i) => i.y === y)
      return `Row ${rowNumber(y, height)}: ${row.map((i) => `${project.yarns[i.yarn]?.name} floats ${i.length} stitches`).join(', ')}`
    }),
  }
}
