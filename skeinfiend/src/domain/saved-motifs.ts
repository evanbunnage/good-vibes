import { NONE, type Grid } from './grid'
import { KNIT } from './stitches'
import { uniqueName } from './names'

/**
 * A motif saved to the designer's library, for use in any project. Projects
 * have different yarns, so a saved motif doesn't store yarns: it stores
 * slots (the main color, then contrast colors 1, 2, and so on) and takes on
 * each project's yarns when it's used.
 */
export interface SavedMotif {
  readonly id: string
  readonly name: string
  /** `NONE` is transparent, `MAIN` the main color, and 0, 1, … the contrast colors in order. */
  readonly grid: Grid
  /**
   * How each stitch is worked (a `StitchType` code: purl, twisted…), the
   * grid's size, when any isn't knit. Motifs saved before stitches were
   * kept have none: they're all knit.
   */
  readonly stitches?: Grid
  readonly savedAt: number
  /** When it was last edited in the library, if it has been since it was saved. */
  readonly editedAt?: number
}

/** When a saved motif last changed: charts made from an earlier version can take this one. */
export const editedAt = (motif: SavedMotif): number => motif.editedAt ?? motif.savedAt

export const MAIN = 254

/** A band's motif as slots (its contrast yarns in palette order, and the main color), with its stitches, if any aren't knit. */
export function toSavedMotif(motif: Grid, background: number, id: string, name: string, now: number, stitches: Grid | null = null): SavedMotif {
  const contrasts = [...new Set(motif.cells)].filter((c) => c !== NONE && c !== background).sort((a, b) => a - b)
  const slot = (cell: number) => (cell === NONE ? NONE : cell === background ? MAIN : contrasts.indexOf(cell))
  const worked = stitches && stitches.width === motif.width && stitches.height === motif.height && stitches.cells.some((c) => c !== KNIT)
  return { id, name, grid: { ...motif, cells: motif.cells.map(slot) }, ...(worked && { stitches }), savedAt: now }
}

/** Whether two saves of a motif are drawn the same: colors and stitches. */
export function sameDrawing(a: Pick<SavedMotif, 'grid' | 'stitches'>, b: Pick<SavedMotif, 'grid' | 'stitches'>): boolean {
  const same = (x: Grid | undefined, y: Grid | undefined) =>
    x === y || (!!x && !!y && x.width === y.width && x.height === y.height && x.cells.every((c, i) => c === y.cells[i]))
  return same(a.grid, b.grid) && same(a.stitches, b.stitches)
}

/**
 * The saved motif in a project's yarns. The first contrast color is `first`
 * (the yarn being painted with), the rest follow in palette order, and they
 * repeat if the motif has more contrast colors than the project has yarns.
 */
export function motifInYarns(saved: Grid, yarnCount: number, background: number, first: number): Grid {
  const others = Array.from({ length: yarnCount }, (_, i) => i).filter((i) => i !== background && i !== first)
  const contrasts = first === background ? others : [first, ...others]
  const yarn = (cell: number) =>
    cell === NONE ? NONE : cell === MAIN || contrasts.length === 0 ? background : contrasts[cell % contrasts.length]!
  return { ...saved, cells: saved.cells.map(yarn) }
}

/**
 * A name no other motif in the library has, SkeinFiend's own included:
 * "Snowflake", or "Snowflake 2" if that's taken. A motif keeps its own name.
 */
export function uniqueMotifName(motif: Pick<SavedMotif, 'id' | 'name'>, saved: readonly SavedMotif[], builtInNames: readonly string[]): string {
  return uniqueName(motif.name, [...builtInNames, ...saved.filter((m) => m.id !== motif.id).map((m) => m.name)], 'Colorwork motif')
}

