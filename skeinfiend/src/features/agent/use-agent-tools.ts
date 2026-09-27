import { useEffect } from 'react'
import type { EditorStore } from '@/editor/store'
import { agentTools, type AgentTool, type ToolResult } from './tools'

/** The WebMCP surface: `document.modelContext` in current Chrome, `navigator.modelContext` before it. */
interface ModelContext {
  registerTool(tool: AgentTool): void
  unregisterTool?(name: string): void
}

/**
 * The same tools on the page itself, for agents that drive the browser
 * without WebMCP (or before it's on): `skeinfiend.tools` lists them, and
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

/** Offers the open pattern's tools to the designer's agent while the editor is open. */
export function useAgentTools(store: EditorStore): void {
  useEffect(() => {
    const tools = agentTools(store)
    const context = modelContext()
    const registered: string[] = []
    for (const tool of tools) {
      try {
        context?.registerTool(tool)
        registered.push(tool.name)
      } catch (error) {
        console.warn(`Couldn't offer ${tool.name} over WebMCP`, error)
      }
    }
    window.skeinfiend = {
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      call: async (name, input = {}) => {
        const tool = tools.find((t) => t.name === name)
        if (!tool) return { content: [{ type: 'text', text: `No tool "${name}". Tools: ${tools.map((t) => t.name).join(', ')}.` }], isError: true }
        return tool.execute(input)
      },
    }
    return () => {
      for (const name of registered) context?.unregisterTool?.(name)
      delete window.skeinfiend
    }
  }, [store])
}
