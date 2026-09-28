import { gridFromRows, NONE, type Grid } from './grid'

/**
 * Classic stranded colorwork motifs. `X` is the contrast color and `.` is
 * transparent, so a motif sits on whatever background yarn is underneath.
 */
const LIBRARY: ReadonlyArray<{ id: string; name: string; rows: string[]; spacing?: number }> = [
  {
    id: 'peerie',
    name: 'Peerie',
    rows: ['.X.', 'X.X', '.X.'],
  },
  {
    id: 'lice',
    name: 'Lice',
    rows: ['X...', '....', '..X.', '....'],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    rows: ['...X...', '..X.X..', '.X...X.', 'X.....X', '.X...X.', '..X.X..', '...X...'],
  },
  {
    id: 'star',
    name: 'Eight-point star',
    spacing: 1,
    rows: [
      'X.....X.....X',
      '.X....X....X.',
      '..X..XXX..X..',
      '...XXX.XXX...',
      '..XX.....XX..',
      '..X.......X..',
      'XXX.......XXX',
      '..X.......X..',
      '..XX.....XX..',
      '...XXX.XXX...',
      '..X..XXX..X..',
      '.X....X....X.',
      'X.....X.....X',
    ],
  },
  {
    // Balanced so neither color floats more than 5 stitches when tiled edge to edge.
    id: 'snowflake',
    name: 'Snowflake',
    rows: [
      'X...X...X',
      '.X..X..X.',
      '..X.X.X..',
      'X..XXX..X',
      '.XXX.XXX.',
      'X..XXX..X',
      '..X.X.X..',
      '.X..X..X.',
      'X...X...X',
    ],
  },
  {
    id: 'heart',
    name: 'Heart',
    // Solid across its middle, so repeats need a stitch between them to read as hearts.
    spacing: 1,
    rows: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  },
  {
    id: 'zigzag',
    name: 'Zigzag',
    rows: ['X...X...', '.X.X.X.X', '..X...X.'],
  },
]

export interface LibraryMotif {
  readonly id: string
  readonly name: string
  /** Builds the motif using `yarn` for its colored stitches. */
  readonly build: (yarn: number) => Grid
  /** Stitches between repeats: 0 for motifs designed to tile edge to edge. */
  readonly spacing: number
}

export const MOTIF_LIBRARY: readonly LibraryMotif[] = LIBRARY.map(({ id, name, rows, spacing = 0 }) => ({
  id,
  name,
  spacing,
  build: (yarn: number) => gridFromRows(rows, { X: yarn, '.': NONE }),
}))
