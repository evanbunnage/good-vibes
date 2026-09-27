/**
 * A rectangular grid of stitches. Cells hold a palette index, or `NONE`.
 *
 * Coordinates are screen coordinates: x runs left to right, y top to bottom.
 * Knitting conventions (row 1 at the bottom, stitch 1 at the right) are a
 * presentation concern, handled in `numbering.ts`.
 *
 * Grids are treated as immutable values. Functions that "change" a grid return
 * a new one; callers that need speed (a paint stroke) copy once, mutate the
 * copy, then publish it.
 */
export interface Grid {
  readonly width: number
  readonly height: number
  readonly cells: Uint8Array
}

/** No stitch or no color: outside the outline, or a transparent motif cell. */
export const NONE = 255

/** Big enough for an adult yoke in fine yarn, charted all the way around. */
export const MAX_SIZE = 800

export function createGrid(width: number, height: number, fill = NONE): Grid {
  assertSize(width, height)
  return { width, height, cells: new Uint8Array(width * height).fill(fill) }
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height
}

export function getCell(grid: Grid, x: number, y: number): number {
  return inBounds(grid, x, y) ? grid.cells[y * grid.width + x]! : NONE
}

export function cloneGrid(grid: Grid): Grid {
  return { width: grid.width, height: grid.height, cells: grid.cells.slice() }
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false
  return true
}

/**
 * Resizes around the bottom-right corner, where knitting charts start, so
 * existing work keeps its row and stitch numbers.
 */
export function resizeGrid(grid: Grid, width: number, height: number, fill = NONE): Grid {
  const next = createGrid(width, height, fill)
  const dx = width - grid.width
  const dy = height - grid.height
  for (let y = 0; y < grid.height; y++) {
    const ny = y + dy
    if (ny < 0 || ny >= height) continue
    for (let x = 0; x < grid.width; x++) {
      const nx = x + dx
      if (nx < 0 || nx >= width) continue
      next.cells[ny * width + nx] = grid.cells[y * grid.width + x]!
    }
  }
  return next
}

/** Parses rows of characters, top row first, using `legend` to map characters to cells. */
export function gridFromRows(rows: readonly string[], legend: Readonly<Record<string, number>>): Grid {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const grid = createGrid(width, height)
  rows.forEach((row, y) => {
    if (row.length !== width) throw new RangeError(`Row ${y} has ${row.length} cells, expected ${width}`)
    for (let x = 0; x < width; x++) {
      const value = legend[row[x]!]
      if (value === undefined) throw new RangeError(`No legend entry for "${row[x]}"`)
      grid.cells[y * width + x] = value
    }
  })
  return grid
}

function assertSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid grid size ${width}×${height}`)
  }
  if (width > MAX_SIZE || height > MAX_SIZE) {
    throw new RangeError(`Grids are limited to ${MAX_SIZE}×${MAX_SIZE}`)
  }
}
