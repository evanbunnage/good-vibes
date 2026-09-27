import type { Gauge } from '@/domain/gauge'
import { NumberField } from '@/ui/NumberField'
import { fromUnits, toUnits, unitStep, useUnits } from './units'
import styles from './gauge-fields.module.css'

/**
 * Setting the gauge, as a knitter says it: "28 stitches and 32 rows in 10 cm",
 * every number editable, the length included (4 in, say, or however far the
 * swatch was measured). `onPreview` (optional) shows a change live while
 * scrubbing; `onChange` commits it.
 */
export function GaugeFields({ gauge, onChange, onPreview, onPreviewEnd }: {
  gauge: Gauge
  onChange: (gauge: Gauge) => void
  onPreview?: (gauge: Gauge) => void
  onPreviewEnd?: () => void
}) {
  const units = useUnits()
  const over = gauge.over ?? 10
  const live = (change: (value: number) => Partial<Gauge>) => ({
    onChange: (value: number) => onChange({ ...gauge, ...change(value) }),
    onPreview: onPreview && ((value: number) => onPreview({ ...gauge, ...change(value) })),
    onPreviewEnd,
  })
  const step = unitStep(units)
  return (
    <div className={styles.gauge}>
      <NumberField label="Stitches" hideLabel compact value={gauge.stitches} min={1} max={200} step={0.5} {...live((stitches) => ({ stitches }))} />
      <span>sts and</span>
      <NumberField label="Rows" hideLabel compact value={gauge.rows} min={1} max={200} step={0.5} {...live((rows) => ({ rows }))} />
      <span>rows in</span>
      <NumberField key={units} label={`Measured over, in ${units}`} hideLabel compact step={step} min={step} max={units === 'in' ? 12 : 30}
        value={Math.round(toUnits(over, units) / step) * step} {...live((value) => ({ over: fromUnits(value, units) }))} />
      <span>{units}</span>
    </div>
  )
}
