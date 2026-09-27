import { useMemo, useState } from 'react'
import { schematicOf, setSchematic } from '@/domain/edits'
import { formatLength, rowsPerCm, stitchesPerCm } from '@/domain/gauge'
import { layoutSchematic, type Measurement, type SchematicPiece } from '@/domain/pieces'
import type { Project } from '@/domain/project'
import { useUnits } from '@/features/pieces/units'
import { roundLength, updateMeasurement } from './measurements'
import type { ChartCanvasHandle } from '@/render/ChartCanvas'
import type { View } from '@/render/draw-chart'
import { useEditorStore, useProject } from './editor-context'
import styles from './editor.module.css'

/** Room beside the chart for the sizes, while they show: heights on the left, widths on the right. */
export const SIZING_MARGINS = { left: 64, right: 150 }

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
 */
export function SizingOverlay({ view, canvas }: { view: View; canvas: React.RefObject<ChartCanvasHandle | null> }) {
  const store = useEditorStore()
  const project = useProject()
  const units = useUnits()
  const [dragging, setDragging] = useState<string | null>(null)
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

  /** A drag on a width: previews each change, keeps the piece still under it, and commits it as one step. */
  function drag(e: React.PointerEvent, id: string, change: (dx: number, dy: number) => (s: SchematicPiece) => SchematicPiece) {
    const chart = canvas.current
    if (!chart || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, view: chart.view(), width: W, height: H }
    // Pointer pixels to centimeters, at the zoom when the drag began.
    const cmAcross = 1 / (start.view.cellWidth * stitchesPerCm(project.gauge))
    const cmUp = 1 / (start.view.cellHeight * rowsPerCm(project.gauge))
    const edit = (ev: PointerEvent) => (p: Project) =>
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
      if (!moved) return store.cancelPreview()
      store.update(edit(ev))
      hold()
    }
    setDragging(id)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const round = (cm: number) => roundLength(cm, units)
  const dragEnd = (e: React.PointerEvent, m: Measurement, side: 1 | -1) =>
    drag(e, m.id, (dx, dy) => updateMeasurement(m.id, { width: Math.max(0.5, round(m.width + 2 * side * dx)), height: Math.max(0, round(m.height + dy)) }))
  const dragLine = (e: React.PointerEvent, m: Measurement) =>
    drag(e, m.id, (_, dy) => updateMeasurement(m.id, { height: Math.max(0, round(m.height + dy)) }))

  return (
    <svg className={styles.sizing} data-dragging={dragging ? '' : undefined} aria-label="Sizes">
      <polygon className={styles.sizingOutline} points={outline} />
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
            <text x={chartRight + 36} y={label - 6} dominantBaseline="middle">
              <tspan className={styles.sizingName}>{m.name}</tspan>
            </text>
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
