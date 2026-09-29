import { NONE, type Grid } from './grid'
import { isRightSide, rowNumber, rowRuns } from './numbering'
import type { Construction } from './pieces'
import { KNIT, NO_STITCH, PURL, workedAs } from './stitches'

/**
 * A chart row written the way patterns write it, for knitters who'd rather
 * read than follow the chart:
 *
 *   Row 20 (WS): k1, *[p1 tbl, k1] twice, p7; rep from * to last st, k1. (39 sts)
 *
 * Lowercase abbreviations with their counts, knit and purl always spelled out;
 * a repeat as "*…; rep from *", and repeated stitches in brackets; yarns as a
 * pattern's key names them (MC, CC1…), only when the row has more than the
 * main color; the stitch count at the end.
 */
export interface WrittenRow {
  /** "Row 20 (WS)", or "Rnd 12" in the round. */
  readonly heading: string
  readonly text: string
  readonly stitches: number
  /** The yarns the row names, in the order they're first named, to show beside it. */
  readonly yarns: readonly number[]
}

/**
 * The yarns as a pattern's key names them: the main color MC, the others CC,
 * or CC1, CC2… when there are several, in palette order. The same letters as
 * the printed key.
 */
export function yarnLabels(counts: readonly number[], background: number): Map<number, string> {
  const contrasts = counts.map((n, i) => ({ n, i })).filter(({ n, i }) => n > 0 && i !== background).map(({ i }) => i)
  const labels = new Map<number, string>([[background, 'MC']])
  contrasts.forEach((i, k) => {
    labels.set(i, contrasts.length === 1 ? 'CC' : `CC${k + 1}`)
  })
  return labels
}

interface Stitch {
  readonly yarn: number
  readonly stitch: number
}

export function writeRow(chart: Grid, y: number, construction: Construction, firstFlatRow: number, stitches: Grid | null, labels: Map<number, string>, background: number): WrittenRow {
  const row = rowNumber(y, chart.height)
  const rightSide = isRightSide(row, construction, firstFlatRow)
  const heading = construction === 'round' ? `Rnd ${row}` : `Row ${row} (${rightSide ? 'RS' : 'WS'})`

  // The row in the order it's knitted, split where it's worked in separate pieces.
  const pieces: Stitch[][] = [[]]
  for (const run of rowRuns(chart, y, construction, firstFlatRow, stitches)) {
    if (run.kind === 'gap') pieces.push([])
    else for (let i = 0; i < run.count; i++) pieces.at(-1)!.push({ yarn: run.yarn, stitch: run.stitch })
  }
  const all = pieces.flat()
  const used = [...new Set(all.map((s) => s.yarn))]
  // Yarns are named stitch by stitch when the row has more than one. A row in one yarn, on a chart with others,
  // says it once, as patterns do ("With MC, *k1, p1; rep…"): coming off a contrast row, that's what to pick up.
  const named = used.length > 1
  const oneYarn = used.length === 1 && (used[0] !== background || labels.size > 1) ? used[0]! : null
  const yarnsNamed: number[] = []
  const name = (yarn: number) => {
    if (!yarnsNamed.includes(yarn)) yarnsNamed.push(yarn)
    return labels.get(yarn) ?? '?'
  }
  const write = (sts: readonly Stitch[]) => words(sts, rightSide, named ? name : null)
  const worded = pieces.filter((p) => p.length).map((piece) => withRepeat(piece, write)).join('; then the other side: ')
  const text = oneYarn !== null && worded ? `With ${name(oneYarn)}, ${worded}` : worded
  // A row with more or fewer stitches than the one below says where they're made or lost: where the chart shows it.
  const below = y + 1 < chart.height ? stitchesIn(chart, stitches, y + 1) : 0
  const change = below ? all.length - below : 0
  if (change && (construction === 'round' || (rightSide && pieces.length === 1))) {
    const where = shapingOf(chart, y, below, all.length)
    const plain = !named && all.every((s) => s.stitch === KNIT)
    let shaped: string
    // A plain row is just its shaping, "*k12, k2tog; rep from * to end"; one with colors or stitches says both.
    if (where && plain) shaped = oneYarn !== null ? `With ${name(oneYarn)}, ${where}` : where
    else if (where) shaped = `${change < 0 ? 'Dec' : 'Inc'} ${construction === 'round' ? 'rnd' : 'row'} (${where}): ${text}`
    // Cast on or off at once, or put on hold: the pattern's shaping says how.
    else shaped = `${Math.abs(change)} sts ${change < 0 ? 'fewer' : 'more'} than the ${construction === 'round' ? 'round' : 'row'} below, as the shaping says: ${text}`
    return { heading, text: `${shaped}.`, stitches: all.length, yarns: yarnsNamed }
  }
  return { heading, text: text ? `${text}.` : '', stitches: all.length, yarns: yarnsNamed }
}

/**
 * Where a row's shaping is worked, read off the chart: a stitch that was on
 * the row below and isn't on this one is knitted together with the one
 * before it ("k2tog"), or at the start, with the one after ("ssk"); a stitch
 * this row has that the row below didn't is made ("M1"). In the order it's
 * knitted, from the right, with its repeat: "*k12, k2tog; rep from * to end",
 * or "ssk, k60, k2tog". Null when the chart's shaping can't be written so.
 */
function shapingOf(chart: Grid, y: number, before: number, after: number): string | null {
  const w = chart.width
  const on = (row: number, x: number) => chart.cells[row * w + x] !== NONE
  const tokens: string[] = []
  let [plain, consumed, made] = [0, 0, 0]
  const flush = (n: number) => {
    if (n > 0) tokens.push(`k${n}`)
  }
  for (let x = w - 1; x >= 0; x--) {
    const [was, is] = [on(y + 1, x), on(y, x)]
    if (was && is) plain++
    else if (!was && is) {
      flush(plain)
      tokens.push('M1')
      consumed += plain
      made += plain + 1
      plain = 0
    } else if (was && !is) {
      let gone = 1
      while (x - gone >= 0 && on(y + 1, x - gone) && !on(y, x - gone)) gone++
      if (gone > 2) return null
      x -= gone - 1
      if (plain > 0) {
        // Together with the stitch before: "k to the last one, k2tog".
        flush(plain - 1)
        tokens.push(gone === 1 ? 'k2tog' : 'k3tog')
        consumed += plain + gone
        made += plain
      } else {
        // At the start, with the stitch after it: "ssk".
        const next = x - 1
        if (next < 0 || !on(y + 1, next) || !on(y, next)) return null
        tokens.push(gone === 1 ? 'ssk' : 'sssk')
        consumed += gone + 1
        made += 1
        x = next
      }
      plain = 0
    }
  }
  flush(plain)
  consumed += plain
  made += plain
  // Only as the stitch counts have it (a chart's own "no stitch" places shape it too, and aren't read here).
  if (consumed !== before || made !== after || !tokens.length) return null
  // Its repeat: the same stretch, ending at a shaping, again and again, then any plain stitches left.
  const segments: string[][] = [[]]
  for (const t of tokens) {
    segments.at(-1)!.push(t)
    if (!/^k\d+$/.test(t)) segments.push([])
  }
  const tail = segments.pop()!
  const words = segments.map((seg) => seg.join(', '))
  // The fewest stretches that repeat: "*k13, M1, k14, M1; rep" when the sections alternate in size.
  for (let period = 1; period <= Math.min(4, words.length / 2); period++) {
    if (words.length % period || !words.every((seg, i) => seg === words[i % period])) continue
    const repeat = words.slice(0, period).join(', ')
    if (!tail.length) return `*${repeat}; rep from * to end`
    const rest = Number(tail[0]!.slice(1))
    return `*${repeat}; rep from * to last ${rest === 1 ? 'st' : `${rest} sts`}, ${tail[0]}`
  }
  return tokens.join(', ')
}

/** Stitches knitted in a row: on the piece, and not a place with no stitch. */
function stitchesIn(chart: Grid, stitches: Grid | null, y: number): number {
  let n = 0
  for (let x = 0; x < chart.width; x++) {
    const i = y * chart.width + x
    if (chart.cells[i] !== NONE && stitches?.cells[i] !== NO_STITCH) n++
  }
  return n
}

/**
 * A piece of a row, with its repeat marked: "k1, *…; rep from * to last st, k1".
 * The repeat is the shortest that covers most of the row. Of the places it
 * could start, the first where the stitches change, as a chart's repeat box
 * does: not partway through a run of the same stitch.
 */
function withRepeat(sts: readonly Stitch[], write: (sts: readonly Stitch[]) => string): string {
  const n = sts.length
  const same = (a: Stitch, b: Stitch) => a.yarn === b.yarn && a.stitch === b.stitch
  const fits = (before: number, period: number) => {
    const times = Math.floor((n - before) / period)
    if (times < 2) return false
    // All one stitch isn't a repeat, just a run: "k42".
    if (sts.slice(before, before + period).every((s) => same(s, sts[before]!))) return false
    for (let i = before + period; i < before + times * period; i++) if (!same(sts[i]!, sts[i - period]!)) return false
    return before + (n - before - times * period) < times * period
  }
  for (let period = 2; period <= n / 2; period++) {
    const starts = Array.from({ length: Math.min(8, n) + 1 }, (_, before) => before).filter((before) => fits(before, period))
    if (!starts.length) continue
    // Where the repeat's first stitch differs from its last: a run isn't split across the repeat's edge.
    const before = starts.find((b) => !same(sts[b]!, sts[b + period - 1]!)) ?? starts[0]!
    const times = Math.floor((n - before) / period)
    const rest = n - before - times * period
    const start = before ? `${write(sts.slice(0, before))}, ` : ''
    const end = rest ? `; rep from * to last ${rest === 1 ? 'st' : `${rest} sts`}, ${write(sts.slice(n - rest))}` : '; rep from * to end'
    return `${start}*${write(sts.slice(before, before + period))}${end}`
  }
  return write(sts)
}

/** Stitches as words, stitch by stitch run: "k2 MC, p1 tbl, [k1, p1] twice". */
function words(sts: readonly Stitch[], rightSide: boolean, name: ((yarn: number) => string) | null): string {
  const runs: Array<{ stitch: number; yarn: number; count: number }> = []
  for (const s of sts) {
    const last = runs.at(-1)
    if (last && last.stitch === s.stitch && last.yarn === s.yarn) last.count++
    else runs.push({ ...s, count: 1 })
  }
  const tokens = runs.map(({ stitch, yarn, count }) => {
    const worked = workedAs(stitch, rightSide)
    const color = name ? ` ${name(yarn)}` : ''
    // Knit and purl take a count ("k3"); other stitches repeat in brackets ("[k2tog] twice").
    if (stitch === KNIT || stitch === PURL) return `${worked}${count}${color}`
    return count === 1 ? `${worked}${color}` : `[${worked}${color}] ${times(count)}`
  })
  return bracket(tokens).join(', ')
}

/** Runs of the same few stitches, bracketed: "k1 tbl, p1, k1 tbl, p1" → "[k1 tbl, p1] twice". */
function bracket(tokens: readonly string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    let best: { size: number; count: number } | null = null
    for (let size = 2; size <= 4; size++) {
      let count = 1
      while (i + (count + 1) * size <= tokens.length && tokens.slice(i + count * size, i + (count + 1) * size).every((t, k) => t === tokens[i + k])) count++
      if (count > 1 && (!best || count * size > best.count * best.size)) best = { size, count }
    }
    // Starting one later reaches the end just as well: bracket from there, as patterns do ("p1 tbl, [k1, p1 tbl] twice").
    if (best && i + best.count * best.size < tokens.length && i + 1 + best.count * best.size === tokens.length
      && Array.from({ length: best.count * best.size }, (_, k) => tokens[i + 1 + k] === tokens[i + 1 + (k % best!.size)]).every(Boolean)) {
      out.push(tokens[i++]!)
      continue
    }
    if (best) {
      out.push(`[${tokens.slice(i, i + best.size).join(', ')}] ${times(best.count)}`)
      i += best.size * best.count
    } else out.push(tokens[i++]!)
  }
  return out
}

function times(n: number): string {
  return n === 2 ? 'twice' : `${n} times`
}

