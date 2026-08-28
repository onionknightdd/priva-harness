import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { CANVAS_TOOL_NAME } from '../event/tool-names.js'
import { defineTool, stringToolArg } from './define-tool.js'

const CANVAS_DIRECTORY_NAME = '.canvas'
const DEFAULT_CANVAS_FILE_NAME = 'canvas.html'

export const canvasTool = defineTool({
  name: CANVAS_TOOL_NAME,
  description: [
    'Write a large HTML artifact for the user to open in the workspace HTML preview.',
    'Use this for multi-section pages, documents, dashboards, or any HTML that needs a full preview surface and richer workspace interaction.',
    'Inline script and click handlers run in the workspace preview sandbox.',
    'Do not use this for compact inline React snippets; use visualize for those.',
    'Pass a complete HTML document in html. Optional name or title becomes the .canvas file name.',
    'Do not wrap the HTML in markdown fences.',
    'The chat UI does not show the HTML. It opens the workspace preview when the user clicks the canvas card.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description:
          'Complete HTML document to write. Raw HTML only, no markdown fences.',
      },
      name: {
        type: 'string',
        description:
          'Optional file name for the artifact. Stored as .canvas/<name>.html.',
      },
      title: {
        type: 'string',
        description: 'Optional display title. Used as the file name when name is omitted.',
      },
    },
    required: ['html'],
  },
  async execute(input, context) {
    const html = stringToolArg(input, 'html')
    if (html.trim() === '') {
      return {
        ok: false,
        text: 'canvas requires a non-empty html string',
      }
    }

    const fileName = canvasFileName(
      stringToolArg(input, 'name') || stringToolArg(input, 'title'),
    )

    try {
      const filePath = resolveCanvasFilePath(context.cwd, fileName)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, html, 'utf8')
      return { ok: true, text: filePath }
    } catch (error) {
      return {
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      }
    }
  },
})

export function canvasFileName(raw: string): string {
  const base = raw.replaceAll('\\', '/').split('/').pop() ?? ''
  const stripped = base
    .replace(/\.html?$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (stripped === '') {
    return DEFAULT_CANVAS_FILE_NAME
  }
  return `${stripped}.html`
}

export function resolveCanvasFilePath(cwd: string, fileName: string): string {
  const canvasDir = path.resolve(cwd, CANVAS_DIRECTORY_NAME)
  const filePath = path.resolve(canvasDir, fileName)
  const relative = path.relative(canvasDir, filePath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('canvas path must stay inside .canvas')
  }
  return filePath
}
