import { catchPoints, type FloatIssue, type RowIssue } from '@/domain/floats'
import { KNIT, NO_STITCH, STITCHES } from '@/domain/stitches'
import { NONE, type Grid } from '@/domain/grid'
import { isDark } from '@/domain/palette'
import { rowNumber, stitchNumber } from '@/domain/numbering'

export interface Theme {
  readonly canvas: string
  readonly gridLine: string
  readonly majorLine: string
  readonly outside: string
  readonly text: string
  readonly accent: string
  readonly warning: string
  /** The app's faces, for labels and the chart's numbers. */
  readonly fontUi: string
  readonly fontMono: string
}

export interface View {
  /** Cell size in CSS pixels. Height follows the gauge. */
  readonly cellWidth: number
  readonly cellHeight: number
  /** Screen position of the chart's top-left corner, in CSS pixels. */
  readonly originX: number
  readonly originY: number
}

export interface ChartDrawing {
  readonly grid: Grid
  readonly colors: readonly string[]
  readonly view: View
  readonly theme: Theme
  readonly numbers: boolean
  /** How each stitch is worked, the same size as `grid` (`StitchType` codes): each gets its chart symbol. Null when everything's knit. */
  readonly stitches?: Grid | null
  readonly issues?: readonly RowIssue[]
  /** Rows whose floats are drawn out; other problem rows just get a mark. */
  readonly issueRows?: readonly number[]
  /** Every float, drawn as a thin strand in its yarn: the back of the fabric, when asked for. */
  readonly strands?: readonly FloatIssue[] | null
  /** The longest float allowed, for where to catch the long ones. */
  readonly maxFloat?: number
  /**
   * A ruler over the chart, at real lengths: lines every so many centimeters
   * (or inches), counted from the right edge (where stitch 1 is) and the
   * cast-on, as the readout counts. Given stitches and rows per unit.
   */
  /** Colors washed out toward the page, so what's drawn over them (the sizes) reads plainly. */
  readonly faded?: boolean
  readonly measure?: { readonly stitchesPerUnit: number; readonly rowsPerUnit: number; readonly unit: 'cm' | 'in' } | null
  /** Repeats to box, as printed charts do: in cells, with a label ("14-st rep"). */
  readonly repeats?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly label: string }>
  /** A row pointed at in knitting, to preview: outlined lightly. */
  readonly hoverRow?: number | null
  /** Rows to point out across the chart: picked (strong), or pointed at. */
  readonly markedRows?: ReadonlyArray<{ readonly y: number; readonly strong: boolean }>
  readonly hover?: { readonly x: number; readonly y: number } | null
  /** The stitch pointed at is off the piece: its outline is drawn faintly. */
  readonly hoverFaint?: boolean
  /**
   * A brush's tip, where it would paint: the stitch under the pointer in the
   * color it'd take (the main color, for the eraser), shown faintly before
   * anything's painted. With a stitch as the brush, just its outline.
   */
  readonly brushTip?: { readonly x: number; readonly y: number; readonly color: string | null } | null
  /**
   * Where the pointer is, measured along the chart's edges: exactly, in stitches
   * across and rows down from the top-left, with a label for each edge.
   */
  readonly readout?: { readonly x: number; readonly y: number; readonly across: string; readonly up: string; readonly width?: string; readonly floats?: string } | null
  /** Knitting mode: the row being knitted, top-based. Other rows are dimmed. */
  readonly currentRow?: number | null
  /** The selected pattern band: its rows (top-based, inclusive) and each repeat's outline, in cells. */
  readonly selection?: {
    readonly top: number
    readonly bottom: number
    /** Whether the band has edges to drag (an all-over pattern and a placed motif don't). */
    readonly resizable: boolean
    /** A placed motif's stitches across; a band spans the whole chart. */
    readonly columns?: { readonly left: number; readonly right: number }
    readonly tiles: ReadonlyArray<{ x: number; y: number; width: number; height: number }>
    /** Where to drag the space between repeats: a stitch position and the band's rows. */
    readonly spacing?: { readonly x: number; readonly top: number; readonly bottom: number } | null
    /** The repeat whose corners scale the motif, in cells. */
    readonly corners?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  } | null
  /**
   * Knitting mode: motifs stitched on after knitting, shown faintly over the
   * knitted chart with a dashed outline above the row dimming; `focused` (an index) is outlined solidly.
   */
  readonly stitchedOn?: {
    readonly grid: Grid
    readonly places: ReadonlyArray<{ readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }>
    readonly focused?: number | null
  } | null
  /** Move tool: the row spans of bands that can be moved, outlined faintly; the one a click would grab, less so. */
  readonly movable?: ReadonlyArray<{ readonly top: number; readonly bottom: number; readonly columns?: { readonly left: number; readonly right: number }; readonly hovered?: boolean }>
}

/** Numbers are drawn every 5 stitches or rows, with heavier lines every 10, as in printed charts. */
const MAJOR = 10
const MINOR = 5

export function drawChart(ctx: CanvasRenderingContext2D, drawing: ChartDrawing): void {
  const { grid, colors, view, theme } = drawing
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const { width, height } = ctx.canvas
  const dpr = ctx.getTransform().a || 1
  const viewW = width / dpr
  const viewH = height / dpr

  ctx.fillStyle = theme.canvas
  ctx.fillRect(0, 0, viewW, viewH)

  // Only draw cells on screen.
  const x0 = Math.max(0, Math.floor(-originX / cw))
  const y0 = Math.max(0, Math.floor(-originY / ch))
  const x1 = Math.min(grid.width, Math.ceil((viewW - originX) / cw))
  const y1 = Math.min(grid.height, Math.ceil((viewH - originY) / ch))

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cell = grid.cells[y * grid.width + x]!
      ctx.fillStyle = cell === NONE ? theme.outside : (colors[cell] ?? theme.outside)
      ctx.fillRect(originX + x * cw, originY + y * ch, cw, ch)
    }
  }
  if (drawing.stitches && cw >= 4) drawStitches(ctx, drawing, x0, y0, x1, y1)
  if (drawing.faded) {
    ctx.save()
    ctx.globalAlpha = 0.6
    ctx.fillStyle = theme.canvas
    ctx.fillRect(originX + x0 * cw, originY + y0 * ch, (x1 - x0) * cw, (y1 - y0) * ch)
    ctx.restore()
  }
  if (cw >= 5) drawGridLines(ctx, drawing, x0, y0, x1, y1)
  if (drawing.stitchedOn?.places.length) drawStitchedOn(ctx, drawing, x0, y0, x1, y1)
  if (drawing.issues?.length || drawing.strands?.length) drawIssues(ctx, drawing, y0, y1)
  if (drawing.movable?.length) drawMovable(ctx, drawing)
  if (drawing.selection) drawSelection(ctx, drawing)
  // Over the selection's dimming, so the row looked at always shows.
  if (drawing.markedRows?.length) drawMarkedRows(ctx, drawing)
  if (drawing.measure) drawMeasure(ctx, drawing)
  if (drawing.currentRow != null) drawCurrentRow(ctx, drawing, viewW)
  if (drawing.hoverRow != null) drawHoverRow(ctx, drawing)
  // Outlined above the dimming, so they're findable from any row.
  if (drawing.stitchedOn?.places.length) outlineStitchedOn(ctx, drawing)
  if (drawing.hover) drawHover(ctx, drawing)
  if (drawing.brushTip) drawBrushTip(ctx, drawing)
  if (drawing.repeats?.length) drawRepeats(ctx, drawing)
  if (drawing.numbers) drawNumbers(ctx, drawing)
  if (drawing.readout) drawReadout(ctx, drawing)
}

/** Each stitch's symbol as a path, drawn in a 24 × 24 box and scaled to the stitch. Made when first drawn. */
let symbols: Map<number, { path: Path2D; fill: boolean }> | null = null
const symbolPaths = () => (symbols ??= new Map(STITCHES.filter((s) => s.symbol.path).map((s) => [s.code, { path: new Path2D(s.symbol.path), fill: s.symbol.fill ?? false }])))

/**
 * Stitch symbols, as charts print them: over each stitch's color, dark or
 * light to show on it. A place with no stitch is greyed out.
 */
function drawStitches(ctx: CanvasRenderingContext2D, { grid, colors, stitches, view, theme }: ChartDrawing, x0: number, y0: number, x1: number, y1: number) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const size = Math.min(cw, ch)
  const k = size / 24
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * grid.width + x
      const code = stitches!.cells[i]!
      if (code === KNIT || code === NONE) continue
      const [left, top] = [originX + x * cw, originY + y * ch]
      if (code === NO_STITCH) {
        ctx.fillStyle = theme.outside
        ctx.fillRect(left, top, cw, ch)
        continue
      }
      const symbol = symbolPaths().get(code)
      if (!symbol) continue
      const color = colors[grid.cells[i]!]
      const ink = color && isDark(color) ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.75)'
      ctx.save()
      ctx.translate(left + (cw - size) / 2, top + (ch - size) / 2)
      ctx.scale(k, k)
      ctx.lineWidth = Math.max(1.6, 1.1 / k)
      if (symbol.fill) {
        ctx.fillStyle = ink
        ctx.fill(symbol.path)
      } else {
        ctx.strokeStyle = ink
        ctx.stroke(symbol.path)
      }
      ctx.restore()
    }
  }
  ctx.restore()
}

/**
 * Rows to look at: the one picked has the rest of the chart faded around it,
 * as knitting mode shows the row being knitted; one pointed at is outlined.
 */
function drawMarkedRows(ctx: CanvasRenderingContext2D, { grid, view, theme, markedRows }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const [left, right] = [originX, originX + grid.width * cw]
  ctx.save()
  const picked = markedRows!.find((r) => r.strong)
  if (picked) {
    const top = originY + picked.y * ch
    ctx.fillStyle = theme.canvas
    ctx.globalAlpha = 0.55
    ctx.fillRect(left, originY, right - left, top - originY)
    ctx.fillRect(left, top + ch, right - left, originY + grid.height * ch - top - ch)
    ctx.globalAlpha = 1
  }
  for (const { y, strong } of markedRows!) {
    ctx.strokeStyle = strong ? theme.text : theme.warning
    ctx.lineWidth = strong ? 2 : 1.5
    ctx.strokeRect(left - 1, originY + y * ch - 1, right - left + 2, ch + 2)
  }
  ctx.restore()
}

/** Steps a ruler can take, finest first: whole centimeters, or inches. */
const MEASURE_STEPS = { cm: [1, 5, 10, 20], in: [1, 2, 4, 8] } as const
/** Lines at least this far apart on screen, so they never crowd. */
const MEASURE_GAP = 44

/**
 * Lines at real lengths, exactly where they fall (through a stitch, if that's
 * where the length ends), finer as the chart is zoomed in: every centimeter
 * close up, every 5 or 10 farther out. Faint, in the accent color, so they
 * read apart from the stitch grid, labeled just inside the cast-on and left edges.
 */
function drawMeasure(ctx: CanvasRenderingContext2D, { grid, view, theme, measure }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const { stitchesPerUnit, rowsPerUnit, unit } = measure!
  const [right, bottom] = [originX + grid.width * cw, originY + grid.height * ch]
  const perUnit = Math.min(cw * stitchesPerUnit, ch * rowsPerUnit)
  const step = MEASURE_STEPS[unit].find((s) => s * perUnit >= MEASURE_GAP) ?? MEASURE_STEPS[unit].at(-1)!
  ctx.save()
  ctx.strokeStyle = theme.accent
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 1
  ctx.beginPath()
  const across: number[] = []
  for (let k = step; k * stitchesPerUnit < grid.width; k += step) {
    const x = right - k * stitchesPerUnit * cw
    across.push(k)
    ctx.moveTo(Math.round(x) + 0.5, originY)
    ctx.lineTo(Math.round(x) + 0.5, bottom)
  }
  const up: number[] = []
  for (let k = step; k * rowsPerUnit < grid.height; k += step) {
    const y = bottom - k * rowsPerUnit * ch
    up.push(k)
    ctx.moveTo(originX, Math.round(y) + 0.5)
    ctx.lineTo(right, Math.round(y) + 0.5)
  }
  ctx.stroke()
  ctx.globalAlpha = 0.9
  ctx.font = `10px ${theme.fontUi}`
  ctx.textBaseline = 'top'
  const label = (text: string, x: number, y: number) => {
    ctx.fillStyle = theme.accent
    ctx.fillText(text, x, y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  // Not in the middle, where the sizes write the piece's widths.
  const middle = (originX + right) / 2
  for (const k of across) {
    const x = right - k * stitchesPerUnit * cw
    if (Math.abs(x - middle) > 50) label(`${k} ${unit}`, x, bottom - 3)
  }
  ctx.textAlign = 'left'
  for (const k of up) label(`${k} ${unit}`, originX + 3, bottom - k * rowsPerUnit * ch - 2)
  ctx.restore()
}

/** The red of a printed chart's repeat box. */
const REPEAT_RED = '#c4262e'

/** Each repeat boxed in red, its label just above it, as a book's chart marks "14-st rep". */
function drawRepeats(ctx: CanvasRenderingContext2D, { view, theme, repeats }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  ctx.save()
  ctx.strokeStyle = REPEAT_RED
  ctx.fillStyle = REPEAT_RED
  ctx.lineWidth = 1.5
  ctx.font = `600 9px ${theme.fontUi}`
  ctx.textBaseline = 'bottom'
  for (const r of repeats!) {
    const [x, y] = [originX + r.x * cw, originY + r.y * ch]
    ctx.strokeRect(x, y, r.width * cw, r.height * ch)
    const label = r.label
    const w = ctx.measureText(label).width + 6
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillRect(x, y - 12, w, 11)
    ctx.fillStyle = REPEAT_RED
    ctx.fillText(label, x + 3, y - 2)
  }
  ctx.restore()
}

function drawGridLines(ctx: CanvasRenderingContext2D, { grid, view, theme }: ChartDrawing, x0: number, y0: number, x1: number, y1: number) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const left = originX + x0 * cw
  const right = originX + x1 * cw
  const top = originY + y0 * ch
  const bottom = originY + y1 * ch
  // Heavy lines every 10 stitches counted from the right and 10 rows from the
  // bottom, where the chart starts. A line at x has width - x stitches to its right.
  const isMajorColumn = (x: number) => (grid.width - x) % MAJOR === 0
  const isMajorRow = (y: number) => (grid.height - y) % MAJOR === 0
  ctx.lineWidth = 1
  for (const major of [false, true]) {
    ctx.beginPath()
    for (let x = x0; x <= x1; x++) {
      if (isMajorColumn(x) !== major) continue
      const px = Math.round(originX + x * cw) + 0.5
      ctx.moveTo(px, top)
      ctx.lineTo(px, bottom)
    }
    for (let y = y0; y <= y1; y++) {
      if (isMajorRow(y) !== major) continue
      const py = Math.round(originY + y * ch) + 0.5
      ctx.moveTo(left, py)
      ctx.lineTo(right, py)
    }
    // Each line twice: faint light beneath, the usual dark on top. Over pale
    // yarns the dark line shows; over dark yarns, the light one shows through.
    ctx.strokeStyle = major ? 'rgb(255 255 255 / 0.3)' : 'rgb(255 255 255 / 0.16)'
    ctx.stroke()
    ctx.strokeStyle = major ? theme.majorLine : theme.gridLine
    ctx.stroke()
  }
}

/**
 * Every problem row gets a mark beside it, like a spelling squiggle. The row
 * being looked at also has its floats drawn as the strand they are: a line
 * behind the stitches it skips.
 */
/** Floats, only on the rows on screen (`y0` to `y1`): a chart can have thousands. */
function drawIssues(ctx: CanvasRenderingContext2D, { grid, view, theme, colors, issues, issueRows = [], strands, maxFloat = 0 }: ChartDrawing, y0: number, y1: number) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const r = Math.max(2, Math.min(4, ch * 0.3))
  const rowY = (y: number) => originY + y * ch + ch / 2
  // A float's runs across the chart (it can wrap around the round), from the first stitch it skips to the last.
  const runs = (cells: readonly number[]) => {
    const out: Array<[number, number]> = []
    let start: number | null = null
    let prev = -2
    for (const i of cells) {
      if (i !== prev + 1) {
        if (start !== null) out.push([start, prev])
        start = i
      }
      prev = i
    }
    if (start !== null) out.push([start, prev])
    return out
  }
  const segment = (path: Path2D, y: number, from: number, to: number) => {
    path.moveTo(originX + (from % grid.width) * cw + cw * 0.15, rowY(y))
    path.lineTo(originX + (to % grid.width) * cw + cw * 0.85, rowY(y))
  }
  const line = (y: number, from: number, to: number, color: string, width: number) => {
    const path = new Path2D()
    segment(path, y, from, to)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke(path)
  }
  const onScreen = (y: number) => y >= y0 && y < y1
  ctx.save()
  ctx.lineCap = 'round'

  // Every float, quietly: a thin strand in its yarn on a light edge. One path for the edges and one per yarn, not a stroke each.
  const thin = Math.max(1, ch * 0.1)
  const edges = new Path2D()
  const byYarn = new Map<number, Path2D>()
  for (const float of strands ?? []) {
    if (!onScreen(float.y)) continue
    let path = byYarn.get(float.yarn)
    if (!path) {
      path = new Path2D()
      byYarn.set(float.yarn, path)
    }
    for (const [from, to] of runs(float.cells)) {
      segment(edges, float.y, from, to)
      segment(path, float.y, from, to)
    }
  }
  if (byYarn.size) {
    ctx.strokeStyle = 'rgb(255 255 255 / 0.6)'
    ctx.lineWidth = thin + 1.5
    ctx.stroke(edges)
    ctx.lineWidth = thin
    for (const [yarn, path] of byYarn) {
      ctx.strokeStyle = colors[yarn] ?? theme.text
      ctx.stroke(path)
    }
  }

  const shown = new Set(issueRows)

  const marked = new Set<number>()
  for (const issue of issues ?? []) {
    if (!onScreen(issue.y)) continue
    if (!marked.has(issue.y)) {
      marked.add(issue.y)
      ctx.fillStyle = theme.warning
      ctx.beginPath()
      ctx.arc(originX - r - 9, rowY(issue.y), r, 0, Math.PI * 2)
      ctx.fill()
    }
    if (!shown.has(issue.y)) continue
    // A long float: a thick strand in its yarn with a warning edge, and ticks where to catch it.
    const thick = Math.max(1.5, ch * 0.14)
    for (const [from, to] of runs(issue.cells)) {
      line(issue.y, from, to, theme.warning, thick + 2)
      line(issue.y, from, to, colors[issue.yarn] ?? theme.text, thick)
    }
    ctx.strokeStyle = theme.warning
    ctx.lineWidth = Math.max(1.25, cw * 0.1)
    for (const at of catchPoints(issue.length, maxFloat)) {
      const cell = issue.cells[at]!
      const x = originX + (cell % grid.width) * cw + cw / 2
      ctx.beginPath()
      ctx.moveTo(x, rowY(issue.y) - ch * 0.42)
      ctx.lineTo(x, rowY(issue.y) + ch * 0.42)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawStitchedOn(ctx: CanvasRenderingContext2D, { view, theme, colors, stitchedOn }: ChartDrawing, x0: number, y0: number, x1: number, y1: number) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const { grid } = stitchedOn!
  ctx.save()
  ctx.globalAlpha = 0.35
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cell = grid.cells[y * grid.width + x]!
      if (cell === NONE) continue
      ctx.fillStyle = colors[cell] ?? theme.outside
      ctx.fillRect(originX + x * cw, originY + y * ch, cw, ch)
    }
  }
  ctx.restore()
}

function outlineStitchedOn(ctx: CanvasRenderingContext2D, { view, theme, stitchedOn }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const { places, focused } = stitchedOn!
  ctx.save()
  ctx.strokeStyle = theme.accent
  places.forEach(({ left, right, top, bottom }, i) => {
    const focus = i === focused
    ctx.globalAlpha = focus ? 1 : 0.6
    ctx.lineWidth = focus ? 2 : 1
    ctx.setLineDash(focus ? [] : [4, 3])
    ctx.strokeRect(originX + left * cw + 0.5, originY + top * ch + 0.5, (right - left) * cw - 1, (bottom - top + 1) * ch - 1)
  })
  ctx.restore()
}

function drawMovable(ctx: CanvasRenderingContext2D, { grid, view, theme, movable }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  ctx.save()
  ctx.strokeStyle = theme.accent
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])
  for (const { top, bottom, columns = { left: 0, right: grid.width }, hovered } of movable!) {
    ctx.globalAlpha = hovered ? 0.9 : 0.45
    ctx.lineWidth = hovered ? 1.5 : 1
    ctx.strokeRect(originX + columns.left * cw + 0.5, originY + top * ch + 0.5, (columns.right - columns.left) * cw - 1, (bottom - top + 1) * ch - 1)
  }
  ctx.restore()
}

/**
 * The band being edited: the rest of the chart dims, the band is outlined,
 * each repeat gets a dashed outline, and grips mark the draggable edges.
 */
function drawSelection(ctx: CanvasRenderingContext2D, { grid, view, theme, selection }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const { top, bottom, tiles, resizable, columns = { left: 0, right: grid.width } } = selection!
  const left = originX + columns.left * cw
  const width = (columns.right - columns.left) * cw
  const bandTop = originY + top * ch
  const bandBottom = originY + (bottom + 1) * ch

  ctx.save()
  ctx.fillStyle = theme.canvas
  ctx.globalAlpha = 0.5
  // Everything but the band (or the placed motif) dims.
  const chartLeft = originX
  const chartRight = originX + grid.width * cw
  ctx.fillRect(chartLeft, originY, chartRight - chartLeft, bandTop - originY)
  ctx.fillRect(chartLeft, bandBottom, chartRight - chartLeft, originY + grid.height * ch - bandBottom)
  ctx.fillRect(chartLeft, bandTop, left - chartLeft, bandBottom - bandTop)
  ctx.fillRect(left + width, bandTop, chartRight - left - width, bandBottom - bandTop)
  ctx.globalAlpha = 1

  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  for (const t of tiles) ctx.strokeRect(originX + t.x * cw + 0.5, originY + t.y * ch + 0.5, t.width * cw - 1, t.height * ch - 1)
  ctx.setLineDash([])
  ctx.lineWidth = 2
  ctx.strokeRect(left - 1, bandTop - 1, width + 2, bandBottom - bandTop + 2)

  if (resizable) {
    const gripWidth = Math.min(44, width / 4)
    const cx = left + width / 2
    ctx.fillStyle = theme.accent
    for (const y of [bandTop, bandBottom]) {
      ctx.beginPath()
      ctx.roundRect(cx - gripWidth / 2, y - 3, gripWidth, 6, 3)
      ctx.fill()
    }
  }
  const { spacing, corners } = selection!
  if (corners) {
    // Square handles, like any drawing app's: drag one out to knit the motif larger.
    const size = 8
    const x0 = originX + corners.x * cw
    const y0 = originY + corners.y * ch
    const x1 = x0 + corners.width * cw
    const y1 = y0 + corners.height * ch
    ctx.fillStyle = theme.canvas
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1.5
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
      ctx.beginPath()
      ctx.rect(x - size / 2, y - size / 2, size, size)
      ctx.fill()
      ctx.stroke()
    }
  }
  if (spacing) {
    // A divider down the gap between two repeats, the full height of the band,
    // so it reads as "the space here", not as another edge grip.
    const x = originX + spacing.x * cw
    const y0 = originY + spacing.top * ch + 3
    const y1 = originY + (spacing.bottom + 1) * ch - 3
    ctx.fillStyle = theme.accent
    ctx.strokeStyle = theme.canvas
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x - 2, y0, 4, Math.max(4, y1 - y0), 2)
    ctx.stroke()
    ctx.fill()
  }
  ctx.restore()
}

function drawCurrentRow(ctx: CanvasRenderingContext2D, { grid, view, theme, currentRow }: ChartDrawing, viewW: number) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const top = originY + currentRow! * ch
  ctx.fillStyle = theme.canvas
  ctx.globalAlpha = 0.62
  ctx.fillRect(originX, originY, grid.width * cw, top - originY)
  ctx.fillRect(originX, top + ch, grid.width * cw, (grid.height - currentRow! - 1) * ch)
  ctx.globalAlpha = 1
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 2.5
  ctx.strokeRect(Math.max(0, originX) - 1, top - 1, Math.min(viewW, grid.width * cw) + 2, ch + 2)
}

function drawHoverRow(ctx: CanvasRenderingContext2D, { grid, view, theme, hoverRow }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  ctx.save()
  ctx.strokeStyle = theme.text
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.5
  ctx.strokeRect(originX - 1, originY + hoverRow! * ch - 1, grid.width * cw + 2, ch + 2)
  ctx.restore()
}

function drawBrushTip(ctx: CanvasRenderingContext2D, { view, theme, brushTip }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const { x, y, color } = brushTip!
  const [left, top] = [originX + x * cw, originY + y * ch]
  ctx.save()
  if (color) {
    ctx.globalAlpha = 0.6
    ctx.fillStyle = color
    ctx.fillRect(left, top, cw, ch)
    ctx.globalAlpha = 1
  }
  ctx.strokeStyle = theme.text
  ctx.lineWidth = 1.5
  ctx.strokeRect(left + 0.75, top + 0.75, cw - 1.5, ch - 1.5)
  ctx.restore()
}

function drawHover(ctx: CanvasRenderingContext2D, { view, theme, hover, hoverFaint }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  ctx.save()
  // Off the piece, fainter: pointing there, not at a stitch.
  ctx.globalAlpha = hoverFaint ? 0.3 : 1
  ctx.strokeStyle = theme.text
  ctx.lineWidth = 1.5
  ctx.strokeRect(originX + hover!.x * cw + 0.75, originY + hover!.y * ch + 0.75, cw - 1.5, ch - 1.5)
  ctx.restore()
}

/**
 * The pointer's place, read off the chart's edges like a ruler: quietly, a
 * thin tick where it meets each edge and a small label beside it, across the
 * bottom (from the right edge, where stitch 1 is) and up the right side.
 */
function drawReadout(ctx: CanvasRenderingContext2D, { grid, view, theme, readout }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const { x, y, across, up, width, floats } = readout!
  const [px, py] = [originX + x * cw, originY + y * ch]
  const bottom = originY + grid.height * ch
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = theme.text
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px, bottom - 4)
  ctx.lineTo(px, bottom + 3)
  ctx.moveTo(originX + 4, py)
  ctx.lineTo(originX - 3, py)
  ctx.stroke()
  ctx.font = `10px ${theme.fontUi}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  // In a small tag in the page's color, so it reads over busy colorwork: the lines as one tag, from its left edge.
  const PAD = 4
  const LINE = 13
  type Line = { text: string; warning?: boolean }
  const widthOf = (lines: readonly Line[]) => Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 2 * PAD
  const tag = (lines: readonly Line[], lx: number, cy: number, over = false) => {
    const w = widthOf(lines)
    const h = lines.length * LINE + 3
    const top = cy - h / 2
    // Over the stitches, see-through, so they still show; beside them, solid.
    ctx.globalAlpha = over ? 0.78 : 0.94
    ctx.fillStyle = theme.canvas
    ctx.beginPath()
    ctx.roundRect(lx, top, w, h, 3)
    ctx.fill()
    ctx.globalAlpha = 1
    lines.forEach((l, i) => {
      ctx.fillStyle = l.warning ? theme.warning : theme.text
      ctx.fillText(l.text, lx + PAD, top + 1.5 + LINE * (i + 0.5))
    })
  }
  // Under the chart; zoomed in with the bottom edge out of view, just inside the view's bottom edge, over the stitches.
  const viewHeight = ctx.canvas.height / (ctx.getTransform().d || 1)
  const under = bottom + 22
  const acrossOver = under + LINE / 2 > viewHeight - 4
  tag([{ text: across }], px - widthOf([{ text: across }]) / 2, acrossOver ? viewHeight - 16 : under, acrossOver)
  // Beside the row, on the left, clear of the problem-row marks: the height up, the piece's width there, and the row's long floats.
  // Each measurement on its own line ("13.2 cm", "42 rows"), so the tag is tall and narrow.
  const split = (text: string): Line[] => text.split(' · ').map((part) => ({ text: part }))
  const lines: Line[] = [...split(up), ...(width ? split(width) : []), ...(floats ? [{ text: floats, warning: true }] : [])]
  const w = widthOf(lines)
  const MARKS = 20
  // Left of the chart, past the marks. Zoomed in with no room there, just inside the view's left edge, over the stitches.
  const beside = originX - MARKS - w
  tag(lines, beside >= 4 ? beside : 8, lines.length > 1 ? py : py - 9, beside < 4)
  ctx.restore()
}

function drawNumbers(ctx: CanvasRenderingContext2D, { grid, view, theme }: ChartDrawing) {
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const size = Math.max(9, Math.min(12, ch * 0.7))
  ctx.fillStyle = theme.text
  ctx.font = `${size}px ${theme.fontMono}`
  // Every 5, 10, or 20: the finest that keeps the labels apart. Past 100 stitches the numbers
  // are three digits wide, so they go to every 20 until the chart's zoomed in enough for 10.
  const steps = [MINOR, MAJOR, MAJOR * 2, MAJOR * 5]
  const rowStep = steps.find((s) => ch * s >= size * 1.6) ?? steps.at(-1)!
  const widest = ctx.measureText(String(grid.width)).width
  const stitchStep = steps.find((s) => cw * s >= widest + 8) ?? steps.at(-1)!

  // Row numbers on the right, where right-side rows begin.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (let y = 0; y < grid.height; y++) {
    const row = rowNumber(y, grid.height)
    if (row !== 1 && row % rowStep !== 0) continue
    ctx.fillText(String(row), originX + grid.width * cw + 6, originY + y * ch + ch / 2)
  }
  // Stitch numbers along the bottom, counting from the right.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let x = 0; x < grid.width; x++) {
    const stitch = stitchNumber(x, grid.width)
    if (stitch !== 1 && stitch % stitchStep !== 0) continue
    ctx.fillText(String(stitch), originX + x * cw + cw / 2, originY + grid.height * ch + 6)
  }
}

/**
 * Reads the chart colors from CSS. Custom properties come back as their raw
 * text (`light-dark(…)`, `var(…)`), which canvas can't use, so each one is
 * resolved through a real color property on a hidden probe element.
 */
export function readTheme(element: Element): Theme {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  element.parentElement?.appendChild(probe)
  const resolve = (name: string) => {
    probe.style.color = `var(${name})`
    return getComputedStyle(probe).color
  }
  const theme = {
    canvas: resolve('--chart-canvas'),
    gridLine: resolve('--chart-grid'),
    majorLine: resolve('--chart-grid-major'),
    outside: resolve('--chart-outside'),
    text: resolve('--chart-text'),
    accent: resolve('--accent'),
    warning: resolve('--warning'),
    fontUi: getComputedStyle(element).getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif',
    fontMono: getComputedStyle(element).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace',
  }
  probe.remove()
  return theme
}
