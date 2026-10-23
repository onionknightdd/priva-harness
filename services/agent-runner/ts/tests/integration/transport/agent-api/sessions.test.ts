import { readFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { errorBodySchema } from '../../../../src/core/agent-api/errors.js'
import { sessionSnapshotSchema } from '../../../../src/core/agent-api/objects.js'
import { capabilitiesSchema, fileUploadedSchema, sessionCreatedSchema, sessionsPageSchema } from '../../../../src/core/agent-api/responses.js'
import { nativeSessionId } from '../../../../src/harness/agent-api/agent-api-service.js'
import { AGENT_API, createAgentApiFixture, multipartFile, type AgentApiFixture } from '../../../support/agent-api.js'

describe('Agent API sessions', () => {
  let fixture: AgentApiFixture

  beforeEach(async () => { fixture = await createAgentApiFixture() })
  afterEach(async () => { await fixture.close() })

  it('describes harnesses, the default model and limits', async () => {
    const response = await fixture.server.inject({ method: 'GET', url: AGENT_API })
    expect(response.statusCode).toBe(200)
    expect(response.headers['request-id']).toMatch(/^req_/u)
    const body = capabilitiesSchema.parse(response.json())
    expect(body.defaults).toEqual({ harness: 'claude', model: `${fixture.profileId}:claude-sonnet-4-5` })
    expect(body.limits.max_upload_bytes).toBe(1024)
    expect(body.limits.max_wait_seconds).toBe(60)
  })

  it('creates a session with defaults and preallocates the Claude session', async () => {
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload: { workdir: 'projects/shop-web', settings: { effort: 'high' } } })
    expect(response.statusCode).toBe(201)
    const { session } = sessionCreatedSchema.parse(response.json())
    expect(session).toMatchObject({
      harness: 'claude', workdir: 'projects/shop-web', run_mode: 'agent', title: null, driver: 'none', last_event_seq: 0,
      settings: { model: `${fixture.profileId}:claude-sonnet-4-5`, effort: 'high', context_window: 200000 },
      status: { state: 'idle', active_tasks: 0 },
    })
    const stored = JSON.parse(await readFile(join(fixture.runtimeHome, 'agent-api', 'sessions', session.id, 'session.json'), 'utf8')) as { nativeId: string }
    expect(stored.nativeId).toMatch(/^[0-9a-f-]{36}$/u)

    const snapshot = await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${session.id}` })
    expect(sessionSnapshotSchema.parse(snapshot.json())).toMatchObject({ id: session.id, active_run: null, queued_runs: [], interactions: [], tasks: [] })
  })

  it.each([
    ['an unknown field', { model: 'x' }, 'validation_failed', undefined],
    ['an absolute workdir', { workdir: '/etc' }, 'path_outside_workspace', 'workdir'],
    ['a workdir escaping the workspace', { workdir: '../runtime' }, 'path_outside_workspace', 'workdir'],
    ['a missing workdir', { workdir: 'nope' }, 'validation_failed', 'workdir'],
    ['an unknown model profile', { settings: { model: 'missing:model' } }, 'validation_failed', 'settings.model'],
    ['a Pi-only effort on Claude', { settings: { effort: 'minimal' } }, 'validation_failed', 'settings.effort'],
  ])('rejects %s', async (_name, payload, code, param) => {
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload })
    const body = errorBodySchema.parse(response.json())
    expect(body.error.code).toBe(code)
    expect(body.error.param).toBe(param)
    expect(body.error.request_id).toBe(response.headers['request-id'])
  })

  it('rejects a workdir that escapes through a symlink', async () => {
    await symlink(fixture.runtimeHome, join(fixture.workspace, 'escape'))
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload: { workdir: 'escape' } })
    expect(response.json()).toMatchObject({ error: { code: 'path_outside_workspace', param: 'workdir' } })
  })

  it('lists API sessions together with WebUI sessions inside the workspace', async () => {
    const created = sessionCreatedSchema.parse((await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload: { harness: 'pi' } })).json())
    const base = { summary: 'WebUI chat', fileSize: 1, customTitle: null, firstPrompt: 'hi', gitBranch: null, tag: null }
    fixture.claude.sessions.seed({ ...base, ref: { provider: 'claude', id: 'web-1' }, lastModified: Date.parse('2030-01-01T00:00:00Z'), cwd: join(fixture.workspace, 'projects', 'shop-web') })
    fixture.claude.sessions.seed({ ...base, ref: { provider: 'claude', id: 'outside' }, lastModified: 1, cwd: fixture.runtimeHome })

    const page = sessionsPageSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions` })).json())
    expect(page.data.map((session) => session.id)).toEqual([nativeSessionId({ provider: 'claude', id: 'web-1' }), created.session.id])
    expect(page.data[0]).toMatchObject({ harness: 'claude', workdir: 'projects/shop-web', title: 'WebUI chat' })

    const limited = sessionsPageSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions?limit=1` })).json())
    expect(limited.data).toHaveLength(1)
    const next = sessionsPageSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions?limit=1&cursor=${limited.next_cursor ?? ''}` })).json())
    expect(next.data.map((session) => session.id)).toEqual([created.session.id])
    expect(next.next_cursor).toBeNull()

    const webSession = await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${nativeSessionId({ provider: 'claude', id: 'web-1' })}` })
    expect(webSession.statusCode).toBe(200)
  })

  it('uploads an attachment into the session directory', async () => {
    const { session } = sessionCreatedSchema.parse((await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload: { workdir: 'projects/shop-web' } })).json())
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${session.id}/files`, ...multipartFile('checkout-error.log', 'boom') })
    expect(response.statusCode).toBe(201)
    const file = fileUploadedSchema.parse(response.json())
    expect(file).toMatchObject({ name: 'checkout-error.log', media_type: 'text/plain', size: 4 })
    expect(file.path).toMatch(/^\.priva-attachments\/file-[^/]+\/checkout-error\.log$/u)
    expect(await readFile(join(fixture.workspace, 'projects', 'shop-web', file.path), 'utf8')).toBe('boom')

    const tooLarge = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${session.id}/files`, ...multipartFile('big.log', 'x'.repeat(2048)) })
    expect(tooLarge.statusCode).toBe(413)
    expect(tooLarge.json()).toMatchObject({ error: { type: 'invalid_request', code: 'file_too_large' } })
  })

  it('deletes a session and reports unknown sessions as not found', async () => {
    const { session } = sessionCreatedSchema.parse((await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload: {} })).json())
    expect((await fixture.server.inject({ method: 'DELETE', url: `${AGENT_API}/sessions/${session.id}` })).statusCode).toBe(204)
    const missing = await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${session.id}` })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ error: { type: 'not_found', code: 'not_found' } })
  })
})
