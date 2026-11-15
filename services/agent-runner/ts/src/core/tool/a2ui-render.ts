import {
  A2uiError,
  A2uiGenerator,
  CatalogConfig,
  ExpressFormatFactory,
  InMemoryCatalogProvider,
  type AgentToRendererMessage,
} from '@a2ui/agent'

import { a2uiCatalogDefinition } from './a2ui-catalog.generated.js'
import { RENDER_UI_TOOL_NAME } from '../event/tool-names.js'
import { MAX_A2UI_SOURCE_LENGTH, validateA2uiSurface } from './a2ui-validation.js'
import { defineTool, stringToolArg } from './define-tool.js'

const SURFACE_ID = 'main'
const catalog = new InMemoryCatalogProvider(a2uiCatalogDefinition).load()
const generator = new A2uiGenerator([new CatalogConfig(catalog)])
const capabilities = { supportedCatalogIds: [catalog.id] }
const format = new ExpressFormatFactory({
  surfaceId: SURFACE_ID,
  version: 'v1.0',
  allowedMessages: ['createSurface', 'updateComponents', 'updateDataModel'],
})

export interface A2uiToolOutput {
  readonly format: 'a2ui'
  readonly version: '1.0'
  readonly messages: AgentToRendererMessage[]
}

class A2uiSourceError extends Error {}

function completeSource(source: string): string {
  if (source.length > MAX_A2UI_SOURCE_LENGTH) {
    throw new A2uiSourceError(`source exceeds ${MAX_A2UI_SOURCE_LENGTH} characters. Summarize or split the content into separate calls.`)
  }
  const trimmed = source.trim()
  if (trimmed === '') {
    throw new A2uiSourceError('source is required. Provide a complete A2UI Express program with root = Component(...).')
  }
  if (!trimmed.startsWith('<a2ui>')) return trimmed
  if (!trimmed.endsWith('</a2ui>')) {
    throw new A2uiSourceError('The <a2ui> block is incomplete. Include the closing </a2ui> tag and every referenced component.')
  }
  return trimmed.slice('<a2ui>'.length, -'</a2ui>'.length).trim()
}

/** Compile and validate a complete response without retaining another tool call's state. */
export function compileA2uiSource(source: string, signal?: AbortSignal): A2uiToolOutput {
  signal?.throwIfAborted()
  const program = completeSource(source)
  const processor = generator.createProcessor(capabilities, format)
  const state = processor.createState()
  // Full-block parsing always checks the final tree, including missing children and cycles.
  const parts = processor.parseResponse(program, { wrapped: false, state })
  const messages = parts.flatMap((part) => part.type === 'a2ui' ? part.a2ui : [])
  const surfaces = messages.filter((message) => 'createSurface' in message)
  if (surfaces.length !== 1 || surfaces[0]?.createSurface.surfaceId !== SURFACE_ID) {
    throw new A2uiSourceError('Create exactly one UI with root = Component(...). Use the default main surface; do not target another surface.')
  }
  for (const message of messages) {
    const operation = 'createSurface' in message ? message.createSurface
      : 'updateComponents' in message ? message.updateComponents
        : 'updateDataModel' in message ? message.updateDataModel
          : null
    if (operation?.surfaceId !== SURFACE_ID) {
      throw new A2uiSourceError('Only createSurface, updateComponents and updateDataModel on the main surface are supported. Every call creates a new independent UI.')
    }
  }
  const surface = state.getSurface(SURFACE_ID)
  if (surface === undefined) throw new A2uiSourceError('The program must create a main surface with a root component.')
  try {
    validateA2uiSurface(surface)
  } finally {
    surface.dispose()
  }
  signal?.throwIfAborted()
  return { format: 'a2ui', version: '1.0', messages }
}

// The SDK also serves persistent multi-surface canvases. Its generic surface(...)
// example conflicts with this tool's independent inline results, and cannot be
// disabled through allowedMessages while createSurface remains enabled.
const inlineExpressPrompt = generator.createProcessor(capabilities, format).promptSnippet.replace(
  /^15\. Surface targeting:[^\n]*(?:\n {4}[^\n]*)*/mu,
  '15. Inline UI: The host creates the main surface for each tool call. Create the UI by assigning root = Component(...); do not emit a surface(...) command or choose a surface ID.',
)

const description = [
  'Render a polished, interactive UI in the conversation using A2UI Express and the registered shadcn/ui catalog.',
  'Use this for dashboards, charts, comparisons, forms and choices. Supply real data from the conversation; label illustrative data clearly.',
  'The host compiles source to validated A2UI 1.0 messages. Do not output HTML, JavaScript, JSX, CSS or raw protocol JSON.',
  'Each call creates one fresh independent surface named main. Assign root; do not use surface(...) or deleteSurface(...), and do not refer to earlier tool calls.',
  inlineExpressPrompt,
  'Host rules: pass the complete program in the source argument. A single complete <a2ui>...</a2ui> wrapper is accepted; Markdown fences and surrounding prose are not.',
  'Table takes columns: string[], rows: (string | number)[][], and an optional title. Each row must have exactly one cell per column. Use string column labels and arrays of cell values, not column-definition objects or row objects. Example:\n<a2ui>\nroot = Table(["Service", "State"], [["Example MCP", "Available"]], "MCP status")\n</a2ui>',
  'Prefer a Heading followed by a Grid of Stat cards and clearly titled charts. Use concise labels, consistent units, and supported properties; the frontend owns styling.',
  'Initialize every data binding with $/path = value; this renderer supports absolute paths and explicit children lists, not relative bindings or dynamic list templates. TextField and Select values must bind to initialized strings. Use at most 200 components and 64000 source characters.',
  'For user choices, use Button(label="Continue", action={event:{name:"action_name",context:{key:value},userMessage:"Readable request"}}). Always supply a concise human-readable userMessage, which appears as the next user message after a click. Use this explicit event map instead of the Event helper to preserve userMessage. Events return user click context to this conversation; they do not run code or call external APIs.',
  'Inside an explicit event map, bind form values using context:{region:{"@path":"/region"}}. Use value=$/region on TextField or Select. The event map requires the explicit @path object rather than the $/path shorthand.',
  'A user click arrives as readable text followed by <priva-a2ui-action> JSON </priva-a2ui-action>. The JSON has version: 1, toolCallId, and action containing name, surfaceId, sourceComponentId, timestamp and context. toolCallId identifies which independent UI was clicked. Use action.context to answer or call render_ui with a complete new UI. The previous UI remains part of conversation history.',
].join('\n\n')

export const renderUiTool = defineTool({
  name: RENDER_UI_TOOL_NAME,
  description,
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Complete A2UI Express source with one root and all referenced components and data.' },
    },
    required: ['source'],
  },
  execute(input, context) {
    try {
      const output = compileA2uiSource(stringToolArg(input, 'source'), context.signal)
      return Promise.resolve({ ok: true, text: JSON.stringify(output) })
    } catch (error) {
      if (context.signal.aborted) {
        return Promise.resolve({ ok: false, text: 'A2UI rendering was cancelled. No UI was published.' })
      }
      if (!(error instanceof A2uiError) && !(error instanceof A2uiSourceError)) throw error
      return Promise.resolve({
        ok: false,
        text: `A2UI source is invalid: ${error.message}\nFix the source using the catalog signatures, then call render_ui again with the complete program.`,
      })
    }
  },
})
