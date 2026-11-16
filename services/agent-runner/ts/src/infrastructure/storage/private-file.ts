import { randomUUID } from 'node:crypto'
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { hasErrorCode } from '../../core/util/errors.js'

const LOCK_RETRY_MS = 25

export interface FileLockOptions {
  /** How long to wait for another holder before failing. */
  readonly waitMs: number
  /** Age after which a lock whose holder cannot be checked is taken over. */
  readonly staleMs: number
}

/** Carries a string `code` so stores can treat it like any other I/O failure. */
export class FileLockTimeoutError extends Error {
  readonly code = 'ELOCKTIMEOUT'

  constructor(lockPath: string) {
    super(`Timed out waiting for lock: ${basename(lockPath)}`)
    this.name = 'FileLockTimeoutError'
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

export async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
}

/**
 * Replace a private file in one step: readers see the previous or the new
 * content, never a partial write, and need no lock.
 */
export async function writePrivateFileAtomically(filePath: string, content: string): Promise<void> {
  const directory = dirname(filePath)
  const temporaryPath = join(directory, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let handle: FileHandle | undefined
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, filePath)
    await chmod(filePath, 0o600)
    await syncDirectory(directory)
  } finally {
    await handle?.close()
    await removeIfPresent(temporaryPath)
  }
}

// Callers in this process queue here instead of polling the lock file, which
// keeps them in arrival order. The file lock covers other processes.
const localQueues = new Map<string, Promise<void>>()

/**
 * Run `operation` while holding an exclusive lock file. The file records its
 * holder, so a lock left by a dead process is taken over at once and a holder
 * only ever removes its own lock.
 */
export async function withExclusiveFileLock<T>(
  lockPath: string,
  options: FileLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = localQueues.get(lockPath) ?? Promise.resolve()
  let release: () => void = () => undefined
  const turn = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.then(() => turn)
  localQueues.set(lockPath, queued)
  await previous
  try {
    const holder = await acquire(lockPath, options)
    try {
      return await operation()
    } finally {
      if (await readHolder(lockPath) === holder) await removeIfPresent(lockPath)
    }
  } finally {
    release()
    if (localQueues.get(lockPath) === queued) localQueues.delete(lockPath)
  }
}

async function acquire(lockPath: string, options: FileLockOptions): Promise<string> {
  await ensurePrivateDirectory(dirname(lockPath))
  const holder = `${String(process.pid)} ${randomUUID()}`
  const deadline = Date.now() + options.waitMs
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(holder, 'utf8')
      } finally {
        await handle.close()
      }
      return holder
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    }
    if (await takeOverStaleLock(lockPath, options.staleMs)) continue
    if (Date.now() >= deadline) throw new FileLockTimeoutError(lockPath)
    await delay(LOCK_RETRY_MS)
  }
}

async function readHolder(lockPath: string): Promise<string | undefined> {
  try {
    return await readFile(lockPath, 'utf8')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

/** Returns true when the lock path is free to be created again. */
async function takeOverStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  let observed: string | undefined
  let ageMs: number
  try {
    ageMs = Date.now() - (await stat(lockPath)).mtimeMs
    observed = await readHolder(lockPath)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return true
    throw error
  }
  if (observed === undefined) return true
  if (!holderIsDead(observed) && ageMs <= staleMs) return false

  // Rename the stale file away so only one contender claims it. If a live
  // holder replaced it between the check and the rename, put that lock back.
  const claimedPath = `${lockPath}.${String(process.pid)}.${randomUUID()}.stale`
  try {
    await rename(lockPath, claimedPath)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return true
    throw error
  }
  try {
    if (await readHolder(claimedPath) === observed) return true
    await link(claimedPath, lockPath).catch((error: unknown) => {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    })
    return false
  } finally {
    await removeIfPresent(claimedPath)
  }
}

function holderIsDead(holder: string): boolean {
  const pid = Number(holder.split(' ')[0])
  if (!Number.isInteger(pid) || pid <= 0) return false
  // Callers in this process are serialised above, so a lock carrying this pid
  // was left by an earlier process that had the same pid.
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return hasErrorCode(error, 'ESRCH')
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
