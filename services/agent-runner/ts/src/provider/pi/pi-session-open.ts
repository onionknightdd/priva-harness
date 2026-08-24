import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import type { ProviderRunSpec, SessionTarget } from '../../core/contract/agent-provider.js'
import { SessionError } from '../../core/resource/session.js'
import { piSessionBucketDir, piSessionsRoot } from './pi-paths.js'

export async function createPiSessionManager(
  agentDir: string,
  spec: Pick<ProviderRunSpec, 'cwd'>,
  target: SessionTarget,
): Promise<SessionManager> {
  const sessionDir = piSessionBucketDir(agentDir, spec.cwd)

  if (target.kind === 'new') {
    return SessionManager.create(spec.cwd, sessionDir)
  }
  if (target.kind === 'fork') {
    throw new SessionError('invalid-request', 'Pi does not support fork')
  }
  if (target.session.provider !== 'pi') {
    throw new SessionError('invalid-request', 'Pi provider cannot resume a non-pi session')
  }

  const found = await findPiSession(agentDir, spec.cwd, target.session.id)
  return SessionManager.open(found.path, dirname(found.path), spec.cwd)
}

async function findPiSession(
  agentDir: string,
  cwd: string,
  sessionId: string,
): Promise<{ readonly path: string; readonly id: string }> {
  const sessionDir = piSessionBucketDir(agentDir, cwd)
  const local = await SessionManager.list(cwd, sessionDir)
  const listed = local.find((session) => session.id === sessionId)
  if (listed !== undefined) return listed

  const root = piSessionsRoot(agentDir)
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new SessionError('session-not-found', 'Session not found')
    }
    throw error
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const group = await SessionManager.listAll(join(root, entry.name))
    const found = group.find((session) => session.id === sessionId)
    if (found !== undefined) return found
  }

  throw new SessionError('session-not-found', 'Session not found')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}
