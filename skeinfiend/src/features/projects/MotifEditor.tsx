import { useEffect, useId, useRef, useState } from 'react'
import { createGrid, NONE, resizeGrid, type Grid } from '@/domain/grid'
import { STARTER_YARNS } from '@/domain/palette'
import { MAIN, type SavedMotif } from '@/domain/saved-motifs'
import { NumberField } from '@/ui/NumberField'
import ui from '@/ui/ui.module.css'
import styles from './projects.module.css'

/**
 * A library motif's colors, for drawing it outside any chart: the main color,
 * then contrasts 1–4. A chart shows it in its own yarns.
 */
export const SLOT_COLORS: readonly string[] = (() => {
  const colors: string[] = []
  const [main, ...contrasts] = STARTER_YARNS
  contrasts.slice(0, 4).forEach((y, i) => {
    colors[i] = y.hex
  })
  colors[MAIN] = main!.hex
  return colors
})()

const SLOTS = [
  { value: 0, name: 'Contrast 1' },
  { value: 1, name: 'Contrast 2' },
  { value: 2, name: 'Contrast 3' },
  { value: 3, name: 'Contrast 4' },
  { value: MAIN, name: 'Main color' },
  { value: NONE, name: 'Clear' },
]

/** Room for the grid in the dialog, in pixels. */
const ROOM = 360
const MAX_SIDE = 60

/**
 * Draws a library motif: its name, its size, and its stitches, in the main
 * color and up to four contrasts (a chart gives them its own yarns). Drag to
 * paint; a right-click clears. Saving changes the library only: charts that
 * use it are offered the new version when they're next opened. It can go
 * straight into a chart, too: an existing one, or a new one started with it
 * (saved first, either way).
 */
export function MotifEditor({ motif, copy = false, charts, onSave, onUse, onClose }: {
  motif: SavedMotif | null
  /** A copy of a classic colorwork motif: saving makes it the designer's own. */
  copy?: boolean
  charts: ReadonlyArray<{ id: string; name: string }>
  onSave: (name: string, grid: Grid) => void
  /** Saves it, then puts it in a chart: the one with this id, or a new one. Without it, it's only saved. */
  onUse?: (name: string, grid: Grid, chart: string | 'new') => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [name, setName] = useState(motif?.name ?? 'New colorwork motif')
  const [grid, setGrid] = useState<Grid>(motif?.grid ?? createGrid(8, 8))
  const [slot, setSlot] = useState(0)
  const [chart, setChart] = useState('')
  useEffect(() => dialog.current?.showModal(), [])
  const named = () => name.trim() || 'Colorwork motif'

  return (
    <dialog ref={dialog} className={`${ui.dialog} ${styles.motifEditor}`} aria-labelledby={titleId} onClose={onClose}>
      <form method="dialog" onSubmit={() => onSave(named(), grid)}>
        <h2 id={titleId}>{motif && !copy ? 'Edit colorwork motif' : 'New colorwork motif'}</h2>
        <label className={styles.motifField}>
          <span>Name</span>
          <input className={styles.motifName} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className={styles.motifSize}>
          <NumberField label="Stitches" value={grid.width} min={1} max={MAX_SIDE} onChange={(w) => setGrid((g) => resizeGrid(g, w, g.height))} />
          <NumberField label="Rows" value={grid.height} min={1} max={MAX_SIDE} onChange={(h) => setGrid((g) => resizeGrid(g, g.width, h))} />
        </div>
        <div className={styles.slots} role="radiogroup" aria-label="Paint with">
          {SLOTS.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={slot === s.value} title={s.name} aria-label={s.name}
              className={styles.slot} data-clear={s.value === NONE || undefined} style={{ background: SLOT_COLORS[s.value] }}
              onClick={() => setSlot(s.value)} />
          ))}
        </div>
        <MotifGrid grid={grid} slot={slot} onChange={setGrid} />
        {/* Into a chart, from here: a new one, or one there is. */}
        {onUse && <div className={styles.motifUse}>
          <select value={chart} onChange={(e) => setChart(e.target.value)} aria-label="Chart to add it to">
            <option value="">Add to…</option>
            <option value="new">A new chart</option>
            {charts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className={ui.button} disabled={!chart} onClick={() => onUse(named(), grid, chart)}>Add</button>
        </div>}
        <div className={ui.actions}>
          <button type="button" className={ui.button} data-variant="ghost" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className={ui.button} data-variant="primary">{copy ? 'Save as mine' : 'Save'}</button>
        </div>
      </form>
    </dialog>
  )
}

/** The motif's stitches, big enough to paint: drag across them with a color, or right-click to clear. */
function MotifGrid({ grid, slot, onChange }: { grid: Grid; slot: number; onChange: (grid: Grid) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const cell = Math.max(6, Math.min(32, Math.floor(ROOM / Math.max(grid.width, grid.height))))
  const painting = useRef<{ value: number; grid: Grid } | null>(null)

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = grid.width * cell * dpr
    el.height = grid.height * cell * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, grid.width * cell, grid.height * cell)
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const value = grid.cells[y * grid.width + x]!
        if (value === NONE) continue
        ctx.fillStyle = SLOT_COLORS[value] ?? '#999'
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
    ctx.strokeStyle = 'rgb(0 0 0 / 0.12)'
    ctx.beginPath()
    for (let x = 0; x <= grid.width; x++) {
      ctx.moveTo(x * cell + 0.5, 0)
      ctx.lineTo(x * cell + 0.5, grid.height * cell)
    }
    for (let y = 0; y <= grid.height; y++) {
      ctx.moveTo(0, y * cell + 0.5)
      ctx.lineTo(grid.width * cell, y * cell + 0.5)
    }
    ctx.stroke()
  }, [grid, cell])

  const at = (e: React.PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect()
    const [x, y] = [Math.floor((e.clientX - box.left) / cell), Math.floor((e.clientY - box.top) / cell)]
    return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? y * grid.width + x : null
  }
  const paint = (e: React.PointerEvent) => {
    const stroke = painting.current
    const i = at(e)
    if (!stroke || i === null || stroke.grid.cells[i] === stroke.value) return
    const cells = stroke.grid.cells.slice()
    cells[i] = stroke.value
    stroke.grid = { ...stroke.grid, cells }
    onChange(stroke.grid)
  }

  return (
    <div className={styles.motifGrid}>
      <canvas ref={canvas} style={{ inlineSize: grid.width * cell, blockSize: grid.height * cell }} aria-label="Colorwork motif stitches: drag to paint, right-click to clear"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          painting.current = { value: e.button === 2 ? NONE : slot, grid }
          paint(e)
        }}
        onPointerMove={paint}
        onPointerUp={() => (painting.current = null)} />
    </div>
  )
}
