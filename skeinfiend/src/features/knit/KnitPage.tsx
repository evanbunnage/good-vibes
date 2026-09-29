import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { analyzeRow } from '@/domain/floats'
import { cellAspect } from '@/domain/gauge'
import { NONE, type Grid } from '@/domain/grid'
import { isRightSide, rowNumber, stitchOnRow } from '@/domain/numbering'
import { constructionOf, projectRowsWorked } from '@/domain/instructions'
import { yarnCounts } from '@/domain/palette'
import { KNIT, NO_STITCH, stitchType } from '@/domain/stitches'
import { floatRulesOf, floatsDismissed, stitchedOn as findStitchedOn, type StitchedOn } from '@/domain/project'
import { writeRow, yarnLabels } from '@/domain/written'
import { useEditorStore, useProject } from '@/features/editor/editor-context'
import { ChartCanvas, isTyping } from '@/render/ChartCanvas'
import { Icon } from '@/ui/Icon'
import { createPreference } from '@/ui/preference'
import ui from '@/ui/ui.module.css'
import styles from './knit.module.css'
import { sizeIndex, switchSize } from '@/domain/edits'
import { useProgress } from './progress'


/**
 * The size each chart is knitted in, remembered in this browser, by its name:
 * the knitter's, like their row, so the design can show another size (an
 * agent trying the colorwork on each, say) without it changing here.
 */
const knitSizes = createPreference<Record<string, string>>('skeinfiend.knitSizes', {})

/** Row-by-row knitting from the chart: one row highlighted, spelled out, and remembered. */
export function KnitPage() {
  const store = useEditorStore()
  const design = useProject()
  // The size being knitted: the knitter's pick, or until they pick, the one the design shows.
  const picked = knitSizes.use()[design.id]
  const pickedIndex = design.sizes?.findIndex((s) => s.name === picked) ?? -1
  const project = useMemo(() => (pickedIndex >= 0 ? switchSize(design, pickedIndex) : design), [design, pickedIndex])
  // What's knitted: motifs stitched on afterwards aren't in the rows.
  const chart = useMemo(() => store.knittedChart(project), [store, project])
  // The knitter's row: theirs, kept apart from the chart.
  const [y, setY, done, finish] = useProgress(project.id, chart.height)
  const row = rowNumber(y, chart.height)
  const total = chart.height
  // A piece can start in the round and turn flat partway: each row is worked one way or the other.
  const rowsWorked = useMemo(() => projectRowsWorked(project), [project])
  const worked = rowsWorked(y)
  const construction = constructionOf(worked)
  const firstFlatRow = worked.since
  const rightSide = isRightSide(row, construction, firstFlatRow)
  const purls = useMemo(() => store.stitches(project, { knitted: true }), [store, project])
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
  // The round a tap on the chart jumped from, to go back to.
  const [jumpedFrom, setJumpedFrom] = useState<number | null>(null)
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
    setJumpedFrom(null)
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
    const p = project
    return {
      grid: store.knittedChart(p),
      colors: p.yarns.map((c) => c.hex),
      stitches: store.stitches(p, { knitted: true }),
      numbers: true,
      // Once finished, nothing is being knitted: the whole chart shows, for stitching on.
      currentRow: finished ? null : y,
      hover: hover && hover.y === y && !finished && hoverText ? hover : null,
      hoverRow: hover && (hover.y !== y || finished) ? hover.y : null,
      stitchedOn: { grid: stitchedOn.grid, places: stitchedOn.motifs, focused: finished ? focused : null },
    }
  }, [store, project, stitchedOn, finished, focused, y, hover, hoverText])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/p/$projectId" params={{ projectId: project.id }} className={ui.button} data-variant="ghost">
          <Icon name="back" /> Edit
        </Link>
        {/* With several sizes, the one being knitted: the rows and stitches below are its. */}
        <h1 className={styles.title}>{project.name}</h1>
        {project.sizes && project.sizes.length > 1 && (
          <label className={styles.size}>
            <span>Size</span>
            <select value={sizeIndex(project)} aria-label="Size being knitted"
              onChange={(e) => knitSizes.set({ ...knitSizes.get(), [design.id]: project.sizes![Number(e.target.value)]!.name })}>
              {project.sizes.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
            </select>
          </label>
        )}
        {/* As a recipe's cook mode: the screen stays on while knitting, unless the knitter turns it off. */}
        <label className={styles.awake}>
          <input type="checkbox" checked={awake} onChange={(e) => keepAwake.set(e.target.checked)} />
          Keep screen on
        </label>
        {/* As wide as "100% knitted" all along, so Keep screen on beside it stays put. */}
        <span className={styles.progressText}>
          <span aria-hidden className={styles.progressSizer}>100% knitted</span>
          {/* Rows knitted so far, below the one being knitted: the last row counts once it's marked done. */}
          <span>{done || finished ? 100 : Math.round(((total - 1 - y) / Math.max(1, total)) * 100)}% knitted</span>
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
            if (cellY === y) return
            // One tap jumps there (a stray one too, on a bus): the round it left is a tap away.
            setJumpedFrom(y)
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
        <StitchOnList motifs={stitchedOn.motifs} chart={chart} focused={focused}
          onFocus={setFocused} onBack={() => setFinished(false)} />
      ) : (
        <section className={styles.row} aria-label="Current row">
          <div className={styles.rowHeader}>
            <h2 aria-live="polite">
              {/* Knitters call a row worked in the round a round, as the written row below does (Rnd). */}
              {construction === 'round' ? 'Round' : 'Row'} {row} <span className={styles.of}>of {total}</span>
            </h2>
            <span className={styles.side}>
              {/* Which side, and which way: the written row says the stitches (rib, purls), not this. */}
              {construction === 'round' ? '' : rightSide ? 'Right side · ' : 'Wrong side, left to right · '}
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

          {jumpedFrom !== null && (
            <button type="button" className={styles.backTo} onClick={() => {
              setY(jumpedFrom)
              setJumpedFrom(null)
            }}>
              Back to {construction === 'round' ? 'round' : 'row'} {rowNumber(jumpedFrom, total)}
            </button>
          )}
          <div className={styles.nav}>
            <button type="button" className={ui.button} onClick={() => go(-1)} disabled={y >= total - 1} aria-label={`Previous ${construction === 'round' ? 'round' : 'row'}`}>
              <Icon name="chevronDown" /> Previous
            </button>
            {lastRow && stitchedOn.motifs.length > 0 ? (
              <button type="button" className={`${ui.button} ${styles.next}`} data-variant="primary" onClick={() => setFinished(true)}>
                Done knitting <Icon name="chevronUp" />
              </button>
            ) : (
              <button type="button" className={`${ui.button} ${styles.next}`} data-variant="primary" onClick={() => (lastRow ? finish() : go(1))} disabled={lastRow && done}>
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
function StitchOnList({ motifs, chart, focused, onFocus, onBack }: {
  motifs: readonly StitchedOn[]
  chart: Grid
  focused: number | null
  onFocus: (index: number | null) => void
  onBack: () => void
}) {
  // Rows count up from the bottom, and stitches from the right along the motif's first row, as it's knitted.
  const range = (a: number, b: number) => (a === b ? `${a}` : `${Math.min(a, b)}–${Math.max(a, b)}`)
  const stitches = (m: StitchedOn) => {
    const across: number[] = []
    for (let x = m.left; x < m.right; x++) {
      const at = stitchOnRow(chart, m.bottom, x)
      if (at) across.push(at.stitch)
    }
    return across.length ? range(Math.min(...across), Math.max(...across)) : ''
  }
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
                Rows {range(rowNumber(m.bottom, chart.height), rowNumber(m.top, chart.height))}
                {stitches(m) && <>{' · '}Stitches {stitches(m)}</>}
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
