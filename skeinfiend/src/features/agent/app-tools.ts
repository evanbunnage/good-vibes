import type { QueryClient } from '@tanstack/react-query'
import { duplicate, projectKeys, projectListQuery, projectQuery } from '@/data/projects'
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
  /** A chart by id, or by name if only one has it. */
  const find = async (ref: unknown) => {
    if (typeof ref !== 'string' || !ref.trim()) return { problem: problem('Give `chart`: the chart’s name or id (see list-charts).') }
    const wanted = ref.trim()
    const list = await charts()
    const byId = list.find((c) => c.id === wanted)
    if (byId) return byId
    const named = list.filter((c) => c.name.toLowerCase() === wanted.toLowerCase())
    if (named.length > 1) return { problem: problem(`More than one chart is called "${wanted}": give its id (${named.map((c) => c.id).join(', ')}).`) }
    if (!named[0]) return { problem: problem(`No chart "${wanted}". The charts are: ${list.map((c) => c.name).join(', ') || 'none yet'}.`) }
    return named[0]
  }
  return [
    {
      name: 'list-charts',
      description: 'The knitter’s charts, most recently edited first, and which is open.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const list = await charts()
        if (!list.length) return text('No charts yet: start one with new-chart.')
        // With its id: two charts can share a name, and open-chart takes either.
        return text(list.map((c) => `${c.name}${c.id === openId ? ' (open)' : ''}: edited ${dateFormat.format(c.updatedAt)} (id ${c.id})`).join('\n'))
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
        if (typeof name === 'string' && !name.trim()) return problem('A chart needs a name: leave `name` out for "New chart".')
        const asked = typeof name === 'string' ? name.trim() : made.name
        // Under a name no other chart has, as the knitter's own are.
        const project = { ...made, name: uniqueName(asked, (await charts()).map((c) => c.name), 'New chart') }
        await repository.put(project)
        queryClient.setQueryData(projectKeys.detail(id), project)
        await queryClient.invalidateQueries({ queryKey: projectKeys.list() })
        await open(id)
        return text(`Started "${project.name}" and opened it: its tools (get-chart and the rest) are offered now. Every change is saved as it's made: to the knitter's account if they're signed in, otherwise in this browser.`)
      },
    },
    {
      name: 'open-chart',
      description: 'Opens one of the knitter’s charts, by name or id, to work on it.',
      inputSchema: { type: 'object', properties: { chart: { type: 'string', description: 'Its name or id (see list-charts).' } }, required: ['chart'] },
      execute: async ({ chart }) => {
        const found = await find(chart)
        if ('problem' in found) return found.problem
        await open(found.id)
        return text(`Opened "${found.name}": its tools (get-chart and the rest) are offered now.`)
      },
    },
    {
      name: 'duplicate-chart',
      description: 'Copies one of the knitter’s charts (to try a variation, or keep the original as it is) and opens the copy.',
      inputSchema: {
        type: 'object',
        properties: {
          chart: { type: 'string', description: 'The chart to copy: its name or id (see list-charts). Default: the one open.' },
          name: { type: 'string', description: 'What to call the copy. Default: "… copy".' },
        },
      },
      execute: async ({ chart, name }) => {
        const found = await find(chart ?? openId ?? '')
        if ('problem' in found) return found.problem
        const source = await queryClient.fetchQuery(projectQuery(repository, found.id))
        if (typeof name === 'string' && !name.trim()) return problem('A chart needs a name: leave `name` out for "… copy".')
        const copy = duplicate(source, crypto.randomUUID(), Date.now())
        const project = { ...copy, name: uniqueName(typeof name === 'string' ? name.trim() : copy.name, (await charts()).map((c) => c.name), 'New chart') }
        await repository.put(project)
        queryClient.setQueryData(projectKeys.detail(project.id), project)
        await queryClient.invalidateQueries({ queryKey: projectKeys.list() })
        await open(project.id)
        return text(`Copied "${source.name}" to "${project.name}" and opened the copy. The original is as it was.`)
      },
    },
  ]
}
