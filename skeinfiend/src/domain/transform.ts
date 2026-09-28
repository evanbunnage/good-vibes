import { createGrid, type Grid } from './grid'

export type Rotation = 0 | 90 | 180 | 270

export interface Orientation {
  readonly rotation: Rotation
  /** Mirror left to right, applied before rotating. */
  readonly mirror: boolean
}

/** Returns the grid mirrored and then rotated clockwise. */
export function orient(grid: Grid, { rotation, mirror }: Orientation): Grid {
  if (rotation === 0 && !mirror) return grid
  const { width: w, height: h } = grid
  const turned = rotation === 90 || rotation === 270
  const out = createGrid(turned ? h : w, turned ? w : h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = mirror ? w - 1 - x : x
      let ox: number
      let oy: number
      switch (rotation) {
        case 0: [ox, oy] = [x, y]; break
        case 90: [ox, oy] = [h - 1 - y, x]; break
        case 180: [ox, oy] = [w - 1 - x, h - 1 - y]; break
        case 270: [ox, oy] = [y, w - 1 - x]; break
      }
      out.cells[oy * out.width + ox] = grid.cells[y * w + sx]!
    }
  }
  return out
}

/**
 * The inverse of `orient` for one point: given a cell in the oriented grid,
 * the cell of the original grid (`width` × `height`) it came from.
 */
export function sourcePoint(ox: number, oy: number, width: number, height: number, { rotation, mirror }: Orientation): { x: number; y: number } {
  let x: number
  let y: number
  switch (rotation) {
    case 0: [x, y] = [ox, oy]; break
    case 90: [x, y] = [oy, height - 1 - ox]; break
    case 180: [x, y] = [width - 1 - ox, height - 1 - oy]; break
    case 270: [x, y] = [width - 1 - oy, ox]; break
  }
  return { x: mirror ? width - 1 - x : x, y }
}

export function rotateClockwise(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation
}
