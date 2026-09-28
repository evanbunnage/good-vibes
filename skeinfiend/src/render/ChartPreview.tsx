import { useEffect, useRef } from 'react'
import { NONE, type Grid } from '@/domain/grid'

/** Pixels per stitch when filling a box, enough to keep stitch edges crisp. */
const SCALE = 4

/**
 * A small, non-interactive chart thumbnail. `fill` scales it up to fill its
 * box, for motifs only a few stitches across.
 */
export function ChartPreview({ grid, colors, aspect = 1, fill = false }: { grid: Grid; colors: readonly string[]; aspect?: number; fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    // One pixel per stitch; `pixelated` keeps stitches crisp when CSS stretches it.
    const image = new ImageData(grid.width, grid.height)
    const rgb = colors.map(hexToRgb)
    for (let i = 0; i < grid.cells.length; i++) {
      const cell = grid.cells[i]!
      const color = cell === NONE ? null : rgb[cell]
      if (!color) continue
      image.data.set([...color, 255], i * 4)
    }
    if (!fill) {
      canvas.width = grid.width
      canvas.height = grid.height
      ctx.putImageData(image, 0, 0)
      return
    }
    // To fill a box at the right proportions, the canvas itself has them: each
    // stitch is SCALE pixels wide and SCALE × aspect tall.
    canvas.width = grid.width * SCALE
    canvas.height = Math.max(1, Math.round(grid.height * SCALE * aspect))
    const source = new OffscreenCanvas(grid.width, grid.height)
    source.getContext('2d')!.putImageData(image, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  }, [grid, colors, fill, aspect])

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={fill
        ? { inlineSize: '100%', blockSize: '100%', objectFit: 'contain', imageRendering: 'pixelated' }
        : { aspectRatio: `${grid.width} / ${grid.height * aspect}`, imageRendering: 'pixelated', maxInlineSize: '100%', maxBlockSize: '100%' }}
    />
  )
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
