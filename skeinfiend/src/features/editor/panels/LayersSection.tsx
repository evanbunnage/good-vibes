import { useRef, useState } from 'react'
import { motifYarns, placementOf, scaledMotif, type Band } from '@/domain/bands'
import { removeBand, renameBand, reorderBand, setBackground, takeLibraryVersion, updateBand } from '@/domain/edits'
import { useSavedMotifs } from '@/data/library'
import { editedAt } from '@/domain/saved-motifs'
import type { EditorState } from '@/editor/store'
import { ChartPreview } from '@/render/ChartPreview'
import { CommitInput } from '@/ui/CommitInput'
import { Icon } from '@/ui/Icon'
import ui from '@/ui/ui.module.css'
import { useEditor, useEditorStore, useProject } from '../editor-context'
import { Section } from './Section'
import { layerWindow } from '../layer-window'
import { MotifStrip } from './MotifStrip'
import styles from './panels.module.css'

const selectSelectedLayer = (s: EditorState) => s.selectedBandId
const selectRecoloring = (s: EditorState) => s.recoloring

/**
 * The colorwork, as layers: motif layers from front to back, then the
 * main color everything sits on. Click a layer to select it: it's what
 * dragging on the chart moves. Its pencil opens its window (motif and
 * settings) over the chart. Double-click a name to rename it.
 */
export function LayersSection() {
  const store = useEditorStore()
  const project = useProject()
  const selectedId = useEditor(selectSelectedLayer)
  const editingId = layerWindow.editing.use()
  const recoloring = useEditor(selectRecoloring)
  const [dragging, setDragging] = useState<string | null>(null)
  // Where a dragged layer would land: before or after a row in the list.
  const [drop, setDrop] = useState<{ index: number; edge: 'before' | 'after' } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // A layer made from a library motif that's been edited since: the newer version, to take or not.
  const { data: savedMotifs = [] } = useSavedMotifs()
  const newerVersion = (band: Band) => {
    const saved = band.fromLibrary && savedMotifs.find((m) => m.id === band.fromLibrary!.motifId)
    return saved && editedAt(saved) > band.fromLibrary!.editedAt ? saved : undefined
  }
  // Front to back, as layers are listed; the project keeps them back to front.
  const layers = [...project.bands].reverse()
  const colors = project.yarns.map((y) => y.hex)
  const background = project.yarns[project.background]?.hex

  /** Editing a layer selects it and opens its window. */
  function edit(id: string) {
    store.selectLayer(id)
    layerWindow.editing.set(id)
  }

  const list = useRef<HTMLUListElement>(null)
  /** Where a layer dragged to this height would land: before or after the row it's over. */
  function dropAt(y: number): { index: number; edge: 'before' | 'after' } | null {
    const rows = [...(list.current?.children ?? [])].slice(0, layers.length)
    for (const [index, row] of rows.entries()) {
      const { top, bottom, height } = row.getBoundingClientRect()
      if (y >= top && y < bottom) return { index, edge: y < top + height / 2 ? 'before' : 'after' }
    }
    if (!rows.length) return null
    // Past either end: to the front, or the back.
    return y < rows[0]!.getBoundingClientRect().top ? { index: 0, edge: 'before' } : { index: rows.length - 1, edge: 'after' }
  }

  function endDrag() {
    setDragging(null)
    setDrop(null)
  }

  /** Moves the dragged layer to where it was dropped in the list, front to back. */
  function place() {
    if (!dragging || !drop) return endDrag()
    const from = layers.findIndex((b) => b.id === dragging)
    let to = drop.edge === 'before' ? drop.index : drop.index + 1
    if (to > from) to -= 1
    const id = dragging
    store.update((p) => reorderBand(p, id, p.bands.length - 1 - to))
    endDrag()
  }

  return (
    <Section title="Colorwork" scrolls="first">
      <ul ref={list} className={styles.layers} aria-label="Layers, front to back">
        {layers.map((band, i) => {
          const selected = band.id === selectedId
          const open = editingId === band.id
          const motif = scaledMotif(band)
          const yarns = motifYarns(motif)
          return (
            <li key={band.id} className={styles.layerGroup} data-selected={selected || undefined} data-open={open || undefined}
              data-dragging={dragging === band.id || undefined}
              data-drop={dragging && dragging !== band.id && drop?.index === i ? drop.edge : undefined}
>
              <div className={styles.layer} data-grip>
                {/* Dragged by pointer, not the browser's drag and drop, so a finger can do it as well as a mouse. */}
                <button type="button" className={styles.grip} aria-label={`Rearrange ${band.name}`} title="Drag to rearrange"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setDragging(band.id)
                  }}
                  onPointerMove={(e) => dragging === band.id && setDrop(dropAt(e.clientY))}
                  onPointerUp={() => dragging === band.id && place()}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => {
                    // Up is toward the front of the stack, as the list reads.
                    const by = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
                    if (!by) return
                    e.preventDefault()
                    store.update((p) => reorderBand(p, band.id, p.bands.findIndex((b) => b.id === band.id) + by))
                  }}>
                  <Icon name="grip" />
                </button>
                {renaming === band.id ? (
                  <span className={styles.layerSelect}>
                    <span className={styles.motifPreview} style={{ background }}>
                      <ChartPreview grid={motif} colors={colors} fill />
                    </span>
                    <CommitInput className={styles.renameInput} value={band.name} aria-label="Layer name" autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onCommit={(name) => store.update((p) => renameBand(p, band.id, name))} onFinish={() => setRenaming(null)} />
                  </span>
                ) : (
                  <button type="button" className={styles.layerSelect} aria-pressed={selected}
                    onClick={() => store.selectLayer(selected ? null : band.id)}>
                    <span className={styles.motifPreview} style={{ background }}>
                      <ChartPreview grid={motif} colors={colors} fill />
                    </span>
                    {/* A shortcut for the mouse: the layer's window renames it from the keyboard. */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: see above */}
                    <span className={styles.layerName} title="Double-click to rename"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setRenaming(band.id)
                      }}>
                      {band.name}
                    </span>
                    <RepeatMark band={band} />
                  </button>
                )}
                {(() => {
                  const newer = newerVersion(band)
                  return newer && (
                    <button type="button" className={styles.libraryUpdate} title={`“${newer.name}” has been changed in your colorwork motifs. Take the new version (Undo puts it back).`}
                      onClick={() => store.update((p) => takeLibraryVersion(p, band.id, newer))}>
                      Update
                    </button>
                  )
                })()}
                <span className={styles.chips} data-grid={yarns.length > 2 || undefined}>
                  {yarns.map((yarn) => {
                    const picked = recoloring?.bandId === band.id && recoloring.yarn === yarn
                    return (
                      <button type="button" key={yarn} className={styles.chipButton} aria-pressed={picked} style={{ background: colors[yarn] }}
                        aria-label={`Recolor ${project.yarns[yarn]?.name ?? 'color'} in ${band.name}`} title="Recolor: then pick a yarn"
                        onClick={() => store.recolor(band.id, yarn)} />
                    )
                  })}
                </span>
                {/* Painted stitches are edited on the chart itself: there's no window to open. */}
                {band.painted ? <span className={styles.actionSpace} aria-hidden /> : (
                  <button type="button" className={ui.button} data-variant="ghost" data-size="icon" aria-pressed={open} data-open={open || undefined}
                    aria-label={open ? `Close ${band.name}` : `Edit ${band.name}`} title={open ? 'Close' : 'Edit'}
                    onClick={() => (open ? layerWindow.editing.set(null) : edit(band.id))}>
                    <Icon name="pencil" />
                  </button>
                )}
                <VisibilityButton name={band.name} visible={band.visible}
                  onToggle={(visible) => store.update((p) => updateBand(p, band.id, { visible }))} />
                <button type="button" className={ui.button} data-variant="ghost" data-size="icon" aria-label={`Delete ${band.name}`} title="Delete layer"
                  onClick={() => store.update((p) => removeBand(p, band.id))}>
                  <Icon name="trash" />
                </button>
              </div>
            </li>
          )
        })}

        <li className={styles.layer}>
          <label className={styles.layerSelect}>
            <span className={styles.layerIcon} style={{ background }} />
            <span className={styles.layerName}>Main color</span>
            <select className={styles.inlineSelect} value={project.background}
              onChange={(e) => store.update((p) => setBackground(p, Number(e.target.value)))}>
              {project.yarns.map((y, i) => <option key={y.id} value={i}>{y.name}</option>)}
            </select>
          </label>
        </li>
      </ul>
      {/* The colorwork motifs to add, under the layers they become. */}
      <MotifStrip />
    </Section>
  )
}

function VisibilityButton({ name, visible, onToggle }: { name: string; visible: boolean; onToggle: (visible: boolean) => void }) {
  return (
    <button type="button" className={ui.button} data-variant="ghost" data-size="icon" aria-pressed={visible}
      aria-label={visible ? `Hide ${name}` : `Show ${name}`} title={visible ? 'Hide' : 'Show'} onClick={() => onToggle(!visible)}>
      <Icon name={visible ? 'eye' : 'eyeOff'} />
    </button>
  )
}

/** How a layer repeats, when it does: across its rows, or all over. A single motif, or painted stitches, don't. */
function RepeatMark({ band }: { band: Band }) {
  const placement = placementOf(band)
  if (band.painted || placement === 'single') return null
  const label = placement === 'band' ? 'Repeats across its rows' : 'Repeats all over'
  return (
    <span className={styles.repeatMark} role="img" title={label} aria-label={label}>
      <Icon name={placement === 'band' ? 'repeatAcross' : 'repeatAll'} />
    </span>
  )
}
