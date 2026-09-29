import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The demo's address, as a knitter would write it in a prompt: the home page
 * as `?demo` shows it (no sign-in page, not the last chart, and the note
 * telling an agent where the tools are).
 */
export const Route = createFileRoute('/try')({
  beforeLoad: () => {
    throw redirect({ to: '/', search: { home: true, demo: true }, replace: true })
  },
})
