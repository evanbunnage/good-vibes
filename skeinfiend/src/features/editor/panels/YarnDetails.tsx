import { useEffect, useRef, useState } from 'react'
import { setSwatch, updateYarn } from '@/domain/edits'
import { YARN_WEIGHTS, type Yarn } from '@/domain/palette'
import { formatYarnLength, METERS_PER_YARD, type YarnEstimate } from '@/domain/yarn-estimate'
import { fromUnits, toUnits, useUnits } from '@/features/pieces/units'
import type { EditorState, EditorStore } from '@/editor/store'
import { FloatingWindow } from '@/ui/FloatingWindow'
import { useEditor, useEditorStore, useProject } from '../editor-context'
import { yarnWindow } from '../yarn-window'
import { ColorInput } from './YarnsSection'
import styles from './panels.module.css'

const selectYarns = (_: EditorState, store: EditorStore) => store.project.yarns
const selectEstimate = (_: EditorState, store: EditorStore) => store.estimate()
const selectChosen = (s: EditorState) => s.yarn

/** The open yarn's details, in a window over the chart: its pencil in the Yarns list opens it. */
export function YarnWindow() {
  const store = useEditorStore()
  const id = yarnWindow.yarn.use()
  const yarns = useEditor(selectYarns)
  const estimate = useEditor(selectEstimate)
  const index = yarns.findIndex((y) => y.id === id)
  const yarn = yarns[index]
  // Choosing another yarn to draw with closes this one's details; leaving the chart closes them.
  const chosen = useEditor(selectChosen)
  const chosenId = yarns[chosen]?.id
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else if (yarnWindow.yarn.get() !== chosenId) yarnWindow.close()
  }, [chosenId])
  useEffect(() => () => yarnWindow.close(), [])
  if (!yarn) return null
  return (
    // Keyed by yarn, so switching yarns starts the window fresh (and a new one's name is ready to type).
    <FloatingWindow key={yarn.id} name={yarn.name} nameLabel="Yarn name" position={yarnWindow.position} focusName={yarnWindow.isNaming(yarn.id)}
      leading={
        <label className={styles.windowSwatch} style={{ background: yarn.hex }} title="Change color">
          <ColorInput aria-label={`${yarn.name} color`} value={yarn.hex}
            onPreview={(hex) => store.preview((p) => updateYarn(p, index, { hex }))} onCommit={() => store.commitPreview()} />
        </label>
      }
      onRename={(name) => store.update((p) => updateYarn(p, index, { name: name.trim() }))} onClose={() => yarnWindow.close()} data-yarn-window>
      <YarnDetails yarn={yarn} index={index} estimate={estimate.yarns.find((e) => e.yarn === index)} />
    </FloatingWindow>
  )
}

/**
 * A yarn as its ball band gives it: what it is, and a skein's
 * length and weight (for how many skeins the chart takes). Then what the
 * chart takes of it, and the swatch that makes that closer. Each field
 * saves when it's left; emptied, it's cleared.
 */
export function YarnDetails({ yarn, index, estimate }: { yarn: Yarn; index: number; estimate: YarnEstimate | undefined }) {
  const store = useEditorStore()
  const units = useUnits()
  const yards = units === 'in'
  const set = (changes: Partial<Omit<Yarn, 'id'>>) => store.update((p) => updateYarn(p, index, changes))
  const text = (value: string) => value.trim() || undefined
  const number = (value: string) => {
    const n = Number.parseFloat(value.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  const length = yarn.metersPerSkein === undefined ? '' : String(Math.round(yards ? yarn.metersPerSkein / METERS_PER_YARD : yarn.metersPerSkein))

  return (
    <div className={styles.yarnDetails}>
      <label>
        <span>Yarn</span>
        <Field value={yarn.brand ?? ''} placeholder="Brand and name" onCommit={(v) => set({ brand: text(v) })} />
      </label>
      <label>
        <span>Weight</span>
        <select value={yarn.weight ?? ''} onChange={(e) => set({ weight: (e.target.value || undefined) as Yarn['weight'] })}>
          <option value="">—</option>
          {YARN_WEIGHTS.map((w) => <option key={w} value={w}>{w[0]!.toUpperCase() + w.slice(1)}</option>)}
        </select>
      </label>
      <label>
        <span>Fiber</span>
        <Field value={yarn.fiber ?? ''} placeholder="100% wool" onCommit={(v) => set({ fiber: text(v) })} />
      </label>
      <div className={styles.yarnDetailsRow} role="group" aria-label="A skein">
        <span>Skein</span>
        <span className={styles.yarnSkein}>
          <Field value={length} inputMode="decimal" aria-label={yards ? 'Yards per skein' : 'Meters per skein'}
            onCommit={(v) => { const n = number(v); set({ metersPerSkein: n && (yards ? n * METERS_PER_YARD : n) }) }} />
          {yards ? 'yd' : 'm'}
          <Field value={yarn.gramsPerSkein === undefined ? '' : String(yarn.gramsPerSkein)} inputMode="decimal" aria-label="Grams per skein"
            onCommit={(v) => set({ gramsPerSkein: number(v) })} />
          g
        </span>
      </div>
      <label>
        <span>Link</span>
        <Field value={yarn.url ?? ''} type="url" placeholder="https://" onCommit={(v) => set({ url: text(v) })} />
      </label>
      {estimate && (
        <p className={styles.yarnNeeds}>
          <strong>{amount(estimate, units)}</strong>
          <span>{counted(estimate)}</span>
        </p>
      )}
      <SwatchFields />
    </div>
  )
}

/** What a yarn takes: "About 185 m (2 skeins, 44 g)". */
export function amount(e: YarnEstimate, units: 'cm' | 'in'): string {
  const parts = [e.skeins !== null && `${e.skeins} ${e.skeins === 1 ? 'skein' : 'skeins'}`, e.grams !== null && `${Math.ceil(e.grams)} g`].filter(Boolean)
  return `About ${formatYarnLength(e.meters, units)}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

/** What it's counted from: "7,640 stitches · floats across 1,148". */
export function counted(e: YarnEstimate): string {
  return `${e.stitches.toLocaleString()} stitches${e.floatStitches ? ` · floats across ${e.floatStitches.toLocaleString()}` : ''}`
}

/**
 * A swatch the knitter weighed, for the estimate: shared by every yarn, as
 * it's the whole fabric. Asked for in a line until it's given; then its size
 * and weight, to change. All three, or none: emptying them all clears it.
 */
function SwatchFields() {
  const store = useEditorStore()
  const project = useProject()
  const units = useUnits()
  const swatch = project.swatch
  const [asked, setAsked] = useState(false)
  const [draft, setDraft] = useState<{ width: string; height: string; grams: string } | null>(null)
  // Saved if the window closes while it's being typed in.
  const commitRef = useRef<() => void>(() => {})
  useEffect(() => () => commitRef.current(), [])
  if (!swatch && !asked) {
    return (
      <button type="button" className={styles.swatchAsk} onClick={() => setAsked(true)}>
        Weigh your swatch for a closer estimate
      </button>
    )
  }
  const shown = draft ?? {
    width: swatch ? String(Math.round(toUnits(swatch.widthCm, units) * 10) / 10) : '',
    height: swatch ? String(Math.round(toUnits(swatch.heightCm, units) * 10) / 10) : '',
    grams: swatch ? String(swatch.grams) : '',
  }
  const number = (v: string) => {
    const n = Number.parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const commit = () => {
    if (!draft) return
    const [w, h, g] = [number(draft.width), number(draft.height), number(draft.grams)]
    setDraft(null)
    if (w && h && g) store.update((p) => setSwatch(p, { widthCm: fromUnits(w, units), heightCm: fromUnits(h, units), grams: g }))
    else if (!draft.width && !draft.height && !draft.grams) {
      store.update((p) => setSwatch(p, undefined))
      setAsked(false)
    }
  }
  commitRef.current = commit
  const field = (key: 'width' | 'height' | 'grams', label: string) => (
    // biome-ignore lint/a11y/noAutofocus: adding a swatch starts at its width, the first thing to type
    <input className={styles.yarnField} inputMode="decimal" aria-label={label} value={shown[key]} autoFocus={key === 'width' && !swatch}
      onChange={(e) => setDraft({ ...shown, [key]: e.target.value })}
      // Saved once all three are left.
      onBlur={(e) => !e.currentTarget.parentElement?.contains(e.relatedTarget) && commit()}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  )
  return (
    <div className={styles.yarnDetailsRow} role="group" aria-label="Swatch">
      <span>Swatch</span>
      <span className={styles.yarnSkein}>
        {field('width', 'Swatch width')}×{field('height', 'Swatch height')}{units}{field('grams', 'Swatch weight in grams')}g
      </span>
    </div>
  )
}

/**
 * A text field that saves when it's left (or on Enter), or when the window
 * closes around it, and can be emptied. Escape puts it back.
 */
function Field({ value, onCommit, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  // What's typed and not yet saved, saved once, however the field goes away.
  const pending = useRef({ draft, saved: value, onCommit })
  pending.current.draft = draft
  pending.current.onCommit = onCommit
  useEffect(() => { pending.current.saved = value }, [value])
  const save = () => {
    const { draft, saved, onCommit } = pending.current
    if (draft === saved) return
    pending.current.saved = draft
    onCommit(draft)
  }
  // Saved on the way out too: closing the window mid-edit keeps what was typed. (`save` reads a ref.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on unmount
  useEffect(() => save, [])
  return (
    <input {...props} className={styles.yarnField} value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          pending.current.draft = value
          const input = e.currentTarget
          requestAnimationFrame(() => input.blur())
        }
      }} />
  )
}
