import { useMemo } from 'react'
import { dismissFloats, switchSize } from '@/domain/edits'
import type { RowIssue } from '@/domain/floats'
import { formatShortLength, } from '@/domain/gauge'
import { floatRulesOf } from '@/domain/project'
import { rowNumber } from '@/domain/numbering'
import type { EditorState, EditorStore } from '@/editor/store'
import { useUnits } from '@/features/pieces/units'
import { Icon } from '@/ui/Icon'
import { useEditor, useEditorStore, useProject } from './editor-context'
import styles from './editor.module.css'
import { describeRow } from './issues'

const selectIssues = (_: EditorState, store: EditorStore) => store.issues()
const selectShowing = (s: EditorState) => s.showingFloats
const selectIssueRow = (s: EditorState) => s.issueRow
const selectSizeFloats = (_: EditorState, store: EditorStore) => store.sizeFloats()

/**
 * Floats, as information rather than alarm. The chart's margin marks rows to
 * look at; this tool, at the foot of the tool rail, shows the back of the
 * fabric (every strand, the long ones picked out, where to catch them) with a
 * card of the rows to look at and the one setting. Long floats are often a
 * choice: knitters catch them.
 */
export function FloatsTool({ className }: { className?: string }) {
  const store = useEditorStore()
  const issues = useEditor(selectIssues)
  const showing = useEditor(selectShowing)
  return (
    <button type="button" className={className} aria-pressed={showing} title={showing ? 'Hide the floats' : 'Show the floats on the back'}
      onClick={() => {
        store.toggleFloats()
        if (showing) store.clearIssueRow()
      }}>
      <span className={styles.floatsIcon}>
        <Icon name="floats" />
        {issues.length > 0 && !showing && <span className={styles.floatsDot} role="img" aria-label="Some rows to look at" />}
      </span>
      <span aria-hidden>Floats</span>
    </button>
  )
}

/** The card beside the tool, at the chart's bottom-left, while the floats show. Escape closes it. */
export function FloatsCard() {
  const showing = useEditor(selectShowing)
  return showing ? <FloatsPanel /> : null
}

function FloatsPanel() {
  const store = useEditorStore()
  const project = useProject()
  const units = useUnits()
  const issues = useEditor(selectIssues)
  const current = useEditor(selectIssueRow)
  const { floatRules, gauge } = project
  // What floats are flagged past: a length (2.5 cm, the usual rule), and the stitches that comes to here.
  const rules = floatRulesOf(project)
  const limitCm = floatRules.maxFloatCm
  const rows = useMemo(() => problemRows(issues), [issues])
  // The colorwork is shared by every size: what floats in the others, a click away.
  const otherSizes = useEditor(selectSizeFloats).filter((size) => size.rows > 0)

  return (
    <div className={styles.floatsCard} role="region" aria-label="Floats">
      {/* The rule, read-only: floats past about an inch, as knitters go by. */}
      <div className={styles.floatsHead}>
        <p className={styles.floatsLimit}>
          Floats over {formatShortLength(limitCm, units)} <span className={styles.floatsNote}>({rules.maxFloat} sts)</span>
        </p>
        {/* Every row seen and fine: all set aside in one step, each back if it changes. */}
        {rows.length > 1 && (
          <button type="button" className={styles.floatsDismiss} title="Hidden until their rows change"
            onClick={() => {
              store.clearIssueRow()
              store.peekAtRow(null)
              store.update((p) => rows.reduce((next, [y, rowIssues]) => dismissFloats(next, y, rowIssues), p))
            }}>
            Ignore all
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <ul className={styles.floatsRows}>
          {rows.map(([y, rowIssues]) => (
            <li key={y}>
              <button type="button" aria-pressed={y === current} onClick={() => (y === current ? store.clearIssueRow() : store.showIssueRow(y))}
                onPointerEnter={() => store.peekAtRow(y)} onPointerLeave={() => store.peekAtRow(null)}>
                <span className={styles.floatsRow}>Row {rowNumber(y, project.outline.height)}</span>
                <span>{describeRow(rowIssues, project.yarns, gauge, units)}</span>
              </button>
              {/* Seen, and fine as it is: set aside until the row changes. */}
              <button type="button" className={styles.floatsDismiss} aria-label={`Ignore row ${rowNumber(y, project.outline.height)}`} title="Hidden until this row changes"
                onClick={() => {
                  if (y === current) store.clearIssueRow()
                  store.peekAtRow(null)
                  store.update((p) => dismissFloats(p, y, rowIssues))
                }}>
                Ignore
              </button>
            </li>
          ))}
        </ul>
      )}
      {otherSizes.length > 0 && (
        <div className={styles.floatsSizes}>
          <span>Other sizes:</span>
          {otherSizes.map((size) => (
            <button type="button" key={size.index} onClick={() => store.update((p) => switchSize(p, size.index))}>
              {size.name} · {size.rows} {size.rows === 1 ? 'row' : 'rows'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Issues grouped by row, from row 1 up: the order they're knitted in. */
function problemRows(issues: readonly RowIssue[]): Array<[number, RowIssue[]]> {
  const rows = new Map<number, RowIssue[]>()
  for (const issue of issues) rows.set(issue.y, [...(rows.get(issue.y) ?? []), issue])
  return [...rows.entries()].sort(([a], [b]) => b - a)
}
