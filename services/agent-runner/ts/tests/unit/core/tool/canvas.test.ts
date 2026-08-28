import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CANVAS_TOOL_NAME,
  canonicalProductToolName,
  isCanvasToolName,
  VISUALIZE_TOOL_NAME,
} from '../../../../src/core/event/tool-names.js'
import {
  canvasFileName,
  canvasTool,
  resolveCanvasFilePath,
} from '../../../../src/core/tool/canvas.js'
import { productTools } from '../../../../src/core/tool/product-tools.js'

async function toolContext(cwd?: string) {
  return {
    cwd: cwd ?? (await mkdtemp(path.join(tmpdir(), 'canvas-tool-'))),
    session: { provider: 'claude' as const, id: 'sess-1' },
    signal: new AbortController().signal,
  }
}

describe('canvas tool', () => {
  it('writes html under .canvas and returns the file path', async () => {
    const context = await toolContext()
    const html = '<!doctype html><html><body><h1>Report</h1></body></html>'
    const result = await canvasTool.execute(
      { html, name: 'quarterly-report', title: 'Quarterly report' },
      context,
    )

    const expected = path.join(context.cwd, '.canvas', 'quarterly-report.html')
    expect(result).toEqual({ ok: true, text: expected })
    await expect(readFile(expected, 'utf8')).resolves.toBe(html)
  })

  it('uses title when name is omitted and defaults the file name', async () => {
    const context = await toolContext()
    const titled = await canvasTool.execute(
      { html: '<p>titled</p>', title: 'Board Review' },
      context,
    )
    expect(titled).toEqual({
      ok: true,
      text: path.join(context.cwd, '.canvas', 'Board-Review.html'),
    })

    const unnamed = await canvasTool.execute({ html: '<p>plain</p>' }, context)
    expect(unnamed).toEqual({
      ok: true,
      text: path.join(context.cwd, '.canvas', 'canvas.html'),
    })
  })

  it('opens an existing workspace html file without rewriting it', async () => {
    const context = await toolContext()
    const filePath = path.join(context.cwd, 'docs', 'board.html')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, '<p>keep me</p>', 'utf8')

    await expect(
      canvasTool.execute({ path: 'docs/board.html' }, context),
    ).resolves.toEqual({ ok: true, text: filePath })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('<p>keep me</p>')
  })

  it('treats an html argument that is a file path as a path', async () => {
    const context = await toolContext()
    const filePath = path.join(context.cwd, 'page.html')
    await writeFile(filePath, '<p>from path</p>', 'utf8')

    await expect(
      canvasTool.execute({ html: 'page.html' }, context),
    ).resolves.toEqual({ ok: true, text: filePath })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('<p>from path</p>')
  })

  it('writes html to a provided workspace path', async () => {
    const context = await toolContext()
    const html = '<h1>Saved</h1>'
    const result = await canvasTool.execute(
      { html, path: 'public/deck.html' },
      context,
    )
    const expected = path.join(context.cwd, 'public', 'deck.html')
    expect(result).toEqual({ ok: true, text: expected })
    await expect(readFile(expected, 'utf8')).resolves.toBe(html)
  })

  it('rejects a blank payload and a missing or unsafe path', async () => {
    const context = await toolContext()
    await expect(canvasTool.execute({ html: '   ' }, context)).resolves.toEqual({
      ok: false,
      text: 'canvas requires html or an html file path',
    })
    await expect(
      canvasTool.execute({ path: 'missing.html' }, context),
    ).resolves.toMatchObject({
      ok: false,
    })
    await expect(
      canvasTool.execute({ path: '../secret.html' }, context),
    ).resolves.toEqual({
      ok: false,
      text: 'canvas path must stay inside the workspace',
    })
    await expect(
      canvasTool.execute({ path: 'notes.txt' }, context),
    ).resolves.toEqual({
      ok: false,
      text: 'canvas path must be an .html file',
    })
  })

  it('keeps sanitized names inside .canvas', () => {
    expect(canvasFileName('../../etc/passwd')).toBe('passwd.html')
    expect(canvasFileName('Q2 Report!.html')).toBe('Q2-Report.html')
    expect(canvasFileName('')).toBe('canvas.html')
    expect(
      resolveCanvasFilePath('/work', 'report.html'),
    ).toBe(path.resolve('/work/.canvas/report.html'))
    expect(() => resolveCanvasFilePath('/work', '../secret.html')).toThrow(
      'canvas path must stay inside .canvas',
    )
  })

  it('is registered on the product catalog', () => {
    expect(productTools.map((tool) => tool.name)).toEqual([
      VISUALIZE_TOOL_NAME,
      CANVAS_TOOL_NAME,
    ])
  })

  it('tells the model it can write html or open an existing path', () => {
    expect(canvasTool.description).toContain('workspace preview')
    expect(canvasTool.description).toContain('does not show the HTML')
    expect(canvasTool.description).toContain('Pass path')
    expect(canvasTool.description).toContain('preview sandbox')
    expect(canvasTool.description).toContain('visualize')
  })
})

describe('canonicalProductToolName', () => {
  it('maps Claude SDK MCP names onto canvas', () => {
    expect(canonicalProductToolName('mcp__agentWorkshop__canvas')).toBe('canvas')
    expect(canonicalProductToolName('Canvas')).toBe('canvas')
    expect(isCanvasToolName('mcp__agentWorkshop__canvas')).toBe(true)
    expect(isCanvasToolName('visualize')).toBe(false)
  })
})
