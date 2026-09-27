import { bandSpan, bandStitchTile, bandTile, centeredOffset, createBand, placementOf, type Band, type Placement } from '@/domain/bands'
import { KNIT, STITCHES, stitchNamed, stitchType } from '@/domain/stitches'
import { addBand, addYarn, adjustBand, dismissFloats, removeBand, renamePiece, reorderBand, setBackground, setConstruction, setGauge, setScale, setSchematic, setSizes, setSwatch, sizeIndex, switchSize, updateBand, updateYarn } from '@/domain/edits'
import { isValidGauge, rowsPerCm, stitchesPerCm, type Gauge } from '@/domain/gauge'
import { createGrid, MAX_SIZE, NONE, type Grid } from '@/domain/grid'
import { rowNumber } from '@/domain/numbering'
import { constructionOf, projectRowsWorked } from '@/domain/instructions'
import { writeRow, yarnLabels } from '@/domain/written'
import { isHexColor, MAX_YARNS, YARN_WEIGHTS, yarnCounts, type Yarn } from '@/domain/palette'
import { MARGIN, METERS_PER_YARD } from '@/domain/yarn-estimate'
import type { SchematicPiece } from '@/domain/pieces'
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

const layerRef = { type: 'string', description: 'The layer, by name or id (from get_chart).' }
const yarnRef = { type: 'string', description: 'A yarn in the chart, by name (or its number from get_chart).' }

export function agentTools(store: EditorStore): AgentTool[] {
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
    return rows ? ` ${rows} ${rows === 1 ? 'row has' : 'rows have'} long floats: see get_chart.` : ''
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
      name: 'get_chart',
      description:
        'The colorwork chart open in SkeinFiend: the piece it goes on (size in stitches and rows, knitted in the round or flat), the yarns (colors), and the colorwork layers stacked on it, each with its chart. Rows are numbered as knitters do: row 1 is the cast-on row, at the bottom. Also lists rows with floats too long to knit comfortably.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => text(JSON.stringify(describe(store.project, store), null, 1)),
    },
    {
      name: 'set_yarns',
      description:
        'Adds yarns, or changes them: a name, a color, which is the main color (knitted wherever no layer has a stitch). To try the chart in other colors, change the yarns rather than the charts: every layer follows. Also what each yarn is, from its ball band (a photo of the label, or the yarn’s page in a shop): brand, weight, fiber, a skein’s length and weight, and a link. With a skein’s length, `estimate_yarn` says how many skeins the chart takes. Give null to clear a detail. All the changes are one step the knitter can undo, so each colorway tried is one undo away from the last.',
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
              },
            },
          },
        },
        required: ['yarns'],
      },
      execute: ({ yarns }) => {
        if (!Array.isArray(yarns) || !yarns.length) throw new ToolError('`yarns` must list the yarns to add or change.')
        const changed: number[] = []
        let next = store.project
        for (const entry of yarns as Array<Record<string, unknown>>) {
          const { yarn, name, hex, main } = entry
          if (hex !== undefined && !isHexColor(String(hex))) throw new ToolError(`Color must be #rrggbb, not "${hex}".`)
          let index: number
          if (yarn === undefined) {
            if (next.yarns.length >= MAX_YARNS) throw new ToolError(`A chart has at most ${MAX_YARNS} yarns.`)
            index = next.yarns.length
            next = addYarn(next)
          } else index = yarnIndex(yarn, next)
          next = updateYarn(next, index, { ...(name !== undefined && { name: String(name) }), ...(hex !== undefined && { hex: String(hex).toLowerCase() }), ...yarnDetails(entry) })
          if (main) next = setBackground(next, index)
          changed.push(index)
        }
        const result = next
        store.update(() => result)
        const list = store.project.yarns.map((y, i) => `${y.name} ${y.hex}${i === store.project.background ? ' (main)' : ''}${describeYarn(y)}`).join('; ')
        return text(`Yarns: ${list}.${floatNote()}`)
      },
    },
    {
      name: 'shape_piece',
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
      name: 'set_size',
      description: 'Shows another size of the pattern, with the colorwork on it: to compare sizes, or the knitter’s own. Only for a piece made with sizes.',
      inputSchema: { type: 'object', properties: { size: { type: 'string', description: 'The size’s name, from get_chart.' } }, required: ['size'] },
      execute: ({ size }) => {
        const sizes = store.project.sizes
        if (!sizes) throw new ToolError('This piece has one size: make it with `sizes` in shape_piece to have several.')
        const index = sizes.findIndex((s) => s.name.toLowerCase() === String(size).trim().toLowerCase())
        if (index < 0) throw new ToolError(`No size "${size}". The sizes are: ${sizes.map((s) => s.name).join(', ')}.`)
        store.update((p) => switchSize(p, index))
        const { width, height } = store.project.outline
        return text(`Showing size ${sizes[index]!.name}: ${height} rows, up to ${width} stitches.${floatNote()}`)
      },
    },
    {
      name: 'add_chart',
      description:
        'Adds a colorwork chart as a layer on the piece. Write the chart one character per stitch, rows top first, exactly as it reads on the page (the bottom row is knitted first, stitches as seen). `key` says which yarn each character is; map the chart’s background to "main" so the main color shows through and layers can stack. Add " purl" for purl stitches (the chart’s dot or dash symbol): "Canary purl", or "main purl" for a purl in the main color. Everything else is knit. Placement: "row" repeats it across the piece over its rows (a yoke or brim band), "tile" repeats it all over, "single" puts one copy in the middle.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What the chart is called, e.g. "Chart A".' },
          rows: { type: 'array', items: { type: 'string' }, description: 'The chart, top row first, one character per stitch. Every row the same length.' },
          key: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Each character used, to a yarn name from get_chart (or "main" to show the main color), a stitch, or both: "Madder", "k1 tbl", "main purl", "Madder k2tog". Stitches: purl, k1 tbl, yo, k2tog, ssk, M1, M1L, M1R, M1 p-st, sl, bobble, no stitch; anything else is knit. Match the chart’s own key to these: books draw them differently (a dash or a dot for purl, a loop for k1 tbl). E.g. {".": "main", "X": "Madder", "-": "purl", "Q": "k1 tbl"}.',
          },
          placement: { type: 'string', enum: ['row', 'tile', 'single'] },
          bottomRow: { type: 'number', description: 'The knitted row the chart’s bottom row falls on (row 1 is the cast-on). Defaults to a free spot.' },
          gap: { type: 'number', description: 'Stitches of main color between repeats across. Default 0.' },
          upsideDown: { type: 'boolean', description: 'Turn the chart upside down: for a piece knitted top-down (a yoke from the neck), so a chart drawn bottom-up still reads the right way up when worn.' },
        },
        required: ['name', 'rows', 'key', 'placement'],
      },
      execute: ({ name, rows, key, placement, bottomRow, gap = 0, upsideDown }) => {
        const { colors: chart, stitches } = parseChart(rows, key, (ref) => yarnIndex(ref))
        const where = placementFrom(placement)
        const span = bottomRow === undefined ? store.rowsForNewBand(chart.height) : rowsFrom(Number(bottomRow), chart.height)
        const gapX = Math.max(0, Math.round(Number(gap)))
        const width = store.project.outline.width
        const band: Band = {
          ...createBand(crypto.randomUUID(), String(name || `Chart ${store.project.bands.length + 1}`), chart, where === 'tile' ? null : span),
          gapX,
          offsetX: where === 'single' ? Math.floor((width - chart.width) / 2) : centeredOffset(width, chart.width, gapX),
          ...(where === 'single' && { once: true }),
          ...(stitches && { stitches }),
          ...(upsideDown === true && UPSIDE_DOWN),
        }
        store.update((p) => addBand(p, band))
        store.selectLayer(band.id)
        return text(`Added "${band.name}" (${chart.width} × ${chart.height}) ${placed(band, store.project)}.${fitNote(band.id)}${floatNote()}`)
      },
    },
    {
      name: 'update_layer',
      description: 'Moves or changes a layer: which rows it sits on, how it repeats, its spacing, its scale (each stitch knitted as a block), whether it shows, its name, or where it is in the stack (a layer in front covers the ones behind).',
      inputSchema: {
        type: 'object',
        properties: {
          layer: layerRef,
          name: { type: 'string' },
          placement: { type: 'string', enum: ['row', 'tile', 'single'] },
          bottomRow: { type: 'number', description: 'The knitted row its bottom falls on (row 1 is the cast-on).' },
          rows: { type: 'number', description: 'How many rows the band covers; its chart repeats up them.' },
          gap: { type: 'number', description: 'Stitches between repeats across.' },
          shift: { type: 'number', description: 'Stitches to shift the repeats (or single motif) to the right.' },
          scale: { type: 'number', description: 'How much larger to knit the chart, 1 to 4 in tenths: 1.5 makes a 14-stitch chart 21 stitches, doubling some stitches.' },
          visible: { type: 'boolean' },
          order: { type: 'string', enum: ['front', 'back', 'forward', 'backward'], description: 'Moves it in the stack: to the front or back, or one step.' },
          upsideDown: { type: 'boolean', description: 'Turn the chart upside down: for a piece knitted top-down (a yoke from the neck), so a chart drawn bottom-up still reads the right way up when worn.' },
          recolor: {
            type: 'object',
            properties: { from: yarnRef, to: yarnRef },
            description: 'Switch one yarn for another in this layer only.',
          },
          chart: {
            type: 'object',
            description: 'A new chart for the layer, as add_chart takes it: to fix a misread, or add its stitches. It keeps its place.',
            properties: { rows: { type: 'array', items: { type: 'string' } }, key: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['rows', 'key'],
          },
        },
        required: ['layer'],
      },
      execute: (input) => {
        const band = findLayer(input.layer)
        const { id } = band
        store.update((p) => {
          let next = p
          const current = () => next.bands.find((b) => b.id === id)!
          if (input.name !== undefined) next = updateBand(next, id, { name: String(input.name) })
          if (input.scale !== undefined) next = setScale(next, id, Number(input.scale))
          if (input.placement !== undefined) {
            const where = placementFrom(input.placement)
            const span = current().rows ?? rowsFrom(1, bandTile(current()).height, next)
            next = updateBand(next, id, where === 'tile' ? { rows: null, once: false } : { rows: span, once: where === 'single' })
          }
          if (input.bottomRow !== undefined || input.rows !== undefined) {
            const span = bandSpan(current(), next.outline.height)
            const height = input.rows !== undefined ? Math.max(1, Math.round(Number(input.rows))) : span.bottom - span.top + 1
            const bottom = input.bottomRow !== undefined ? Number(input.bottomRow) : rowNumber(span.bottom, next.outline.height)
            next = updateBand(next, id, { rows: rowsFrom(bottom, height, next) })
          }
          if (input.gap !== undefined) next = adjustBand(next, id, { gapX: Math.max(0, Math.round(Number(input.gap))) })
          if (input.shift !== undefined) next = updateBand(next, id, { offsetX: current().offsetX + Math.round(Number(input.shift)) })
          if (input.visible !== undefined) next = updateBand(next, id, { visible: Boolean(input.visible) })
          if (input.order !== undefined) {
            // Layers are kept back to front.
            const at = next.bands.findIndex((b) => b.id === id)
            const to = { front: next.bands.length - 1, back: 0, forward: at + 1, backward: at - 1 }[String(input.order) as 'front']
            if (to === undefined) throw new ToolError('`order` is front, back, forward, or backward.')
            next = reorderBand(next, id, Math.max(0, Math.min(next.bands.length - 1, to)))
          }
          if (input.upsideDown !== undefined) next = adjustBand(next, id, input.upsideDown ? UPSIDE_DOWN : { rotation: 0, mirror: false })
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
      name: 'render_chart',
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
      name: 'show',
      description:
        'Shows or hides things over the chart, for the knitter to see what you mean: `sizing` (the piece’s widths and lengths, to drag), `floats` (every strand on the back, the long ones picked out, and the rows with them listed), `stitches` (each stitch’s symbol, and a palette to paint stitches). They can be on together.',
      inputSchema: {
        type: 'object',
        properties: { sizing: { type: 'boolean' }, floats: { type: 'boolean' }, stitches: { type: 'boolean' } },
      },
      execute: ({ sizing, floats, stitches }) => {
        const state = store.getState()
        if (sizing !== undefined && Boolean(sizing) !== state.showingSizing) store.toggleSizing()
        if (floats !== undefined && Boolean(floats) !== state.showingFloats) store.toggleFloats()
        if (stitches !== undefined && Boolean(stitches) !== state.showingStitches) store.toggleStitches()
        const now = store.getState()
        const on = [now.showingSizing && 'sizing', now.showingFloats && 'floats', now.showingStitches && 'stitches'].filter(Boolean)
        return text(on.length ? `Showing ${on.join(', ')}.` : 'Showing just the chart.')
      },
    },
    {
      name: 'estimate_yarn',
      description:
        `How much of each yarn the piece takes, in the size shown: stitches in it, stitches its floats pass behind, and meters (with ${Math.round(MARGIN * 100)}% extra for the swatch and weaving in). With a skein’s length and weight from set_yarns, also grams and skeins. From the gauge unless the knitter weighed a swatch (set_swatch). For another size, set_size first.`,
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
      name: 'set_swatch',
      description: 'Records the knitter’s swatch for the yarn estimate: its size and what it weighs, knitted in the colorwork (or plain, in one yarn). It stands in for the gauge’s guess at how much yarn a stitch takes. Every yarn in the chart needs a skein’s length and weight (set_yarns) for it to be used. Give `clear` to remove it.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'number', description: 'Width in centimeters.' },
          height: { type: 'number', description: 'Height in centimeters.' },
          grams: { type: 'number' },
          clear: { type: 'boolean' },
        },
      },
      execute: ({ width, height, grams, clear }) => {
        if (clear) {
          store.update((p) => setSwatch(p, undefined))
          return text('Swatch removed: the estimate goes by the gauge.')
        }
        const [w, h, g] = [Number(width), Number(height), Number(grams)]
        if (!(w > 0 && h > 0 && g > 0)) throw new ToolError('Give the swatch’s width and height in centimeters, and its weight in grams.')
        store.update((p) => setSwatch(p, { widthCm: w, heightCm: h, grams: g }))
        return text(`Swatch: ${w} × ${h} cm, ${g} g.${store.estimate().fromSwatch ? ' The estimate goes by it now.' : ' Every yarn in the chart needs a skein’s length and weight before it can be used.'}`)
      },
    },
    {
      name: 'get_written_rows',
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
      name: 'paint_stitches',
      description: 'Paints single stitches on the chart, for small fixes a layer can’t make: each a yarn, a stitch, or both, by row (1 at the cast-on) and stitch (1 at the right edge, where a row begins). They go in the chart’s “Drawn colorwork” layer, on top. One step the knitter can undo.',
      inputSchema: {
        type: 'object',
        properties: {
          stitches: {
            type: 'array',
            items: {
              type: 'object',
              properties: { row: { type: 'number' }, stitch: { type: 'number' }, yarn: yarnRef, type: { type: 'string', description: 'A stitch, as in add_chart’s key: "purl", "k2tog"…' } },
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
          if (s.yarn === undefined && s.type === undefined) throw new ToolError('Each stitch needs a yarn, a type, or both.')
          const type = s.type === undefined ? undefined : stitchNamed(String(s.type))
          if (s.type !== undefined && !type) throw new ToolError(`"${s.type}" isn't a stitch this knows.`)
          return { x: width - at, y: height - row, ...(s.yarn !== undefined && { yarn: yarnIndex(s.yarn) }), ...(type && { stitch: type.code }) }
        })
        const painted = store.paintCells(cells)
        return text(`Painted ${painted} of ${cells.length} stitches${painted < cells.length ? ' (the rest are off the piece)' : ''}.${floatNote()}`)
      },
    },
    {
      name: 'ignore_floats',
      description: 'Sets long floats aside that the knitter’s happy with (they’ll catch them, or the yarn is grippy): the rows stop being flagged until they change. Give rows by number, or `all`.',
      inputSchema: {
        type: 'object',
        properties: { rows: { type: 'array', items: { type: 'number' } }, all: { type: 'boolean' } },
      },
      execute: ({ rows, all }) => {
        const height = store.project.outline.height
        const flagged = new Map<number, ReturnType<typeof store.issues>>()
        for (const issue of store.issues()) flagged.set(issue.y, [...(flagged.get(issue.y) ?? []), issue])
        const wanted = all ? [...flagged.keys()] : (Array.isArray(rows) ? rows : []).map((r) => height - Math.round(Number(r)))
        const ignoring = wanted.filter((y) => flagged.has(y))
        if (!ignoring.length) return text('None of those rows have long floats flagged.')
        store.update((p) => ignoring.reduce((next, y) => dismissFloats(next, y, flagged.get(y)!), p))
        return text(`Ignoring rows ${ignoring.map((y) => height - y).sort((a, b) => a - b).join(', ')}, until they change.`)
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
      name: 'remove_layer',
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

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
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
  return where[placementOf(band)] + (band.gapX ? `, ${band.gapX} stitches apart` : '') + (upsideDown ? ', upside down' : '') + (band.visible ? '' : ' (hidden)')
}

/** Characters for a layer's chart in get_chart, after "." for the main color. */
// Letters only: a "-" would read as purl, whatever it stood for.
const SYMBOLS = 'XOABCDEFGHIJKLMNPQRSTUVWYZ'

/** The chart as the agent sees it. */
function describe(project: Project, store: EditorStore) {
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
    },
    yarns: project.yarns.map(({ id: _, ...y }, i) => ({ number: i, ...y, ...(i === project.background && { main: true }) })),
    layers: project.bands.map((band) => {
      // A character for each yarn and stitch the chart uses, the way add_chart takes them.
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
      return {
        id: band.id,
        name: band.name,
        where: placed(band, project),
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
