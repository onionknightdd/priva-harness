import { expect, it, vi } from 'vitest'
import { readTerminalUsage, terminalUsageDelta } from '../../../../src/harness/terminal/terminal-run-usage.js'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { FakeSessionStore } from '../../../support/fake-session-store.js'

it('counts each native API message once across split blocks, retries and owned subagents', async () => {
  const store = new FakeSessionStore()
  const row = (uuid: string, id: string, output: number, parent: string | null = null, model = 'model') => mapClaudeMessage({
    type: 'assistant', uuid, session_id: 's', parent_tool_use_id: parent,
    message: { id, model, usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 4, cache_creation_input_tokens: 3 }, content: [] },
  }, 's')
  const messages = vi.spyOn(store, 'messages').mockResolvedValue([row('a', 'api', 1)])
  const before = await readTerminalUsage(store, { provider: 'claude', id: 's' })
  messages.mockResolvedValue([row('a', 'api', 1), row('b', 'api', 5), row('c', 'api', 2, 'agent-tool', 'child-model'), row('d', 'fake', 50, null, '<synthetic>')])
  const after = await readTerminalUsage(store, { provider: 'claude', id: 's' })
  expect(after.size).toBe(2)
  expect(terminalUsageDelta(before, after)).toEqual({ numTurns: 1, usage: { input: 10, output: 6, cacheRead: 4, cacheWrite: 3 }, byModel: {
    model: { input: 0, output: 4, cacheRead: 0, cacheWrite: 0 }, 'child-model': { input: 10, output: 2, cacheRead: 4, cacheWrite: 3 },
  } })
  expect(terminalUsageDelta(after, after).usage?.input).toBe(0)
})
