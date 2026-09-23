import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture, type ModelRequest } from '../../../fixtures/terminal/claude-tui-fixture.js'
import { testRunSpec } from '../../../support/run-spec.js'
import { PLATFORM_INSTRUCTIONS } from '../../../../src/harness/prompt/platform-instructions.js'
import { CLAUDE_AGENT_DISALLOWED_TOOLS } from '../../../../src/provider/claude/claude-tool-policy.js'

function checkRequest(request: ModelRequest | undefined, mode: 'agent' | 'code') {
  expect(request).toBeDefined()
  expect(JSON.stringify(request?.system)).toContain(PLATFORM_INSTRUCTIONS.split('\n')[0])
  const tools = request?.tools?.map((tool) => tool['name']) ?? []
  for (const name of CLAUDE_AGENT_DISALLOWED_TOOLS) {
    if (mode === 'agent') expect(tools).not.toContain(name)
    else expect(tools).toContain(name)
  }
  for (const name of ['Read', 'Write', 'Edit', 'Bash', 'Skill', 'AskUserQuestion', 'Agent', 'TaskStop']) expect(tools).toContain(name)
}

it.skipIf(!nativeClaudeAvailable())('applies the same mode in real SDK and TUI requests, including native cross-mode resume and clear', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: 'Mode verified.' }], `mode-${++calls}`))
  const codeId = randomUUID()
  try {
    for (const runMode of ['code', 'agent'] as const) {
      const before = fixture.requests.length
      for await (const _event of fixture.harness.run({ text: `SDK ${runMode} probe` }, { signal: AbortSignal.timeout(45000) },
        testRunSpec({ cwd: fixture.root, model: 'claude-sonnet-4-6', baseUrl: fixture.profile.baseUrl, authToken: 'fixture-token', runMode }),
        { source: 'web', keepRuntimeWarm: false, session: { kind: 'new', provider: 'claude', sessionId: runMode === 'code' ? codeId : randomUUID() } })) { void _event }
      checkRequest(fixture.requests.slice(before).find((request) => request.tools?.length), runMode)
    }

    fixture.send('TUI Agent probe', 'agent')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'agent'), { timeout: 45000 }).toBe(true)
    checkRequest(fixture.requests.at(-1), 'agent')
    expect(fixture.harness.sessionStream(fixture.ref).snapshot().config?.runMode).toBe('agent')
    const count = fixture.requests.length
    fixture.send('Conflicting mode must not execute', 'conflict', undefined, { runMode: 'code' })
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'error' && frame.runId === 'conflict')).toBe(true)
    expect(fixture.requests).toHaveLength(count)

    // This is native terminal input, not an SDK or bubble-only approximation.
    await fixture.terminals.submit(fixture.ref, `/resume ${codeId}`, AbortSignal.timeout(30000))
    await expect.poll(() => fixture.ref.id, { timeout: 30000 }).toBe(codeId)
    await expect.poll(async () => (await fixture.terminals.spec(fixture.ref))?.runMode, { timeout: 15000 }).toBe('code')
    fixture.send('TUI Code probe', 'code')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'code'), { timeout: 30000 }).toBe(true)
    checkRequest(fixture.requests.at(-1), 'code')
    expect(fixture.harness.sessionStream(fixture.ref).snapshot().config?.runMode).toBe('code')

    fixture.send('/clear', 'clear')
    await expect.poll(() => fixture.ref.id !== codeId, { timeout: 15000 }).toBe(true)
    fixture.send('Code after clear', 'after-clear')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'after-clear'), { timeout: 30000 }).toBe(true)
    checkRequest(fixture.requests.at(-1), 'code')
    expect(fixture.harness.sessionStream(fixture.ref).snapshot().config?.runMode).toBe('code')
  } catch (error) {
    console.error(fixture.frames.filter((frame) => ['error', 'run.failed', 'session.rebound'].includes(frame.type)))
    if (fixture.ref.id && await fixture.terminals.isAlive(fixture.ref)) console.error(await fixture.terminals.capture(fixture.ref))
    throw error
  } finally { await fixture.dispose() }
}, 150000)
