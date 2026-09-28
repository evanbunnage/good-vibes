import type { RowIssue } from '@/domain/floats'
import { stitchesPerCm, type Gauge, type Units } from '@/domain/gauge'

/**
 * A row's long floats, per yarn, with how long they are, in stitches and as a
 * length: "Natural float: 7 sts (3 cm)"; "3 Madder floats: 8–12 sts (3–4 cm)".
 */
export function describeRow(issues: readonly RowIssue[], yarns: ReadonlyArray<{ name: string }>, gauge: Gauge, units: Units): string {
  const byYarn = new Map<number, number[]>()
  for (const issue of issues) byYarn.set(issue.yarn, [...(byYarn.get(issue.yarn) ?? []), issue.length])
  const length = (stitches: number) => {
    const cm = stitches / stitchesPerCm(gauge)
    // Whole centimeters; inches to the half.
    return units === 'in' ? Math.round((cm / 2.54) * 2) / 2 : Math.round(cm)
  }
  return [...byYarn].map(([yarn, lengths]) => {
    const [shortest, longest] = [Math.min(...lengths), Math.max(...lengths)]
    const name = yarns[yarn]?.name ?? 'yarn'
    const who = lengths.length === 1 ? `${name} float` : `${lengths.length} ${name} floats`
    const sts = shortest === longest ? `${longest} sts` : `${shortest}–${longest} sts`
    const size = length(shortest) === length(longest) ? `${length(longest)} ${units}` : `${length(shortest)}–${length(longest)} ${units}`
    return `${who}: ${sts} (${size})`
  }).join('; ')
}
