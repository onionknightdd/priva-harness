import { describe, expect, it } from 'vitest'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { ownedSubagentMessages } from '../../../../src/provider/claude/session/claude-subagent-history.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'

const map = (message: unknown) => mapClaudeMessage(message, 'session')
const main = [map({ type: 'assistant', uuid: 'main', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'agent-call', name: 'Agent', input: {} }] } }),
  map({ type: 'user', uuid: 'result', toolUseResult: { agentId: 'regular' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'agent-call', content: 'launched' }] } })]

describe('subagent history ownership', () => {
 it('does not append unowned workflow worker messages to the main conversation', () => {
  const owned = ownedSubagentMessages(main, [{ agentId: 'workflow-worker', messages: [
   map({ type: 'assistant', uuid: 'worker-result', message: { role: 'assistant', content: [{ type: 'text', text: 'Verifier result' }] } }),
   map({ type: 'user', uuid: 'enforce', message: { role: 'user', content: '[structured-output-enforce] Call tool now.' } }),
  ] }])
  expect(owned).toEqual([])
  const thread = foldThread(replayClaudeSessionMessages([...main, ...owned]))
  expect(thread.some((message) => message.role === 'user')).toBe(false)
 })
 it('recovers ordinary Agent ownership from its result and deduplicates UUIDs', () => {
  const row = map({ type: 'assistant', uuid: 'worker', message: { role: 'assistant', content: [{ type: 'text', text: 'Regular result' }] } })
  const owned = ownedSubagentMessages(main, [{ agentId: 'regular', messages: [row, row] }])
  expect(owned).toHaveLength(1)
  expect(owned[0]?.parentToolUseId).toBe('agent-call')
  const thread = foldThread(replayClaudeSessionMessages([...main, ...owned]))
  expect(thread[0]?.nestedAgents?.[0]?.blocks[0]).toMatchObject({ type: 'text', text: 'Regular result' })
 })
})
