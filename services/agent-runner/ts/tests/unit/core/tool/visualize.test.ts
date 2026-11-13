import { describe, expect, it } from 'vitest'

import {
  canonicalProductToolName,
  isVisualizeToolName,
  VISUALIZE_TOOL_NAME,
} from '../../../../src/core/event/tool-names.js'
import { visualizeTool } from '../../../../src/core/tool/visualize.js'
import { productTools } from '../../../../src/core/tool/product-tools.js'

const context = {
  cwd: '/work',
  session: { provider: 'claude' as const, id: 'sess-1' },
  signal: new AbortController().signal,
}

describe('visualize tool', () => {
  it('echoes jsx unchanged', async () => {
    const jsx = '<div style={{padding: 16}}>Hello</div>'
    await expect(visualizeTool.execute({ jsx }, context)).resolves.toEqual({
      ok: true,
      text: jsx,
    })
  })

  it('rejects a blank jsx payload', async () => {
    await expect(visualizeTool.execute({ jsx: '   ' }, context)).resolves.toEqual({
      ok: false,
      text: 'visualize requires a non-empty jsx string',
    })
  })

  it('accepts only a bounded list of explicit local asset paths', async () => {
    const jsx = '<div>3D scene</div>'
    await expect(visualizeTool.execute({ jsx, assets: '/work/texture.png\n/work/mesh.bin' }, context)).resolves.toEqual({ ok: true, text: jsx })
    for (const assets of ['https://example.com/a', '../file', '/work/*', '/bad\0path', Array.from({ length: 17 }, (_, i) => `/file-${i}`).join('\n'), ['array']]) {
      expect((await visualizeTool.execute({ jsx, assets }, context)).ok).toBe(false)
    }
    expect(visualizeTool.description).toContain('createThreeScene')
    expect(visualizeTool.description).toContain('assets.read(path)')
  })

  it('is registered on the product catalog', () => {
    expect(productTools.map((tool) => tool.name)).toEqual([
      VISUALIZE_TOOL_NAME,
      'canvas',
      'whiteboard_read',
      'whiteboard_write',
      'static_visualize',
      'interactive_visualize',
      'image_gen',
      'image_read',
      'image_edit',
    ])
  })

  it('tells the model the preview is interactive and sandboxed', () => {
    expect(visualizeTool.description).toContain('sandboxed iframe')
    expect(visualizeTool.description).toContain('useState')
    expect(visualizeTool.description).toContain('onClick')
  })
})

describe('canonicalProductToolName', () => {
  it('maps Claude SDK MCP names onto visualize', () => {
    expect(canonicalProductToolName('mcp__agentWorkshop__visualize')).toBe('visualize')
    expect(canonicalProductToolName('Visualize')).toBe('visualize')
    expect(isVisualizeToolName('mcp__agentWorkshop__visualize')).toBe(true)
    expect(canonicalProductToolName('mcp__github__create_issue')).toBe(
      'mcp__github__create_issue',
    )
  })
})
