import { useState } from 'react'
import { STITCHES, stitchType, type StitchType } from '@/domain/stitches'
import type { EditorState } from '@/editor/store'
import { useEditor, useEditorStore } from './editor-context'
import styles from './editor.module.css'
import { Section } from './panels/Section'

const selectPicked = (s: EditorState) => (s.brush === 'stitch' ? s.stitch : null)

/**
 * Stitches to paint with, beside the yarns and like them: pick one and it's
 * the brush (a yarn picked after takes over again). Painting places it on the
 * chart, or on a motif in its window, keeping the colors; a right-click sets
 * a stitch back to knit. Picking one shows the symbols, to see what's painted.
 */
export function StitchesSection() {
  const store = useEditorStore()
  const picked = useEditor(selectPicked)
  // The stitch pointed at, or else the one picked: named under the palette, as a chart key would. Empty until then.
  const [pointed, setPointed] = useState<number | null>(null)
  const named = pointed ?? picked
  return (
    <Section title="Stitches">
      {/* The name shows for the stitch pointed at, until the pointer leaves the whole palette: no flicker between stitches. */}
      <div className={styles.stitchPalette} role="radiogroup" aria-label="Stitch to paint with" onPointerLeave={() => setPointed(null)}>
        {STITCHES.map((stitch) => (
          <button type="button" key={stitch.code} className={styles.stitchButton} role="radio" aria-checked={picked === stitch.code}
            title={stitch.none ? stitch.name : `${stitch.name} (${stitch.rs} on RS, ${stitch.ws} on WS)`} aria-label={stitch.name}
            onClick={() => store.setStitch(stitch.code)}
            onPointerEnter={() => setPointed(stitch.code)}
            onFocus={() => setPointed(stitch.code)} onBlur={() => setPointed(null)}>
            <StitchSymbol stitch={stitch} />
          </button>
        ))}
      </div>
      <p className={styles.stitchName} aria-live="polite">
        {named !== null && <StitchName stitch={stitchType(named)} />}
      </p>
    </Section>
  )
}

/** What a stitch is and how it's worked, as a chart key says it: "Purl: p on RS, k on WS". */
function StitchName({ stitch }: { stitch: StitchType }) {
  if (stitch.none) return <><strong>No stitch</strong>: a place with no stitch in the row</>
  return <><strong>{stitch.name}</strong>: {stitch.rs === stitch.ws ? stitch.rs : `${stitch.rs} on RS, ${stitch.ws} on WS`}</>
}

/** A stitch's chart symbol in a square, as a chart key draws it. */
export function StitchSymbol({ stitch }: { stitch: StitchType }) {
  return (
    <svg viewBox="0 0 24 24" className={styles.stitchSymbol} data-none={stitch.none || undefined} aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="2" />
      {stitch.symbol.path && <path d={stitch.symbol.path} data-fill={stitch.symbol.fill || undefined} />}
    </svg>
  )
}
