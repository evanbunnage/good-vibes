import { rowsPerCm, stitchesPerCm, type Gauge } from './gauge'
import type { Measurement, PieceTemplate, SchematicPiece } from './pieces'

/**
 * Published patterns, charted from their own numbers, for tests: the app has
 * to write their instructions as the designers did, line for line. (They
 * used to be starting shapes in the app; charts from patterns now come from
 * the knitter's agent reading the pattern.)
 */

const CLAYOQUOT_GAUGE: Gauge = { stitches: 22, rows: 28, over: 4 * 2.54 }
const FLAX_GAUGE: Gauge = { stitches: 18, rows: 24, over: 4 * 2.54 }

/** Lengths from a pattern's own counts at its gauge, so they come out exact when built at it. */
function counted(gauge: Gauge) {
  return { sts: (n: number) => n / stitchesPerCm(gauge), rows: (n: number) => n / rowsPerCm(gauge) }
}


const measurement = (id: string, name: string, height: number, width: number): Measurement => ({ id, name, height, width })

const PUBLISHED: readonly PieceTemplate[] = [
  {
    // Tin Can Knits' Clayoquot Toque, size Adult M, from the free pattern:
    // cast on 108, 1.25" of 2x2 rib, increase to 116 for the colorwork (a
    // 4-stitch repeat), straight to 6", then the crown decreased in 8 sections.
    id: 'hat',
    name: 'Clayoquot Toque',
    construction: 'round',
    builtIn: true,
    gauge: CLAYOQUOT_GAUGE,
    credit: { designer: 'Tin Can Knits', pattern: 'Clayoquot Toque', size: 'Adult M', url: 'https://www.ravelry.com/patterns/library/clayoquot-toque' },
    spec: (() => {
      const { sts, rows } = counted(CLAYOQUOT_GAUGE)
      return {
        kind: 'schematic',
        measurements: [
          measurement('brim', 'Brim', 0, sts(108)),
          measurement('rib', 'Top of rib', rows(8), sts(108)),
          measurement('body', 'Body', rows(9), sts(116)),
          measurement('crown-start', 'Start of crown', rows(41), sts(116)),
          measurement('crown-set-up', 'Crown set-up', rows(42), sts(112)),
          measurement('crown', 'Crown', rows(58), sts(48)),
          measurement('crown-top', 'Crown top', rows(62), sts(16)),
          measurement('top', 'Top', rows(64), sts(8)),
        ],
        openings: [],
        sections: [{ id: 'brim-rib', name: 'Brim rib', stitch: 'rib', bottom: 0, height: rows(9) }],
        multiple: 4,
      } satisfies SchematicPiece
    })(),
  },
  {
    // Tin Can Knits' Flax, size M (38" chest), from the free pattern: top down
    // in the round from a ribbed neck, raglan increases to the underarm, the
    // sleeves put on hold, then the body straight to a ribbed hem. (The
    // sleeves are knit afterwards from the held stitches.)
    id: 'sweater',
    name: 'Flax Sweater',
    construction: 'round',
    builtIn: true,
    gauge: FLAX_GAUGE,
    credit: { designer: 'Tin Can Knits', pattern: 'Flax', size: 'M', url: 'https://www.ravelry.com/patterns/library/flax' },
    spec: (() => {
      const { sts, rows } = counted(FLAX_GAUGE)
      return {
        kind: 'schematic',
        measurements: [
          measurement('neck', 'Neck', 0, sts(90)),
          measurement('neck-rib', 'Top of neck rib', rows(7), sts(90)),
          measurement('yoke', 'Yoke', rows(8), sts(120)),
          measurement('raglan', 'End of raglan', rows(40), sts(248)),
          measurement('underarm', 'Underarm', rows(58), sts(248)),
          { ...measurement('body', 'Body', rows(59), sts(172)), hold: true },
          measurement('hem-rib', 'Hem rib', rows(142), sts(172)),
          measurement('hem', 'Hem', rows(155), sts(172)),
        ],
        openings: [],
        sections: [
          { id: 'neck-rib', name: 'Neck rib', stitch: 'rib', bottom: 0, height: rows(8) },
          { id: 'hem-rib', name: 'Hem rib', stitch: 'rib', bottom: rows(143), height: rows(12) },
        ],
        multiple: 2,
      } satisfies SchematicPiece
    })(),
  },
  {
    // CalicoRadio Knits' Edinburgh Seamless Dog Sweater, size S, from the free
    // pattern: worked from the neck in the round, raglan increases to the chest,
    // bound-off-and-cast-on arm holes and a harness hole, then the belly bound
    // off and the back worked flat to the tail. Stitch counts at 18 sts in 10 cm:
    // 48 at the neck, 72 at the chest, 52 after the belly, 28 at the tail.
    id: 'dog-sweater',
    name: 'Edinburgh Dog Sweater',
    construction: 'round',
    builtIn: true,
    gauge: { stitches: 18, rows: 24 },
    credit: {
      designer: 'CalicoRadio Knits',
      pattern: 'Edinburgh Seamless Dog Sweater',
      size: 'S',
      url: 'https://www.ravelry.com/patterns/library/edinburgh-seamless-dog-sweater',
    },
    spec: {
      kind: 'schematic',
      measurements: [
        measurement('neck', 'Neck', 0, 26.7),
        measurement('neck-rib', 'Top of neck rib', 4.2, 26.7),
        measurement('chest', 'Chest', 14.2, 40),
        measurement('belly', 'Belly bind-off', 28.8, 40),
        measurement('back', 'Back', 28.8, 28.9),
        measurement('tail', 'Tail', 38.8, 15.6),
        measurement('end', 'End', 41.3, 15.6),
      ],
      openings: [
        // Bound off one round and cast on again the next: slits, so the round isn't broken.
        { id: 'arms', name: 'Arm holes', shape: 'rectangle', bottom: 14.2, height: 0.4, width: 6.7, offset: 14.4, pair: true },
        { id: 'harness', name: 'Harness hole', shape: 'rectangle', bottom: 15.4, height: 0.4, width: 2.2, offset: 0, pair: false },
      ],
      sections: [
        { id: 'neck-rib', name: 'Neck rib', stitch: 'rib', bottom: 0, height: 4.2 },
        { id: 'tail-rib', name: 'Tail rib', stitch: 'rib', bottom: 38.8, height: 2.5 },
      ],
      multiple: 2,
    },
  },
]

export function publishedPattern(id: 'hat' | 'sweater' | 'dog-sweater'): PieceTemplate {
  return PUBLISHED.find((t) => t.id === id)!
}
