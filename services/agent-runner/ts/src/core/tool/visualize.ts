import { VISUALIZE_TOOL_NAME } from '../event/tool-names.js'
import { defineTool, stringToolArg } from './define-tool.js'

export const visualizeTool = defineTool({
  name: VISUALIZE_TOOL_NAME,
  description: [
    'Render an interactive visual for the user from React JSX.',
    'The snippet runs in a sandboxed iframe, so onClick and useState work.',
    'Call this when the user asks to visualize, chart, diagram, or mock a compact UI in chat.',
    'Use canvas instead for large HTML documents or an existing .html file that should open in the workspace preview. If that file already exists, edit it and pass path to canvas; do not regenerate it.',
    'Pass either a JSX snippet or a function named App, for example function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; }.',
    'Do not wrap the JSX in markdown fences, and do not import or export modules.',
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
