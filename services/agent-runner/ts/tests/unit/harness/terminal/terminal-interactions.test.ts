import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import type { InteractionRequest, InteractionResolution } from '../../../../src/core/resource/interaction.js'
import { TerminalInteractions } from '../../../../src/harness/terminal/terminal-interactions.js'

const question: InteractionRequest = { kind: 'question', requestId: 'request', toolUseId: 'tool', tool: 'AskUserQuestion', expiresAt: 0,
  questions: [{ id: 'q0', question: 'Color?', multiSelect: false, options: [{ label: 'Blue' }] }] }
const answer: InteractionResolution = { request: { ...question, requestId: 'history:tool' }, decision: 'allow', reason: 'answered',
  answers: { q0: { selected: [], text: 'Blue' } } }

function setup(request = question) {
  const events: AgentEvent[] = []
  const retired: AgentEvent[] = []
  const interactions = new TerminalInteractions((event) => events.push(event), (event) => retired.push(event))
  interactions.mirror({ type: 'permission.requested', request })
  const resolved = () => events.filter((event) => event.type === 'permission.resolved')
  return { interactions, events, retired, resolved }
}

describe('native interaction reconciliation', () => {
  it('defers mirror disconnect until the native answer, retains the request ID and emits once', () => {
    const { interactions, resolved, retired } = setup()
    interactions.mirror({ type: 'permission.resolved', resolution: { request: question, decision: 'deny', reason: 'cancelled' } })
    expect(resolved()).toEqual([])
    expect(retired).toMatchObject([{ type: 'permission.resolved', resolution: { reason: 'cancelled' } }])
    interactions.native({ type: 'permission.resolved', resolution: answer }, 'transcript')
    interactions.native({ type: 'permission.resolved', resolution: answer }, 'hook')
    interactions.finish()
    expect(resolved()).toEqual([{ type: 'permission.resolved', resolution: { ...answer, request: question } }])
  })

  it('does not replace a Web UI answer with its replay or a cancelled hook', () => {
    const { interactions, resolved } = setup()
    const webAnswer = { ...answer, request: question, answers: { q0: { selected: ['Blue'], text: '' } } }
    interactions.mirror({ type: 'permission.resolved', resolution: webAnswer })
    interactions.mirror({ type: 'permission.resolved', resolution: webAnswer })
    interactions.native({ type: 'permission.resolved', resolution: answer }, 'transcript')
    interactions.mirror({ type: 'permission.resolved', resolution: { request: question, decision: 'deny', reason: 'cancelled' } })
    expect(resolved()).toEqual([{ type: 'permission.resolved', resolution: webAnswer }])
  })

  it.each([true, false])('records native permission as approved even if execution fails (ok=%s)', (ok) => {
    const request: InteractionRequest = { kind: 'tool', requestId: 'r', toolUseId: 't', tool: 'Write', expiresAt: 0 }
    const { interactions, resolved } = setup(request)
    const event: AgentEvent = { type: 'tool.completed', id: 't', name: 'Write', ok, output: 'result' }
    interactions.native(event, 'transcript')
    expect(resolved()).toHaveLength(0)
    interactions.native(event, 'hook')
    expect(resolved()).toEqual([{ type: 'permission.resolved', resolution: { request, decision: 'allow', reason: 'answered' } }])
  })

  it('records native denial and ignores unrelated historical results', () => {
    const { interactions, resolved } = setup()
    interactions.native({ type: 'permission.resolved', resolution: { ...answer, request: { ...question, toolUseId: 'old' } } }, 'transcript')
    expect(resolved()).toHaveLength(0)
    interactions.native({ type: 'permission.resolved', resolution: { request: { kind: 'tool', requestId: 'history:tool', toolUseId: 'tool', tool: 'AskUserQuestion', expiresAt: 0 },
      decision: 'deny', reason: 'skipped' } }, 'transcript')
    expect(resolved()).toEqual([{ type: 'permission.resolved', resolution: { request: question, decision: 'deny', reason: 'skipped' } }])
  })

  it('settles a truly interrupted request as cancelled once', () => {
    const { interactions, resolved } = setup()
    interactions.mirror({ type: 'permission.resolved', resolution: { request: question, decision: 'deny', reason: 'cancelled' } })
    interactions.finish()
    interactions.finish()
    expect(resolved()).toEqual([{ type: 'permission.resolved', resolution: { request: question, decision: 'deny', reason: 'cancelled' } }])
  })

  it('handles a native result racing with the mirror request', () => {
    const events: AgentEvent[] = []
    const interactions = new TerminalInteractions((event) => events.push(event))
    interactions.native({ type: 'tool.started', id: 'tool', name: 'AskUserQuestion', input: {}, messageId: 'm', blockId: 'b' }, 'hook')
    interactions.native({ type: 'permission.resolved', resolution: answer }, 'hook')
    interactions.mirror({ type: 'permission.requested', request: question })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ type: 'permission.resolved', resolution: { decision: 'allow', request: { requestId: 'request' } } })
  })

  it('correlates exact input and agent without guessing identical pending calls', () => {
    const { interactions } = setup()
    const question = { sessionId: 's', instanceId: 'i', cwd: '/tmp', tool: 'Write', input: { path: 'x' } }
    const tool: Extract<AgentEvent, { type: 'tool.started' }> = { type: 'tool.started', id: 't', name: 'Write', input: question.input, messageId: 'm', blockId: 'b' }
    interactions.native(tool, 'hook')
    interactions.native({ ...tool, id: 'child', agentId: 'a' }, 'hook')
    expect(interactions.toolId(question)).toBe('t')
    expect(interactions.toolId({ ...question, agentId: 'a' })).toBe('child')
    interactions.native({ ...tool, id: 'duplicate' }, 'hook')
    expect(interactions.toolId(question)).toBeUndefined()
    expect(interactions.toolId({ ...question, toolUseId: 't' })).toBe('t')
  })

  it.each(['accept', 'decline', 'cancel'])('records native MCP form action %s and preserves typed answers', (action) => {
    const request: InteractionRequest = { kind: 'question', requestId: 'form', tool: 'mcp__server__elicitation', expiresAt: 0,
      questions: [], input: { elicitationId: 'elicit-1', schema: { type: 'object', required: ['count', 'enabled'], properties: {
        count: { type: 'integer', minimum: 0 }, enabled: { type: 'boolean' }, label: { type: 'string' },
      } } } }
    const { interactions, resolved } = setup(request)
    interactions.mirror({ type: 'permission.resolved', resolution: { request, decision: 'deny', reason: 'cancelled' } })
    interactions.native({ type: 'ext', vendor: 'claude', name: 'elicitation.result', data: { serverName: 'server', elicitationId: 'other', action, content: { count: 0, enabled: false } } }, 'hook')
    expect(resolved()).toHaveLength(0)
    interactions.native({ type: 'ext', vendor: 'claude', name: 'elicitation.result', data: { serverName: 'server', elicitationId: 'elicit-1', action, content: { count: 0, enabled: false } } }, 'hook')
    interactions.finish()
    expect(resolved()).toEqual([{ type: 'permission.resolved', resolution: {
      request, decision: action === 'accept' ? 'allow' : 'deny', reason: action === 'accept' ? 'answered' : action === 'decline' ? 'skipped' : 'cancelled',
      ...(action === 'accept' ? { answers: { q0: { selected: [], text: '0' }, q1: { selected: ['false'], text: '' }, q2: { selected: ['Omit this field'], text: '' } } } : {}),
    } }])
  })
})
