import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { analyzeRow } from '@/domain/floats'
import { cellAspect } from '@/domain/gauge'
import { NONE } from '@/domain/grid'
import { isRightSide, rowNumber, stitchNumber } from '@/domain/numbering'
import { constructionOf, projectRowsWorked } from '@/domain/instructions'
import { yarnCounts } from '@/domain/palette'
import { KNIT, NO_STITCH, stitchType } from '@/domain/stitches'
import { floatRulesOf, floatsDismissed, stitchedOn as findStitchedOn, type StitchedOn } from '@/domain/project'
import { writeRow, yarnLabels } from '@/domain/written'
import type { EditorState, EditorStore } from '@/editor/store'
import { useEditor, useEditorStore, useProject } from '@/features/editor/editor-context'
import { ChartCanvas, isTyping } from '@/render/ChartCanvas'
import { Icon } from '@/ui/Icon'
import { createPreference } from '@/ui/preference'
import ui from '@/ui/ui.module.css'
import styles from './knit.module.css'
import { useProgress } from './progress'


// What's knitted: motifs stitched on afterwards aren't in the rows.
const selectChart = (_: EditorState, store: EditorStore) => store.knittedChart()
const selectPurls = (_: EditorState, store: EditorStore) => store.stitches(store.project, { knitted: true })

/** Row-by-row knitting from the chart: one row highlighted, spelled out, and remembered. */
export function KnitPage() {
  const store = useEditorStore()
  const project = useProject()
  const chart = useEditor(selectChart)
  // The knitter's row: theirs, kept apart from the chart.
  const [y, setY] = useProgress(project.id, chart.height)
  const row = rowNumber(y, chart.height)
  const total = chart.height
  // A piece can start in the round and turn flat partway: each row is worked one way or the other.
  const rowsWorked = useMemo(() => projectRowsWorked(project), [project])
  const worked = rowsWorked(y)
  const construction = constructionOf(worked)
  const firstFlatRow = worked.since
  const rightSide = isRightSide(row, construction, firstFlatRow)
  const purls = useEditor(selectPurls)
  // MC, CC1… as the printed key names them.
  const labels = useMemo(() => yarnLabels(yarnCounts(chart, project.yarns.length), project.background), [chart, project.yarns.length, project.background])
  const written = useMemo(() => writeRow(chart, y, construction, firstFlatRow, purls, labels, project.background), [chart, y, construction, firstFlatRow, purls, labels, project.background])
  const stitches = written.stitches
  // A row whose floats were dismissed (and haven't changed since) isn't flagged here either.
  const floats = useMemo(() => {
    const found = analyzeRow(chart, y, construction, floatRulesOf(project))
    return floatsDismissed(project, y, found) ? [] : found
  }, [chart, y, construction, project])

  // Motifs to stitch on afterwards: shown faintly on the chart, mentioned on
  // their rows, and listed once the last row is done.
  const stitchedOn = useMemo(() => findStitchedOn(project), [project])
  const here = stitchedOn.motifs.filter((m) => y >= m.top && y <= m.bottom)
  const [finished, setFinished] = useState(false)
  const [focused, setFocused] = useState<number | null>(null)
  const lastRow = y <= 0
  const focus = finished && focused != null ? stitchedOn.motifs[focused] : undefined

  // Pointed at with a mouse: on the row being knitted, which stitch it is; on any other, what that row says.
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [pointer, setPointer] = useState<{ left: number; top: number; right: number | null } | null>(null)
  const hoverText = useMemo(() => {
    if (!hover) return null
    const at = hover.y * chart.width + hover.x
    if (hover.y === y && !finished) {
      const code = purls?.cells[at] ?? KNIT
      if (chart.cells[at] === NONE || code === NO_STITCH) return null
      // Counted as it's worked: from the right on a right-side row, from the left on a wrong-side one.
      const xs = Array.from({ length: chart.width }, (_, i) => (rightSide ? chart.width - 1 - i : i))
      const worked = xs.filter((x) => chart.cells[y * chart.width + x] !== NONE && (purls?.cells[y * chart.width + x] ?? KNIT) !== NO_STITCH)
      const stitch = stitchType(code)
      const how = code === KNIT ? '' : ` · ${rightSide ? stitch.rs : stitch.ws}`
      return `Stitch ${worked.indexOf(hover.x) + 1} of ${worked.length} · ${project.yarns[chart.cells[at]!]?.name ?? ''}${how}`
    }
    const there = rowsWorked(hover.y)
    const line = writeRow(chart, hover.y, constructionOf(there), there.since, purls, labels, project.background)
    return `${line.heading}: ${line.text}`
  }, [hover, chart, y, finished, purls, rightSide, project.yarns, project.background, rowsWorked, labels])

  const go = useCallback((delta: number) => {
    setFinished(false)
    setY(y - delta)
  }, [setY, y])

  const awake = keepAwake.use()
  useWakeLock(awake)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if ([' ', 'ArrowRight', 'ArrowUp', 'Enter'].includes(e.key)) go(1)
      else if (['ArrowLeft', 'ArrowDown', 'Backspace'].includes(e.key)) go(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  const getDrawing = useCallback(() => {
    const p = store.project
    return {
      grid: store.knittedChart(),
      colors: p.yarns.map((c) => c.hex),
      stitches: store.stitches(p, { knitted: true }),
      numbers: true,
      // Once finished, nothing is being knitted: the whole chart shows, for stitching on.
      currentRow: finished ? null : y,
      hover: hover && hover.y === y && !finished && hoverText ? hover : null,
      hoverRow: hover && (hover.y !== y || finished) ? hover.y : null,
      stitchedOn: { grid: stitchedOn.grid, places: stitchedOn.motifs, focused: finished ? focused : null },
    }
  }, [store, stitchedOn, finished, focused, y, hover, hoverText])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/p/$projectId" params={{ projectId: project.id }} className={ui.button} data-variant="ghost">
          <Icon name="back" /> Edit
        </Link>
        <h1 className={styles.title}>{project.name}</h1>
        {/* As a recipe's cook mode: the screen stays on while knitting, unless the knitter turns it off. */}
        <label className={styles.awake}>
          <input type="checkbox" checked={awake} onChange={(e) => keepAwake.set(e.target.checked)} />
          Keep screen on
        </label>
        {/* As wide as "100% knitted" all along, so Keep screen on beside it stays put. */}
        <span className={styles.progressText}>
          <span aria-hidden className={styles.progressSizer}>100% knitted</span>
          <span>{Math.round(((total - 1 - y) / Math.max(1, total - 1)) * 100)}% knitted</span>
        </span>
      </header>
      <progress className={styles.progress} max={total} value={total - y} aria-label="Rows completed" />

      {/* biome-ignore lint/a11y/noStaticElementInteractions: follows the pointer for the hover label; clicks go to the chart */}
      <div className={styles.chart}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const left = e.clientX - box.left
          // Past the middle, it sits to the pointer's left, measured from the right so it keeps its width.
          setPointer({ left, top: e.clientY - box.top, right: left > box.width / 2 ? box.width - left : null })
        }}
        onMouseLeave={() => setPointer(null)}>
        <ChartCanvas
          getDrawing={getDrawing}
          subscribe={store.subscribe}
          aspect={cellAspect(project.gauge)}
          fitKey={`knit-${chart.width}x${chart.height}`}
          interactive={false}
          // Stitches big enough to read on a phone: a wide chart starts at stitch 1, on the right.
          readable={8}
          // Any row, a click away: knitters pick up where they are, not only one row on.
          onCellClick={(_x, cellY) => {
            setFinished(false)
            setY(cellY)
          }}
          focusRow={focus ? Math.round((focus.top + focus.bottom) / 2) : finished ? null : y}
          label={`Chart with row ${row} highlighted`}
          onHover={setHover}
          cursorAt={(x, exact) => (Math.floor(exact.y) !== y && x >= 0 && x < chart.width && exact.y >= 0 && exact.y < chart.height ? 'pointer' : undefined)}
        />
        {hover && pointer && hoverText && (
          <div className={styles.hoverLabel} data-flip={pointer.right !== null || undefined}
            style={pointer.right === null ? { left: pointer.left, top: pointer.top } : { right: pointer.right, top: pointer.top }} aria-hidden>
            {hoverText}
          </div>
        )}
      </div>

      {finished ? (
        <StitchOnList motifs={stitchedOn.motifs} chartWidth={chart.width} chartHeight={chart.height} focused={focused}
          onFocus={setFocused} onBack={() => setFinished(false)} />
      ) : (
        <section className={styles.row} aria-live="polite" aria-label="Current row">
          <div className={styles.rowHeader}>
            <h2>
              {/* Knitters call a row worked in the round a round, as the written row below does (Rnd). */}
              {construction === 'round' ? 'Round' : 'Row'} {row} <span className={styles.of}>of {total}</span>
            </h2>
            <span className={styles.side}>
              {construction === 'round'
                ? 'Knit'
                : rightSide
                  ? 'Right side: knit'
                  : 'Wrong side: purl, left to right'}
              {' · '}
              {stitches} stitches
            </span>
          </div>

          {/* Scrolls when a row is long, so the chart above keeps its size from row to row. */}
          <div className={styles.rowBody}>
          {/* The row as patterns write it: for knitters who read rather than follow the chart above. */}
          <p className={styles.written}>
            <strong>{written.heading}:</strong> {written.text} <span className={styles.writtenCount}>({written.stitches} sts)</span>
          </p>
          {written.yarns.length > 0 && (
            <ul className={styles.writtenKey} aria-label="Yarns in this row">
              {written.yarns.map((i) => (
                <li key={i}>
                  <span className={styles.writtenSwatch} style={{ background: project.yarns[i]?.hex }} />
                  <strong>{labels.get(i)}</strong> {project.yarns[i]?.name}
                </li>
              ))}
            </ul>
          )}

          {here.length > 0 && (
            <p className={styles.afterNote}>
              <span className={styles.stitchOnMark} aria-hidden /> {here.map((m) => m.band.name).join(', ')}: duplicate stitch after knitting
            </p>
          )}

          {floats.length > 0 && (
            <p className={styles.floatNote}>
              <Icon name="warning" /> {floats.length} long {floats.length === 1 ? 'float' : 'floats'}
            </p>
          )}

          </div>

          <div className={styles.nav}>
            <button type="button" className={ui.button} onClick={() => go(-1)} disabled={y >= total - 1} aria-label="Previous row">
              <Icon name="chevronDown" /> Previous
            </button>
            {lastRow && stitchedOn.motifs.length > 0 ? (
              <button type="button" className={`${ui.button} ${styles.next}`} data-variant="primary" onClick={() => setFinished(true)}>
                Done knitting <Icon name="chevronUp" />
              </button>
            ) : (
              <button type="button" className={`${ui.button} ${styles.next}`} data-variant="primary" onClick={() => go(1)} disabled={lastRow}>
                {lastRow ? 'Finished!' : <>Next {construction === 'round' ? 'round' : 'row'} <Icon name="chevronUp" /></>}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

/** After the last row: the motifs to stitch on, each with where it goes. */
function StitchOnList({ motifs, chartWidth, chartHeight, focused, onFocus, onBack }: {
  motifs: readonly StitchedOn[]
  chartWidth: number
  chartHeight: number
  focused: number | null
  onFocus: (index: number | null) => void
  onBack: () => void
}) {
  // Rows count up from the bottom and stitches from the right, as on the chart.
  const range = (a: number, b: number) => (a === b ? `${a}` : `${Math.min(a, b)}–${Math.max(a, b)}`)
  return (
    <section className={styles.row} aria-label="Duplicate stitch">
      <div className={styles.rowHeader}>
        <h2>Duplicate stitch</h2>
      </div>
      <ul className={styles.stitchOn}>
        {motifs.map((m, i) => (
          <li key={m.band.id}>
            <button type="button" aria-pressed={focused === i} onClick={() => onFocus(focused === i ? null : i)}>
              <strong>{m.band.name}</strong>
              <span>
                Rows {range(rowNumber(m.bottom, chartHeight), rowNumber(m.top, chartHeight))}
                {' · '}
                Stitches {range(stitchNumber(m.left, chartWidth), stitchNumber(m.right - 1, chartWidth))}
              </span>
              <span className={styles.show}>{focused === i ? 'Shown' : 'Show'}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.nav}>
        <button type="button" className={ui.button} onClick={onBack}>
          <Icon name="chevronDown" /> Last row
        </button>
      </div>
    </section>
  )
}


/** Keeps the screen on while knitting, where supported. */
/** Whether knit mode keeps the screen on, remembered in this browser. */
const keepAwake = createPreference<boolean>('skeinfiend.keepScreenOn', true)

function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on) return
    let lock: WakeLockSentinel | null = null
    const request = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        // Denied or unsupported (e.g. battery saver): the page still works.
      }
    }
    const onVisible = () => document.visibilityState === 'visible' && void request()
    void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [on])
}
