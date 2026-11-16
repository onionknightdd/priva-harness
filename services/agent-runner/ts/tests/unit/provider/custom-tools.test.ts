import { describe, expect, it } from 'vitest'

import { productTools } from '../../../src/core/tool/product-tools.js'
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

  it('stops a Claude tool with its own call and names the tool in its progress', async () => {
    const progress: [string, string][] = []
    let aborted: boolean | undefined
    const definition = defineTool({
      name: 'image_read', description: 'Signal fixture', inputSchema: { type: 'object', properties: {} },
      execute: (_args, toolContext) => {
        aborted = toolContext.signal.aborted
        toolContext.emitProgress?.('half')
        return Promise.resolve({ ok: true, text: 'done' })
      },
    })
    const compiled = compileClaudeCustomTools([definition], context, (toolName, chunk) => progress.push([toolName, chunk]))
    // The SDK keeps the handlers it was given on its MCP server instance.
    const server = compiled.mcpServers?.['agentWorkshop'] as unknown as {
      instance: { _registeredTools: Record<string, { handler(args: unknown, extra: unknown): Promise<unknown> }> }
    }
    const registered = server.instance._registeredTools['image_read']
    if (!registered) throw new Error('Tool fixture did not register')
    const call = new AbortController()
    call.abort()

    // The query-wide signal in `context` is still live; only this call was interrupted.
    await expect(registered.handler({}, { signal: call.signal })).resolves.toMatchObject({ isError: false })
    expect(aborted).toBe(true)
    expect(progress).toEqual([['image_read', 'half']])
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

  it.each(['image_read', 'image_gen', 'image_edit'])('reports %s failures to Pi with the original error text', async (name) => {
    const raw = '{"error":{"message":"Original service failure <detail>"}}'
    const definition = defineTool({ name, description: 'Image error fixture', inputSchema: { type: 'object', properties: {} }, execute: () => Promise.resolve({ ok: false, text: raw }) })
    const [tool] = compilePiCustomTools([definition], { ...context, session: { provider: 'pi', id: 'sess-1' } })
    if (!tool) throw new Error('Image fixture did not compile')
    await expect(tool.execute('call-1', {}, context.signal, undefined, {} as never)).rejects.toMatchObject({ message: raw })
  })
})
