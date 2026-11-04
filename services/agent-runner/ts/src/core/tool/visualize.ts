import { VISUALIZE_TOOL_NAME } from '../event/tool-names.js'
import { defineTool, stringToolArg } from './define-tool.js'

export const visualizeTool = defineTool({
  name: VISUALIZE_TOOL_NAME,
  description: [
    'Render an interactive visual for the user from React JSX.',
    'The snippet runs in a sandboxed iframe, so onClick and useState work.',
    'Call this when the user asks for freeform JSX, a diagram, animation, or a small interactive mock.',
    'Use static_visualize instead for a card, table, or chart built from registered components.',
    'Use canvas instead for large HTML documents or an existing .html file that should open in the workspace preview. If that file already exists, edit it and pass path to canvas; do not regenerate it.',
    'Pass either a JSX snippet or a function named App, for example function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; }.',
    'Do not wrap the JSX in markdown fences, and do not import or export modules.',
    'Prefer inline style objects.',
    'Optional components: Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, Progress, Separator.',
    'For 3D explanations and simulations, THREE and OrbitControls are bundled locally; do not import from a CDN.',
    'Use useEffect with createThreeScene(containerRef.current), which returns scene, camera, renderer, controls, requestRender(), setAnimation(deltaSeconds => {}), and dispose(). Return view.dispose as effect cleanup. Give the container an explicit height. Call requestRender after static updates; use setAnimation only for motion.',
    'Declare each local resource path in assets (one absolute path per line, at most 16). Inside the snippet await assets.read(path) for ArrayBuffer or assets.url(path) for a texture/image blob URL. Only declared resources are readable; network requests are blocked. Each resource is limited to 32 MiB and all resources to 64 MiB.',
    'Code starts after generation completes. Theme changes preserve interactive state. Use the file preview for engineering model inspection and measurements; this tool is for executable interactive explanations.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      jsx: {
        type: 'string',
        description: 'Complete React JSX snippet to render. Raw JSX only, no markdown fences.',
      },
      assets: {
        type: 'string',
        description: 'Optional explicit resource allowlist: one absolute local file path per line, up to 16. No URLs, directory grants, or wildcard paths.',
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
    if (input['assets'] !== undefined && typeof input['assets'] !== 'string') {
      return Promise.resolve({ ok: false, text: 'visualize assets must be newline-separated absolute file paths' })
    }
    const assets = [...new Set(stringToolArg(input, 'assets').split(/\r?\n/).map((path) => path.trim()).filter(Boolean))]
    if (assets.length > 16 || assets.some((path) => !path.startsWith('/') || path.length > 4096 || path.includes('\0') || /[\\*?]/.test(path))) {
      return Promise.resolve({ ok: false, text: 'visualize assets must contain at most 16 absolute file paths without wildcards' })
    }
    return Promise.resolve({ ok: true, text: jsx })
  },
})
