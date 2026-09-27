import { centeredOffset, createBand } from './bands'
import { MOTIF_LIBRARY } from './motifs'
import { yForRow } from './numbering'
import { createProject, type Project } from './project'
import type { PieceTemplate } from './pieces'

/**
 * A finished-looking hat for first-time visitors: a band of snowflakes above
 * the brim and a peerie band above that, in the traditional natural, indigo,
 * and madder palette. It's also a design that knits well: no long floats.
 */
/** A plain hat of its own, so the example stays as designed whatever the starting shapes become. */
const EXAMPLE_HAT: PieceTemplate = {
  id: 'example-hat',
  name: 'Hat',
  construction: 'round',
  spec: {
    kind: 'schematic',
    measurements: [
      { id: 'brim', name: 'Brim', height: 0, width: 52 },
      { id: 'crown-start', name: 'Start of crown', height: 16, width: 52 },
      { id: 'crown', name: 'Crown', height: 22, width: 4 },
    ],
    openings: [],
    multiple: 8,
  },
}

export function createExampleProject(id: string, now: number): Project {
  const base = createProject({ id, name: 'Snowflake hat', template: EXAMPLE_HAT, now })
  const [natural, , madder, indigo] = [0, 1, 2, 3]
  const library = (motifId: string) => MOTIF_LIBRARY.find((m) => m.id === motifId)!
  const { height, width } = base.outline

  // Rows are given in knitting rows (1 = brim) and converted to chart rows.
  const rows = (from: number, to: number) => ({ top: yForRow(to, height), bottom: yForRow(from, height) })
  const snowflake = library('snowflake').build(indigo)

  return {
    ...base,
    background: natural,
    bands: [
      { ...createBand('snowflakes', 'Snowflake', snowflake, rows(8, 16)), offsetX: centeredOffset(width, snowflake.width, 0) },
      { ...createBand('peeries', 'Peerie', library('peerie').build(madder), rows(25, 27)), gapX: 1 },
    ],
  }
}
