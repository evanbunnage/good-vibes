import { describe, expect, it } from 'vitest'
import { patternSteps, rowsWorked } from './instructions'
import { isRightSide, readsRightToLeft } from './numbering'
import type { SchematicPiece } from './pieces'
import { publishedPattern } from './published-patterns.fixture'

// A seamless dog sweater, neck to tail, at 18 stitches and 24 rows over 10 cm:
// rib at the neck, raglan increases to the chest, arm holes, a straight
// midsection, the belly bound off, then the back worked flat down to the tail.
const gauge = { stitches: 18, rows: 24 }
const cm = (stitches: number) => Math.round((stitches / 1.8) * 10) / 10
const sweater: SchematicPiece = {
  kind: 'schematic',
  multiple: 1,
  measurements: [
    { id: 'neck', name: 'Neck', height: 0, width: cm(48) },
    { id: 'neck-rib', name: 'Top of neck rib', height: 4, width: cm(48) },
    { id: 'chest', name: 'Chest', height: 14, width: cm(72) },
    { id: 'waist', name: 'Waist', height: 28.5, width: cm(72) },
    { id: 'back', name: 'Back', height: 28.5, width: cm(52) },
    { id: 'tail', name: 'Tail', height: 38.5, width: cm(28) },
    { id: 'end', name: 'End', height: 41, width: cm(28) },
  ],
  openings: [{ id: 'arms', name: 'Arm holes', shape: 'rectangle', bottom: 14, height: 0.5, width: cm(12), offset: cm(26), pair: true }],
  sections: [{ id: 'neck-ribbing', name: 'Neck rib', stitch: 'rib', bottom: 0, height: 4 }],
}

describe('pattern instructions', () => {
  it('writes the piece out in the order it is knitted, turning to rows where binding off opens the round', () => {
    const steps = patternSteps(sweater, gauge, 'round')
    expect(steps.map((s) => `${s.where} · ${s.title}: ${s.text}`)).toEqual([
      'Round 1 · Cast on: Cast on 48 stitches and join to work in the round.',
      'Rounds 1–10 · Neck rib: Work in K1, P1 rib.',
      'Rounds 12–35 · Top of neck rib to Chest: Increase 1 stitch at each end of the round every other round, 12 times.',
      'Rounds 35–36 · Arm holes: Bind off 12 stitches for each. On round 36, cast on 12 stitches over each gap.',
      'Row 69 · Waist to Back: Bind off 20 stitches (10 stitches at each edge).',
      'Row 69 · Worked flat: Turn at the gap and work back and forth in rows, starting with a right-side row.',
      'Rows 70–93 · Back to Tail: Decrease 1 stitch at each edge every other row, 12 times.',
      'Row 98 · Bind off: Bind off the remaining 28 stitches.',
    ])
  })

  it('works out which rows are flat from the gaps in them', () => {
    const tube = (openings: SchematicPiece['openings']): SchematicPiece => ({
      kind: 'schematic', multiple: 1, openings,
      measurements: [{ id: 'a', name: 'A', height: 0, width: 40 }, { id: 'b', name: 'B', height: 20, width: 40 }],
    })
    // Each stretch of rows worked the same way, in order up the piece.
    const works = (piece: SchematicPiece, construction: 'round' | 'flat' = 'round') =>
      rowsWorked(piece, gauge, construction).map((r) => r.work).filter((w, i, all) => w !== all[i - 1])
    const hole = { id: 'h', name: 'Hole', shape: 'rectangle' as const, bottom: 5, height: 5, width: 4, offset: 0, pair: false }
    // A slit (one row) doesn't break the round.
    expect(works(tube([{ ...hole, height: 0.4 }]))).toEqual(['round'])
    // A taller opening is worked flat, then back in the round once it closes.
    expect(works(tube([hole]))).toEqual(['round', 'flat', 'round'])
    const flatRows = rowsWorked(tube([hole]), gauge, 'round').filter((r) => r.work === 'flat')
    expect(new Set(flatRows.map((r) => r.since)).size).toBe(1)
    // A pair is worked flat too; a steek keeps it in the round.
    expect(works(tube([{ ...hole, offset: 8, pair: true }]))).toEqual(['round', 'flat', 'round'])
    expect(works(tube([{ ...hole, steek: true }]))).toEqual(['round'])
    // Worked flat, it's flat throughout.
    expect(works(tube([{ ...hole, bottom: 15, height: 10 }]), 'flat')).toEqual(['flat'])
  })

  it('writes a steeked opening as a steek, and says where it turns flat and joins again', () => {
    const piece: SchematicPiece = {
      kind: 'schematic', multiple: 1,
      measurements: [{ id: 'a', name: 'A', height: 0, width: 40 }, { id: 'b', name: 'B', height: 20, width: 40 }],
      openings: [{ id: 'h', name: 'Armhole', shape: 'rectangle', bottom: 5, height: 5, width: 4, offset: 8, pair: true }],
    }
    const text = (p: SchematicPiece) => patternSteps(p, gauge, 'round').map((s) => `${s.title}: ${s.text}`)
    expect(text(piece)).toContain('Worked flat: Turn at the gap and work back and forth in rows, starting with a right-side row.')
    expect(text(piece)).toContain('In the round: Join and work in the round again.')
    const steeked = text({ ...piece, openings: [{ ...piece.openings[0]!, steek: true }] })
    expect(steeked.find((t) => t.startsWith('Armhole'))).toMatch(/cast on 5 steek stitches over each gap/)
    expect(steeked.some((t) => t.startsWith('Worked flat'))).toBe(false)
  })

  it('reads rows worked flat back and forth from the first flat row', () => {
    expect([isRightSide(69, 'flat', 69), isRightSide(70, 'flat', 69)]).toEqual([true, false])
    expect(readsRightToLeft(70, 'flat', 69)).toBe(false)
    expect(readsRightToLeft(70, 'round', 69)).toBe(true)
  })
})

describe('the Edinburgh template', () => {
  it("matches CalicoRadio Knits' pattern, size S, stitch for stitch", async () => {
    const template = publishedPattern('dog-sweater')
    const steps = patternSteps(template.spec as SchematicPiece, template.gauge!, 'round').map((s) => `${s.title}: ${s.text}`)
    expect(steps).toContain('Cast on: Cast on 48 stitches and join to work in the round.')
    expect(steps).toContain('Top of neck rib to Chest: Increase 1 stitch at each end of the round every other round, 12 times.')
    expect(steps).toContain('Belly bind-off to Back: Bind off 20 stitches (10 stitches at each edge).')
    expect(steps).toContain('Worked flat: Turn at the gap and work back and forth in rows, starting with a right-side row.')
    expect(steps).toContain('Back to Tail: Decrease 1 stitch at each edge every other row, 12 times.')
    expect(steps.at(-1)).toBe('Bind off: Bind off the remaining 28 stitches.')
    // The arm holes are slits: the round carries on through them.
    expect(steps.filter((s) => s.startsWith('Worked flat'))).toHaveLength(1)
  })
})

describe('the Tin Can Knits templates', () => {
  const steps = async (id: 'hat' | 'sweater') => {
    const { publishedPattern } = await import('./published-patterns.fixture')
    const template = publishedPattern(id)
    return patternSteps(template.spec as SchematicPiece, template.gauge!, 'round').map((s) => `${s.where} · ${s.title}: ${s.text}`)
  }

  it('matches the Clayoquot Toque, Adult M', async () => {
    expect(await steps('hat')).toEqual([
      'Round 1 · Cast on: Cast on 108 stitches and join to work in the round.',
      'Rounds 1–9 · Brim rib: Work in K1, P1 rib.',
      'Round 10 · Top of rib to Body: Increase 8 stitches evenly.',
      'Round 43 · Start of crown to Crown set-up: Decrease 4 stitches evenly.',
      'Rounds 44–59 · Crown set-up to Crown: Decrease 8 stitches, 1 in each of 8 sections, every other round, 8 times.',
      'Rounds 60–63 · Crown to Crown top: Decrease 8 stitches, 1 in each of 8 sections, every round, 4 times.',
      'Round 64 · Crown top to Top: Decrease 8 stitches evenly.',
      'Round 64 · Bind off: Bind off the remaining 8 stitches.',
    ])
  })

  it('matches Flax, size M', async () => {
    expect(await steps('sweater')).toEqual([
      'Round 1 · Cast on: Cast on 90 stitches and join to work in the round.',
      'Rounds 1–8 · Neck rib: Work in K1, P1 rib.',
      'Round 9 · Top of neck rib to Yoke: Increase 30 stitches evenly.',
      'Rounds 10–41 · Yoke to End of raglan: Increase 8 stitches, 1 in each of 8 sections, every other round, 16 times.',
      'Round 60 · Underarm to Body: Put the sleeve stitches on hold, casting on at the underarms: 172 stitches remain.',
      'Rounds 144–155 · Hem rib: Work in K1, P1 rib.',
      'Round 155 · Bind off: Bind off the remaining 172 stitches.',
    ])
  })
})
