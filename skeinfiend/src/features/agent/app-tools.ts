import type { QueryClient } from '@tanstack/react-query'
import { projectKeys, projectListQuery } from '@/data/projects'
import type { ProjectRepository } from '@/data/repository'
import { createExampleProject } from '@/domain/example'
import { uniqueName } from '@/domain/names'
import { createProject } from '@/domain/project'
import type { AgentTool, ToolResult } from './tools'

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] })
const problem = (value: string): ToolResult => ({ ...text(value), isError: true })

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/**
 * The knitter's charts, on every page: listing them, starting one, and opening
 * one. Opening a chart offers that chart's own tools (get-chart and the rest).
 * Deleting a chart is left to the knitter: it can't be undone, and WebMCP has
 * no way yet to ask them first.
 */
export function appTools({ repository, queryClient, open, openId }: {
  repository: ProjectRepository
  queryClient: QueryClient
  /** Shows a chart in the editor. */
  open: (id: string) => Promise<void>
  /** The chart open now, if any. */
  openId: string | null
}): AgentTool[] {
  const charts = () => queryClient.fetchQuery(projectListQuery(repository))
  return [
    {
      name: 'list-charts',
      description: 'The knitter’s charts, most recently edited first, and which is open.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const list = await charts()
        if (!list.length) return text('No charts yet: start one with new-chart.')
        return text(list.map((c) => `${c.name}${c.id === openId ? ' (open)' : ''}: edited ${dateFormat.format(c.updatedAt)}`).join('\n'))
      },
    },
    {
      name: 'new-chart',
      description: 'Starts a chart and opens it: a plain rectangle to shape (with shape-piece or update-chart) and put colorwork on, or SkeinFiend’s example hat.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What to call it, e.g. the pattern’s name. Default: "New chart".' },
          example: { type: 'boolean', description: 'Start from the example hat instead.' },
        },
      },
      execute: async ({ name, example }) => {
        const id = crypto.randomUUID()
        const now = Date.now()
        const made = example === true ? createExampleProject(id, now) : createProject({ id, name: 'New chart', now })
        const asked = typeof name === 'string' && name.trim() ? name.trim() : made.name
        // Under a name no other chart has, as the knitter's own are.
        const project = { ...made, name: uniqueName(asked, (await charts()).map((c) => c.name), 'New chart') }
        await repository.put(project)
        queryClient.setQueryData(projectKeys.detail(id), project)
        await queryClient.invalidateQueries({ queryKey: projectKeys.list() })
        await open(id)
        return text(`Started "${project.name}" and opened it: its tools (get-chart and the rest) are offered now.`)
      },
    },
    {
      name: 'open-chart',
      description: 'Opens one of the knitter’s charts, by name, to work on it.',
      inputSchema: { type: 'object', properties: { chart: { type: 'string', description: 'Its name (see list-charts).' } }, required: ['chart'] },
      execute: async ({ chart }) => {
        const name = String(chart ?? '').trim().toLowerCase()
        const list = await charts()
        const found = list.find((c) => c.id === name) ?? list.find((c) => c.name.toLowerCase() === name)
        if (!found) return problem(`No chart "${chart}". The charts are: ${list.map((c) => c.name).join(', ') || 'none yet'}.`)
        await open(found.id)
        return text(`Opened "${found.name}": its tools (get-chart and the rest) are offered now.`)
      },
    },
  ]
}
