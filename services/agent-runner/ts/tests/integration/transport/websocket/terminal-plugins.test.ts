import { PLATFORM_INSTRUCTIONS } from '../../../../src/harness/prompt/platform-instructions.js'
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveClaudeQueryOptions } from '../../../../src/provider/claude/claude-runtime.js'
import { describe, expect, it } from 'vitest'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

describe.skipIf(!nativeClaudeAvailable())('native Claude product skill plugins', () => {
  it('discovers and invokes the skill through the actual SDK, then excludes it on resume', async () => {
    let enabled = true
    let calledSkill = false
    let readSkill: boolean
    const fixture = await nativeClaudeFixture((body, reply) => {
      if (!calledSkill) {
        calledSkill = true
        return modelMessage(body, reply, [{ type: 'tool_use', id: enabled ? 'sdk-on' : 'sdk-off', name: 'Skill', input: { skill: 'agent-dashboard:agent-dashboard' } }])
      }
      if (enabled) expect(JSON.stringify(body.messages)).toContain('a2ui:regional-sales')
      else {
        const last = [...body.messages].reverse().find((message) => Array.isArray(message.content) && message.content.some((block) => block['type'] === 'tool_result'))
        expect(JSON.stringify(last)).toMatch(/Unknown skill|not found|not available/iu)
      }
      readSkill = true
      return modelMessage(body, reply, [{ type: 'text', text: 'SDK plugin verification complete.' }])
    })
    let sessionId = ''
    try {
      for (const selected of [['agent-dashboard'], []]) {
        enabled = selected.length > 0; calledSkill = false; readSkill = false
        const spec = { provider: 'claude' as const, runMode: 'agent' as const, systemInstructions: PLATFORM_INSTRUCTIONS, cwd: fixture.root, model: 'claude-sonnet-4-6',
          baseUrl: fixture.profile.baseUrl, authToken: fixture.profile.authToken, enabledPluginIds: selected }
        const target = sessionId ? { kind: 'resume' as const, session: { provider: 'claude' as const, id: sessionId } }
          : { kind: 'new' as const, provider: 'claude' as const }
        const run = query({ prompt: 'Check the dashboard skill', options: resolveClaudeQueryOptions(spec, target) })
        const messages: SDKMessage[] = []
        try { for await (const message of run) messages.push(message) } finally { run.close() }
        const init = messages.find((message) => message.type === 'system' && message.subtype === 'init')
        if (!init) throw new Error('Native SDK initialization is missing')
        expect(init.skills.includes('agent-dashboard:agent-dashboard')).toBe(enabled)
        if (sessionId) expect(init.session_id).toBe(sessionId)
        sessionId = init.session_id
        expect(readSkill).toBe(true)
      }
    } finally { await fixture.dispose() }
  }, 90000)

  it('loads the selected skill and excludes it after an acknowledged restart of the same session', async () => {
    let enabled = true
    let calledSkill = false
    let verifiedSkill = false
    const fixture = await nativeClaudeFixture((body, reply) => {
      expect(body.tools?.map((tool) => tool['name'])).not.toContain('mcp__agentWorkshop__render_ui')
      if (!calledSkill) {
        calledSkill = true
        return modelMessage(body, reply, [{ type: 'tool_use', id: enabled ? 'enabled-skill' : 'disabled-skill', name: 'Skill', input: { skill: 'agent-dashboard:agent-dashboard' } }])
      }
      const lastResult = [...body.messages].reverse().find((message) => Array.isArray(message.content)
        && message.content.some((block) => block['type'] === 'tool_result'))
      if (enabled) {
        expect(JSON.stringify(body.messages)).toContain('a2ui:regional-sales')
        expect(JSON.stringify(body.messages)).toContain('resource/catalog.md')
      } else {
        expect(JSON.stringify(lastResult)).toMatch(/Unknown skill|not found|not available/iu)
      }
      verifiedSkill = true
      return modelMessage(body, reply, [{ type: 'text', text: enabled ? 'Skill loaded.' : 'Skill excluded.' }])
    })
    try {
      fixture.send('Read the dashboard skill', 'plugin-on', 'claude-sonnet-4-6', { enabledPluginIds: ['agent-dashboard'] })
      await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'plugin-on'), { timeout: 45000 }).toBe(true)
      expect(verifiedSkill).toBe(true)
      const sessionId = fixture.ref.id
      enabled = false; calledSkill = false; verifiedSkill = false
      fixture.socket.send(JSON.stringify({ type: 'session.configure', requestId: 'plugin-off', harness: 'claude', sessionId,
        cwd: fixture.root, model: `${fixture.profile.id}:claude-sonnet-4-6`, enabledPluginIds: [] }))
      await expect.poll(() => fixture.frames.find((frame) => frame.type === 'session.config' && frame.requestId === 'plugin-off'), { timeout: 45000 })
        .toMatchObject({ sessionId, config: { enabledPluginIds: [] } })
      fixture.send('Check the dashboard skill after disabling', 'plugin-off-check')
      await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'plugin-off-check'), { timeout: 45000 }).toBe(true)
      expect(verifiedSkill).toBe(true)
      expect(fixture.ref.id).toBe(sessionId)
      expect(fixture.sdkOpen).not.toHaveBeenCalled()
    } finally { await fixture.dispose() }
  }, 150000)
})
