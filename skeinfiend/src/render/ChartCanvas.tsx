import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import type { Grid } from '@/domain/grid'
import { drawChart, readTheme, type ChartDrawing, type Theme, type View } from './draw-chart'
import styles from './ChartCanvas.module.css'

export interface ExactPoint {
  readonly x: number
  readonly y: number
  /** Rows spanned by a comfortable grab distance on screen. */
  readonly slop: number
  /** Stitches spanned by the same distance. */
  readonly slopX: number
}

/** How far from an edge, in screen pixels, still counts as grabbing it. */
const GRAB_PX = 6

export interface ChartCanvasHandle {
  zoomBy(factor: number): void
  fit(): void
  /** The view now: where the chart is, and how big its stitches are. */
  view(): View
  /** Moves the chart to a new origin, keeping its zoom, as though the person had panned it. */
  moveTo(originX: number, originY: number): void
}

export interface ChartCanvasProps {
  /** Everything to draw except the view, read fresh on every frame. */
  readonly getDrawing: () => Omit<ChartDrawing, 'view' | 'theme'>
  /** Calls back whenever the drawing may have changed. */
  readonly subscribe: (onChange: () => void) => () => void
  /** Cell height relative to width, from the gauge. */
  readonly aspect: number
  /** Changing this refits the view, e.g. when switching between the chart and a motif. */
  readonly fitKey: string
  /** Extra room around the chart when fitting, in pixels, for things drawn beside it. */
  readonly margins?: Partial<{ left: number; right: number; top: number; bottom: number }>
  readonly interactive?: boolean
  readonly label: string
  /**
   * Pointer events in cells, plus the exact (fractional) row and how many rows
   * a few screen pixels span, for grabbing the edges between rows at any zoom.
   */
  readonly onCellDown?: (x: number, y: number, event: PointerEvent, exact: ExactPoint) => void
  readonly onCellMove?: (x: number, y: number, exact: ExactPoint) => void
  readonly onCellUp?: () => void
  /** A click on a stitch, where dragging pans (a chart that isn't drawn on): pressed and let go without moving. */
  readonly onCellClick?: (x: number, y: number) => void
  /** Things dragged in with this data type can be dropped on a cell, like a motif from the library. */
  readonly dropType?: string
  readonly onDropAt?: (x: number, y: number, value: string) => void
  /**
   * The pointer over the margin left of the chart, where problem rows are
   * marked: the row it's beside (or null when it leaves), and where it is.
   * Returning true shows the pointer as pointing at something.
   */
  readonly onMarginHover?: (row: number | null, point: { x: number; y: number }) => boolean
  readonly onHover?: (cell: { x: number; y: number } | null) => void
  /** Where the pointer is over the chart, exactly: in stitches across and rows down from its top-left, fractions and all. */
  readonly onPointer?: (at: { x: number; y: number } | null) => void
  /** The CSS cursor to show over a point, e.g. a resize cursor over a band's edge. */
  readonly cursorAt?: (x: number, exact: ExactPoint) => string | undefined
  /** Called when the view pans or zooms, for positioning things over the chart. */
  readonly onViewChange?: (view: View) => void
  /** For knitting mode: keeps this row centered. */
  readonly focusRow?: number | null
  readonly ref?: Ref<ChartCanvasHandle>
}

const GUTTER = { left: 30, right: 40, top: 16, bottom: 30 }
const MIN_CELL = 2
const MAX_CELL = 64

/**
 * A pannable, zoomable canvas for a chart. Drawing happens outside React's
 * render cycle: changes schedule one frame, and the view lives in a ref.
 *
 * Mouse: drag to draw or move, scroll to pan, pinch or ⌘/Ctrl-scroll to zoom,
 * space-drag or middle-drag to pan. Touch: one finger paints, two pan and zoom.
 */
export function ChartCanvas(props: ChartCanvasProps) {
  const { subscribe, aspect, fitKey, interactive = true, label, focusRow, margins, ref } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ cellWidth: 12, cellHeight: 12 * aspect, originX: 0, originY: 0 })
  const frame = useRef(0)
  // Resolved from CSS once, and again when the color scheme changes.
  const theme = useRef<Theme | null>(null)
  // The view stays fitted to the space (through resizes) until the person zooms or pans.
  const userMoved = useRef(false)
  const callbacks = useRef(props)
  callbacks.current = props

  // The view last told to the page: it's told once per frame at most, as the chart's drawn, not on every wheel event.
  const told = useRef<View | null>(null)
  // Where a mouse or pen last pointed over the chart, in its pixels: the stitch under it changes as the chart moves.
  const pointerAt = useRef<{ x: number; y: number } | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const drawNow = useCallback(() => {
    cancelAnimationFrame(frame.current)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    if (told.current !== view.current) {
      told.current = view.current
      callbacks.current.onViewChange?.(view.current)
      // Scrolled or zoomed under a still pointer: what it's over now, once the view settles
      // (not every frame of a zoom, which would have the whole editor recompute as it eases).
      clearTimeout(settle.current)
      settle.current = setTimeout(() => {
        const at = pointerAt.current
        if (!at) return
        const v = view.current
        const [x, y] = [(at.x - v.originX) / v.cellWidth, (at.y - v.originY) / v.cellHeight]
        const { grid } = callbacks.current.getDrawing()
        const [cx, cy] = [Math.floor(x), Math.floor(y)]
        callbacks.current.onHover?.(cx >= 0 && cy >= 0 && cx < grid.width && cy < grid.height ? { x: cx, y: cy } : null)
        callbacks.current.onPointer?.({ x, y })
      }, 80)
    }
    theme.current ??= readTheme(canvas)
    drawChart(ctx, { ...callbacks.current.getDrawing(), view: view.current, theme: theme.current })
  }, [])

  /** Coalesces bursts of changes (pointer moves) into one paint per frame. */
  const draw = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(drawNow)
  }, [drawNow])

  const size = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
  }, [])

  const setView = useCallback(
    (next: View) => {
      view.current = next
      draw()
    },
    [draw],
  )

  /**
   * A view kept on the chart, as photo viewers keep a photo: bigger than the
   * room, its edges can't come inside it; smaller, it's centered. The two
   * meet exactly when the chart just fits, so zooming never jumps.
   */
  const bounded = useCallback(
    (v: View): View => {
      const { grid } = callbacks.current.getDrawing()
      const { width, height } = size()
      const gutter = { ...GUTTER, ...margins }
      const place = (origin: number, extent: number, start: number, room: number) =>
        extent <= room ? start + (room - extent) / 2 : clamp(origin, start + room - extent, start)
      return {
        ...v,
        originX: place(v.originX, grid.width * v.cellWidth, gutter.left, width - gutter.left - gutter.right),
        originY: place(v.originY, grid.height * v.cellHeight, gutter.top, height - gutter.top - gutter.bottom),
      }
    },
    [size, margins],
  )

  /** A view change the person made: stop auto-fitting. */
  const moveView = useCallback(
    (next: View) => {
      userMoved.current = true
      setView(bounded(next))
    },
    [setView, bounded],
  )

  const fit = useCallback(() => {
    const { grid } = callbacks.current.getDrawing()
    const { width, height } = size()
    const gutter = { ...GUTTER, ...margins }
    const availW = width - gutter.left - gutter.right
    const availH = height - gutter.top - gutter.bottom
    const cellWidth = clamp(Math.min(availW / grid.width, availH / (grid.height * aspect)), MIN_CELL, MAX_CELL)
    const cellHeight = cellWidth * aspect
    userMoved.current = false
    setView({
      cellWidth,
      cellHeight,
      originX: gutter.left + (availW - grid.width * cellWidth) / 2,
      originY: gutter.top + (availH - grid.height * cellHeight) / 2,
    })
  }, [aspect, setView, size, margins])

  /**
   * Zooms around a point (the pointer, or the middle of a pinch), kept on the
   * chart (`bounded`). It stops at half the size that fits: smaller shows
   * nothing more.
   */
  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const v = view.current
      const { grid } = callbacks.current.getDrawing()
      const { width, height } = size()
      const gutter = { ...GUTTER, ...margins }
      const [availW, availH] = [width - gutter.left - gutter.right, height - gutter.top - gutter.bottom]
      const fitted = Math.min(availW / grid.width, availH / (grid.height * aspect))
      const cellWidth = clamp(v.cellWidth * factor, Math.max(MIN_CELL, fitted / 2), MAX_CELL)
      const k = cellWidth / v.cellWidth
      moveView({ cellWidth, cellHeight: cellWidth * aspect, originX: px - (px - v.originX) * k, originY: py - (py - v.originY) * k })
    },
    [aspect, moveView, size, margins],
  )

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      const { width, height } = size()
      zoomAt(factor, width / 2, height / 2)
    },
    fit,
    view: () => view.current,
    // Not bounded: the sizing handles hold the chart still while its size changes under them.
    moveTo: (originX, originY) => {
      userMoved.current = true
      setView({ ...view.current, originX, originY })
    },
  }), [fit, size, zoomAt, setView])

  // Size the backing store to the device's pixel ratio.
  useLayoutEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const [w, h] = [Math.round(width * dpr), Math.round(height * dpr)]
      if (canvas.width === w && canvas.height === h) return
      // Resizing the backing store clears it, so repaint in this same frame
      // rather than the next one, or every resize flashes blank.
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!userMoved.current) fit()
      else view.current = bounded(view.current)
      drawNow()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [drawNow, fit, bounded])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new fitKey (the chart's size) refits
  useEffect(() => fit(), [fitKey, fit])
  // What's drawn can change with the page's own state (a hover), not only the store's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new getDrawing is the signal to redraw
  useEffect(() => draw(), [props.getDrawing, draw])
  useEffect(() => subscribe(draw), [subscribe, draw])
  // The chart's fonts come from the web: a canvas doesn't wait for them, so it's drawn again once they're in.
  // (The numbers' face isn't used on the page itself, so it's asked for here, or it would never load.)
  useEffect(() => {
    let live = true
    const fonts = document.fonts
    if (!fonts?.load) return
    void Promise.all([fonts.load("10px 'Figtree'"), fonts.load("12px 'Martian Mono'")]).then(() => live && draw(), () => {})
    return () => {
      live = false
    }
  }, [draw])
  useEffect(() => {
    // Redraw when the color scheme changes, since the theme comes from CSS.
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      theme.current = null
      draw()
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [draw])

  // Keep the knitting row in view.
  useEffect(() => {
    if (focusRow == null) return
    const v = view.current
    const { height } = size()
    const rowTop = v.originY + focusRow * v.cellHeight
    if (rowTop < GUTTER.top || rowTop + v.cellHeight > height - GUTTER.bottom) {
      setView({ ...v, originY: height / 2 - (focusRow + 0.5) * v.cellHeight })
    } else draw()
  }, [focusRow, draw, setView, size])

  usePointerInput({ canvasRef, view, callbacks, interactive, zoomAt, setView: moveView, pointerAt })

  return (
    <div ref={containerRef} className={styles.container} data-interactive={interactive || undefined}>
      <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={label} />
    </div>
  )
}

interface PointerInputOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  view: React.RefObject<View>
  callbacks: React.RefObject<ChartCanvasProps>
  interactive: boolean
  zoomAt: (factor: number, px: number, py: number) => void
  setView: (view: View) => void
  pointerAt: React.RefObject<{ x: number; y: number } | null>
}

/** Translates mouse, pen, and touch input into cell events, pans, and zooms. */
function usePointerInput({ canvasRef, view, callbacks, interactive, zoomAt, setView, pointerAt }: PointerInputOptions) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pointers = new Map<number, { x: number; y: number }>()
    let mode: 'idle' | 'paint' | 'pan' | 'pinch' = 'idle'
    // Where a pan began: let go close to it, and it was a click.
    let panStart: { x: number; y: number } | null = null
    let spaceHeld = false
    let pinch: { distance: number; midX: number; midY: number } | null = null

    const local = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const cellAt = (px: number, py: number) => {
      const v = view.current
      const exactX = (px - v.originX) / v.cellWidth
      const exactY = (py - v.originY) / v.cellHeight
      const exact: ExactPoint = { x: exactX, y: exactY, slop: GRAB_PX / v.cellHeight, slopX: GRAB_PX / v.cellWidth }
      return { x: Math.floor(exactX), y: Math.floor(exactY), exact }
    }
    const inGrid = (cell: { x: number; y: number }, grid: Grid) =>
      cell.x >= 0 && cell.y >= 0 && cell.x < grid.width && cell.y < grid.height

    const onPointerDown = (e: PointerEvent) => {
      const p = local(e)
      pointers.set(e.pointerId, p)
      canvas.setPointerCapture(e.pointerId)
      if (pointers.size === 2) {
        // A second finger turns a paint stroke into a pinch: abandon the stroke.
        if (mode === 'paint') callbacks.current.onCellUp?.()
        mode = 'pinch'
        pinch = pinchState(pointers)
        return
      }
      if (e.button === 1 || spaceHeld || !interactive) {
        mode = 'pan'
        panStart = e.button === 0 && !spaceHeld ? p : null
        return
      }
      if (e.button !== 0 && e.button !== 2) return
      mode = 'paint'
      const cell = cellAt(p.x, p.y)
      callbacks.current.onCellDown?.(cell.x, cell.y, e, cell.exact)
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e)
      const previous = pointers.get(e.pointerId)
      if (previous) pointers.set(e.pointerId, p)
      if (mode === 'pinch' && pointers.size === 2 && pinch) {
        const next = pinchState(pointers)
        const v = view.current
        setView({ ...v, originX: v.originX + next.midX - pinch.midX, originY: v.originY + next.midY - pinch.midY })
        zoomAt(next.distance / pinch.distance, next.midX, next.midY)
        pinch = next
        return
      }
      if (mode === 'pan' && previous) {
        const v = view.current
        setView({ ...v, originX: v.originX + p.x - previous.x, originY: v.originY + p.y - previous.y })
        return
      }
      const cell = cellAt(p.x, p.y)
      const grid = callbacks.current.getDrawing().grid
      if (e.pointerType !== 'touch') {
        pointerAt.current = p
        callbacks.current.onHover?.(inGrid(cell, grid) ? { x: cell.x, y: cell.y } : null)
        callbacks.current.onPointer?.({ x: cell.exact.x, y: cell.exact.y })
      }
      if (mode === 'paint') callbacks.current.onCellMove?.(cell.x, cell.y, cell.exact)
      const v = view.current
      const inMargin = mode === 'idle' && p.x < v.originX && p.x >= v.originX - GUTTER.left && cell.y >= -1 && cell.y <= grid.height
      // A mark is small: pointing within a few pixels of one counts, nearest row first.
      let marked = false
      if (inMargin) {
        const reach = Math.max(1, Math.ceil(6 / v.cellHeight))
        for (let d = 0; d <= reach && !marked; d = d > 0 ? -d : -d + 1) {
          const row = cell.y + d
          if (row >= 0 && row < grid.height) marked = callbacks.current.onMarginHover?.(row, p) ?? false
        }
      }
      if (!marked) callbacks.current.onMarginHover?.(null, p)
      if (!spaceHeld) canvas.style.cursor = marked ? 'default' : (callbacks.current.cursorAt?.(cell.x, cell.exact) ?? '')
    }

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (mode === 'paint') callbacks.current.onCellUp?.()
      if (mode === 'pan' && panStart && pointers.size === 0) {
        const p = local(e)
        if (Math.hypot(p.x - panStart.x, p.y - panStart.y) < 4) {
          const cell = cellAt(p.x, p.y)
          if (inGrid(cell, callbacks.current.getDrawing().grid)) callbacks.current.onCellClick?.(cell.x, cell.y)
        }
        panStart = null
      }
      if (pointers.size === 0) {
        mode = 'idle'
        pinch = null
      }
    }

    const onPointerLeave = () => {
      pointerAt.current = null
      callbacks.current.onHover?.(null)
      callbacks.current.onPointer?.(null)
      callbacks.current.onMarginHover?.(null, { x: 0, y: 0 })
    }
    const onDragOver = (e: DragEvent) => {
      const type = callbacks.current.dropType
      if (!interactive || !type || !e.dataTransfer?.types.includes(type)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      const p = local(e)
      const cell = cellAt(p.x, p.y)
      const grid = callbacks.current.getDrawing().grid
      callbacks.current.onHover?.(inGrid(cell, grid) ? { x: cell.x, y: cell.y } : null)
    }
    const onDrop = (e: DragEvent) => {
      const type = callbacks.current.dropType
      const value = type && e.dataTransfer?.getData(type)
      if (!value) return
      e.preventDefault()
      const p = local(e)
      const cell = cellAt(p.x, p.y)
      callbacks.current.onDropAt?.(cell.x, cell.y, value)
    }
    // Right-click erases, so the context menu would get in the way.
    const onContextMenu = (e: Event) => interactive && e.preventDefault()

    /*
     * The wheel, from a trackpad or a mouse, made to feel the same:
     * - A trackpad sends small, frequent steps: scrolling pans with the
     *   fingers, and a pinch (ctrl + wheel, as browsers report it) zooms,
     *   both followed exactly.
     * - A mouse wheel sends big notches (or lines, in Firefox): each notch
     *   zooms a step at the pointer, eased over a few frames rather than
     *   jumping, as maps and photo editors do. Shift + wheel pans sideways;
     *   to pan freely with a mouse, drag with space held or the middle button.
     */
    const LINE_PX = 16
    const NOTCH_PAN = 60
    const NOTCH_ZOOM = 1.15
    let easing: { dx: number; dy: number; zoom: number; at: { x: number; y: number } } | null = null
    let easeFrame = 0
    const ease = () => {
      if (!easing) return
      // A third of what's left each frame: quick, but never a jump.
      const [dx, dy] = [easing.dx / 3, easing.dy / 3]
      const zoom = easing.zoom ** (1 / 3)
      easing = { ...easing, dx: easing.dx - dx, dy: easing.dy - dy, zoom: easing.zoom / zoom }
      const v = view.current
      if (dx || dy) setView({ ...v, originX: v.originX - dx, originY: v.originY - dy })
      if (zoom !== 1) zoomAt(zoom, easing.at.x, easing.at.y)
      const done = Math.abs(easing.dx) < 0.5 && Math.abs(easing.dy) < 0.5 && Math.abs(easing.zoom - 1) < 0.002
      if (done) {
        const rest = easing
        easing = null
        const w = view.current
        if (rest.dx || rest.dy) setView({ ...w, originX: w.originX - rest.dx, originY: w.originY - rest.dy })
        if (rest.zoom !== 1) zoomAt(rest.zoom, rest.at.x, rest.at.y)
      } else easeFrame = requestAnimationFrame(ease)
    }
    const eased = (dx: number, dy: number, zoom: number, at: { x: number; y: number }) => {
      easing = easing ? { dx: easing.dx + dx, dy: easing.dy + dy, zoom: easing.zoom * zoom, at } : { dx, dy, zoom, at }
      cancelAnimationFrame(easeFrame)
      easeFrame = requestAnimationFrame(ease)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? canvas.clientHeight : 1
      let [dx, dy] = [e.deltaX * unit, e.deltaY * unit]
      // Shift turns a mouse wheel sideways (some systems do it already, as deltaX).
      if (e.shiftKey && !dx) [dx, dy] = [dy, 0]
      // A mouse notch: lines, or one big whole step straight up or down.
      const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50)
      if (notch && !e.shiftKey) {
        // A mouse wheel zooms, with or without ctrl/⌘.
        eased(0, 0, dy < 0 ? NOTCH_ZOOM : 1 / NOTCH_ZOOM, p)
      } else if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-clamp(dy, -50, 50) * 0.01), p.x, p.y)
      } else if (notch) {
        // Shift + wheel: sideways.
        eased(Math.sign(dx) * NOTCH_PAN, Math.sign(dy) * NOTCH_PAN, 1, p)
      } else {
        const v = view.current
        setView({ ...v, originX: v.originX - dx, originY: v.originY - dy })
      }
    }

    // Safari reports a trackpad pinch as gestures, not ctrl + wheel.
    let gestureScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      const p = local(g as unknown as MouseEvent)
      zoomAt(g.scale / gestureScale, p.x, p.y)
      gestureScale = g.scale
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e)) return
      spaceHeld = e.type === 'keydown'
      canvas.dataset.panning = spaceHeld ? 'true' : ''
      if (spaceHeld) e.preventDefault()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('gesturestart', onGestureStart)
    canvas.addEventListener('gesturechange', onGestureChange)
    canvas.addEventListener('contextmenu', onContextMenu)
    canvas.addEventListener('dragover', onDragOver)
    canvas.addEventListener('drop', onDrop)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
      cancelAnimationFrame(easeFrame)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('dragover', onDragOver)
      canvas.removeEventListener('drop', onDrop)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [canvasRef, view, callbacks, interactive, zoomAt, setView, pointerAt])
}

function pinchState(pointers: Map<number, { x: number; y: number }>) {
  const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
  return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 }
}

export function isTyping(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null
  return !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
