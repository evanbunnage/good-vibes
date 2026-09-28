import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/ui/Icon'
import { FloatingWindow, type Place, type WindowPosition } from '@/ui/FloatingWindow'
import { usePhone, useTouch } from '@/ui/use-phone'
import { useProject } from '../editor-context'
import { yarnWindow } from '../yarn-window'
import { MotifArt } from './MotifStrip'
import { useMotifHelper } from './motif-helper-state'
import { useAddLayer } from './use-add-layer'
import styles from './panels.module.css'

/** A closed hand, from above: a palm, four fingers curled over, and a thumb. */
const HAND = (
  <>
    <rect x="5" y="10" width="14" height="11" rx="5" />
    <rect x="5.1" y="7" width="3.4" height="8" rx="1.7" />
    <rect x="8.6" y="5.5" width="3.4" height="8" rx="1.7" />
    <rect x="12.1" y="5.5" width="3.4" height="8" rx="1.7" />
    <rect x="15.6" y="7" width="3.4" height="8" rx="1.7" />
    <rect x="1.8" y="12.4" width="6.5" height="3.4" rx="1.7" transform="rotate(35 5 14.1)" />
  </>
)

/**
 * A window over the chart, hard to miss, level with the motifs in the side
 * panel: a motif tile carried onto a scrap of chart. On a chart just started
 * as an example (always) or as a first chart of their own, and for anyone
 * signed out until they've done it; gone once a motif's dragged onto the
 * chart, or it's closed. It comes a few seconds after the chart, once they've
 * had a look. Not on a phone, where the chart is moved around rather than
 * dropped onto; and out of the way of a yarn's window, which opens where it sits.
 */
export function MotifHelper() {
  const phone = usePhone()
  // A touch screen can't drag a motif onto the chart: it gets the words, by the motifs, instead.
  const touch = useTouch()
  const yarnOpen = yarnWindow.yarn.use() !== null
  const project = useProject()
  const { wanted, close } = useMotifHelper(project.id)
  const main = project.yarns[project.background]?.hex
  const { saved, builtIn } = useAddLayer()
  const first = saved[0] ?? builtIn[0]
  // Level with the motifs, following them as the panel scrolls, until it's moved by hand.
  const anchor = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState<Place>({ top: 12, right: 12 })
  const [moved, setMoved] = useState(false)
  const position = useMemo<WindowPosition>(() => ({
    use: () => place,
    set: (next) => {
      setMoved(true)
      setPlace(next)
    },
  }), [place])
  const shown = wanted && !phone && !touch && !yarnOpen
  // Before it's painted, so it opens there rather than jumping there.
  useLayoutEffect(() => {
    if (!shown || moved) return
    // The tile in the picture level with the strip's first row: centre to centre.
    const middle = (r: DOMRect) => r.top + r.height / 2
    const measure = () => {
      const area = anchor.current?.parentElement?.getBoundingClientRect()
      const first = document.querySelector('[data-motif-strip]')?.firstElementChild?.getBoundingClientRect()
      const helper = document.querySelector('[data-motif-helper]')
      const box = helper?.getBoundingClientRect()
      const tile = helper?.querySelector('[data-helper-tile]')?.getBoundingClientRect()
      if (!area || !first?.height || !box || !tile) return
      const top = middle(first) - area.top - (middle(tile) - box.top)
      setPlace({ top: Math.max(12, Math.min(area.height - box.height - 12, top)), right: 12 })
    }
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [shown, moved])
  if (!shown) return <span ref={anchor} hidden />
  return (
    <>
    <span ref={anchor} hidden />
    <FloatingWindow name="Drag a colorwork motif onto the chart" nameLabel="Tip" position={position} onClose={close} data-motif-helper>
      {/* The chart's own main color, and the first motif in the strip: what they'll see when they do it. */}
      <div className={styles.helper} style={{ '--helper-main': main } as React.CSSProperties} aria-hidden>
        <span className={styles.helperDemo}>
          <span className={styles.helperChart} />
          <span className={styles.helperTile} data-helper-tile>
            {first && <MotifArt choice={first} />}
            {/* The hand carrying it: solid, drawn twice, an ink outline under a white fill, so it reads as one shape. */}
            <svg className={styles.helperHand} viewBox="0 0 24 24" aria-hidden="true">
              <g className={styles.helperHandOutline}>{HAND}</g>
              <g className={styles.helperHandFill}>{HAND}</g>
              <path className={styles.helperHandLines} d="M8.6 8.5v3M12.1 7v4.5M15.6 8.5v3" />
            </svg>
          </span>
        </span>
      </div>
    </FloatingWindow>
    </>
  )
}

/**
 * Where a motif can't be dragged onto the chart (a touch screen, phone or
 * tablet; or a window narrow enough to be laid out as a phone): the tip as
 * words, in a translucent bubble of its own floating just above the motifs,
 * its tail on the first one. Not part of the controls: over them, following
 * the motifs as the page scrolls, until it's used or closed.
 */
export function MotifTip() {
  const phone = usePhone()
  // Tapped on a phone or tablet; clicked in a laptop window made narrow.
  const touch = useTouch()
  const project = useProject()
  const { wanted, close } = useMotifHelper(project.id)
  const shown = wanted && (phone || touch)
  const bubble = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; tail: number } | null>(null)
  // Before it's painted, so it opens in place rather than jumping there.
  useLayoutEffect(() => {
    if (!shown) return
    const measure = () => {
      const strip = document.querySelector('[data-motif-strip]')
      const first = strip?.children[1]?.getBoundingClientRect() ?? strip?.firstElementChild?.getBoundingClientRect()
      const area = strip?.getBoundingClientRect()
      const box = bubble.current?.getBoundingClientRect()
      if (!area?.height || !first || !box) return setPlace(null)
      const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, area.left))
      const middle = first.left + first.width / 2
      setPlace({ left, top: area.top - box.height - 10, tail: Math.max(14, Math.min(box.width - 14, middle - left)) })
    }
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [shown])
  if (!shown) return null
  return createPortal(
    <div ref={bubble} className={styles.tipBubble} role="status"
      style={place ? { left: place.left, top: place.top, '--tail': `${place.tail}px` } as React.CSSProperties : { visibility: 'hidden' }}>
      <p>{touch ? 'Tap' : 'Click'} to add to chart</p>
      <button type="button" className={styles.tipBubbleClose} aria-label="Close" title="Close" onClick={close}>
        <Icon name="close" />
      </button>
    </div>,
    document.body,
  )
}
