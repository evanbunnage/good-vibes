/**
 * The demo for someone's own agent: a hat charted from two plates of a
 * public-domain pattern book, on this site. Written as a knitter would ask, short
 * enough to read at a glance in the app's check before it's sent; how an agent
 * reaches the tools is on the page it opens (`/try`, the home page as `?demo`
 * shows it), not here. It also skips the sign-in page: it works signed out.
 */
export function demoPrompt(origin: string): string {
  return `Help me get started with a Fair Isle hat using SkeinFiend: ${origin}/try. No need to sign in

Chart a band from this 1922 DMC pattern plate, stitch for stitch: ${PLATE}
Add the hearts from this one above it: ${HEARTS}
- Cream with the plates' golds and reds, and fix any floats that are too long
- Make it in S, M and L, with a crown in 8 sections
- Save the bands to my motifs so I can reuse them
- Tell me how much yarn I'll need

Keep the chart on screen`
}

/**
 * Plate 1 of Thérèse de Dillmont's Motifs pour broderies (DMC, 1922): six
 * two-color geometric bands, as stranded colorwork is. Public domain in the
 * US (published before 1931); Wikimedia Commons, 2048 × 1426, 2 MB.
 */
const PLATE = 'https://upload.wikimedia.org/wikipedia/commons/e/e2/Motifs_pour_Broderies_-_1re_s%C3%A9rie_-_Planche_01.jpg'

/**
 * Plate 3 of the same book: hearts, crosses and a chevron band, photographed
 * as stitched (not a flat chart like plate 1), so reading it is a harder test.
 * Public domain; Wikimedia Commons.
 */
const HEARTS = 'https://upload.wikimedia.org/wikipedia/commons/c/cc/Motifs_pour_Broderies_-_1re_s%C3%A9rie_-_Planche_03.jpg'

/**
 * Opens each assistant's desktop app, where its agent can use a browser, with
 * the prompt typed in and waiting to be sent (never sent for them). Both are
 * documented: the ChatGPT app keeps Codex's `codex://new?prompt=`
 * (developers.openai.com/codex/app/commands), and Claude Desktop takes
 * `claude://claude.ai/new?q=` (support.claude.com, "Open Claude Desktop with a
 * link"). Without the app, nothing opens: the prompt's copied as well.
 */
export const demoLinks = (prompt: string) => [
  { name: 'ChatGPT', href: `codex://new?prompt=${encodeURIComponent(prompt)}`, download: 'https://chatgpt.com/download' },
  { name: 'Claude', href: `claude://claude.ai/new?q=${encodeURIComponent(prompt)}`, download: 'https://claude.ai/download' },
]
