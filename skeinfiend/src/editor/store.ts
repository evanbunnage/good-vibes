import { bandSpan, bandTile, bandTiles, coverChart, createBand, isArranged, motifCellAt, scaledMotif, type Band } from '@/domain/bands'
import { addBand, adjustBand, drawMotif, drawStitches, moveBand, recolorBand, setBandEdge, setScale, sizeIndex, switchSize, updateBand } from '@/domain/edits'
import { analyzeChart, type FloatIssue, type RowIssue } from '@/domain/floats'
import { cloneGrid, createGrid, getCell, inBounds, NONE, type Grid } from '@/domain/grid'
import { commit, redo, replacePresent, startHistory, undo, type History } from '@/domain/history'
import { lineCells } from '@/domain/lines'
import { KNIT, PURL } from '@/domain/stitches'
import { constructionOf, projectRowsWorked } from '@/domain/instructions'
import { estimateYarn, type ChartEstimate } from '@/domain/yarn-estimate'
import { composeChart, composeStitches, floatRulesOf, floatsDismissed, type Project } from '@/domain/project'

/** What drawing in the motif window does: color stitches in, or clear them. */
export type MotifTool = 'brush' | 'eraser'

/** Another size of the pattern, and how many of its rows have long floats. */
export interface SizeFloats {
  readonly index: number
  readonly name: string
  readonly rows: number
}

/** A corner of the selected layer's motif, to drag to scale it. */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface EditorState {
  readonly history: History<Project>
  /** The project mid-gesture (a stroke or a drag). Committed as one undo step when it ends. */
  readonly draft: Project | null
  /** The yarn the brush draws with. */
  readonly yarn: number
  readonly motifTool: MotifTool
  /** The selected layer: highlighted on the chart, what dragging moves, and in the motif window to edit. */
  readonly selectedBandId: string | null
  /** The problem row being looked at, from the Floats panel. */
  readonly issueRow: number | null
  /** A problem row being pointed at in the margin: its floats are drawn out. */
  readonly peekRow: number | null
  /** The layer being moved, sized or spaced on the chart: only the floats it makes are shown meanwhile. */
  readonly arranging: string | null
  /** Every long float drawn out on the chart, not just the row pointed at. */
  readonly showingFloats: boolean
  /** The piece's widths and lengths drawn over the chart, to change them there. */
  readonly showingSizing: boolean
  /** Each stitch's symbol drawn on the chart; painting places `stitch` rather than a color. */
  readonly showingStitches: boolean
  /** The stitch painting places, when it's the brush (a `StitchType` code). */
  readonly stitch: number
  /** What painting places: the chosen yarn, or the chosen stitch. Whichever was picked last. */
  readonly brush: 'yarn' | 'stitch'
  /** A layer color picked to recolor: the next yarn chosen replaces it. */
  readonly recoloring: { readonly bandId: string; readonly yarn: number } | null
  readonly hover: { readonly x: number; readonly y: number } | null
  /** The pointer's exact place over the chart, in stitches and rows from its top-left. */
  readonly pointer: { readonly x: number; readonly y: number } | null
}

type Listener = () => void

/** At least this close to a band's edge (in rows) grabs the edge rather than the band. */
const EDGE_GRAB = 0.6

type Stroke =
  | { kind: 'motif'; bandId: string; grid: Grid; value: number; last: { x: number; y: number }; stitches?: { scale: number } }
  /**
   * Painting on the chart, into its painted layer: its colors, or with the
   * stitches showing, its stitches. `base` is the project with that layer
   * ready (made, or grown to cover the chart).
   */
  | { kind: 'paint'; bandId: string; grid: Grid; value: number; last: { x: number; y: number }; base: Project; offset: { x: number; y: number }; stitches: boolean }

type Gesture =
  | Stroke
  | { kind: 'move'; bandId: string; start: { x: number; y: number } }
  | { kind: 'edge'; bandId: string; edge: 'top' | 'bottom' }
  | { kind: 'spacing'; bandId: string; startX: number; startGap: number }
  | {
      kind: 'scale'
      bandId: string
      /** The corner opposite the one dragged, in cells: it stays put. */
      anchor: { x: number; y: number }
      /** Which way from the anchor the dragged corner is. */
      toward: { x: 1 | -1; y: 1 | -1 }
      /** The motif's own size, unscaled. */
      motif: { width: number; height: number }
      /** Whether the band was one motif tall, so its rows follow the motif. */
      fitted: boolean
      /** A layer in rows: its rows and scale when the drag began. It scales by height, its rows with it. */
      inRows?: { span: number; scale: number }
    }

/**
 * The editor's state and every way it changes. Deliberately outside React:
 * pointer events arrive faster than React should render, so the canvas reads
 * this store directly and panels subscribe to just the slices they show.
 *
 * The chart is for arranging: pointing at a layer grabs it (to move it, change
 * its rows, or change the gap between repeats). Stitches are drawn in the
 * motif window, on the selected layer's motif.
 */
export class EditorStore {
  private state: EditorState
  private readonly listeners = new Set<Listener>()
  private gesture: Gesture | null = null
  private readonly composed = new WeakMap<Project, Grid>()
  private readonly knitted = new WeakMap<Project, Grid>()
  private readonly purled = new WeakMap<Project, { all: Grid | null; knitted: Grid | null }>()
  private readonly otherSizes = new WeakMap<Project, SizeFloats[]>()
  private readonly shownIssues = new WeakMap<Project, RowIssue[]>()
  private readonly analyzed = new WeakMap<Grid, RowIssue[]>()
  private readonly allFloats = new WeakMap<Grid, FloatIssue[]>()
  private readonly estimates = new WeakMap<Project, ChartEstimate>()
  /** While arranging a layer: the long floats there were without it, to tell the ones it makes. */
  private baseline: Set<string> | null = null
  /** The rows on screen, so new things land where you're looking. */
  private visibleRows: { top: number; bottom: number } | null = null

  constructor(project: Project) {
    this.state = {
      history: startHistory(project),
      draft: null,
      yarn: Math.min(1, project.yarns.length - 1),
      motifTool: 'brush',
      selectedBandId: null,
      issueRow: null,
      peekRow: null,
      arranging: null,
      showingFloats: false,
      showingSizing: false,
      showingStitches: false,
      stitch: PURL,
      brush: 'yarn',
      recoloring: null,
      hover: null,
      pointer: null,
    }
  }

  // Subscription (the shape useSyncExternalStore expects)

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): EditorState => this.state

  private set(patch: Partial<EditorState>): void {
    const next = { ...this.state, ...patch }
    this.state = patch.history && patch.history !== this.state.history ? reconcile(next) : next
    for (const listener of this.listeners) listener()
  }

  // Derived values, memoized by identity so selectors stay stable

  get project(): Project {
    return this.state.draft ?? this.state.history.present
  }

  chart(project = this.project): Grid {
    let chart = this.composed.get(project)
    if (!chart) {
      chart = composeChart(project)
      this.composed.set(project, chart)
    }
    return chart
  }

  /** The chart as knitted: without motifs stitched on afterwards. The same grid when there are none. */
  knittedChart(project = this.project): Grid {
    if (!project.bands.some((b) => b.afterKnitting && b.visible)) return this.chart(project)
    let chart = this.knitted.get(project)
    if (!chart) {
      chart = composeChart(project, { knitted: true })
      this.knitted.set(project, chart)
    }
    return chart
  }

  /** Every float in the knitted chart, however short: the strands behind the fabric. */
  floats(project = this.project): FloatIssue[] {
    const chart = this.knittedChart(project)
    let floats = this.allFloats.get(chart)
    if (!floats) {
      const worked = projectRowsWorked(project)
      floats = analyzeChart(chart, (y) => constructionOf(worked(y)), { maxFloat: 0 })
      this.allFloats.set(chart, floats)
    }
    return floats
  }

  /** How much of each yarn the piece takes, as knitted: stitches, floats, and a margin. */
  estimate(project = this.project): ChartEstimate {
    let estimate = this.estimates.get(project)
    if (!estimate) {
      estimate = estimateYarn(this.knittedChart(project), this.stitches(project, { knitted: true }), this.floats(project), project.yarns, project.gauge, project.swatch)
      this.estimates.set(project, estimate)
    }
    return estimate
  }

  /**
   * Long floats to show the knitter: every row's, less the rows they've
   * dismissed (while those rows stay as they were).
   */
  issues(project = this.project): RowIssue[] {
    const all = this.allIssues(project)
    if (!project.dismissedFloats) return all
    let shown = this.shownIssues.get(project)
    if (!shown) {
      const byRow = new Map<number, RowIssue[]>()
      for (const issue of all) byRow.set(issue.y, [...(byRow.get(issue.y) ?? []), issue])
      shown = all.filter((issue) => !floatsDismissed(project, issue.y, byRow.get(issue.y)!))
      this.shownIssues.set(project, shown)
    }
    return shown
  }

  /** Every long float, dismissed or not: for the agent, which should know them all. */
  allIssues(project = this.project): RowIssue[] {
    // Floats are about knitting, so stitched-on motifs don't count.
    const chart = this.knittedChart(project)
    let issues = this.analyzed.get(chart)
    if (!issues) {
      const worked = projectRowsWorked(project)
      issues = analyzeChart(chart, (y) => constructionOf(worked(y)), floatRulesOf(project))
      this.analyzed.set(chart, issues)
    }
    return issues
  }

  /** Knit and purl stitches (`composeStitches`), or null when nothing's purled. `knitted` leaves out what's stitched on afterwards. */
  stitches(project = this.project, { knitted = false } = {}): Grid | null {
    let both = this.purled.get(project)
    if (!both) {
      both = { all: composeStitches(project), knitted: composeStitches(project, { knitted: true }) }
      this.purled.set(project, both)
    }
    return knitted ? both.knitted : both.all
  }

  /**
   * The pattern's other sizes, with how many rows of each have long floats:
   * the colorwork is shared, so what's fine in one size can float in another.
   */
  sizeFloats(project = this.project): SizeFloats[] {
    let found = this.otherSizes.get(project)
    if (!found) {
      const shown = sizeIndex(project)
      found = (project.sizes ?? []).flatMap((size, index) => {
        if (index === shown) return []
        const sized = switchSize(project, index)
        const worked = projectRowsWorked(sized)
        const issues = analyzeChart(composeChart(sized, { knitted: true }), (y) => constructionOf(worked(y)), floatRulesOf(sized))
        return [{ index, name: size.name, rows: new Set(issues.map((i) => i.y)).size }]
      })
      this.otherSizes.set(project, found)
    }
    return found
  }

  selectedBand(project = this.project): Band | undefined {
    return project.bands.find((b) => b.id === this.state.selectedBandId)
  }

  // Layers and drawing

  selectLayer(id: string | null): void {
    if (id !== this.state.selectedBandId) this.set({ selectedBandId: id })
  }

  setMotifTool(motifTool: MotifTool): void {
    // Erasing clears colors: it's the yarn brush.
    this.set({ motifTool, ...(motifTool === 'eraser' && { brush: 'yarn' as const }) })
  }

  setYarn(yarn: number): void {
    if (yarn >= 0 && yarn < this.project.yarns.length) this.set({ yarn })
  }

  /**
   * Choosing a yarn. While recoloring a layer, it becomes that layer's color;
   * otherwise it's what the brush draws with (so the brush, not the eraser).
   */
  chooseYarn(yarn: number): void {
    const { recoloring } = this.state
    if (recoloring) {
      this.update((p) => recolorBand(p, recoloring.bandId, recoloring.yarn, yarn))
      this.set({ recoloring: null })
      return
    }
    this.setYarn(yarn)
    if (this.state.motifTool !== 'brush') this.setMotifTool('brush')
    if (this.state.brush !== 'yarn') this.set({ brush: 'yarn' })
  }

  /** Picks one of a layer's colors to recolor with the next yarn chosen (again to cancel). */
  recolor(bandId: string, yarn: number): void {
    const current = this.state.recoloring
    const same = current?.bandId === bandId && current.yarn === yarn
    this.set({ recoloring: same ? null : { bandId, yarn } })
  }

  cancelRecolor(): void {
    if (this.state.recoloring) this.set({ recoloring: null })
  }

  /**
   * Where to drag the space between the selected layer's repeats: in the gap
   * after the repeat just right of the middle of the chart, the band's full height.
   */
  spacingHandle(): { x: number; top: number; bottom: number } | null {
    const band = this.selectedBand()
    if (!band || band.once || !isArranged(band)) return null
    const { width, height } = this.project.outline
    const { top, bottom } = bandSpan(band, height)
    const tile = bandTile(band)
    const period = tile.width + Math.max(0, band.gapX)
    // The gap you see runs from one repeat's last stitch to the next one's first,
    // including any blank columns inside the motif itself.
    const { left, right } = stitchColumns(tile)
    const gaps = [...new Set(bandTiles(band, width, height).map((t) => t.x))]
      .map((x) => ({ start: x + right + 1, end: x + period + left }))
      .filter((g) => g.start >= 0 && g.end <= width)
    if (gaps.length === 0) return null
    // One repeat right of the middle, clear of the grips on the band's edges.
    const target = width / 2 + period
    const gap = gaps.reduce((best, g) => (Math.abs(g.start - target) < Math.abs(best.start - target) ? g : best))
    return { x: (gap.start + gap.end) / 2, top, bottom }
  }

  /**
   * Where the selected layer's corners are, to drag to scale it: a layer in
   * rows scales by its outline (all its repeats together), a placed motif by
   * itself. A layer tiled over the whole piece is scaled in its window. In cells.
   */
  scaleHandle(): { x: number; y: number; width: number; height: number } | null {
    const band = this.selectedBand()
    if (!band || !isArranged(band)) return null
    const { width, height } = this.project.outline
    if (!band.once) return { x: 0, y: band.rows!.top, width, height: band.rows!.bottom - band.rows!.top + 1 }
    const tile = bandTile(band)
    return bandTiles(band, width, height).find((t) => t.height === tile.height && t.x >= 0 && t.x + t.width <= width) ?? null
  }

  setVisibleRows(top: number, bottom: number): void {
    this.visibleRows = { top, bottom }
  }

  /**
   * Rows for a new layer `height` rows tall: the free rows nearest the middle
   * of what's on screen, so it's in view and doesn't cover another layer.
   */
  rowsForNewBand(height: number): { top: number; bottom: number } {
    const chartHeight = this.project.outline.height
    const view = this.visibleRows ?? { top: 0, bottom: chartHeight - 1 }
    const middle = Math.floor((Math.max(0, view.top) + Math.min(chartHeight - 1, view.bottom)) / 2)
    const ideal = clamp(middle - Math.floor(height / 2), 0, Math.max(0, chartHeight - height))
    const taken = this.project.bands.filter((b) => b.visible && b.rows).map((b) => b.rows!)
    const free = (top: number) => taken.every((r) => top + height - 1 < r.top - 1 || top > r.bottom + 1)
    for (let d = 0; d <= chartHeight; d++) {
      for (const top of [ideal - d, ideal + d]) {
        if (top >= 0 && top + height <= chartHeight && free(top)) return { top, bottom: top + height - 1 }
      }
    }
    return this.rowsAt(middle, height)
  }

  /** Rows for a layer `height` rows tall, centered on row `y` (where a motif was dropped). */
  rowsAt(y: number, height: number): { top: number; bottom: number } {
    const chartHeight = this.project.outline.height
    const top = clamp(y - Math.floor(height / 2), 0, Math.max(0, chartHeight - height))
    return { top, bottom: Math.min(chartHeight - 1, top + height - 1) }
  }

  // Floats

  peekAtRow(y: number | null): void {
    if (y !== this.state.peekRow) this.set({ peekRow: y })
  }

  /** Shows the back of the fabric (every strand, the long ones picked out), or stops. */
  toggleFloats(): void {
    this.set({ showingFloats: !this.state.showingFloats })
  }

  /** Shows the piece's widths and lengths over the chart, with handles to change them. Stacks with the floats. */
  toggleSizing(): void {
    this.set({ showingSizing: !this.state.showingSizing })
  }

  /** Shows each stitch's symbol (purl, k1 tbl, k2tog…) on the chart. Only what's seen: painting follows the brush. */
  toggleStitches(): void {
    this.set({ showingStitches: !this.state.showingStitches })
  }

  /** Picks a stitch to paint with: it's the brush now, and the symbols show, to see what's painted. */
  setStitch(stitch: number): void {
    this.set({ stitch, brush: 'stitch', showingStitches: true })
  }


  /** Goes to a problem row: scrolled into view with its floats drawn. */
  showIssueRow(y: number): void {
    this.set({ issueRow: y })
  }

  clearIssueRow(): void {
    if (this.state.issueRow !== null) this.set({ issueRow: null })
  }

  /** Where the pointer is over the chart, exactly (stitches across and rows down, fractions and all): for the live measurements on its edges. */
  setPointer(pointer: { x: number; y: number } | null): void {
    const current = this.state.pointer
    if (current?.x === pointer?.x && current?.y === pointer?.y) return
    this.set({ pointer })
  }

  setHover(hover: { x: number; y: number } | null): void {
    const current = this.state.hover
    if (current?.x === hover?.x && current?.y === hover?.y) return
    this.set({ hover })
  }

  // Document changes

  /** Applies an edit as one undoable step, replacing any live preview of it. */
  update(edit: (project: Project) => Project): void {
    const next = edit(this.state.history.present)
    const draft = this.gesture ? this.state.draft : null
    if (next !== this.state.history.present) this.set({ draft, history: commit(this.state.history, next) })
    else if (draft !== this.state.draft) this.set({ draft })
  }

  /** Applies a change that shouldn't be undoable, like knitting progress. */
  updateQuietly(edit: (project: Project) => Project): void {
    this.set({ history: replacePresent(this.state.history, edit(this.state.history.present)) })
  }

  /** Shows an edit live, like a color being dragged in a picker, without committing it yet. */
  preview(edit: (project: Project) => Project): void {
    this.set({ draft: edit(this.state.history.present) })
  }

  /** Drops a live preview without committing it. */
  cancelPreview(): void {
    if (this.state.draft && !this.gesture) this.set({ draft: null })
  }

  /** Commits the previewed edit as one undo step. */
  commitPreview(): void {
    const draft = this.state.draft
    if (draft && !this.gesture) this.set({ draft: null, history: commit(this.state.history, draft) })
  }

  undo(): void {
    if (!this.state.draft) this.set({ history: undo(this.state.history) })
  }

  redo(): void {
    if (!this.state.draft) this.set({ history: redo(this.state.history) })
  }

  get canUndo(): boolean {
    return this.state.history.past.length > 0
  }

  get canRedo(): boolean {
    return this.state.history.future.length > 0
  }

  // Pointer input on the chart. `x` and `y` are cells; `exactY` is the fractional row, for grabbing band edges.

  /**
   * What a press here would grab: an edge of the selected layer, its gap
   * handle, the layer you can see at that stitch, or nothing. Used for the
   * cursor and by `pointerDown`.
   */
  hitTest(x: number, exactY: number, slop = 0, exactX = x + 0.5, slopX = slop): { band: Band; part: 'top' | 'bottom' | 'body' | 'spacing' | Corner } | null {
    const project = this.project
    const selected = this.selectedBand(project)
    const grab = Math.max(EDGE_GRAB, slop)
    const corner = selected && this.cornerAt(exactX, exactY, slopX, slop)
    if (selected && corner) return { band: selected, part: corner }
    if (selected?.rows && !selected.once) {
      if (Math.abs(exactY - selected.rows.top) < grab) return { band: selected, part: 'top' }
      if (Math.abs(exactY - (selected.rows.bottom + 1)) < grab) return { band: selected, part: 'bottom' }
    }
    const handle = this.spacingHandle()
    if (selected && handle && Math.abs(x + 0.5 - handle.x) <= 0.75 && exactY >= handle.top && exactY < handle.bottom + 1) {
      return { band: selected, part: 'spacing' }
    }
    if (x < 0 || x >= project.outline.width) return null
    const y = Math.floor(exactY)
    // Where layers overlap, you get the one you can see at that stitch: later layers
    // draw on top, so the first (from the top) with a motif stitch there. Between
    // stitches, a band in rows wins over a tiled pattern.
    const height = project.outline.height
    // A layer tiled over the whole piece isn't grabbed on the chart: pressing there reaches what's in rows, or nothing.
    const hits = [...project.bands].reverse().filter((b) => b.visible && isArranged(b) && inBandRows(b, y, height) && (!b.once || (x >= b.offsetX && x < b.offsetX + bandTile(b).width)))
    const hasStitch = (b: Band) => {
      const cell = motifCellAt(b, x, y, height)
      const motif = scaledMotif(b)
      return cell !== null && motif.cells[cell.y * motif.width + cell.x] !== NONE
    }
    const band = hits.find(hasStitch) ?? hits.find((b) => b.rows) ?? hits[0]
    return band ? { band, part: 'body' } : null
  }

  /** The corner of the scale handle at a point, within a grab distance across and up. */
  private cornerAt(exactX: number, exactY: number, grabX: number, grabY: number): Corner | null {
    const handle = this.scaleHandle()
    if (!handle) return null
    const { x, y, width, height } = handle
    // A comfortable grab on screen, but never so much of a small motif that it can't be moved.
    const [gx, gy] = [Math.min(grabX, width / 4), Math.min(grabY, height / 4)]
    const near = (a: number, b: number, grab: number) => Math.abs(a - b) <= grab
    grabX = gx
    grabY = gy
    const side = near(exactX, x, grabX) ? 'left' : near(exactX, x + width, grabX) ? 'right' : null
    const end = near(exactY, y, grabY) ? 'top' : near(exactY, y + height, grabY) ? 'bottom' : null
    return side && end ? `${end}-${side}` : null
  }

  pointerDown(x: number, y: number, options: { exactY?: number; slop?: number; exactX?: number; slopX?: number; secondary?: boolean } = {}): void {
    const { exactY = y + 0.5, slop = 0, exactX = x + 0.5, slopX = slop, secondary = false } = options
    const project = this.state.history.present

    // With the painted layer selected, pressing anywhere paints (a right-click erases).
    if (this.selectedBand(project)?.painted) {
      this.startPainting(x, y, secondary)
      return
    }
    const hit = secondary ? null : this.hitTest(x, exactY, slop, exactX, slopX)
    if (!hit) {
      // On the piece's plain stitches, pressing paints; off the piece, it lets go of the selected layer.
      if (getCell(project.outline, x, y) !== NONE) this.startPainting(x, y, secondary)
      else this.set({ selectedBandId: null })
      return
    }
    this.selectLayer(hit.band.id)
    const { part, band } = hit
    if (part === 'top' || part === 'bottom') this.gesture = { kind: 'edge', bandId: band.id, edge: part }
    else if (part === 'body') this.gesture = { kind: 'move', bandId: band.id, start: { x, y } }
    else if (part === 'spacing') this.gesture = { kind: 'spacing', bandId: band.id, startX: x, startGap: band.gapX }
    else {
      const handle = this.scaleHandle()!
      const toward = { x: part.endsWith('left') ? -1 : 1, y: part.startsWith('top') ? -1 : 1 } as const
      const span = bandSpan(band, project.outline.height)
      this.gesture = {
        kind: 'scale',
        bandId: band.id,
        anchor: { x: toward.x < 0 ? handle.x + handle.width : handle.x, y: toward.y < 0 ? handle.y + handle.height : handle.y },
        toward,
        motif: { width: band.motif.width, height: band.motif.height },
        fitted: band.once || (band.rows !== null && span.bottom - span.top + 1 === bandTile(band).height),
        ...(band.rows && !band.once && { inRows: { span: span.bottom - span.top + 1, scale: band.scale ?? 1 } }),
      }
    }
    // The floats there'd be without the layer: what it makes, from here, is what it adds to those.
    this.baseline = new Set(this.allIssues(updateBand(project, band.id, { visible: false })).map(floatKey))
    this.set({ arranging: band.id })
  }

  /**
   * Long floats the layer being arranged makes, where it is now: new ones,
   * or ones it lengthens. None when nothing's being arranged.
   */
  causedIssues(project = this.project): RowIssue[] {
    const baseline = this.baseline
    if (!baseline) return []
    return this.allIssues(project).filter((issue) => !baseline.has(floatKey(issue)))
  }

  pointerMove(x: number, y: number, exactY = y + 0.5, exactX = x + 0.5): void {
    const gesture = this.gesture
    if (!gesture) return
    const present = this.state.history.present
    switch (gesture.kind) {
      case 'scale':
        this.set({ draft: scaleFromCorner(present, gesture, exactX, exactY) })
        return
      case 'move':
        this.set({ draft: moveBand(present, gesture.bandId, x - gesture.start.x, y - gesture.start.y) })
        return
      case 'spacing': {
        const gapX = clamp(gesture.startGap + x - gesture.startX, 0, 60)
        this.set({ draft: adjustBand(present, gesture.bandId, { gapX }) })
        return
      }
      case 'edge': {
        // The top edge is the first row of the band; the bottom edge is the line under its last row.
        const row = gesture.edge === 'top' ? Math.round(exactY) : Math.round(exactY) - 1
        this.set({ draft: setBandEdge(present, gesture.bandId, gesture.edge, row) })
        return
      }
      case 'paint':
        if (gesture.last.x !== x || gesture.last.y !== y) this.paintLine(gesture, gesture.last.x, gesture.last.y, x, y)
        return
      case 'motif':
        return
    }
  }

  pointerUp(): void {
    const draft = this.state.draft
    this.gesture = null
    this.stopArranging()
    if (!draft) return
    this.set({ draft: null, history: commit(this.state.history, draft) })
  }

  private stopArranging(): void {
    this.baseline = null
    if (this.state.arranging) this.set({ arranging: null })
  }

  cancelGesture(): void {
    this.gesture = null
    this.stopArranging()
    if (this.state.draft) this.set({ draft: null })
  }

  // The motif window: drawing the selected layer's motif, stitch for stitch.

  /** `secondary` is a right-click, which erases whichever tool is picked. */
  motifPointerDown(x: number, y: number, { secondary = false } = {}): void {
    const band = this.selectedBand(this.state.history.present)
    // Drawn at the layer's scale: at 2×, each stitch of its finer drawing.
    const motif = band && scaledMotif(band)
    if (!band || !motif || !inBounds(motif, x, y)) return
    if (this.state.brush === 'stitch') {
      // Stitches belong to the motif's own stitches, at 1×: at 2×, each block of four is one.
      const scale = motif.width / band.motif.width
      const grid = band.stitches ? cloneGrid(band.stitches) : createGrid(band.motif.width, band.motif.height, KNIT)
      const at = { x: Math.floor(x / scale), y: Math.floor(y / scale) }
      this.gesture = { kind: 'motif', bandId: band.id, grid, value: secondary ? KNIT : this.state.stitch, last: at, stitches: { scale } }
      this.paintLine(this.gesture, at.x, at.y, at.x, at.y)
      return
    }
    // Cleared motif stitches are transparent: the background shows through.
    const value = this.state.motifTool === 'eraser' || secondary ? NONE : this.state.yarn
    this.gesture = { kind: 'motif', bandId: band.id, grid: cloneGrid(motif), value, last: { x, y } }
    this.paintLine(this.gesture, x, y, x, y)
  }

  motifPointerMove(x: number, y: number): void {
    const gesture = this.gesture
    if (gesture?.kind !== 'motif') return
    const scale = gesture.stitches?.scale ?? 1
    const at = { x: Math.floor(x / scale), y: Math.floor(y / scale) }
    if (at.x !== gesture.last.x || at.y !== gesture.last.y) this.paintLine(gesture, gesture.last.x, gesture.last.y, at.x, at.y)
  }

  private paintLine(stroke: Stroke, x0: number, y0: number, x1: number, y1: number): void {
    // Painting on the chart: chart stitches, offset into the painted layer, and only on the piece.
    const offset = stroke.kind === 'paint' ? stroke.offset : { x: 0, y: 0 }
    const outline = stroke.kind === 'paint' ? stroke.base.outline : null
    for (const [cx, cy] of lineCells(x0, y0, x1, y1)) {
      if (outline && getCell(outline, cx, cy) === NONE) continue
      const [x, y] = [cx - offset.x, cy - offset.y]
      if (inBounds(stroke.grid, x, y)) stroke.grid.cells[y * stroke.grid.width + x] = stroke.value
    }
    stroke.last = { x: x1, y: y1 }
    // A new grid object around the mutated cells, so memoized derivations refresh.
    const grid = { ...stroke.grid }
    const project = stroke.kind === 'paint' ? stroke.base : this.state.history.present
    const stitches = stroke.kind === 'paint' ? stroke.stitches : stroke.kind === 'motif' && Boolean(stroke.stitches)
    this.set({ draft: stitches ? drawStitches(project, stroke.bandId, grid) : drawMotif(project, stroke.bandId, grid) })
  }

  /**
   * Starts painting on the chart with the chosen yarn (or erasing, with
   * `secondary`), into the painted layer: made on top if there isn't one yet,
   * and selected. Making it and the first stroke are one step to undo.
   */
  /**
   * Paints stitches straight onto the chart, as painting by hand does (into
   * the drawn layer, made if there isn't one), all as one step to undo: each
   * a yarn, a stitch, or both. Off the piece, a stitch is skipped. Returns how
   * many were painted.
   */
  paintCells(cells: ReadonlyArray<{ readonly x: number; readonly y: number; readonly yarn?: number; readonly stitch?: number }>): number {
    const present = this.project
    const { width, height } = present.outline
    const existing = present.bands.find((b) => b.painted)
    let made = existing ?? { ...createBand(crypto.randomUUID(), 'Drawn colorwork', createGrid(width, height), { top: 0, bottom: height - 1 }), once: true, painted: true }
    if (cells.some((c) => c.stitch !== undefined) && !made.stitches) made = { ...made, stitches: createGrid(made.motif.width, made.motif.height, KNIT) }
    const band = coverChart(made, width, height)
    const tileTop = band.rows!.bottom - band.motif.height + 1
    const motif = cloneGrid(band.motif)
    const stitches = band.stitches ? cloneGrid(band.stitches) : null
    let painted = 0
    for (const cell of cells) {
      if (getCell(present.outline, cell.x, cell.y) === NONE) continue
      const [x, y] = [cell.x - band.offsetX, cell.y - tileTop]
      if (!inBounds(motif, x, y)) continue
      if (cell.yarn !== undefined) motif.cells[y * motif.width + x] = cell.yarn
      if (cell.stitch !== undefined && stitches) stitches.cells[y * stitches.width + x] = cell.stitch
      painted++
    }
    if (!painted) return 0
    const next = { ...band, motif, ...(stitches && { stitches }) }
    this.update((p) => (existing ? updateBand(p, next.id, next) : addBand(p, next)))
    return painted
  }

  private startPainting(x: number, y: number, erase: boolean): void {
    const present = this.state.history.present
    const { width, height } = present.outline
    const existing = present.bands.find((b) => b.painted)
    if (!existing && erase) return
    // With a stitch as the brush, painting places it (a right-click sets it back to knit).
    const stitches = this.state.brush === 'stitch'
    const made = existing ?? { ...createBand(crypto.randomUUID(), 'Drawn colorwork', createGrid(width, height), { top: 0, bottom: height - 1 }), once: true, painted: true }
    const band = coverChart(stitches && !made.stitches ? { ...made, stitches: createGrid(made.motif.width, made.motif.height, KNIT) } : made, width, height)
    const base = existing ? updateBand(present, band.id, band) : addBand(present, band)
    const tileTop = band.rows!.bottom - band.motif.height + 1
    const grid = stitches ? band.stitches! : band.motif
    const value = stitches ? (erase ? KNIT : this.state.stitch) : erase ? NONE : this.state.yarn
    this.gesture = { kind: 'paint', bandId: band.id, grid: cloneGrid(grid), value, last: { x, y }, base, offset: { x: band.offsetX, y: tileTop }, stitches }
    this.selectLayer(band.id)
    this.paintLine(this.gesture, x, y, x, y)
  }
}

/** The first and last columns with a stitch in them (the whole width if there are none). */
function stitchColumns(tile: Grid): { left: number; right: number } {
  let left = tile.width
  let right = -1
  for (let i = 0; i < tile.cells.length; i++) {
    if (tile.cells[i] === NONE) continue
    const x = i % tile.width
    left = Math.min(left, x)
    right = Math.max(right, x)
  }
  return right < 0 ? { left: 0, right: tile.width - 1 } : { left, right }
}


function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function inBandRows(band: Band, y: number, chartHeight: number): boolean {
  const { top, bottom } = bandSpan(band, chartHeight)
  return y >= top && y <= bottom
}

/**
 * After the document changes (an edit, undo, or redo), drops selections that
 * no longer exist: a removed yarn, a deleted layer, a color that's gone.
 */
function reconcile(state: EditorState): EditorState {
  const project = state.history.present
  const yarn = Math.min(state.yarn, project.yarns.length - 1)
  const selectedBandId = project.bands.some((b) => b.id === state.selectedBandId) ? state.selectedBandId : null
  // A color being recolored has to still be in its layer.
  const recoloringBand = state.recoloring && project.bands.find((b) => b.id === state.recoloring!.bandId)
  const recoloring = recoloringBand && scaledMotif(recoloringBand).cells.includes(state.recoloring!.yarn) ? state.recoloring : null
  if (yarn === state.yarn && selectedBandId === state.selectedBandId && recoloring === state.recoloring) return state
  return { ...state, yarn, selectedBandId, recoloring }
}

/**
 * A layer scaled by dragging a corner of its motif to a point: as large as
 * reaches the point, in tenths, with the opposite corner staying put. A placed
 * motif stays anchored both ways; a band one motif tall keeps its anchored
 * edge, and its repeats stay as they're laid out across.
 */
function scaleFromCorner(project: Project, gesture: Extract<Gesture, { kind: 'scale' }>, exactX: number, exactY: number): Project {
  const { anchor, toward, motif, bandId, fitted, inRows } = gesture
  const up = (exactY - anchor.y) * toward.y
  // Rows span the chart's width, so a layer in rows scales by how tall it's dragged.
  const reach = inRows ? (inRows.scale * up) / inRows.span : Math.max(((exactX - anchor.x) * toward.x) / motif.width, up / motif.height)
  let next = setScale(project, bandId, reach)
  const band = next.bands.find((b) => b.id === bandId)
  if (!band) return next
  const tile = bandTile(band)
  const chartHeight = next.outline.height
  if (band.rows && (fitted || inRows)) {
    // One motif tall stays one motif tall; taller, the rows grow with the drag.
    const rows = fitted ? tile.height : Math.max(tile.height, Math.round(up))
    const top = clamp(toward.y < 0 ? anchor.y - rows : anchor.y, 0, Math.max(0, chartHeight - rows))
    next = updateBand(next, bandId, { rows: { top, bottom: Math.min(chartHeight - 1, top + rows - 1) } })
  }
  if (band.once) next = updateBand(next, bandId, { offsetX: toward.x < 0 ? anchor.x - tile.width : anchor.x })
  return next
}

/** A float, as the same float wherever it's found: its row, yarn and the stitches it passes. */
function floatKey(issue: RowIssue): string {
  return `${issue.y}:${issue.yarn}:${issue.cells.join(',')}`
}
