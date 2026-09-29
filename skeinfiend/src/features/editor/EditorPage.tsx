import { useMutationState } from '@tanstack/react-query'
import { Link, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SAVE_MUTATION_KEY } from '@/data/projects'
import { NotSignedInError } from '@/data/remote-repository'
import { rename, sizeIndex, switchSize } from '@/domain/edits'
import { cellAspect, CM_PER_INCH, formatLength, heightCm, rowsPerCm, stitchesPerCm, widthCm } from '@/domain/gauge'
import type { RowIssue } from '@/domain/floats'
import { floatRulesOf, type Project } from '@/domain/project'
import { getUnits, useUnits } from '@/features/pieces/units'
import { rowNumber, stitchOnRow } from '@/domain/numbering'
import { bandSpan, bandTile, bandTiles, isArranged, type Band } from '@/domain/bands'
import { getCell, NONE } from '@/domain/grid'
import { KNIT, stitchType } from '@/domain/stitches'
import type { EditorState, EditorStore } from '@/editor/store'
import { ChartCanvas, isTyping, type ChartCanvasHandle, type ExactPoint } from '@/render/ChartCanvas'
import type { View } from '@/render/draw-chart'
import { CommitInput } from '@/ui/CommitInput'
import { Icon } from '@/ui/Icon'
import { Logo } from '@/ui/Logo'
import { usePhone } from '@/ui/use-phone'
import ui from '@/ui/ui.module.css'
import { useEditor, useEditorStore, useEditsPending, useProject } from './editor-context'
import { LayersSection } from './panels/LayersSection'
import { MotifHelper, MotifTip } from './panels/MotifHelper'
import { MOTIF_DRAG_TYPE, useAddLayer } from './panels/use-add-layer'
import { describeRow } from './issues'
import { FloatsCard, FloatsTool } from './Floats'
import { StitchesSection } from './Stitches'
import { LayerWindow } from './LayerWindow'
import { AccountMenu } from './AccountMenu'
import { ChartsMenu } from './ChartsMenu'
import { YarnWindow } from './panels/YarnDetails'
import { yarnWindow } from './yarn-window'
import { layerWindow, motifPreview } from './layer-window'
import { YarnsSection } from './panels/YarnsSection'
import { PieceSection } from './panels/PieceSection'
import { SIZING_MARGINS, SizingOverlay, type SizingPress } from './SizingOverlay'
import styles from './editor.module.css'
import { isReturning } from '@/data/auth'

const selectSizing = (s: EditorState) => s.showingSizing
const selectStitchesShown = (s: EditorState) => s.showingStitches

/** Shows or hides each stitch's symbol over the chart: a view, like Sizing and Floats. Painting stitches is in the side panel. */
function StitchesTool() {
  const store = useEditorStore()
  const showing = useEditor(selectStitchesShown)
  return (
    <button type="button" className={styles.tool} aria-pressed={showing} aria-label={showing ? 'Hide stitches' : 'Show stitches'}
      title={showing ? 'Hide stitches' : 'Show stitches'}
      onClick={() => store.toggleStitches()}>
      <Icon name="stitches" />
      <span aria-hidden>Stitches</span>
    </button>
  )
}

/**
 * The editor: the colorwork chart on its piece. The piece's size and gauge
 * are in the side panel; a piece from someone's pattern has its shape set by
 * the knitter's agent, reading the pattern. (The schematic editor, for
 * shaping a garment by hand, is set aside: see features/schematic.)
 */
export function EditorPage() {
  const canvas = useRef<ChartCanvasHandle>(null)
  useShortcuts(canvas)
  // On a phone, the chart's for looking at: laid out on a larger screen, knitted from here.
  const phone = usePhone()
  useOpenLayer()

  return (
    <div className={styles.editor}>
      <TopBar phone={phone} />
      <ViewControls canvas={canvas} phone={phone} />
      <section className={styles.stage} aria-label="Chart">
        <EditorCanvas canvas={canvas} phone={phone} />
        <div className={styles.cards}>
          <FloatsCard />
        </div>
        <StatusBar />
      </section>
      <aside className={styles.panel} aria-label="Colorwork settings">
        {phone ? (
          <>
            {/* The colorwork as layers, as on a larger screen: what's been added can be edited, hidden or taken off again. */}
            <LayersSection />
            <YarnsSection />
          </>
        ) : (
          <>
            <PieceSection />
            <YarnsSection />
            <LayersSection />
            <StitchesSection />
          </>
        )}
      </aside>
    </div>
  )
}

const selectCanUndo = (_: EditorState, store: EditorStore) => store.canUndo
const selectCanRedo = (_: EditorState, store: EditorStore) => store.canRedo

/**
 * How the chart's saving stands. Signed in: "Saving…" from the first edit
 * until the server has it, then "Saved"; offline, that it'll save when it
 * can. Signed out, nothing until there's colorwork to lose, then only a way
 * to sign in to save it.
 */
function SaveState({ projectId, hasWork, signedIn }: { projectId: string; hasWork: boolean; signedIn: boolean }) {
  const pending = useEditsPending()
  // This chart's latest save: under way, or waiting for the connection (TanStack Query pauses it offline).
  const latest = useMutationState({
    filters: { mutationKey: SAVE_MUTATION_KEY, predicate: (m) => (m.state.variables as Project | undefined)?.id === projectId },
    select: (m) => ({ status: m.state.status, paused: m.state.isPaused, signedOut: m.state.failureReason instanceof NotSignedInError }),
  }).at(-1)
  // The session's over: the save waits, and goes once they've signed in again.
  if (latest?.status === 'pending' && latest.signedOut) {
    return (
      <span className={styles.saveState} data-signed-out>
        <Link to="/sign-in" search={{ redirect: `/p/${projectId}` }}>Sign in<span className={styles.roomyOnly}> to save</span></Link>
      </span>
    )
  }
  if (!signedIn) {
    return (
      <span className={styles.saveState} data-sign-in>
        {/* Says what the page it opens asks for: a first account, or signing in again on this browser. */}
        {hasWork && <Link to="/sign-in" search={{ redirect: `/p/${projectId}` }}>{isReturning() ? 'Sign in to save' : 'Create an account to save'}</Link>}
      </span>
    )
  }
  const text = latest?.status === 'pending' && latest.paused ? 'Offline' : pending || latest?.status === 'pending' ? 'Saving…' : 'Saved'
  // As wide as "Saving…" whatever it says, so what follows doesn't shift with each save.
  return (
    <span className={styles.saveState} data-status>
      <span aria-hidden className={styles.saveSizer}>Saving…</span>
      <span aria-live="polite">{text}</span>
    </span>
  )
}


function TopBar({ phone }: { phone: boolean }) {
  const store = useEditorStore()
  const project = useProject()
  const canUndo = useEditor(selectCanUndo)
  const canRedo = useEditor(selectCanRedo)
  const { user } = useRouteContext({ from: '__root__' })

  return (
    <header className={styles.topBar}>
      {phone && (
        <Link to="/" search={{ home: true }} className={styles.phoneLogo} aria-label="SkeinFiend home" title="SkeinFiend">
          <Logo size={26} />
        </Link>
      )}
      <ChartsMenu currentId={project.id} />
      <CommitInput className={styles.name} value={project.name} aria-label="Chart name" onCommit={(name) => store.update((p) => rename(p, name))} />
      <SaveState projectId={project.id} hasWork={project.bands.length > 0} signedIn={Boolean(user)} />
      <SizePicker />
      <span className={styles.headerSpacer} />
      <div className={styles.topActions}>
        {!phone && <>
        <button type="button" className={ui.button} data-variant="ghost" disabled={!canUndo} onClick={() => store.undo()} aria-label="Undo" title="Undo (⌘Z)">
          <Icon name="undo" /> <span className={styles.wideOnly}>Undo</span>
        </button>
        <button type="button" className={ui.button} data-variant="ghost" disabled={!canRedo} onClick={() => store.redo()} aria-label="Redo" title="Redo (⇧⌘Z)">
          <Icon name="redo" /> <span className={styles.wideOnly}>Redo</span>
        </button>
        </>}
        <AccountMenu returnTo={`/p/${project.id}`} />
        <Link to="/p/$projectId/knit" params={{ projectId: project.id }} className={ui.button} data-variant="primary" aria-label="Knit">
          <Icon name="knit" /> <span className={styles.roomyOnly}>Knit</span>
        </Link>
      </div>
    </header>
  )
}

/**
 * The size shown, for a chart made from someone's pattern: every size it
 * gives, a pick away, with the colorwork on each. Marked until it's first
 * opened, so the knitter notices it and chooses theirs.
 */
function SizePicker() {
  const store = useEditorStore()
  const project = useProject()
  const sizes = project.sizes
  if (!sizes || sizes.length < 2) return null
  const unpicked = project.size === undefined
  return (
    <label className={styles.sizePicker} data-unpicked={unpicked || undefined} title={unpicked ? 'Choose your size' : 'Size'}>
      <span>Size</span>
      <select value={sizeIndex(project)} aria-label="Size"
        onFocus={() => unpicked && store.updateQuietly((p) => switchSize(p, sizeIndex(p)))}
        onChange={(e) => store.update((p) => switchSize(p, Number(e.target.value)))}>
        {sizes.map((size, i) => <option key={size.name} value={i}>{size.name}</option>)}
      </select>
    </label>
  )
}

/** The command key, as it's labeled on this platform. */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/**
 * Zoom and fit. There are no tools to pick: the chart is for arranging layers
 * (pointing at one grabs it), and stitches are drawn in the motif window.
 */
function ViewControls({ canvas, phone }: { canvas: React.RefObject<ChartCanvasHandle | null>; phone: boolean }) {
  const store = useEditorStore()
  const sizing = useEditor(selectSizing)
  const canUndo = useEditor(selectCanUndo)
  const canRedo = useEditor(selectCanRedo)
  return (
    <nav className={styles.toolbar} aria-label="View">
      {/* The mark, in the corner above the views, level with the top bar: home to the landing page.
          On a phone, where the views are a bar along the bottom, it's in the top bar instead. */}
      {!phone && (
        <Link to="/" search={{ home: true }} className={styles.logo} aria-label="SkeinFiend home" title="SkeinFiend">
          <Logo size={30} />
        </Link>
      )}
      <div className={styles.toolStack}>
        {/* What's shown over the chart, on or off, together or apart. (Sizes are dragged: not on a phone.) */}
        {!phone && <div className={styles.toolGroup} role="group" aria-label="Views">
          <button type="button" className={styles.tool} aria-pressed={sizing} title={sizing ? 'Hide sizes' : 'Show sizes'}
            onClick={() => store.toggleSizing()}>
            <Icon name="ruler" />
            <span aria-hidden>Sizing</span>
          </button>
          <FloatsTool className={styles.tool} />
          <StitchesTool />
        </div>}
          <div className={styles.toolGroup}>
            <button type="button" className={styles.tool} onClick={() => canvas.current?.zoomBy(1.25)} aria-label="Zoom in" title={`Zoom in (${MOD}+)`}>
              <Icon name="zoomIn" />
              <span aria-hidden>Zoom in</span>
            </button>
            <button type="button" className={styles.tool} onClick={() => canvas.current?.zoomBy(0.8)} aria-label="Zoom out" title={`Zoom out (${MOD}−)`}>
              <Icon name="zoomOut" />
              <span aria-hidden>Zoom out</span>
            </button>
            <button type="button" className={styles.tool} onClick={() => canvas.current?.fit()} aria-label="Fit to screen" title={`Fit to screen (${MOD}0)`}>
              <Icon name="fit" />
              <span aria-hidden>Fit</span>
            </button>
          </div>
          {/* On a phone there's no room for them in the top bar: here, so a motif taken off by mistake comes back. */}
          {phone && (
            <div className={styles.toolGroup}>
              <button type="button" className={styles.tool} disabled={!canUndo} onClick={() => store.undo()} aria-label="Undo">
                <Icon name="undo" />
                <span aria-hidden>Undo</span>
              </button>
              <button type="button" className={styles.tool} disabled={!canRedo} onClick={() => store.redo()} aria-label="Redo">
                <Icon name="redo" />
                <span aria-hidden>Redo</span>
              </button>
            </div>
          )}
      </div>
    </nav>
  )
}

const selectGauge = (_: EditorState, store: EditorStore) => store.project.gauge
const selectFitKey = (state: EditorState, store: EditorStore) => `${store.project.outline.width}x${store.project.outline.height}:${state.fitRequests}`

function EditorCanvas({ canvas, phone }: { canvas: React.RefObject<ChartCanvasHandle | null>; phone: boolean }) {
  const store = useEditorStore()
  const gauge = useEditor(selectGauge)
  // Sizes are dragged into shape: not on a phone.
  const sizing = useEditor(selectSizing) && !phone
  // Refits when the piece changes size, but not while its sizes are shown: dragging them keeps the chart still.
  const pieceSize = useEditor(selectFitKey)
  const fitKey = sizing ? 'sizing' : pieceSize
  // Where the chart is on screen, for the sizes drawn over it.
  const [chartView, setChartView] = useState<View | null>(null)

  // Each layer is outlined faintly, and the one a press would grab stands out.
  const movableBands = useCallback(() => {
    const { hover } = store.getState()
    const band = store.selectedBand()
    const target = hover ? store.hitTest(hover.x, hover.y + 0.5)?.band : undefined
    const height = store.project.outline.height
    return store.project.bands
      .filter((b) => b.visible && b !== band && isArranged(b))
      .map((b) => ({ ...bandSpan(b, height), columns: placedColumns(b), hovered: b === target }))
  }, [store])

  const getDrawing = useCallback(() => {
    const state = store.getState()
    const project = store.project
    const grid = store.chart()
    const band = store.selectedBand()
    // Long floats only while the Floats view is on: moving a layer, only the ones it makes; otherwise every one.
    const caused = state.showingFloats && state.arranging ? store.causedIssues() : null
    const issues = state.showingFloats ? (caused ?? store.issues()) : []
    return {
      grid,
      colors: project.yarns.map((y) => y.hex),
      // Symbols only while the stitches show: otherwise it's the colorwork, as it'll look.
      stitches: state.showingStitches ? store.stitches() : null,
      movable: movableBands(),
      numbers: true,
      // With the sizes showing, the width a press would add is previewed instead (SizingOverlay).
      hover: state.showingSizing ? null : state.hover,
      // Off the piece, the stitch pointed at is outlined faintly: there's no stitch there.
      hoverFaint: state.hover !== null && getCell(project.outline, state.hover.x, state.hover.y) === NONE,
      readout: readoutAt(state.pointer, project, issues, state.peekRow),
      // With the sizes showing, a ruler over the chart at real lengths.
      measure: state.showingSizing ? measureOf(project) : null,
      faded: state.showingSizing,
      issues,
      // Float lines only for the row being looked at; every problem row gets a mark.
      strands: state.showingFloats && !caused ? store.floats() : null,
      maxFloat: floatRulesOf(project).maxFloat,
      // The row picked in the Floats list stays marked; one pointed at (there, or by its mark in the margin) is outlined as a hovered stitch is.
      markedRows: [
        ...(state.issueRow !== null ? [{ y: state.issueRow, strong: true }] : []),
        ...(state.peekRow !== null && state.peekRow !== state.issueRow ? [{ y: state.peekRow, strong: false }] : []),
      ],
      issueRows: state.showingFloats || caused
        ? [...new Set(issues.map((i) => i.y))]
        : [state.hover?.y, state.issueRow, state.peekRow].filter((y) => y != null),
      // A layer tiled over the whole piece has nothing to arrange on the chart: it's edited in its window.
      selection: band && isArranged(band) ? {
        ...bandSpan(band, grid.height),
        resizable: band.rows !== null && !band.once,
        columns: placedColumns(band),
        tiles: bandTiles(band, grid.width, grid.height),
        spacing: store.spacingHandle(),
        corners: store.scaleHandle(),
      } : null,
    }
  }, [store, movableBands])

  const cursorAt = useCallback((x: number, exact: ExactPoint) => {
    // With the sizes showing, the chart takes new widths, not paint.
    if (sizingShown.current) return undefined
    if (store.selectedBand()?.painted) return 'crosshair'
    const hit = store.hitTest(x, exact.y, exact.slop, exact.x, exact.slopX)
    // Plain stitches of the piece: pressing paints.
    if (!hit) return getCell(store.project.outline, x, Math.floor(exact.y)) !== NONE ? 'crosshair' : undefined
    switch (hit.part) {
      case 'body': return 'grab'
      case 'spacing': return 'ew-resize'
      case 'top': case 'bottom': return 'ns-resize'
      case 'top-left': case 'bottom-right': return 'nwse-resize'
      case 'top-right': case 'bottom-left': return 'nesw-resize'
    }
  }, [store])

  // New layers go in rows in view.
  const stage = useRef<HTMLDivElement>(null)
  // The view, kept without re-rendering: only the sizes drawn over the chart need it as state,
  // so a zoom or scroll re-renders the editor only while they show.
  const latestView = useRef<View | null>(null)
  const sizingShown = useRef(sizing)
  const sizingPress = useRef<SizingPress | null>(null)
  sizingShown.current = sizing
  useEffect(() => {
    if (sizing) setChartView(latestView.current)
  }, [sizing])
  const onViewChange = useCallback((next: View) => {
    latestView.current = next
    if (sizingShown.current) setChartView(next)
    const height = stage.current?.clientHeight ?? 0
    store.setVisibleRows(Math.floor(-next.originY / next.cellHeight), Math.ceil((height - next.originY) / next.cellHeight) - 1)
  }, [store])
  // Pointing at a problem row's mark in the margin draws its floats out.
  const onMarginHover = useCallback((row: number | null) => {
    const marked = row !== null && store.getState().showingFloats && store.issues().some((i) => i.y === row)
    store.peekAtRow(marked ? row : null)
    return marked
  }, [store])
  const { add } = useAddLayer()
  const issueRow = useEditor(selectIssueRow)

  return (
    <div ref={stage} className={styles.canvasArea} data-chart-area
      // Pressing on the chart itself (not in a window over it) puts the yarn details away.
      onPointerDownCapture={(e) => {
        if ((e.target as HTMLElement).closest('[role=dialog]')) return
        yarnWindow.close()
        motifPreview.set(null)
      }}>
    <ChartCanvas
      ref={canvas}
      getDrawing={getDrawing}
      subscribe={store.subscribe}
      aspect={cellAspect(gauge)}
      fitKey={fitKey}
      margins={phone ? undefined : sizing ? SIZING_WITH_READOUT : WITH_READOUT}
      // On a phone, dragging moves around the chart rather than changing it.
      interactive={!phone}
      label={phone ? 'Colorwork chart' : 'Colorwork chart. Drag a layer to move it.'}
      // With the sizes showing, pressing adds a width there; otherwise it paints, or moves a layer.
      onCellDown={(x, y, e, exact) => {
        if (sizing) {
          if (e.button === 0 && y >= 0 && y < store.project.outline.height) sizingPress.current?.(e, exact.y)
          return
        }
        // A finger doesn't paint on the chart (too fiddly): it moves the motifs, and otherwise the view.
        // Motifs are painted in their own windows.
        if (e.pointerType === 'touch') {
          const hit = store.hitTest(x, exact.y, exact.slop, exact.x, exact.slopX)
          if (!hit || hit.band.painted) return 'pan'
          if (store.selectedBand()?.painted) store.selectLayer(null)
        }
        if (e.button === 0 || e.button === 2) store.pointerDown(x, y, { exactY: exact.y, slop: exact.slop, exactX: exact.x, slopX: exact.slopX, secondary: e.button === 2 })
      }}
      onCellMove={(x, y, exact) => !sizing && store.pointerMove(x, y, exact.y, exact.x)}
      cursorAt={cursorAt}
      onViewChange={onViewChange}
      // With the sizes showing, a press's drag is the width's own (it commits itself): not a stroke to end.
      onCellUp={() => !sizing && store.pointerUp()}
      onMarginHover={onMarginHover}
      // A tap that moved nothing (a finger, off the motifs): lets go of the selected layer, as pressing off it does with a mouse.
      onCellClick={() => store.selectLayer(null)}
      dropType={MOTIF_DRAG_TYPE}
      // Dragged on: open, ready to draw on, move and size.
      onDropAt={(_x, y, key) => add(key, y, { edit: true })}
      onHover={(cell) => store.setHover(cell)}
      onPointer={(at) => store.setPointer(at)}
      focusRow={issueRow}
    />
    {sizing && chartView && <SizingOverlay view={chartView} canvas={canvas} press={sizingPress} />}
    <LayerWindow />
    <YarnWindow />
    <MotifHelper />
    <MotifTip />
    </div>
  )
}

/**
 * Room left of the chart for the pointer's readout, so it doesn't cover the
 * stitches, and the same on the right (where the row numbers are), so the
 * chart sits in the middle. Made once: a new object each render would refit
 * the chart each time.
 */
const READOUT_MARGIN = 88
const WITH_READOUT = { left: READOUT_MARGIN, right: READOUT_MARGIN }
const SIZING_WITH_READOUT = { ...SIZING_MARGINS, left: Math.max(SIZING_MARGINS.left, READOUT_MARGIN) }

/**
 * Opened for a layer just added from the library: it's selected, with its
 * window open, as a colorwork motif dragged onto the chart is, ready to move
 * and size. The address loses the layer then, so reloading doesn't reselect it.
 */
function useOpenLayer() {
  const store = useEditorStore()
  const { layer } = useSearch({ from: '/p/$projectId/' })
  const navigate = useNavigate()
  useEffect(() => {
    if (!layer || !store.project.bands.some((b) => b.id === layer)) return
    store.selectLayer(layer)
    layerWindow.editing.set(layer)
    void navigate({ to: '.', search: {}, replace: true })
  }, [layer, store, navigate])
}

const selectHover = (s: EditorState) => s.hover

/** The chart's stitches and rows per centimeter (or inch), for a ruler at real lengths over it. */
function measureOf(project: Project) {
  const unit = getUnits()
  const per = unit === 'in' ? CM_PER_INCH : 1
  return { stitchesPerUnit: stitchesPerCm(project.gauge) * per, rowsPerUnit: rowsPerCm(project.gauge) * per, unit }
}

/**
 * The pointer's place over the chart as measurements, exactly where it is
 * (not the stitch it's on): across from the right edge, where stitch 1 is,
 * and up from the cast-on, in the chosen units to a tenth, with the same in
 * stitches and rows. Nothing off the chart.
 */
function readoutAt(pointer: { x: number; y: number } | null, project: Project, issues: readonly RowIssue[], markRow: number | null) {
  const { width, height } = project.outline
  // Pointing at a problem row's mark, left of the chart: that row's readout, with no stitch across.
  const onMark = pointer !== null && pointer.x < 0 && markRow !== null
  if (!pointer || (!onMark && (pointer.x < 0 || pointer.y < 0 || pointer.x > width || pointer.y > height))) return null
  // Snapped to the stitch and row pointed at: counted up to and including them (from stitch 1 at the
  // right, and row 1 at the cast-on), and marked at their far edges, where that length ends. The
  // numbers change only from one stitch to the next, not as the pointer moves within one.
  const [column, row] = onMark ? [null, markRow] : [Math.min(width - 1, Math.floor(pointer.x)), Math.min(height - 1, Math.floor(pointer.y))]
  const up = height - row
  const units = getUnits()
  const length = (cm: number) => `${(Math.round((units === 'in' ? cm / CM_PER_INCH : cm) * 10) / 10).toFixed(1)} ${units}`
  // The piece's stitches at the row pointed at (its length is along the bottom).
  const rowIssues = issues.filter((i) => i.y === row)
  let sts = 0
  for (let x = 0; x < width; x++) if (project.outline.cells[row * width + x] !== NONE) sts++
  return {
    x: column,
    y: row,
    across: column === null ? undefined : `${length((width - column) / stitchesPerCm(project.gauge))} · ${width - column} sts`,
    up: `${length(up / rowsPerCm(project.gauge))} · ${up} rows`,
    width: sts ? `${sts} sts` : undefined,
    // The row's longest float, in whole centimeters (or half inches): the Floats list has the rest.
    floats: rowIssues.length ? `Floats up to ${floatLength(Math.max(...rowIssues.map((i) => i.length)) / stitchesPerCm(project.gauge), units)}` : undefined,
  }
}
function floatLength(cm: number, units: 'cm' | 'in'): string {
  return units === 'in' ? `${Math.round((cm / CM_PER_INCH) * 2) / 2} in` : `${Math.round(cm)} cm`
}
const selectIssueRow = (s: EditorState) => s.issueRow
const selectChart = (_: EditorState, store: EditorStore) => store.chart()
const selectIssues = (_: EditorState, store: EditorStore) => store.issues()
const selectShowingFloats = (s: EditorState) => s.showingFloats
const NO_ISSUES: readonly RowIssue[] = []

const selectStitchesGrid = (_: EditorState, store: EditorStore) => store.stitches()

function StatusBar() {
  const project = useProject()
  const hover = useEditor(selectHover)
  const issueRow = useEditor(selectIssueRow)
  const grid = useEditor(selectChart)
  // A row's long floats are said only while the Floats view is on.
  const showingFloats = useEditor(selectShowingFloats)
  const allIssues = useEditor(selectIssues)
  const issues = showingFloats ? allIssues : NO_ISSUES
  const cell = hover ? grid.cells[hover.y * grid.width + hover.x] : undefined
  // The stitch pointed at, when it's more than plain knit: "k1 tbl", "M1L".
  const stitches = useEditor(selectStitchesGrid)
  const stitchCode = hover && stitches ? stitches.cells[hover.y * stitches.width + hover.x]! : KNIT
  const stitchHere = stitchCode !== KNIT && stitchCode !== NONE ? stitchCode : null
  const yarn = cell !== undefined ? project.yarns[cell] : undefined
  const units = useUnits()
  const rowProblem = (y: number) => describeRow(issues.filter((i) => i.y === y), project.yarns, project.gauge, units)

  let info: React.ReactNode
  // Only stitches of the piece are described: off it, the chart's size shows instead.
  if (hover && cell !== undefined && cell !== NONE) {
    const problem = rowProblem(hover.y)
    // Counted along its own row, as it's knitted: on a shaped row, "of" how many it has.
    const onRow = stitchOnRow(grid, hover.y, hover.x)
    info = (
      <>
        Row {rowNumber(hover.y, grid.height)}, stitch {onRow ? `${onRow.stitch}${onRow.of < grid.width ? ` of ${onRow.of}` : ''}` : ''}
        {yarn && <> · {yarn.name}</>}
        {stitchHere !== null && <> · {stitchType(stitchHere).rs || stitchType(stitchHere).name}</>}
        {problem && <span className={styles.statusProblem}> · {problem}</span>}
      </>
    )
  } else if (issueRow !== null && rowProblem(issueRow)) {
    info = <>Row {rowNumber(issueRow, grid.height)} · <span className={styles.statusProblem}>{rowProblem(issueRow)}</span></>
  } else {
    info = (
      <>
        {grid.width} × {grid.height} stitches · {formatLength(widthCm(grid.width, project.gauge), 'cm')} ×{' '}
        {formatLength(heightCm(grid.height, project.gauge), 'cm')}
      </>
    )
  }

  return (
    <div className={styles.status}>
      <span className={styles.statusInfo}>{info}</span>
    </div>
  )
}

/** A placed motif's stitches across, so it's outlined on its own; bands span the chart. */
function placedColumns(band: Band): { left: number; right: number } | undefined {
  return band.once ? { left: band.offsetX, right: band.offsetX + bandTile(band).width } : undefined
}

/** Keyboard shortcuts. Ignored while typing in a field. */
function useShortcuts(canvas: React.RefObject<ChartCanvasHandle | null>) {
  const store = useEditorStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store.redo()
        return
      }
      // Photoshop's view keys: ⌘0 fits, ⌘+ and ⌘− zoom. They'd otherwise zoom the whole page.
      if (mod && ['0', '=', '+', '-'].includes(e.key)) {
        e.preventDefault()
        if (e.key === '0') canvas.current?.fit()
        else canvas.current?.zoomBy(e.key === '-' ? 0.8 : 1.25)
        return
      }
      if (mod || e.altKey) return
      // B and E pick the motif window's brush and eraser; 1-9 pick a yarn.
      if (e.key === 'b') store.setMotifTool('brush')
      else if (e.key === 'e') store.setMotifTool('eraser')
      else if (/^[1-9]$/.test(e.key)) store.chooseYarn(Number(e.key) - 1)
      else if (e.key === '=' || e.key === '+') canvas.current?.zoomBy(1.25)
      else if (e.key === '-') canvas.current?.zoomBy(0.8)
      else if (e.key === '0') canvas.current?.fit()
      else if (e.key === 'Escape') {
        store.cancelGesture()
        if (yarnWindow.yarn.get() !== null) yarnWindow.close()
        else if (store.getState().recoloring) store.cancelRecolor()
        else if (store.getState().issueRow !== null) store.clearIssueRow()
        else if (store.getState().showingFloats) store.toggleFloats()
        else store.selectLayer(null)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, canvas])
}
