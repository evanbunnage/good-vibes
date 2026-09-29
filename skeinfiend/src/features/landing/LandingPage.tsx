import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAddProject, projectListQuery, useRepository } from '@/data/projects'
import { createExampleProject } from '@/domain/example'
import { createProject } from '@/domain/project'
import { isReturning } from '@/data/auth'
import { lastChart } from '@/data/last-chart'
import { AccountMenu } from '@/features/editor/AccountMenu'
import { continuedChart, offerMotifHelper, startedChart } from '@/features/editor/panels/motif-helper-state'
import { ChartPreview } from '@/render/ChartPreview'
import { Icon } from '@/ui/Icon'
import { Logo } from '@/ui/Logo'
import { usePhone, useTouch } from '@/ui/use-phone'
import { ClaudeSpark, OpenAIBlossom } from '@/ui/BrandMarks'
import { demoLinks, demoPrompt } from './demo-prompt'
import { Wordmark } from '@/ui/Wordmark'
import ui from '@/ui/ui.module.css'
import styles from './landing.module.css'
import { runAction } from '@/ui/run-action'

/**
 * Where someone starts who has nothing open yet: signed out, or signed in
 * without a chart. What SkeinFiend is, and two ways in: a blank chart of
 * their own, or an example. Signed out with charts already in this browser,
 * the most recent is a click away too.
 */
export function LandingPage() {
  const repository = useRepository()
  const { data: charts = [], isPending } = useQuery(projectListQuery(repository))
  const addProject = useAddProject()
  const navigate = useNavigate()
  const { user } = useRouteContext({ from: '__root__' })
  // Sent here by the demo prompt: its agent is told where the tools are, since the prompt's left to the knitter.
  // Not shown: it's in the page's text and accessibility tree, where an agent reads, not on screen.
  const { demo } = useSearch({ from: '/' })
  // The chart being made, on its way to opening: never offered to continue as it goes.
  const [starting, setStarting] = useState<string | null>(null)
  const others = charts.filter((c) => c.id !== starting)
  // The chart opened last in this browser, or else the one edited most recently.
  const recent = others.find((c) => c.id === lastChart()) ?? others[0]

  async function start(project: ReturnType<typeof createProject>, example = false) {
    setStarting(project.id)
    try {
      await addProject.mutateAsync(project)
    } catch (error) {
      setStarting(null)
      throw error
    }
    // The drag-a-motif helper: always on an example; on a chart of their own, if it's new to them.
    if (example) offerMotifHelper(project.id)
    else startedChart(project.id, { signedIn: Boolean(user), otherCharts: charts.length })
    void navigate({ to: '/p/$projectId', params: { projectId: project.id } })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <Logo />
          <Wordmark />
        </span>
        {/* The editor's own account menu: signing in, or the account and signing out. */}
        <AccountMenu returnTo="/" />
      </header>

      <main className={styles.hero}>
        <h1>Colorwork chart design for <span className={styles.knitters}>Knitters</span></h1>
        <div className={styles.actions}>
          <button type="button" className={ui.button} data-variant="primary" disabled={starting !== null}
            onClick={() => runAction(() => start(createProject({ id: crypto.randomUUID(), name: 'New chart', now: Date.now() })))}>
            Create a chart
          </button>
          <button type="button" className={ui.button} disabled={starting !== null} onClick={() => runAction(() => start(createExampleProject(crypto.randomUUID(), Date.now()), true))}>
            Open an example
          </button>
        </div>
        {/* Its room is kept while the charts are on their way (just after signing in), so nothing moves when one arrives; with none, it's gone. */}
        {(isPending || recent) && (
        <div className={styles.continueSlot}>
        {recent && (
          <Link to="/p/$projectId" params={{ projectId: recent.id }} className={styles.continue} onClick={() => continuedChart(recent.id)}>
            {/* The chart itself, small: which one this is, at a glance. */}
            <span className={styles.thumb}>
              <ChartPreview grid={recent.preview} colors={recent.colors} aspect={recent.aspect} fill />
            </span>
            <span className={styles.continueText}>Continue “{recent.name}”</span>
          </Link>
        )}
        {/* Signed out, their charts are only in this browser: as in the editor, the way to keep them. */}
        {recent && !user && (
          <Link to="/sign-in" search={{ redirect: '/' }} className={styles.signInToSave}>
            {isReturning() ? 'Sign in to save' : 'Create an account to save'}
          </Link>
        )}
        </div>
        )}
        <AgentDemo />
        {/* Last, so a screen reader reaches the page first; under its own heading, so it's skipped in a keystroke. */}
        {demo && (
          <section className="visually-hidden" aria-labelledby="for-agents">
            <h2 id="for-agents">For AI agents</h2>
            <p>Instructions for AI assistants using SkeinFiend for you.</p>
            <p>
              SkeinFiend’s tools are on this page, over WebMCP. If you don’t see them, run JavaScript here: <code>skeinfiend.tools</code> lists
              them, and <code>await skeinfiend.call(name, input)</code> runs one. Opening a chart (new-chart) adds its own tools. No need to
              sign in: charts are kept in this browser.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}

/**
 * The demo with their own agent, under the ways in: each button opens that
 * assistant's desktop app with the prompt typed in (not sent), and copies it
 * too, in case the app isn't there or drops it. Only with a mouse on a wide screen: an agent that can
 * drive a browser (the ChatGPT desktop app's, or Claude in Chrome) runs on a
 * computer, not a phone.
 */
function AgentDemo() {
  const phone = usePhone()
  const touch = useTouch()
  const prompt = useMemo(() => demoPrompt(window.location.origin), [])
  // The app it didn't open, if a click seemed to do nothing: the page never lost focus to it.
  const [missing, setMissing] = useState<{ name: string; download: string } | null>(null)
  // The prompt was just copied, from a button that says so.
  const [copied, setCopied] = useState(false)
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }
  const waiting = useRef<() => void>(undefined)
  useEffect(() => () => waiting.current?.(), [])
  // The note about an app that didn't open is put away by a click elsewhere, or Escape.
  useEffect(() => {
    if (!missing) return
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest?.(`.${styles.agentTip}`)) setMissing(null)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', away)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', away)
    }
  }, [missing])
  const marks = { ChatGPT: <OpenAIBlossom />, Claude: <ClaudeSpark /> }
  // On a phone or tablet the apps can't drive a browser: the prompt to take to a computer, not buttons that do nothing.
  if (phone || touch) {
    return (
      <section className={styles.agentDemo} aria-label="Try a demo with an agent">
        <p className={styles.agentLead}>SkeinFiend is built for agents, too. Try it out on your desktop.</p>
        <button type="button" className={`${ui.button} ${styles.agentButton}`} onClick={copyPrompt}>
          <Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </section>
    )
  }

  /**
   * A browser can't say whether an app link opened anything. When an app
   * does, it takes the focus (or the page is hidden); when none is there,
   * nothing happens. So: still in front a moment later, it didn't open.
   */
  function watchFor(link: { name: string; download: string }) {
    waiting.current?.()
    setMissing(null)
    const opened = () => stop()
    // An app that opened took the focus (or hid the page) first, and stopped this.
    const timer = setTimeout(() => {
      stop()
      setMissing(link)
    }, 2500)
    const stop = () => {
      clearTimeout(timer)
      window.removeEventListener('blur', opened)
      document.removeEventListener('visibilitychange', opened)
      waiting.current = undefined
    }
    window.addEventListener('blur', opened)
    document.addEventListener('visibilitychange', opened)
    waiting.current = stop
  }
  return (
    <section className={styles.agentDemo} aria-label="Try a demo with an agent">
      <p className={styles.agentLead}>SkeinFiend is built for agents, too. Try it out:</p>
      <div className={styles.agentButtons}>
        {demoLinks(prompt).map((link) => (
          <span key={link.name} className={styles.agentAnchor}>
            <a className={`${ui.button} ${styles.agentButton}`} href={link.href}
              title={`Open a demo in ${link.name} Desktop`} aria-label={link.name}
              onClick={() => {
                void navigator.clipboard?.writeText(prompt).catch(() => {})
                watchFor(link)
              }}>
              {marks[link.name as keyof typeof marks]} {link.name}
              {/* Opens outside the browser, as macOS marks such links. */}
              <span className={styles.agentOpens}><Icon name="external" /></span>
            </a>
            {/* Under the button that didn't open anything: what to do instead. */}
            {missing?.name === link.name && (
              <span className={styles.agentTip} role="status">
                <strong>Couldn’t Open {missing.name} Desktop</strong>
                <span>
                  <a href={missing.download} target="_blank" rel="noreferrer">Download {missing.name} Desktop</a> or{' '}
                  <button type="button" className={styles.linkButton} onClick={copyPrompt}>
                    {copied ? 'copied' : 'copy an example prompt'}
                  </button>
                </span>
              </span>
            )}
          </span>
        ))}
      </div>
    </section>
  )
}
