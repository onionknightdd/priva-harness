import { describe, expect, it } from 'vitest'

import { productTools } from '../../../src/core/tool/product-tools.js'
import { compileA2uiSource } from '../../../src/core/tool/a2ui-render.js'
import { defineTool } from '../../../src/core/tool/define-tool.js'
import {
  PRODUCT_MCP_TOOL_TIMEOUT_MS,
  compileClaudeCustomTools,
} from '../../../src/provider/claude/tools/compile-custom-tools.js'
import { compilePiCustomTools } from '../../../src/provider/pi/tools/compile-custom-tools.js'

const context = {
  cwd: '/work',
  session: { provider: 'claude' as const, id: 'sess-1' },
  signal: new AbortController().signal,
}

describe('compile custom tools', () => {
  it('compiles product tools into a Claude SDK MCP server and aliases', () => {
    const compiled = compileClaudeCustomTools(productTools, context)
    expect(compiled.toolAliases).toEqual({
      visualize: 'mcp__agentWorkshop__visualize',
      canvas: 'mcp__agentWorkshop__canvas',
      whiteboard_read: 'mcp__agentWorkshop__whiteboard_read',
      whiteboard_write: 'mcp__agentWorkshop__whiteboard_write',
      render_ui: 'mcp__agentWorkshop__render_ui',
      image_gen: 'mcp__agentWorkshop__image_gen',
      image_read: 'mcp__agentWorkshop__image_read',
      image_edit: 'mcp__agentWorkshop__image_edit',
    })
    expect(compiled.mcpServers).toMatchObject({
      agentWorkshop: {
        type: 'sdk',
        name: 'agentWorkshop',
        timeout: PRODUCT_MCP_TOOL_TIMEOUT_MS,
      },
    })
  })

  it('compiles visualize into a Pi custom tool that echoes jsx', async () => {
    const [visualize] = compilePiCustomTools(productTools, {
      ...context,
      session: { provider: 'pi', id: 'sess-1' },
    })
    expect(visualize?.name).toBe('visualize')
    const result = await visualize?.execute(
      'call-1',
      { jsx: '<span>ok</span>' },
      context.signal,
      undefined,
      {} as never,
    )
    expect(result).toMatchObject({
      content: [{ type: 'text', text: '<span>ok</span>' }],
    })
  })

  it('returns nothing when the catalog is empty', () => {
    expect(compileClaudeCustomTools([], context)).toEqual({})
    expect(compilePiCustomTools([], context)).toEqual([])
  })

  it('compiles render_ui to a Pi native tool with validated canonical output and failures', async () => {
    const renderUi = compilePiCustomTools(productTools, {
      ...context, session: { provider: 'pi', id: 'a2ui-native' },
    }).find((tool) => tool.name === 'render_ui')
    if (renderUi === undefined) throw new Error('render_ui was not registered')
    const source = 'root = Heading(text="Native Pi UI")'
    await expect(renderUi.execute('ui-1', { source }, context.signal, undefined, {} as never)).resolves.toEqual({
      content: [{ type: 'text', text: JSON.stringify(compileA2uiSource(source)) }], details: {},
    })
    await expect(renderUi.execute('ui-2', { source: 'root = Column(children=[missing])' }, context.signal, undefined, {} as never))
      .rejects.toThrow('missing')
    const controller = new AbortController()
    controller.abort()
    await expect(renderUi.execute('ui-3', { source }, controller.signal, undefined, {} as never)).rejects.toThrow('cancelled')
  })

  it.each(['image_read', 'image_gen', 'image_edit'])('reports %s failures to Pi with the original error text', async (name) => {
    const raw = '{"error":{"message":"Original service failure <detail>"}}'
    const definition = defineTool({ name, description: 'Image error fixture', inputSchema: { type: 'object', properties: {} }, execute: () => Promise.resolve({ ok: false, text: raw }) })
    const [tool] = compilePiCustomTools([definition], { ...context, session: { provider: 'pi', id: 'sess-1' } })
    if (!tool) throw new Error('Image fixture did not compile')
    await expect(tool.execute('call-1', {}, context.signal, undefined, {} as never)).rejects.toMatchObject({ message: raw })
  })
})
