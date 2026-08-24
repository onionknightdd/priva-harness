import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createPiSessionManager } from '../../../../src/provider/pi/pi-session-open.js'

describe('createPiSessionManager', () => {
  it('reopens the same session file when resuming by id', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-session-open-'))
    const cwd = join(agentDir, 'work')
    try {
      const created = await createPiSessionManager(
        agentDir,
        { cwd },
        { kind: 'new', provider: 'pi' },
      )
      const sessionId = created.getSessionId()
      const sessionFile = created.getSessionFile()
      if (sessionFile === undefined) {
        throw new Error('new session did not assign a file path')
      }
      await mkdir(dirname(sessionFile), { recursive: true })
      await writeFile(
        sessionFile,
        `${JSON.stringify({
          type: 'session',
          version: 3,
          id: sessionId,
          timestamp: new Date().toISOString(),
          cwd: created.getCwd(),
        })}\n`,
      )

      const resumed = await createPiSessionManager(
        agentDir,
        { cwd },
        { kind: 'resume', session: { provider: 'pi', id: sessionId } },
      )

      expect(resumed.getSessionId()).toBe(sessionId)
      expect(resumed.getSessionFile()).toBe(sessionFile)
    } finally {
      await rm(agentDir, { recursive: true, force: true })
    }
  })

  it('rejects fork, missing sessions, and non-pi resume targets', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-session-open-'))
    const cwd = join(agentDir, 'work')
    try {
      await expect(createPiSessionManager(
        agentDir,
        { cwd },
        { kind: 'fork', source: { provider: 'pi', id: 'sess-1' } },
      )).rejects.toMatchObject({
        kind: 'invalid-request',
        message: 'Pi does not support fork',
      })

      await expect(createPiSessionManager(
        agentDir,
        { cwd },
        { kind: 'resume', session: { provider: 'claude', id: 'sess-1' } },
      )).rejects.toMatchObject({
        kind: 'invalid-request',
        message: 'Pi provider cannot resume a non-pi session',
      })

      await expect(createPiSessionManager(
        agentDir,
        { cwd },
        { kind: 'resume', session: { provider: 'pi', id: 'missing' } },
      )).rejects.toMatchObject({
        kind: 'session-not-found',
        message: 'Session not found',
      })
    } finally {
      await rm(agentDir, { recursive: true, force: true })
    }
  })
})
