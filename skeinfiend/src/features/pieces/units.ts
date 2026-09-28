import { CM_PER_INCH, type Units } from '@/domain/gauge'
import { createPreference } from '@/ui/preference'

/**
 * Centimeters or inches, remembered in this browser. Everything is stored in
 * centimeters; this only changes what's shown and typed.
 */
const units = createPreference<Units>('skeinfiend.units', 'cm')

export const useUnits = units.use
export const getUnits = units.get
export const setUnits = units.set

export const toUnits = (cm: number, unit: Units) => (unit === 'in' ? cm / CM_PER_INCH : cm)
export const fromUnits = (value: number, unit: Units) => (unit === 'in' ? value * CM_PER_INCH : value)
/** Half centimeters, or quarter inches: as fine as anyone measures a garment. */
export const unitStep = (unit: Units) => (unit === 'in' ? 0.25 : 0.5)
