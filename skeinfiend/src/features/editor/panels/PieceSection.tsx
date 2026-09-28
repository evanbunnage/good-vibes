import { schematicOf, setConstruction, setGauge } from '@/domain/edits'
import type { Gauge } from '@/domain/gauge'
import { possessive, type SchematicPiece } from '@/domain/pieces'
import type { Project } from '@/domain/project'
import { GaugeFields } from '@/features/pieces/GaugeFields'
import { setUnits, useUnits } from '@/features/pieces/units'
import { LengthField, measurementWord } from '../measurements'
import ui from '@/ui/ui.module.css'
import { useEditorStore, useProject } from '../editor-context'
import { Section } from './Section'
import styles from './panels.module.css'

/**
 * What the colorwork goes on: the gauge, and the piece's size. A knitter's
 * own design is a plain piece, set by its width and height; one from someone's
 * pattern keeps the pattern's shape (read from it by their agent), credited.
 */
export function PieceSection() {
  const store = useEditorStore()
  const project = useProject()
  const units = useUnits()
  const schematic = schematicOf(project)
  const plain = isPlain(schematic) && project.piece.kind === 'schematic'
  const { width, height } = project.outline
  const edit = (gauge: Gauge) => (p: Project) => setGauge(p, gauge)
  const { credit } = project.piece
  return (
    // Folded away: set once, when the chart's started, and a click away after that.
    <Section title="Gauge & size" defaultOpen={false}>
      <GaugeFields gauge={project.gauge} onPreview={(gauge) => store.preview(edit(gauge))}
        onChange={(gauge) => store.update(edit(gauge))} onPreviewEnd={() => store.cancelPreview()} />
      <div className={styles.pieceRow}>
        <span>Worked</span>
        <div className={ui.segmented} role="group" aria-label="Worked">
          {(['flat', 'round'] as const).map((c) => (
            <button type="button" key={c} aria-pressed={project.construction === c} onClick={() => store.update((p) => setConstruction(p, c))}>
              {c === 'flat' ? 'Flat' : 'In the round'}
            </button>
          ))}
        </div>
      </div>
      {plain ? (
        <>
          <div className={styles.pieceRow}>
            <span>{measurementWord(project.construction)}</span>
            <LengthField label={measurementWord(project.construction)} cm={schematic.measurements[0]!.width} min={1}
              change={(cm) => (s) => ({ ...s, measurements: s.measurements.map((m) => ({ ...m, width: cm })) })} />
          </div>
          <div className={styles.pieceRow}>
            <span>Height</span>
            <LengthField label="Height" cm={topOf(schematic).height} min={0.5}
              change={(cm) => (s) => ({ ...s, measurements: s.measurements.map((m) => (m.id === topOf(s).id ? { ...m, height: cm } : m)) })} />
          </div>
        </>
      ) : null}
      <p className={styles.pieceSize}>
        {width} sts × {height} rows
        {credit && <> · from <a href={credit.url} target="_blank" rel="noreferrer">{possessive(credit.designer)} {credit.pattern} ↗</a></>}
      </p>
      <div className={styles.pieceRow}>
        <span>Measure in</span>
        <div className={ui.segmented} role="group" aria-label="Units">
          {(['cm', 'in'] as const).map((u) => (
            <button type="button" key={u} aria-pressed={units === u} onClick={() => setUnits(u)}>{u === 'cm' ? 'cm' : 'in'}</button>
          ))}
        </div>
      </div>
    </Section>
  )
}

/** A plain piece: straight up from its cast-on, nothing cut into it. What a width and a height describe. */
function isPlain(schematic: SchematicPiece): boolean {
  const [a, b] = schematic.measurements
  return schematic.measurements.length === 2 && a!.width === b!.width && !schematic.openings.length && !schematic.sections?.length
}

function topOf(schematic: SchematicPiece) {
  return schematic.measurements.reduce((top, m) => (m.height > top.height ? m : top))
}
