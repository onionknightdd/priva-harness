import { describe, expect, it } from 'vitest'

import { productTools } from '../../../src/core/tool/product-tools.js'
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
})
