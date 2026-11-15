import { describe, expect, it } from 'vitest'
import { nativeClaudeAvailable, nativeClaudeFixture, modelMessage } from '../../../fixtures/terminal/claude-tui-fixture.js'
import type { DataRecord } from '../../../../src/core/resource/data-store.js'
import { salesDashboardSource } from '../../../fixtures/a2ui/sales-dashboard.source.js'
import { compileA2uiSource } from '../../../../src/core/tool/a2ui-render.js'

describe.skipIf(!nativeClaudeAvailable())('native Claude product capabilities', () => {
  it('projects a native background task and opens its native management UI without claiming it was stopped', async () => {
    let calls = 0
    const fixture = await nativeClaudeFixture((body, reply) => calls++ === 0
      ? modelMessage(body, reply, [{ type: 'tool_use', id: 'native-job', name: 'Bash', input: { command: 'sleep 60', description: 'Native migration test job', run_in_background: true } }], 'job-call')
      : modelMessage(body, reply, [{ type: 'text', text: 'Job launched.' }], `job-${calls}`))
    try {
      fixture.send('Start the background job', 'job-run')
      await expect.poll(() => fixture.harness.sessionStream(fixture.ref).tasks.list().length, { timeout: 45000 }).toBe(1)
      await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 10000 }).toBe(true)
      const task = fixture.harness.sessionStream(fixture.ref).tasks.list()[0]
      if (!task) throw new Error('Native task is missing')
      expect(task.control).toBe('terminal')
      await fixture.harness.stopTask(fixture.ref, task.taskId)
      await expect.poll(() => fixture.terminals.capture(fixture.ref)).toMatch(/Shell details|Background tasks/u)
      expect(fixture.frames.some((frame) => frame.type === 'terminal.focus')).toBe(true)
      expect(fixture.harness.sessionStream(fixture.ref).tasks.get(task.taskId)?.status).toBe('unknown')
      expect(fixture.sdkOpen).not.toHaveBeenCalled()
    } finally { await fixture.dispose() }
  }, 60000)
  it('executes product MCP tools and mirrors their results, model, context and accounting without an SDK run', async () => {
    const records: DataRecord[] = []
    let calls = 0
    let productCalled = false
    let waitCalls = 0
    const fixture = await nativeClaudeFixture((body, reply) => {
      calls += 1
      if (!productCalled) {
        const tools = body.tools?.map((tool) => tool['name']) ?? []
        // The native CLI connects MCP servers asynchronously and exposes this lifecycle tool.
        if (!tools.includes('mcp__agentWorkshop__render_ui')) {
          expect(tools).toContain('WaitForMcpServers')
          waitCalls += 1
          expect(waitCalls).toBeLessThan(4)
          return modelMessage(body, reply, [{ type: 'tool_use', id: `wait-mcp-${waitCalls}`, name: 'WaitForMcpServers', input: {} }], `mcp-wait-${waitCalls}`)
        }
        expect(tools).not.toContain('mcp__agentWorkshop__visualize')
        productCalled = true
        return modelMessage(body, reply, [{ type: 'tool_use', id: 'render-ui-native', name: 'mcp__agentWorkshop__render_ui', input: { source: salesDashboardSource } }], 'product-call')
      }
      return modelMessage(body, reply, [{ type: 'text', text: 'Native product tool complete.' }], 'product-answer')
    }, { record: (record) => records.push(record) })
    try {
      fixture.send('Create a sales dashboard', 'native-product', 'claude-sonnet-4-6', { visualizeMode: true })
      await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 45000 }).toBe(true)
      const messages = fixture.harness.sessionStream(fixture.ref).snapshot().messages
      const tool = messages.flatMap((message) => message.blocks ?? []).find((block) => block.type === 'tool_use' && block.id === 'render-ui-native')
      if (tool?.type !== 'tool_use') throw new Error('Product tool result is missing')
      expect(tool.tool?.ok).toBe(true)
      expect(tool.tool?.output).toBe(JSON.stringify(compileA2uiSource(salesDashboardSource)))
      await expect.poll(async () => (await fixture.harness.readContextUsage(fixture.ref)).used, { timeout: 10000 }).toBe(10)
      expect(fixture.frames.some((frame) => frame.type === 'session.config' && frame.config.model === 'claude-sonnet-4-6' && frame.config.profileId === fixture.profile.id)).toBe(true)
      expect(records.filter((record) => record.kind === 'run.started')).toHaveLength(1)
      expect(records.filter((record) => record.kind === 'run.finished')).toEqual([expect.objectContaining({ outcome: 'completed', usage: { input: calls * 10, output: calls * 5, cacheRead: 0, cacheWrite: 0 } })])
      const finished = records.find((record) => record.kind === 'run.finished')
      if (finished?.kind !== 'run.finished') throw new Error('Accounting is missing')
      expect(finished.costUsd).toBeGreaterThan(0)
      expect(records.filter((record) => record.kind === 'tool' && record.toolUseId === 'render-ui-native')).toEqual([expect.objectContaining({ toolUseId: 'render-ui-native', ok: true })])
      expect(fixture.sdkOpen).not.toHaveBeenCalled()
    } finally { await fixture.dispose() }
  }, 60000)
})
