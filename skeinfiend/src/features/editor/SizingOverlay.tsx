import { useMemo, useRef, useState } from 'react'
import { schematicOf, setSchematic } from '@/domain/edits'
import { formatLength, rowsPerCm, stitchesPerCm } from '@/domain/gauge'
import { layoutSchematic, type Measurement, type SchematicPiece } from '@/domain/pieces'
import type { Project } from '@/domain/project'
import { useUnits } from '@/features/pieces/units'
import { roundLength, updateMeasurement } from './measurements'
import type { ChartCanvasHandle } from '@/render/ChartCanvas'
import type { View } from '@/render/draw-chart'
import { useEditor, useEditorStore, useProject } from './editor-context'
import type { EditorState } from '@/editor/store'
import styles from './editor.module.css'

/** Room beside the chart for the sizes, while they show: heights on the left, widths on the right. */
export const SIZING_MARGINS = { left: 64, right: 150 }

/** A press on the chart while the sizes show: adds a width there (see `SizingOverlay`). */
export type SizingPress = (e: PointerEvent, rowsDown: number) => void

/** What a drag needs of the press that starts it: React's, on a handle, or the canvas's own. */
type Press = Pick<PointerEvent, 'clientX' | 'clientY' | 'button' | 'preventDefault' | 'stopPropagation'>

const selectPointer = (s: EditorState) => s.pointer

/** Between labels: two lines for a width, one for a height. */
const WIDTH_GAP = 30
const HEIGHT_GAP = 15

/**
 * The piece's sizes over the chart, as its schematic drew them: its outline
 * (straight lines, over the stitches' steps), each width and where it's
 * reached, and the heights up the side. Drag a width's end to change it (and
 * its height), or its line to change just its height. While dragging, the
 * piece's middle and its cast-on edge stay where they are on screen, so what's
 * dragged stays under the pointer as the chart grows.
 *
 * Pressing anywhere on the chart adds a width at that height, as wide as the
 * piece is there; dragging sideways before letting go sets it. It's then a
 * width like the others, to shape the piece with.
 */
export function SizingOverlay({ view, canvas, press }: { view: View; canvas: React.RefObject<ChartCanvasHandle | null>; press: React.RefObject<SizingPress | null> }) {
  const store = useEditorStore()
  const project = useProject()
  const units = useUnits()
  const [dragging, setDragging] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const pointer = useEditor(selectPointer)
  const schematic = useMemo(() => schematicOf(project), [project])
  const layout = useMemo(() => layoutSchematic(schematic, project.gauge, project.construction), [schematic, project.gauge, project.construction])

  const { width: W, height: H } = project.outline
  const { cellWidth: cw, cellHeight: ch, originX, originY } = view
  const chartRight = originX + W * cw
  const X = (stitchesFromMiddle: number) => originX + (W / 2 + stitchesFromMiddle) * cw
  // Heights in centimeters up from the cast-on edge, as the schematic drew them: the top is the chart's top edge.
  const topCm = Math.max(...schematic.measurements.map((m) => m.height))
  const Y = (cm: number) => originY + (H - (topCm > 0 ? (cm / topCm) * H : 0)) * ch
  const placed = [...layout.placed].sort((a, b) => a.measurement.height - b.measurement.height)
  const at = (p: (typeof placed)[number]) => Y(p.measurement.height)
  const outline = [...placed.map((p) => `${X(p.stitches / 2)},${at(p)}`), ...[...placed].reverse().map((p) => `${X(-p.stitches / 2)},${at(p)}`)].join(' ')
  const length = (cm: number) => formatLength(cm, units)

  // Labels, top first, spread apart where widths are close together.
  const widths = [...placed].reverse().map((p) => ({ p, y: at(p) }))
  for (let i = 1; i < widths.length; i++) widths[i]!.y = Math.max(widths[i]!.y, widths[i - 1]!.y + WIDTH_GAP)
  const heights = [...new Set(placed.map((p) => p.measurement.height))].sort((a, b) => b - a).map((cm) => ({ cm, y: Y(cm) }))
  for (let i = 1; i < heights.length; i++) heights[i]!.y = Math.max(heights[i]!.y, heights[i - 1]!.y + HEIGHT_GAP)

  /**
   * A drag on a width: previews each change, keeps the piece still under it, and commits it as one step.
   * `always`: committed even without moving (a width just added).
   */
  function drag(e: Press, id: string, change: (dx: number, dy: number) => (s: SchematicPiece) => SchematicPiece, always = false) {
    const chart = canvas.current
    if (!chart || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, view: chart.view(), width: W, height: H }
    // Pointer pixels to centimeters, at the zoom when the drag began.
    const cmAcross = 1 / (start.view.cellWidth * stitchesPerCm(project.gauge))
    const cmUp = 1 / (start.view.cellHeight * rowsPerCm(project.gauge))
    const edit = (ev: Pick<PointerEvent, 'clientX' | 'clientY'>) => (p: Project) =>
      setSchematic(p, change((ev.clientX - start.x) * cmAcross, (start.y - ev.clientY) * cmUp)(schematicOf(p)))
    // The chart grows from its top left: move it so the middle and the cast-on edge stay put.
    const hold = () => {
      const { width, height } = store.project.outline
      chart.moveTo(start.view.originX - ((width - start.width) / 2) * start.view.cellWidth, start.view.originY - (height - start.height) * start.view.cellHeight)
    }
    let moved = false
    const move = (ev: PointerEvent) => {
      moved = true
      store.preview(edit(ev))
      hold()
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      if (!moved && !always) return store.cancelPreview()
      store.update(edit(ev))
      hold()
    }
    setDragging(id)
    if (always) store.preview(edit({ clientX: start.x, clientY: start.y }))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const round = (cm: number) => roundLength(cm, units)
  const dragEnd = (e: Press, m: Measurement, side: 1 | -1) =>
    drag(e, m.id, (dx, dy) => updateMeasurement(m.id, { width: Math.max(0.5, round(m.width + 2 * side * dx)), height: Math.max(0, round(m.height + dy)) }))
  const dragLine = (e: React.PointerEvent, m: Measurement) =>
    drag(e, m.id, (_, dy) => updateMeasurement(m.id, { height: Math.max(0, round(m.height + dy)) }))

  // Where a press would add a width, rounded as it would be: rows down the chart, to centimeters up.
  const heightAt = (rowsDown: number) => round(Math.min(topCm, Math.max(0, ((H - rowsDown) / H) * topCm)))
  // As wide as the piece is there: between the widths below and above it.
  const widthAt = (cm: number) => {
    const sorted = [...schematic.measurements].sort((a, b) => a.height - b.height)
    const above = sorted.find((m) => m.height > cm) ?? sorted.at(-1)!
    const below = [...sorted].reverse().find((m) => m.height < cm) ?? sorted[0]!
    const t = above.height === below.height ? 0 : (cm - below.height) / (above.height - below.height)
    return below.width + (above.width - below.width) * t
  }
  const existingAt = (cm: number) => schematic.measurements.find((m) => Math.abs(m.height - cm) < 1e-6)

  // A press on the chart (it comes through the canvas, so zooming and panning still work there).
  press.current = (e, rowsDown) => {
    const cm = heightAt(rowsDown)
    const side = e.clientX - (svg.current?.getBoundingClientRect().left ?? 0) >= X(0) ? 1 : -1
    // One already at that height: that's the one taken hold of.
    const there = existingAt(cm)
    if (there) return dragEnd(e, there, side)
    const width = widthAt(cm)
    const taken = new Set(schematic.measurements.map((m) => m.name))
    let n = 1
    while (taken.has(`Measurement ${n}`)) n++
    const added = { id: crypto.randomUUID(), name: `Measurement ${n}`, height: cm, width }
    drag(e, added.id, (dx) => (s) => ({
      ...s,
      // Replaced, not appended: the preview may already have it.
      measurements: [...s.measurements.filter((m) => m.id !== added.id), { ...added, width: Math.max(0.5, round(width + 2 * side * dx)) }]
        .sort((a, b) => a.height - b.height),
    }), true)
  }

  // The width a press would add, where the pointer is: not while dragging, or over one already there.
  const previewCm = pointer && !dragging && pointer.y >= 0 && pointer.y < H ? heightAt(pointer.y) : null
  const preview = previewCm !== null && !existingAt(previewCm) ? { y: Y(previewCm), cm: widthAt(previewCm) } : null
  const previewStitches = preview ? preview.cm * stitchesPerCm(project.gauge) : 0

  const rename = (m: Measurement, name: string) => {
    setRenaming(null)
    const trimmed = name.trim()
    if (trimmed && trimmed !== m.name) store.update((p) => setSchematic(p, updateMeasurement(m.id, { name: trimmed })(schematicOf(p))))
  }

  return (
    <svg ref={svg} className={styles.sizing} data-dragging={dragging ? '' : undefined} aria-label="Sizes">
      <polygon className={styles.sizingOutline} points={outline} />
      {preview && (
        <g className={styles.sizingPreview}>
          <line x1={X(-previewStitches / 2)} x2={X(previewStitches / 2)} y1={preview.y} y2={preview.y} />
          <text x={X(0)} y={preview.y - 5} textAnchor="middle">
            {length(preview.cm)}{project.construction === 'round' ? ' around' : ''}
          </text>
        </g>
      )}
      {/* Heights up the left, off their lines where they'd crowd. */}
      {heights.map(({ cm, y }) => (
        <g key={cm} className={styles.sizingHeight}>
          <line x1={originX - 6} x2={originX} y1={Y(cm)} y2={Y(cm)} />
          {Math.abs(y - Y(cm)) > 1 && <line x1={originX - 6} x2={originX - 10} y1={Y(cm)} y2={y} />}
          <text x={originX - 12} y={y} textAnchor="end" dominantBaseline="middle">{length(cm)}</text>
        </g>
      ))}
      {placed.map(({ measurement: m, row, stitches }) => {
        const y = Y(m.height)
        const label = widths.find((w) => w.p.measurement.id === m.id)!.y
        const active = dragging === m.id || undefined
        return (
          <g key={m.id} className={styles.sizingWidth} data-active={active}>
            {/* The width's line: drag it up or down to change where it's reached. */}
            <line className={styles.sizingLine} x1={X(-stitches / 2)} x2={X(stitches / 2)} y1={y} y2={y} />
            <line className={styles.sizingGrab} x1={X(-stitches / 2)} x2={X(stitches / 2)} y1={y} y2={y} onPointerDown={(e) => dragLine(e, m)} />
            {/* Its length across the piece, as a schematic writes it: around, in the round. */}
            <text className={styles.sizingAcross} x={X(0)} y={y - 5} textAnchor="middle">
              {length(m.width)}{project.construction === 'round' ? ' around' : ''}
            </text>
            {/* A leader out to its label, beside the chart. */}
            <polyline className={styles.sizingLeader} points={`${X(stitches / 2)},${y} ${chartRight + 26},${label} ${chartRight + 32},${label}`} />
            {renaming === m.id ? (
              <foreignObject x={chartRight + 32} y={label - 16} width={SIZING_MARGINS.right - 36} height={20}>
                <input className={styles.sizingNameInput} defaultValue={m.name} aria-label="Measurement name"
                  ref={(el) => el?.select()}
                  onBlur={(e) => rename(m, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }} />
              </foreignObject>
            ) : (
              // Click the name to change it.
              <text className={styles.sizingNameText} x={chartRight + 36} y={label - 6} dominantBaseline="middle" role="button" tabIndex={0}
                aria-label={`Rename ${m.name}`} onClick={() => setRenaming(m.id)} onKeyDown={(e) => e.key === 'Enter' && setRenaming(m.id)}>
                <tspan className={styles.sizingName}>{m.name}</tspan>
              </text>
            )}
            <text className={styles.sizingNote} x={chartRight + 36} y={label + 8} dominantBaseline="middle">
              {stitches} sts · row {row + 1}
            </text>
            {([-1, 1] as const).map((side) => (
              <circle key={side} className={styles.sizingHandle} cx={X((side * stitches) / 2)} cy={y} r={5}
                onPointerDown={(e) => dragEnd(e, m, side)} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
