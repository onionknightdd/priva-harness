import { describe, expect, it } from 'vitest'
import { nativeClaudeAvailable, nativeClaudeFixture, modelMessage } from '../../../fixtures/terminal/claude-tui-fixture.js'
import type { DataRecord } from '../../../../src/core/resource/data-store.js'

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
    const fixture = await nativeClaudeFixture((body, reply) => {
      if (calls++ === 0) {
        expect(body.tools?.map((tool) => tool['name'])).toContain('mcp__agentWorkshop__visualize')
        return modelMessage(body, reply, [{ type: 'tool_use', id: 'visualize-native', name: 'mcp__agentWorkshop__visualize', input: { jsx: '<button>原生 JSX</button>' } }], 'product-call')
      }
      return modelMessage(body, reply, [{ type: 'text', text: 'Native product tool complete.' }], 'product-answer')
    }, { record: (record) => records.push(record) })
    try {
      fixture.send('Create a visual', 'native-product')
      await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 45000 }).toBe(true)
      const messages = fixture.harness.sessionStream(fixture.ref).snapshot().messages
      const tool = messages.flatMap((message) => message.blocks ?? []).find((block) => block.type === 'tool_use' && block.id === 'visualize-native')
      if (tool?.type !== 'tool_use') throw new Error('Product tool result is missing')
      expect(tool.tool?.ok).toBe(true)
      expect(tool.tool?.output).toBe('<button>原生 JSX</button>')
      await expect.poll(async () => (await fixture.harness.readContextUsage(fixture.ref)).used, { timeout: 10000 }).toBe(10)
      expect(fixture.frames.some((frame) => frame.type === 'session.config' && frame.config.model === 'claude-sonnet-4-6' && frame.config.profileId === fixture.profile.id)).toBe(true)
      expect(records.filter((record) => record.kind === 'run.started')).toHaveLength(1)
      expect(records.filter((record) => record.kind === 'run.finished')).toEqual([expect.objectContaining({ outcome: 'completed', usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0 } })])
      const finished = records.find((record) => record.kind === 'run.finished')
      if (finished?.kind !== 'run.finished') throw new Error('Accounting is missing')
      expect(finished.costUsd).toBeGreaterThan(0)
      expect(records.filter((record) => record.kind === 'tool')).toEqual([expect.objectContaining({ toolUseId: 'visualize-native', ok: true })])
      expect(fixture.sdkOpen).not.toHaveBeenCalled()
    } finally { await fixture.dispose() }
  }, 60000)
})
