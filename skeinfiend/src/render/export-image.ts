import { cellAspect } from '@/domain/gauge'
import type { Grid } from '@/domain/grid'
import type { Project } from '@/domain/project'
import { drawChart, type ChartDrawing, type Theme } from './draw-chart'

/** Fixed light colors for printing and exports, whatever the screen's color scheme. */
export const PRINT_THEME: Theme = {
  canvas: '#ffffff',
  gridLine: 'rgba(0, 0, 0, 0.18)',
  majorLine: 'rgba(0, 0, 0, 0.6)',
  outside: '#f1ede7',
  text: '#4a443c',
  accent: '#2f6b4a',
  warning: '#e0601a',
  fontUi: "'Figtree', system-ui, sans-serif",
  fontMono: "'Martian Mono', ui-monospace, monospace",
}

const PRINT_GUTTER = { left: 12, right: 36, top: 12, bottom: 26 }
const NO_GUTTER = { left: 0, right: 0, top: 0, bottom: 0 }

/** Draws the whole chart onto a new canvas, sized for print (two device pixels per point). */
export function renderChartImage(project: Project, chart: Grid, cellWidth = 12, scale = 2, stitches: Grid | null = null,
  { numbers = true, floats, repeats, rows }: {
    numbers?: boolean
    floats?: Pick<ChartDrawing, 'issues' | 'strands' | 'maxFloat' | 'issueRows'>
    repeats?: ChartDrawing['repeats']
    /** Just these rows (top-based, inclusive), numbered as on the whole chart, with its stitch numbers below. */
    rows?: { readonly top: number; readonly bottom: number }
  } = {}): HTMLCanvasElement {
  const cellHeight = cellWidth * cellAspect(project.gauge)
  const GUTTER = numbers ? PRINT_GUTTER : NO_GUTTER
  const width = GUTTER.left + chart.width * cellWidth + GUTTER.right
  const height = GUTTER.top + chart.height * cellHeight + GUTTER.bottom
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  drawChart(ctx, {
    grid: chart,
    colors: project.yarns.map((y) => y.hex),
    numbers,
    stitches,
    ...floats,
    repeats,
    theme: PRINT_THEME,
    view: { cellWidth, cellHeight, originX: GUTTER.left, originY: GUTTER.top },
  })
  if (!rows) return canvas
  // Cut to the rows, keeping the margins above and below (the stitch numbers) as they are.
  const [top, rowsHigh] = [GUTTER.top + rows.top * cellHeight, (rows.bottom - rows.top + 1) * cellHeight]
  const cut = document.createElement('canvas')
  cut.width = canvas.width
  cut.height = Math.ceil((GUTTER.top + rowsHigh + GUTTER.bottom) * scale)
  const to = cut.getContext('2d')!
  const px = (n: number) => Math.round(n * scale)
  to.drawImage(canvas, 0, 0, canvas.width, px(GUTTER.top), 0, 0, canvas.width, px(GUTTER.top))
  to.drawImage(canvas, 0, px(top), canvas.width, px(rowsHigh), 0, px(GUTTER.top), canvas.width, px(rowsHigh))
  to.drawImage(canvas, 0, px(GUTTER.top + chart.height * cellHeight), canvas.width, px(GUTTER.bottom), 0, px(GUTTER.top + rowsHigh), canvas.width, px(GUTTER.bottom))
  return cut
}

export async function downloadPng(canvas: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the image')
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: `${slug(name)}.png` })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart'
}
