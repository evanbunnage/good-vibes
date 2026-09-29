import { useEffect } from 'react'
import { NotSignedInError } from '@/data/remote-repository'
import { agentAtWork } from '@/features/editor/panels/motif-helper-state'
import type { AgentTool, ToolResult } from './tools'

/**
 * The WebMCP surface: `document.modelContext` (`navigator.modelContext` in
 * earlier builds). A tool is withdrawn by aborting the signal it was
 * registered with; earlier builds had `unregisterTool` instead.
 */
interface ModelContext {
  registerTool(tool: AgentTool, options?: { signal?: AbortSignal }): unknown
  unregisterTool?(name: string): void
}

/**
 * The same tools on the page itself, for agents that drive the browser
 * without WebMCP: `skeinfiend.tools` lists them, and
 * `await skeinfiend.call(name, input)` runs one.
 */
interface PageTools {
  readonly tools: ReadonlyArray<Pick<AgentTool, 'name' | 'description' | 'inputSchema'>>
  call(name: string, input?: Record<string, unknown>): Promise<ToolResult>
}

declare global {
  interface Window {
    skeinfiend?: PageTools
  }
}

function modelContext(): ModelContext | undefined {
  const holder = (x: object) => (x as { modelContext?: ModelContext }).modelContext
  return holder(document) ?? holder(navigator)
}

/** Every tool on offer now, from each part of the page that offers some. */
const offered = new Map<string, AgentTool>()

function publish(): void {
  window.skeinfiend = {
    tools: [...offered.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    call: async (name, input = {}) => {
      const tool = offered.get(name)
      if (!tool) {
        // A chart's tools come and go with the chart: with none open, say how to get them.
        const noChart = !offered.has('get-chart') ? ' No chart is open: open-chart or new-chart opens one, and its tools (get-chart and the rest) are offered then.' : ''
        return { content: [{ type: 'text', text: `No tool "${name}".${noChart} Tools now: ${[...offered.keys()].join(', ')}.` }], isError: true }
      }
      return tool.execute(input)
    },
  }
}

/** A tool whose failures come back as results the agent can read and act on, not as exceptions. */
function answering(tool: AgentTool): AgentTool {
  return {
    ...tool,
    execute: async (input) => {
      // An agent's using SkeinFiend: helpers meant for a person trying it for the first time stay out of its way.
      agentAtWork()
      try {
        return await tool.execute(input)
      } catch (error) {
        const text = error instanceof NotSignedInError
          ? 'The knitter’s session has ended, so their account can’t be reached. Ask them to sign in again (the "Sign in to save" link at the top of the chart); nothing on the chart is lost.'
          : `That didn’t work: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text', text }], isError: true }
      }
    },
  }
}

/**
 * Offers tools to the designer's agent while the component using it is on the
 * page: a chart's own while it's open, the app's everywhere. As WebMCP
 * recommends, what's offered follows what's on screen. Made with `useMemo`,
 * so they're offered again only when what they work on changes.
 */
export function useAgentTools(tools: AgentTool[]): void {
  useEffect(() => {
    const context = modelContext()
    const controller = new AbortController()
    const offering = tools.map(answering)
    for (const tool of offering) {
      offered.set(tool.name, tool)
      try {
        // Some builds return a promise: a refusal there is reported, not thrown.
        Promise.resolve(context?.registerTool(tool, { signal: controller.signal })).catch((error: unknown) =>
          console.warn(`Couldn't offer ${tool.name} over WebMCP`, error))
      } catch (error) {
        console.warn(`Couldn't offer ${tool.name} over WebMCP`, error)
      }
    }
    publish()
    return () => {
      controller.abort()
      for (const tool of offering) {
        if (offered.get(tool.name) === tool) offered.delete(tool.name)
        context?.unregisterTool?.(tool.name)
      }
      publish()
    }
  }, [tools])
}
