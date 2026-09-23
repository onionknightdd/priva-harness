import { describe, expect, it } from 'vitest'
import { SessionRunModes } from '../../../../src/harness/session/session-run-mode.js'
import { PLATFORM_INSTRUCTIONS } from '../../../../src/harness/prompt/platform-instructions.js'
import { MemorySessionMetadataRepository } from '../../../support/memory-session-metadata.js'
import { testRunSpec } from '../../../support/run-spec.js'

const request = { ...testRunSpec() }
delete request.runMode
delete request.systemInstructions
const ref = { provider: 'claude', id: 'session' } as const

describe('Claude session run modes', () => {
  it('binds Agent before the first turn, restores it after restart, and inherits forks', async () => {
    const metadata = new MemorySessionMetadataRepository()
    const modes = new SessionRunModes(metadata)
    const spec = await modes.resolve({ kind: 'new', provider: 'claude', sessionId: ref.id }, request)
    expect(spec).toMatchObject({ runMode: 'agent', systemInstructions: PLATFORM_INSTRUCTIONS })
    expect((await metadata.get(ref)).runMode).toBe('agent')
    const restarted = new SessionRunModes(metadata)
    expect((await restarted.resolve({ kind: 'resume', session: ref }, request)).runMode).toBe('agent')
    expect((await restarted.resolve({ kind: 'fork', source: ref, sessionId: 'fork' }, request)).runMode).toBe('agent')
    await expect(restarted.resolve({ kind: 'resume', session: ref }, { ...request, runMode: 'code' })).rejects.toMatchObject({ kind: 'run-mode-conflict' })
    await expect(restarted.resolve({ kind: 'fork', source: ref, sessionId: 'bad-fork' }, { ...request, runMode: 'code' })).rejects.toMatchObject({ kind: 'run-mode-conflict' })
    expect((await metadata.get({ ...ref, id: 'bad-fork' })).runMode).toBeNull()
  })

  it('allows explicit Code and treats untracked native sessions as Code', async () => {
    const modes = new SessionRunModes()
    expect((await modes.resolve({ kind: 'new', provider: 'claude', sessionId: 'new-code' }, { ...request, runMode: 'code' })).runMode).toBe('code')
    expect((await modes.resolve({ kind: 'resume', session: ref }, request)).runMode).toBe('code')
    await expect(modes.resolve({ kind: 'new', provider: 'claude', sessionId: 'new-code' }, request)).rejects.toMatchObject({ kind: 'run-mode-conflict' })
  })

  it('keeps Pi specs unchanged and rejects mode input for Pi', async () => {
    const modes = new SessionRunModes()
    const pi = testRunSpec({ provider: 'pi' })
    expect(await modes.resolve({ kind: 'new', provider: 'pi' }, pi)).toBe(pi)
    await expect(modes.resolve({ kind: 'new', provider: 'pi' }, { ...pi, runMode: 'agent' })).rejects.toMatchObject({ kind: 'invalid-request' })
  })
})
