import { VISUALIZE_TOOL_NAME } from '../event/tool-names.js'
import { defineTool, stringToolArg } from './define-tool.js'

export const visualizeTool = defineTool({
  name: VISUALIZE_TOOL_NAME,
  description: [
    'Render a visual for the user from React JSX.',
    'Call this when the user asks to visualize, chart, diagram, or mock a UI.',
    'Pass a complete JSX snippet in "jsx", for example <div style={{padding: 16}}>…</div>.',
    'Do not wrap the JSX in markdown fences, and do not include import/export or function wrappers.',
    'Prefer inline style objects.',
    'Optional components: Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, Progress, Separator.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      jsx: {
        type: 'string',
        description: 'Complete React JSX snippet to render. Raw JSX only, no markdown fences.',
      },
    },
    required: ['jsx'],
  },
  execute(input) {
    const jsx = stringToolArg(input, 'jsx')
    if (jsx.trim() === '') {
      return Promise.resolve({
        ok: false,
        text: 'visualize requires a non-empty jsx string',
      })
    }
    return Promise.resolve({ ok: true, text: jsx })
  },
})
