import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { CANVAS_TOOL_NAME } from '../event/tool-names.js'
import { defineTool, stringToolArg } from './define-tool.js'

const CANVAS_DIRECTORY_NAME = '.canvas'
const DEFAULT_CANVAS_FILE_NAME = 'canvas.html'

export const canvasTool = defineTool({
  name: CANVAS_TOOL_NAME,
  description: [
    'Open HTML in the workspace preview.',
    'Pass html only for the first version of a new document. The tool saves it under .canvas and returns the file path.',
    'If this document already exists, or the user provided an HTML file path, do not generate a new file and do not pass html again.',
    'Edit the existing file with the file tools to match the user request, then call canvas with path only so the preview reloads that file.',
    'html may also be a .html file path when you are not sending markup.',
    'Use this for multi-section pages, documents, dashboards, or any HTML that needs a full preview surface.',
    'Inline script and click handlers run in the workspace preview sandbox.',
    'Do not use this for compact inline React snippets; use visualize for those.',
    'Do not wrap markup in markdown fences.',
    'The chat UI does not show the HTML. It opens the workspace preview when the user clicks the canvas card.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description:
          'Complete HTML document for a new artifact, or an existing .html file path. Use only when the file does not exist yet. Raw HTML only, no markdown fences.',
      },
      path: {
        type: 'string',
        description:
          'Existing workspace .html file to reload in preview after you edited it. Relative to the working directory or absolute inside it. Do not pass html with this path.',
      },
      name: {
        type: 'string',
        description:
          'Optional file name when writing html without path. Stored as .canvas/<name>.html.',
      },
      title: {
        type: 'string',
        description: 'Optional display title. Used as the file name when name is omitted.',
      },
    },
  },
  async execute(input, context) {
    const { html, path: filePathArg } = canvasSource(input)
    if (html === '' && filePathArg === '') {
      return {
        ok: false,
        text: 'canvas requires html or an html file path',
      }
    }

    try {
      if (filePathArg !== '') {
        const filePath = resolveWorkspaceFilePath(context.cwd, filePathArg)
        if (!isHtmlFilePath(filePath)) {
          return { ok: false, text: 'canvas path must be an .html file' }
        }
        if (html !== '') {
          await mkdir(path.dirname(filePath), { recursive: true })
          await writeFile(filePath, html, 'utf8')
          return { ok: true, text: filePath }
        }
        await assertExistingHtmlFile(filePath)
        return { ok: true, text: filePath }
      }

      const fileName = canvasFileName(
        stringToolArg(input, 'name') || stringToolArg(input, 'title'),
      )
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

export function canvasSource(input: Readonly<Record<string, unknown>>): {
  html: string
  path: string
} {
  const htmlArg = (
    stringToolArg(input, 'html') || stringToolArg(input, 'code')
  ).trim()
  const pathArg = (
    stringToolArg(input, 'path') || stringToolArg(input, 'file_path')
  ).trim()
  if (pathArg !== '') {
    return { html: looksLikeHtmlFilePath(htmlArg) ? '' : htmlArg, path: pathArg }
  }
  if (looksLikeHtmlFilePath(htmlArg)) {
    return { html: '', path: htmlArg }
  }
  return { html: htmlArg, path: '' }
}

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

export function resolveWorkspaceFilePath(cwd: string, raw: string): string {
  const root = path.resolve(cwd)
  const filePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw)
  const relative = path.relative(root, filePath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('canvas path must stay inside the workspace')
  }
  return filePath
}

export function isHtmlFilePath(filePath: string): boolean {
  return /\.html?$/i.test(filePath)
}

export function looksLikeHtmlFilePath(value: string): boolean {
  const trimmed = value.trim()
  return isHtmlFilePath(trimmed) && !trimmed.includes('<') && !trimmed.includes('\n')
}

async function assertExistingHtmlFile(filePath: string): Promise<void> {
  let info
  try {
    info = await stat(filePath)
  } catch {
    throw new Error(`canvas path does not exist: ${filePath}`)
  }
  if (!info.isFile()) {
    throw new Error(`canvas path is not a file: ${filePath}`)
  }
}
