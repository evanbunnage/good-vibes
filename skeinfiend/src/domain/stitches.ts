/**
 * The stitches a chart can show, beyond plain knit: purl, twisted stitches,
 * increases and decreases, slips, bobbles. What each one is, not how a given
 * book draws it: every pattern prints its own key, so a chart's symbols are
 * matched to these (by the knitter's agent, reading the key), the way its
 * colors are matched to yarns. They're drawn in the Craft Yarn Council's
 * style, with the dash for purl that Vogue Knitting uses.
 *
 * A stitch is a number, so a layer keeps them in a grid like its colors. Knit
 * is 0, so an empty grid is all knit.
 */
export interface StitchType {
  readonly code: number
  /** How it's named: in a chart key, the stitch palette, and to the agent. */
  readonly id: string
  readonly name: string
  /** How it's written, worked on the right side and on the wrong side: "k1 tbl" and "p1 tbl". */
  readonly rs: string
  readonly ws: string
  /** Its symbol, drawn in a 24 × 24 box: strokes, or a filled shape. */
  readonly symbol: { readonly path: string; readonly fill?: boolean }
  /** Not a stitch at all: a place in the chart where the row has fewer stitches. */
  readonly none?: boolean
}

export const KNIT = 0
export const PURL = 1
export const NO_STITCH = 10
export const K2TOG = 4
export const SSK = 5
export const M1L = 11
export const M1R = 12

export const STITCHES: readonly StitchType[] = [
  { code: KNIT, id: 'knit', name: 'Knit', rs: 'k', ws: 'p', symbol: { path: '' } },
  { code: PURL, id: 'purl', name: 'Purl', rs: 'p', ws: 'k', symbol: { path: 'M6.5 12h11' } },
  // A twisted stitch: a loop crossed at its foot, as Vogue Knitting draws it.
  { code: 2, id: 'k1 tbl', name: 'Knit through the back loop', rs: 'k1 tbl', ws: 'p1 tbl', symbol: { path: 'M8.5 18.5c3-3 5.5-6 5.5-9.5a2 2 0 0 0-4 0c0 3.5 2.5 6.5 5.5 9.5' } },
  { code: 3, id: 'yo', name: 'Yarn over', rs: 'yo', ws: 'yo', symbol: { path: 'M12 7a5 5 0 1 1 0 10a5 5 0 1 1 0-10z' } },
  { code: 4, id: 'k2tog', name: 'Knit two together', rs: 'k2tog', ws: 'p2tog', symbol: { path: 'M6.5 17.5L17.5 6.5' } },
  { code: 5, id: 'ssk', name: 'Slip, slip, knit', rs: 'ssk', ws: 'ssp', symbol: { path: 'M6.5 6.5l11 11' } },
  { code: 6, id: 'M1', name: 'Make one', rs: 'M1', ws: 'M1P', symbol: { path: 'M7.5 17V7l4.5 6 4.5-6v10' } },
  { code: 7, id: 'M1 p-st', name: 'Make one purl stitch', rs: 'M1 p-st', ws: 'M1', symbol: { path: 'M8.5 17V7h4.5a3 3 0 0 1 0 6H8.5' } },
  { code: 8, id: 'sl', name: 'Slip', rs: 'sl 1 wyib', ws: 'sl 1 wyif', symbol: { path: 'M7.5 7.5l4.5 9 4.5-9' } },
  { code: 9, id: 'bobble', name: 'Bobble', rs: 'MB', ws: 'MB', symbol: { path: 'M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8z', fill: true } },
  { code: NO_STITCH, id: 'no stitch', name: 'No stitch', rs: '', ws: '', symbol: { path: '' }, none: true },
  // Leaning increases, as shaping uses them: an M with an arrow the way it leans.
  { code: M1L, id: 'M1L', name: 'Make one left', rs: 'M1L', ws: 'M1LP', symbol: { path: 'M7.5 15V6.5l4.5 5 4.5-5V15 M5 19h14 M5 19l2.5-2.5 M5 19l2.5 2.5' } },
  { code: M1R, id: 'M1R', name: 'Make one right', rs: 'M1R', ws: 'M1RP', symbol: { path: 'M7.5 15V6.5l4.5 5 4.5-5V15 M5 19h14 M19 19l-2.5-2.5 M19 19l-2.5 2.5' } },
]

export function stitchType(code: number): StitchType {
  return STITCHES.find((s) => s.code === code) ?? STITCHES[0]!
}

/** A stitch from how a chart key or the agent names it: "k1 tbl", "k2tog", "purl", "M1 p-st". */
export function stitchNamed(name: string): StitchType | undefined {
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = plain(name)
  const aliases: Record<string, string> = { p: 'purl', k: 'knit', ktbl: 'k1 tbl', k1b: 'k1 tbl', m1p: 'M1 p-st', m1pst: 'M1 p-st', m1purl: 'M1 p-st', slip: 'sl', sl1: 'sl', mb: 'bobble', nostitch: 'no stitch' }
  const id = aliases[wanted] ?? name
  return STITCHES.find((s) => plain(s.id) === plain(id) || plain(s.name) === plain(id))
}

/** How a stitch is worked: from the right side as charted, from the wrong side as its reverse. */
export function workedAs(code: number, rightSide: boolean): string {
  const stitch = stitchType(code)
  return rightSide ? stitch.rs : stitch.ws
}
