import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { buildRunSpec } from '../../../../src/transport/websocket/run-spec.js'
import { parseClientFrame } from '../../../../src/transport/websocket/schema/run-frames.js'
import { resolveClaudeQueryEnv } from '../../../../src/provider/claude/claude-runtime.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

it('maps independent selections to Claude env/suffix and Pi model configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-context-'))
  try {
    const services = createTestAgentServices(root)
    const profile = await services.modelProfileService.createProfile({ label: 'Fixture',
      baseUrl: 'https://example.test', authToken: 'test', defaultModel: 'custom:model[1m]' })
    for (const harness of ['claude', 'pi'] as const) {
      for (const contextWindow of [undefined, 200000, 1000000] as const) {
        const spec = await buildRunSpec(services, { harness, model: `${profile.id}:custom:model[1m]`, cwd: root,
          ...(contextWindow ? { contextWindow } : {}) })
        expect(spec.contextWindow).toBe(contextWindow ?? 200000)
        expect(spec.model).toBe(harness === 'claude' && contextWindow === 1000000 ? 'custom:model[1m]' : 'custom:model')
        if (harness === 'claude') {
          const env = resolveClaudeQueryEnv(spec)
          expect(env).toMatchObject({ CLAUDE_CODE_DISABLE_1M_CONTEXT: contextWindow === 1000000 ? '0' : '1',
            CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(contextWindow ?? 200000), CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextWindow ?? 200000) })
        }
      }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('validates context options for start and configure on both harnesses', () => {
  for (const harness of ['claude', 'pi']) {
    for (const type of ['run.start', 'session.configure']) {
      const frame = { type, harness, text: 'hi', cwd: '/tmp', model: 'p:m', requestId: 'r', sessionId: 's' }
      for (const contextWindow of [200000, 1000000]) expect(parseClientFrame({ ...frame, contextWindow }).ok).toBe(true)
      for (const contextWindow of [0, 100000, '1M', '200000', null]) expect(parseClientFrame({ ...frame, contextWindow }).ok).toBe(false)
    }
  }
})
