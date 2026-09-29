import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeleteMotif, useSaveMotif, useSavedMotifs } from '@/data/library'
import { usePhone, useTouch } from '@/ui/use-phone'
import { bandStitchTile, bandSpan, bandTile, MAX_SCALE, motifPoint, SCALE_STEP, placementOf, scaleOf, scaledMotif, scaledStitches, type Band, type Placement } from '@/domain/bands'
import { adjustBand, duplicateBand, renameBand, resizeBandMotif, setPlacement, setScale, updateBand } from '@/domain/edits'
import { cellAspect } from '@/domain/gauge'
import { NONE, type Grid } from '@/domain/grid'
import type { Project } from '@/domain/project'
import { editedAt, toSavedMotif } from '@/domain/saved-motifs'
import { rotateClockwise } from '@/domain/transform'
import type { EditorState, EditorStore } from '@/editor/store'
import { ChartCanvas } from '@/render/ChartCanvas'
import { DeleteButton } from '@/ui/DeleteButton'
import { FloatingWindow } from '@/ui/FloatingWindow'
import { Icon } from '@/ui/Icon'
import { NumberField } from '@/ui/NumberField'
import { SliderField } from '@/ui/SliderField'
import ui from '@/ui/ui.module.css'
import { useEditor, useEditorStore, useProject } from './editor-context'
import { layerWindow, motifPreview } from './layer-window'
import { useAddLayer } from './panels/use-add-layer'
import { ChartPreview } from '@/render/ChartPreview'
import styles from './layer-window.module.css'
import { stitchType } from '@/domain/stitches'
import { StitchSymbol } from './Stitches'

const REPEATS: ReadonlyArray<readonly [Placement, string]> = [['band', 'Row'], ['tile', 'Tile'], ['single', 'Single']]

const selectBand = (_: EditorState, store: EditorStore) => store.selectedBand()

const selectSelectedId = (s: EditorState) => s.selectedBandId

/**
 * Everything about the layer being edited, in a window over the chart: its
 * motif to draw on (every repeat on the chart follows), its size, and how
 * it's placed. It opens to edit (a motif dragged on, or Edit), not on
 * selecting a layer. Drag it by its title to move it; its position is remembered.
 */

export function LayerWindow() {
  const band = useEditor(selectBand)
  const editingId = layerWindow.editing.use()
  const previewing = motifPreview.use()
  const selectedId = useEditor(selectSelectedId)
  useEffect(() => {
    // A layer selected puts away a motif being looked at; another layer selected closes the window on this one.
    if (selectedId) motifPreview.set(null)
    if (layerWindow.editing.get() !== selectedId) layerWindow.editing.set(null)
  }, [selectedId])
  useEffect(() => () => {
    motifPreview.set(null)
    layerWindow.editing.set(null)
  }, [])
  if (previewing) return <PreviewWindow motifKey={previewing} />
  // Painted stitches are painted on the chart itself: there's no motif to open.
  return band && editingId === band.id && !band.painted ? <Window band={band} /> : null
}

/**
 * A colorwork motif from the strip, before it's on the chart: how it looks in
 * this chart's yarns, and a button to add it (then it's a layer, in this
 * window, to draw on and place).
 */
function PreviewWindow({ motifKey }: { motifKey: string }) {
  const project = useProject()
  const { builtIn, saved, add } = useAddLayer()
  const saveMotif = useSaveMotif()
  const deleteMotif = useDeleteMotif()
  const choice = [...saved, ...builtIn].find((c) => c.key === motifKey)
  if (!choice) return null
  const colors = project.yarns.map((y) => y.hex)
  return (
    <FloatingWindow name={choice.name} nameLabel="Colorwork motif" position={layerWindow.position} onClose={() => motifPreview.set(null)}>
      <div className={styles.preview} style={{ background: project.yarns[project.background]?.hex }}>
        <ChartPreview grid={choice.motif} colors={colors} fill />
      </div>
      <button type="button" className={ui.button} data-variant="primary" onClick={() => {
        motifPreview.set(null)
        add(choice.key)
      }}>
        <Icon name="plus" /> Add to chart
      </button>
      {/* Edited where it'll be: on the chart, in this chart's yarns, as a layer (saved to the library from
          there, if they like). The designer's own can be copied, or deleted (charts keep their copies). */}
      <div className={styles.previewActions}>
          <button type="button" onClick={() => {
            motifPreview.set(null)
            add(choice.key, undefined, { edit: true })
          }}><Icon name="pencil" /> Edit</button>
          {choice.saved && (
            <>
              <button type="button" onClick={() => {
                const copy = { id: crypto.randomUUID(), name: `${choice.name} copy`, grid: choice.saved!.grid, savedAt: Date.now() }
                saveMotif.mutate(copy, { onSuccess: () => motifPreview.set(`saved:${copy.id}`) })
              }}><Icon name="copy" /> Duplicate</button>
              <DeleteButton label={choice.name} onDelete={() => {
                deleteMotif.mutate(choice.saved!.id)
                motifPreview.set(null)
              }} />
            </>
          )}
        </div>
    </FloatingWindow>
  )
}

function Window({ band }: { band: Band }) {
  const store = useEditorStore()
  // On a phone or tablet a layer's only selected to edit it: a finger moves one on the chart without it.
  const phone = usePhone()
  const touch = useTouch()
  const simple = phone || touch
  return (
    <FloatingWindow name={band.name} nameLabel="Layer name" position={layerWindow.position}
      onRename={(name) => store.update((p) => renameBand(p, band.id, name))}
      onClose={() => {
        layerWindow.editing.set(null)
        // Done editing: the chart's as it is again.
        if (simple) store.selectLayer(null)
      }}>
      <Palette />
      <MotifCanvas band={band} />
      <Settings band={band} />
      <Actions band={band} />
    </FloatingWindow>
  )
}

const selectYarn = (s: EditorState) => s.yarn
const selectBrush = (s: EditorState) => s.brush
const selectStitch = (s: EditorState) => s.stitch
const selectTool = (s: EditorState) => s.motifTool
const selectYarns = (_: EditorState, store: EditorStore) => store.project.yarns

/**
 * What to draw with: a yarn, or the eraser. The same choice as the Yarns
 * panel (and the 1–9, B, and E keys); a right-click erases whichever is picked.
 */
function Palette() {
  const store = useEditorStore()
  const yarns = useEditor(selectYarns)
  const yarn = useEditor(selectYarn)
  const tool = useEditor(selectTool)
  const brush = useEditor(selectBrush)
  const stitch = useEditor(selectStitch)
  return (
    <div className={styles.palette} role="radiogroup" aria-label="Draw with">
      {yarns.map((y, i) => (
        <button type="button" key={y.id} role="radio" aria-checked={brush === 'yarn' && tool === 'brush' && yarn === i} aria-label={y.name}
          title={i < 9 ? `${y.name} (${i + 1})` : y.name} style={{ background: y.hex }}
          onClick={() => store.chooseYarn(i)} />
      ))}
      <button type="button" role="radio" aria-checked={brush === 'yarn' && tool === 'eraser'} aria-label="Erase" title="Erase (E)" data-eraser
        onClick={() => store.setMotifTool('eraser')}>
        <Icon name="eraser" />
      </button>
      {/* The stitch picked in the side panel, while it's the brush: what drawing here places. */}
      {brush === 'stitch' && (
        <button type="button" role="radio" aria-checked aria-label={`${stitchType(stitch).name}: pick a yarn to draw colors again`} title={stitchType(stitch).name} data-stitch>
          <StitchSymbol stitch={stitchType(stitch)} />
        </button>
      )}
    </div>
  )
}

function MotifCanvas({ band }: { band: Band }) {
  const store = useEditorStore()
  const project = useProject()
  const bandId = band.id
  // Shown as it's knitted (scaled, rotated, mirrored), as on the chart. At 2×
  // and up, each stitch can be drawn on: finer detail kept for that scale.
  const tile = bandTile(band)
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < tile.width && y < tile.height ? motifPoint(band, x, y) : { x: -1, y: -1 })
  // The stitch under the pointer, shown as the brush would paint it: kept here, redrawn without re-rendering.
  const tip = useRef<{ x: number; y: number } | null>(null)
  const tipListeners = useRef(new Set<() => void>())
  const subscribe = useCallback((listener: () => void) => {
    const unsubscribe = store.subscribe(listener)
    tipListeners.current.add(listener)
    return () => {
      unsubscribe()
      tipListeners.current.delete(listener)
    }
  }, [store])
  const getDrawing = useCallback(() => {
    const p = store.project
    const state = store.getState()
    const band = p.bands.find((b) => b.id === bandId)
    // What the brush would put down: the yarn painted with, or (erasing) the main color showing through.
    const color = state.motifTool === 'eraser' ? p.yarns[p.background]?.hex ?? null : state.brush === 'yarn' ? p.yarns[state.yarn]?.hex ?? null : null
    return {
      grid: band ? onBackground(bandTile(band), p.background) : { width: 1, height: 1, cells: new Uint8Array([p.background]) },
      colors: p.yarns.map((y) => y.hex),
      // Symbols only while the stitches show, as on the chart.
      stitches: band && state.showingStitches ? bandStitchTile(band) : null,
      numbers: false,
      brushTip: tip.current && { ...tip.current, color },
    }
  }, [store, bandId])

  return (
    <div className={styles.canvas}>
      <ChartCanvas
        getDrawing={getDrawing}
        subscribe={subscribe}
        aspect={cellAspect(project.gauge)}
        fitKey={`${bandId}:${tile.width}x${tile.height}`}
        cursorAt={() => 'crosshair'}
        onHover={(cell) => {
          tip.current = cell
          for (const listener of tipListeners.current) listener()
        }}
        label={`${band.name} motif. Draw to change every repeat.`}
        onCellDown={(x, y, e) => {
          const p = at(x, y)
          store.motifPointerDown(p.x, p.y, { secondary: e.button === 2 || (e.button === 0 && e.ctrlKey) })
        }}
        onCellMove={(x, y) => {
          const p = at(x, y)
          store.motifPointerMove(p.x, p.y)
        }}
        onCellUp={() => store.pointerUp()}
      />
    </div>
  )
}

/** One column of settings, each a label and its control. */
function Settings({ band }: { band: Band }) {
  const store = useEditorStore()
  const project = useProject()
  const tile = bandTile(band)
  const span = bandSpan(band, project.outline.height)
  // A gap between rows of repeats only matters if there's room for more than one.
  const stacks = span.bottom - span.top + 1 > tile.height
  const placement = placementOf(band)
  // Scrubbing, scrolling, and sliding preview live on the chart, then commit as one undo step.
  const live = (edit: (value: number) => (p: Project) => Project) => ({
    onPreview: (value: number) => store.preview(edit(value)),
    onChange: (value: number) => store.update(edit(value)),
    onPreviewEnd: () => store.cancelPreview(),
  })
  const resize = (w: number, h: number) => (p: Project) => resizeBandMotif(p, band.id, w, h)
  const adjust = (changes: (value: number) => Partial<Band>) => (value: number) => (p: Project) => adjustBand(p, band.id, changes(value))

  return (
    <div className={styles.settings}>
      <span>Size</span>
      <div className={styles.size}>
        <NumberField label="Stitches" hideLabel compact value={band.motif.width} min={1} max={60} {...live((w) => resize(w, band.motif.height))} />
        <span aria-hidden>×</span>
        <NumberField label="Rows" hideLabel compact value={band.motif.height} min={1} max={60} {...live((h) => resize(band.motif.width, h))} />
      </div>

      <span>Scale</span>
      <SliderField label="Scale" hideLabel value={scaleOf(band)} min={1} max={MAX_SCALE} step={SCALE_STEP} format={(v) => `${Number(v.toFixed(1))}×`}
        {...live((scale) => (p) => setScale(p, band.id, scale))} />

      <span>Repeat</span>
      <div className={ui.segmented} role="group" aria-label="Repeat">
        {REPEATS.map(([value, label]) => (
          <button type="button" key={value} aria-pressed={placement === value}
            onClick={() => placement !== value && store.update((p) => setPlacement(p, band.id, value, store.rowsForNewBand(tile.height)))}>
            {label}
          </button>
        ))}
      </div>

      {band.once ? (
        <label className={styles.checkbox}>
          <input type="checkbox" checked={band.afterKnitting ?? false}
            onChange={(e) => store.update((p) => adjustBand(p, band.id, { afterKnitting: e.target.checked }))} />
          Duplicate stitch after knitting
        </label>
      ) : (
        <>
          <span className={styles.group}>Space between repeats</span>
          <span className={styles.direction} title="Side by side"><Icon name="spaceAcross" /></span>
          <SliderField label="Space between repeats, side by side" hideLabel value={band.gapX} max={Math.max(10, band.gapX)} format={(v) => `${v} ${v === 1 ? 'stitch' : 'stitches'}`}
            {...live(adjust((gapX) => ({ gapX })))} />
          {stacks && (
            <>
              <span className={styles.direction} title="Stacked"><Icon name="spaceUp" /></span>
              <SliderField label="Space between repeats, stacked" hideLabel value={band.gapY} max={Math.max(10, band.gapY)} format={(v) => `${v} ${v === 1 ? 'row' : 'rows'}`}
                {...live(adjust((gapY) => ({ gapY })))} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Actions({ band }: { band: Band }) {
  const store = useEditorStore()
  const project = useProject()
  const saveMotif = useSaveMotif()
  const [saved, setSaved] = useState(false)
  const { data: savedMotifs = [] } = useSavedMotifs()
  // The knitter's own motif it came from, if it's not behind the library's (changed from another chart since):
  // saved over, that would be lost, so a layer that's behind saves as a new motif instead.
  const mine = savedMotifs.find((m) => m.id === band.fromLibrary?.motifId)
  const own = mine && editedAt(mine) <= band.fromLibrary!.editedAt ? mine : undefined
  const set = (changes: Partial<Band>) => store.update((p) => adjustBand(p, band.id, changes))
  const span = bandSpan(band, project.outline.height)

  return (
    <div className={styles.actions}>
      <button type="button" onClick={() => set({ rotation: rotateClockwise(band.rotation) })}>
        <Icon name="rotate" /> Rotate
      </button>
      <button type="button" aria-pressed={band.mirror} onClick={() => set({ mirror: !band.mirror })}>
        <Icon name="mirror" /> Mirror
      </button>
      <button type="button" onClick={() => {
        const id = crypto.randomUUID()
        store.update((p) => duplicateBand(p, band.id, id, store.rowsForNewBand(span.bottom - span.top + 1)))
        store.selectLayer(id)
      }}>
        <Icon name="copy" /> Duplicate
      </button>
      <button type="button" disabled={saved} title={own ? `Update “${own.name}” in your motifs` : 'Save to your motifs'} onClick={() => {
        // Made from one of their own motifs, it's saved over that one (charts using it are offered the new version);
        // otherwise it's a new one.
        const now = Date.now()
        const motif = own
          ? { ...toSavedMotif(scaledMotif(band), project.background, own.id, own.name, own.savedAt, scaledStitches(band)), editedAt: now }
          : toSavedMotif(scaledMotif(band), project.background, crypto.randomUUID(), band.name, now, scaledStitches(band))
        saveMotif.mutate(motif, {
          onSuccess: () => {
            // The layer is now the library motif's: edits to it there are offered here.
            store.updateQuietly((p) => updateBand(p, band.id, { fromLibrary: { motifId: motif.id, editedAt: motif.editedAt ?? motif.savedAt } }))
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
          },
        })
      }}>
        <Icon name={saved ? 'check' : 'plus'} /> {saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}

/** The motif as it looks: transparent stitches show the background yarn. */
function onBackground(motif: Grid, background: number): Grid {
  return { ...motif, cells: motif.cells.map((c) => (c === NONE ? background : c)) }
}
