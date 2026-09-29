import { useEffect, useMemo, useRef, useState } from 'react'
import { addYarn, removeYarn, updateYarn } from '@/domain/edits'
import { MAX_YARNS, isHexColor, yarnCounts } from '@/domain/palette'
import { formatYarnLength } from '@/domain/yarn-estimate'
import { useUnits } from '@/features/pieces/units'
import type { EditorState, EditorStore } from '@/editor/store'
import { CommitInput } from '@/ui/CommitInput'
import { Icon } from '@/ui/Icon'
import ui from '@/ui/ui.module.css'
import { useEditor, useEditorStore } from '../editor-context'
import { Section } from './Section'
import { amount } from './YarnDetails'
import { yarnWindow } from '../yarn-window'
import styles from './panels.module.css'

const selectYarns = (_: EditorState, store: EditorStore) => store.project.yarns
const selectBackground = (_: EditorState, store: EditorStore) => store.project.background
const selectChart = (_: EditorState, store: EditorStore) => store.chart()
const selectEstimate = (_: EditorState, store: EditorStore) => store.estimate()
// Chosen only while a yarn is the brush: a stitch picked after takes over.
const selectActive = (s: EditorState) => (s.brush === 'yarn' ? s.yarn : -1)
const selectRecoloring = (s: EditorState, store: EditorStore) =>
  s.recoloring && store.project.bands.find((b) => b.id === s.recoloring!.bandId)?.name

/**
 * The design's yarns, edited where they are: click a yarn to draw with it,
 * its swatch to change its color, and its name (once it's the one you're
 * drawing with) to rename it. The main color is chosen with the layers.
 * Beside each, how much of it the chart takes; its pencil opens the yarn's
 * details, from its ball band, in a window over the chart.
 */
export function YarnsSection() {
  const store = useEditorStore()
  const yarns = useEditor(selectYarns)
  const background = useEditor(selectBackground)
  const chart = useEditor(selectChart)
  const active = useEditor(selectActive)
  // While recoloring a layer, choosing a yarn recolors it instead of setting the brush.
  const recoloring = useEditor(selectRecoloring)
  const counts = useMemo(() => yarnCounts(chart, yarns.length), [chart, yarns.length])
  const total = counts.reduce((a, b) => a + b, 0) || 1
  // The yarn being renamed, by id so it survives yarns being added or removed.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const openId = yarnWindow.yarn.use()
  const estimate = useEditor(selectEstimate)
  const units = useUnits()

  return (
    <Section
      title="Yarns"
      scrolls
      collapsed={yarns.map((yarn) => <span key={yarn.id} className={styles.yarnDot} style={{ background: yarn.hex }} title={yarn.name} />)}
      action={
        yarns.length < MAX_YARNS && (
          <button type="button" className={ui.button} data-variant="ghost" data-size="icon" aria-label="Add yarn" title="Add yarn" onClick={() => {
            const next = addYarn(store.project)
            store.update(() => next)
            // A new yarn is there to be described: its window opens, its name ready to type.
            store.chooseYarn(next.yarns.length - 1)
            const added = next.yarns.at(-1)
            if (added) yarnWindow.openNew(added.id)
          }}>
            <Icon name="plus" />
          </button>
        )
      }
    >
      {recoloring && (
        <p className={styles.recolorPrompt} role="status">
          Recolor {recoloring}: pick a yarn
          <button type="button" className={ui.button} data-variant="ghost" onClick={() => store.cancelRecolor()}>Cancel</button>
        </p>
      )}
      <ul className={styles.yarns} data-recoloring={recoloring ? '' : undefined} aria-label="Yarn to draw with">
        {yarns.map((yarn, i) => {
          const chosen = i === active
          const needed = estimate.yarns.find((e) => e.yarn === i)
          const open = openId === yarn.id
          return (
            <li key={yarn.id} className={styles.yarnRow} data-chosen={chosen || undefined} data-open={open || undefined}>
              <label className={styles.swatch} style={{ background: yarn.hex }} title="Change color">
                <ColorInput aria-label={`${yarn.name} color`} value={yarn.hex}
                  onPreview={(hex) => store.preview((p) => updateYarn(p, i, { hex }))} onCommit={() => store.commitPreview()} />
              </label>
              {renamingId === yarn.id ? (
                <span className={styles.yarn}>
                  <CommitInput className={styles.renameInput} value={yarn.name} aria-label="Yarn name" autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onCommit={(name) => store.update((p) => updateYarn(p, i, { name: name.trim() }))} onFinish={() => setRenamingId(null)} />
                </span>
              ) : (
                <button type="button" className={styles.yarn} aria-pressed={chosen} onClick={() => store.chooseYarn(i)}
                  aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}>
                  <span className={styles.yarnName}>
                    {/* A shortcut for the mouse: the yarn's window renames it from the keyboard. */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: see above */}
                    <span title={chosen ? 'Rename' : undefined} onClick={(e) => {
                      // Like a file name: click the chosen yarn's name to rename it.
                      if (!chosen || recoloring) return
                      e.stopPropagation()
                      setRenamingId(yarn.id)
                    }}>
                      {yarn.name}
                    </span>
                    {i === background && <span className={styles.badge} title="Main color">MC</span>}
                  </span>
                </button>
              )}
              {/* How much it takes: skeins, once the ball band's given. */}
              <span className={styles.yarnAmount}
                title={needed ? `${amount(needed, units)}: ${Math.round((counts[i]! / total) * 100)}% of the stitches` : 'Not used yet'}>
                {!needed ? '–' : needed.skeins !== null ? `${needed.skeins} ${needed.skeins === 1 ? 'skein' : 'skeins'}` : formatYarnLength(needed.meters, units)}
              </span>
              <button type="button" className={ui.button} data-variant="ghost" data-size="icon" aria-pressed={open} data-open={open || undefined}
                aria-label={open ? `Close ${yarn.name}` : `Edit ${yarn.name}`} title={open ? 'Close' : 'Yarn details'}
                onClick={() => yarnWindow.yarn.set(open ? null : yarn.id)}>
                <Icon name="pencil" />
              </button>
              <button type="button" className={ui.button} data-variant="ghost" data-size="icon" disabled={yarns.length <= 1}
                aria-label={`Remove ${yarn.name}`} title="Remove yarn" onClick={() => store.update((p) => removeYarn(p, i))}>
                <Icon name="trash" />
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/**
 * A color input that previews while the picker is open and commits once when
 * it closes (the native `change` event), so one color change is one undo step.
 */
export function ColorInput({ value, onPreview, onCommit, ...props }: { value: string; onPreview: (hex: string) => void; onCommit: () => void; 'aria-label'?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => {
    const input = ref.current
    const onChange = () => commit.current()
    input?.addEventListener('change', onChange)
    return () => input?.removeEventListener('change', onChange)
  }, [])
  return <input {...props} ref={ref} type="color" value={value} onChange={(e) => isHexColor(e.target.value) && onPreview(e.target.value)} onBlur={onCommit} />
}
