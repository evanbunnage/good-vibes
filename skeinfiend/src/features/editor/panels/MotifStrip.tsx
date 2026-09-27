import { useEffect, useRef, useState } from 'react'
import { motifYarns } from '@/domain/bands'
import { ChartPreview } from '@/render/ChartPreview'
import { Icon } from '@/ui/Icon'
import { createPreference } from '@/ui/preference'
import { useEditorStore, useProject } from '../editor-context'
import { motifPreview } from '../layer-window'
import { MOTIF_DRAG_TYPE, useAddLayer, type MotifChoice } from './use-add-layer'
import styles from './panels.module.css'

/** Whether the motifs show as a grid rather than a row, remembered in this browser. */
const expandedPreference = createPreference<boolean>('skeinfiend.motifsExpanded', false)

/**
 * Motifs to add as layers, above the layers: a blank one to draw, the
 * designer's own, then the traditional ones. Click one to add it in free rows,
 * or drag it onto the chart where it should go.
 *
 * One row, scrolled sideways as any row is, or, with the
 * arrow at its end, a grid a few rows tall that scrolls up and down.
 */
export function MotifStrip() {
  const { builtIn, saved, add } = useAddLayer()
  const store = useEditorStore()
  // A click shows it in the layer window first, to add from there; a drag onto the chart places it straight away.
  const look = (key: string) => {
    store.selectLayer(null)
    motifPreview.set(key)
  }
  const drag = (key: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData(MOTIF_DRAG_TYPE, key)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const expanded = expandedPreference.use()
  const strip = useRef<HTMLDivElement>(null)
  // The arrow's only there when there's more than one row's worth.
  const [overflows, setOverflows] = useState(false)
  // Measured again when the strip opens or closes, or gains or loses tiles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: they're triggers, not read inside
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const measure = () => {
      // As a row, spaced so the last tile in view is cut in half: plainly more to scroll to.
      el.style.columnGap = ''
      const tile = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
      const minGap = parseFloat(getComputedStyle(el).columnGap) || 0
      const width = el.clientWidth - parseFloat(getComputedStyle(el).paddingInlineStart) * 2
      const whole = Math.floor((width - tile / 2 + minGap) / (tile + minGap))
      if (!expandedPreference.get() && tile && whole > 0 && el.children.length > whole + 1) {
        el.style.columnGap = `${(width - (whole + 0.5) * tile) / whole}px`
      }
      setOverflows(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || expandedPreference.get())
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [expanded, saved.length, builtIn.length])

  return (
    <div className={styles.stripArea}>
    <div ref={strip} className={styles.strip} data-expanded={expanded || undefined} role="group" aria-label="Add a colorwork motif">
      <button type="button" className={styles.stripTile} data-new title="New colorwork motif" aria-label="New colorwork motif" draggable onDragStart={drag('blank')} onClick={() => add('blank')}>
        <Icon name="plus" />
      </button>
      {/* The designer's own: deleted only in the library, on the home page, where it's asked first. */}
      {saved.map((choice) => <Tile key={choice.key} choice={choice} onLook={() => look(choice.key)} onDragStart={drag(choice.key)} />)}
      {builtIn.map((choice) => <Tile key={choice.key} choice={choice} onLook={() => look(choice.key)} onDragStart={drag(choice.key)} />)}
    </div>
    {overflows && (
      <button type="button" className={styles.stripToggle} aria-expanded={expanded} aria-label={expanded ? 'Show colorwork motifs in a row' : 'Show all colorwork motifs'}
        title={expanded ? 'Fewer' : 'More'} onClick={() => expandedPreference.set(!expanded)}>
        <Icon name={expanded ? 'chevronUp' : 'chevronDown'} />
      </button>
    )}
    </div>
  )
}

/** Plain ink, like a stamp: motifs to add, set apart from the layers, which show their yarns on the main color. */
const INK = '#2f332f'
/** A motif's other colors, lighter, so a saved two-color motif still reads. */
const INK_LIGHT = '#9aa097'

function Tile({ choice, onLook, onDragStart }: { choice: MotifChoice; onLook: () => void; onDragStart: (e: React.DragEvent) => void }) {
  const project = useProject()
  const [first] = motifYarns(choice.motif)
  const colors = project.yarns.map((_, i) => (i === first ? INK : INK_LIGHT))
  return (
    <button type="button" className={styles.stripTile} title={`${choice.name}: click to look, or drag onto the chart`} aria-label={choice.name} draggable onDragStart={onDragStart} onClick={onLook}>
      <ChartPreview grid={choice.motif} colors={colors} fill />
    </button>
  )
}
