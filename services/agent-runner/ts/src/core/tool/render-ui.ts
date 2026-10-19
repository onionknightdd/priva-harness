import { createParser, type LibrarySpec } from '@openuidev/lang-core'

import { INTERACTIVE_VISUALIZE_TOOL_NAME, STATIC_VISUALIZE_TOOL_NAME } from '../event/tool-names.js'
import { defineTool, stringToolArg, type ToolDefinition } from './define-tool.js'
import { interactiveVisualizeSpec } from './interactive-visualize.spec.js'
import { staticVisualizeSpec } from './static-visualize.spec.js'

export function formatVisualizeDescription(spec: LibrarySpec, intro: readonly string[]): string {
  const childSignature = spec.components['Button'] === undefined
    ? '(Stack | Card | CardHeader | Text | Badge | Table | BarChart | LineChart | AreaChart | DonutChart)[]'
    : '(Stack | Card | CardHeader | Text | Button)[]'
  const signatures = Object.values(spec.components).map((component) => {
    const signature = component.signature.replaceAll('children: any[]', `children: ${childSignature}`)
    return component.description === undefined ? signature : `${signature} — ${component.description}`
  })
  const notes = spec.componentGroups?.flatMap((group) => group.notes ?? []) ?? []
  return [...intro, ...notes, 'Components:', ...signatures].join('\n')
}

export function openUiLangFromArg(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:openui|text)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

export function defineVisualizeTool(
  name: string,
  spec: LibrarySpec & { schema: Parameters<typeof createParser>[0] },
  intro: readonly string[],
): ToolDefinition {
  const parser = createParser(spec.schema, spec.root)
  return defineTool({
    name,
    description: formatVisualizeDescription(spec, intro),
    inputSchema: {
      type: 'object',
      properties: {
        lang: {
          type: 'string',
          description: 'OpenUI Lang program. Raw text, one statement per line, no markdown fences.',
        },
      },
      required: ['lang'],
    },
    execute(input) {
      const lang = openUiLangFromArg(stringToolArg(input, 'lang'))
      if (lang === '') {
        return Promise.resolve({ ok: false, text: `${name} requires a non-empty lang string` })
      }
      try {
        const result = parser.parse(lang)
        const lines = result.meta.errors
          .filter((error) => error.severity !== 'warning')
          .map((error) => `${error.code}: ${error.message}`)
        if (result.meta.unresolved.length > 0) {
          lines.push(`unresolved: ${result.meta.unresolved.join(', ')}`)
        }
        if (result.root === null && !lines.some((line) => line.startsWith('no-root'))) {
          lines.push('no-root: the program needs root = Stack(...)')
        }
        if (lines.length > 0) return Promise.resolve({ ok: false, text: lines.join('\n') })
        return Promise.resolve({ ok: true, text: lang })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return Promise.resolve({ ok: false, text: `parse-failed: ${message}` })
      }
    },
  })
}

export const staticVisualizeTool = defineVisualizeTool(STATIC_VISUALIZE_TOOL_NAME, staticVisualizeSpec, [
  'Render a static card, table, or chart in the chat from OpenUI Lang.',
  'Use visualize only when this tool is unavailable.',
  'Use interactive_visualize when the user should press a button to continue.',
  'Use canvas for a full HTML document that opens in the workspace preview.',
  'lang is OpenUI Lang, not JSX or JSON. Write one statement per line. Arguments are positional. Do not wrap lang in markdown fences.',
  'Start with root = Stack(...).',
])

export const interactiveVisualizeTool = defineVisualizeTool(INTERACTIVE_VISUALIZE_TOOL_NAME, interactiveVisualizeSpec, [
  'Render a card with buttons that send the next user turn.',
  'Use static_visualize for a table, chart, or status card that has no button.',
  'A button click starts a new turn. Do not use it for a question that must block the current tool.',
  'lang is OpenUI Lang, not JSX or JSON. Write one statement per line. Arguments are positional. Do not wrap lang in markdown fences.',
  'Start with root = Stack(...).',
  'Example: root = Stack([title, action])',
  'title = Text("Raise the budget?", "body")',
  'action = Button("Use 350", @ToAssistant("Make it under $350 a night"))',
])
