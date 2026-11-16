import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  FileLockTimeoutError,
  withExclusiveFileLock,
  writePrivateFileAtomically,
} from '../../../../src/infrastructure/storage/private-file.js'

describe('private file storage', () => {
  let root: string
  let lockPath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'priva-private-file-'))
    lockPath = join(root, '.store.lock')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('runs concurrent holders one at a time in arrival order and removes the lock', async () => {
    const order: string[] = []
    const hold = (name: string, ms: number) => withExclusiveFileLock(lockPath, { waitMs: 5000, staleMs: 30_000 }, async () => {
      order.push(`${name}:start`)
      await new Promise((resolve) => setTimeout(resolve, ms))
      order.push(`${name}:end`)
      return name
    })
    expect(await Promise.all([hold('a', 30), hold('b', 5), hold('c', 0)])).toEqual(['a', 'b', 'c'])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
    expect(await readdir(root)).toEqual([])
  })

  it('releases the lock when the operation throws', async () => {
    await expect(withExclusiveFileLock(lockPath, { waitMs: 1000, staleMs: 30_000 }, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await withExclusiveFileLock(lockPath, { waitMs: 1000, staleMs: 30_000 }, () => Promise.resolve('next'))).toBe('next')
  })

  it('takes over a lock left by a process that no longer exists', async () => {
    // A pid far above any real limit cannot name a live process.
    await writeFile(lockPath, '2147483646 abandoned')
    expect(await withExclusiveFileLock(lockPath, { waitMs: 200, staleMs: 60_000 }, () => Promise.resolve('taken'))).toBe('taken')
  })

  it('waits for a live holder, then times out or takes over once the lock is stale', async () => {
    // The parent process is alive and is not this process.
    const live = `${String(process.ppid)} other-holder`
    await writeFile(lockPath, live)
    await expect(withExclusiveFileLock(lockPath, { waitMs: 80, staleMs: 60_000 }, () => Promise.resolve('never')))
      .rejects.toBeInstanceOf(FileLockTimeoutError)
    expect(await readFile(lockPath, 'utf8')).toBe(live)

    const old = new Date(Date.now() - 120_000)
    await utimes(lockPath, old, old)
    expect(await withExclusiveFileLock(lockPath, { waitMs: 200, staleMs: 60_000 }, () => Promise.resolve('stale'))).toBe('stale')
    expect(await readdir(root)).toEqual([])
  })

  it('does not remove a lock that another holder took over meanwhile', async () => {
    await withExclusiveFileLock(lockPath, { waitMs: 200, staleMs: 60_000 }, async () => {
      await writeFile(lockPath, `${String(process.ppid)} usurper`)
    })
    expect(await readFile(lockPath, 'utf8')).toBe(`${String(process.ppid)} usurper`)
  })

  it('writes private files atomically without leaving temporary files', async () => {
    const filePath = join(root, 'store.json')
    await writePrivateFileAtomically(filePath, 'one')
    await writePrivateFileAtomically(filePath, 'two')
    expect(await readFile(filePath, 'utf8')).toBe('two')
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    expect(await readdir(root)).toEqual(['store.json'])
  })
})
