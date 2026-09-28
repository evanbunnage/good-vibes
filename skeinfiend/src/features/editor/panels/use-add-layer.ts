import { useSavedMotifs } from '@/data/library'
import { blankMotif, centeredOffset, createBand, type Band } from '@/domain/bands'
import { addBand } from '@/domain/edits'
import type { Grid } from '@/domain/grid'
import { MOTIF_LIBRARY } from '@/domain/motifs'
import { editedAt, motifInYarns, type SavedMotif } from '@/domain/saved-motifs'
import type { EditorState } from '@/editor/store'
import { useEditor, useEditorStore, useProject } from '../editor-context'
import { layerWindow } from '../layer-window'
import { motifAdded } from './motif-helper-state'

/** A motif that can become a layer: from the built-in library, the designer's own, or blank to draw. */
export interface MotifChoice {
  /** Stable across renders, and what a drag carries: `built-in:peerie`, `saved:<id>`, or `blank`. */
  readonly key: string
  readonly name: string
  /** The motif in this project's yarns. */
  readonly motif: Grid
  readonly spacing: number
  readonly saved?: SavedMotif
  /** Where it comes from in the library, for the layer to remember. */
  readonly fromLibrary?: Band['fromLibrary']
}

/** What drags carry, so the chart can tell a motif from anything else dropped on it. */
export const MOTIF_DRAG_TYPE = 'application/x-skeinfiend-motif'

const selectYarn = (s: EditorState) => s.yarn

/**
 * The motifs on offer, colored for this project (the first contrast is the
 * yarn being painted with, or another if that's the main color), and a way to
 * add one as a layer: in the nearest free rows, or on the rows it was dropped on.
 */
export function useAddLayer() {
  const store = useEditorStore()
  const project = useProject()
  const activeYarn = useEditor(selectYarn)
  const { data: savedMotifs = [] } = useSavedMotifs()
  const contrast = activeYarn === project.background ? (project.background + 1) % project.yarns.length : activeYarn

  const builtIn: MotifChoice[] = MOTIF_LIBRARY.map((m) => ({
    key: `built-in:${m.id}`, name: m.name, motif: m.build(contrast), spacing: m.spacing, fromLibrary: { motifId: `built-in:${m.id}`, editedAt: 0 },
  }))
  // The designer's own, newest first: one just saved is beside the blank one, not out of sight.
  const saved: MotifChoice[] = [...savedMotifs].sort((a, b) => b.savedAt - a.savedAt).map((m) => ({
    key: `saved:${m.id}`,
    name: m.name,
    motif: motifInYarns(m.grid, project.yarns.length, project.background, contrast),
    spacing: 0,
    saved: m,
    fromLibrary: { motifId: m.id, editedAt: editedAt(m) },
  }))
  const blank: MotifChoice = { key: 'blank', name: `Colorwork motif ${project.bands.length + 1}`, motif: blankMotif(), spacing: 0 }

  /**
   * Puts a motif on the chart, in free rows or at a row: just there, to see
   * on the chart. To edit it (dragged on, or Edit pressed; and a blank one,
   * which is there to draw), it's selected and its window opened.
   */
  function add(key: string, atRow?: number, { edit = key === 'blank' } = {}) {
    const choice = [...builtIn, ...saved, blank].find((c) => c.key === key)
    if (!choice) return
    const { motif, spacing } = choice
    const rows = atRow === undefined ? store.rowsForNewBand(motif.height) : store.rowsAt(atRow, motif.height)
    const band: Band = {
      ...createBand(crypto.randomUUID(), choice.name, motif, rows),
      offsetX: centeredOffset(project.outline.width, motif.width, spacing),
      gapX: spacing,
      ...(choice.fromLibrary && { fromLibrary: choice.fromLibrary }),
    }
    store.update((p) => addBand(p, band))
    // They've done what the helper shows: it's not needed again.
    motifAdded()
    if (!edit) return
    // Selected, so it's ready to place, and its window open to draw on, even if it was closed before.
    store.selectLayer(band.id)
    layerWindow.editing.set(band.id)
  }

  return { builtIn, saved, add }
}
