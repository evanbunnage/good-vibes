import { schematicOf, setSchematic } from '@/domain/edits'
import type { Units } from '@/domain/gauge'
import type { Construction, Measurement, SchematicPiece } from '@/domain/pieces'
import type { Project } from '@/domain/project'
import { fromUnits, toUnits, unitStep, useUnits } from '@/features/pieces/units'
import { NumberField } from '@/ui/NumberField'
import { useEditorStore } from './editor-context'

/** A change to one of the piece's measurements (a width and the height it's reached at). */
export const updateMeasurement = (id: string, changes: Partial<Measurement>) => (s: SchematicPiece): SchematicPiece => ({
  ...s,
  measurements: s.measurements.map((m) => (m.id === id ? { ...m, ...changes } : m)),
})

/** Rounds centimeters to the nearest step of the chosen units: half centimeters, or quarter inches. */
export function roundLength(cm: number, units: Units): number {
  const step = unitStep(units)
  return fromUnits(Math.round(toUnits(cm, units) / step) * step, units)
}

/** A length field in the chosen units, storing centimeters: previewed while scrubbing, committed as one step. */
export function LengthField({ label, cm, min = 0, change }: { label: string; cm: number; min?: number; change: (cm: number) => (s: SchematicPiece) => SchematicPiece }) {
  const store = useEditorStore()
  const units = useUnits()
  const step = unitStep(units)
  const round = (n: number) => Math.round(n / step) * step
  const edit = (value: number) => (p: Project) => setSchematic(p, change(fromUnits(value, units))(schematicOf(p)))
  return (
    <NumberField key={units} label={label} hideLabel compact step={step} min={round(toUnits(min, units))} max={round(toUnits(400, units))}
      value={round(toUnits(cm, units))}
      onPreview={(value) => store.preview(edit(value))} onChange={(value) => store.update(edit(value))} onPreviewEnd={() => store.cancelPreview()} />
  )
}

/** What a measurement is called: how far around, in the round; how wide, flat. */
export function measurementWord(construction: Construction): 'Circumference' | 'Width' {
  return construction === 'round' ? 'Circumference' : 'Width'
}
