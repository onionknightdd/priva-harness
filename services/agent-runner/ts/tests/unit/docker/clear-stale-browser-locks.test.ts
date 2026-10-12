import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const script = resolve('docker/clear-stale-browser-locks.sh')
const singletonNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']

describe('Chromium locks left by an earlier Pod', () => {
  let root: string
  let profile: string
  let socketTarget: string
  let env: NodeJS.ProcessEnv

  beforeEach(async () => {
    root = await mkdtemp('/tmp/chromium-locks-')
    profile = join(root, '.config/chromium')
    socketTarget = join(root, 'old-container-tmp/SingletonSocket')
    const bin = join(root, 'bin')
    await mkdir(bin)
    await mkdir(profile, { recursive: true })
    // The production guards run unchanged; fixtures never inspect real browsers.
    await writeFile(join(bin, 'hostname'), '#!/bin/sh\nprintf "runner-current-pod\\n"\n', { mode: 0o700 })
    await writeFile(join(bin, 'pgrep'), '#!/bin/sh\nexit "${BROWSER_STATUS:-1}"\n', { mode: 0o700 })
    env = { ...process.env, HOME: root, PATH: `${bin}:${process.env['PATH'] ?? ''}` }
    delete env['CHROME_CONFIG_HOME']
    delete env['XDG_CONFIG_HOME']
    delete env['CHROME_USER_DATA_DIR']
    delete env['BROWSER_STATUS']
  })

  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  const run = () => execute('bash', [script], { env })

  async function staleLinks(owner = 'runner-previous-pod-123'): Promise<void> {
    await symlink(owner, join(profile, 'SingletonLock'))
    await symlink(socketTarget, join(profile, 'SingletonSocket'))
    await symlink('old-cookie-token', join(profile, 'SingletonCookie'))
  }

  async function expectLinksRetained(): Promise<void> {
    for (const name of singletonNames) expect((await lstat(join(profile, name))).isSymbolicLink()).toBe(true)
  }

  it('removes only stale singleton symlinks and preserves profile files and symlink targets', async () => {
    await staleLinks()
    await mkdir(join(profile, 'Default'))
    await writeFile(join(profile, 'Default/Bookmarks'), 'saved bookmarks')
    await writeFile(join(profile, 'Local State'), 'saved settings')
    await writeFile(join(profile, 'old-cookie-token'), 'do not follow the cookie link')
    expect((await run()).stderr).toContain('Removed stale Chromium singleton links')
    expect(await readdir(profile)).toEqual(['Default', 'Local State', 'old-cookie-token'])
    expect(await readFile(join(profile, 'Default/Bookmarks'), 'utf8')).toBe('saved bookmarks')
    expect(await readFile(join(profile, 'Local State'), 'utf8')).toBe('saved settings')
    expect(await readFile(join(profile, 'old-cookie-token'), 'utf8')).toBe('do not follow the cookie link')
    expect((await run()).stderr).toBe('')
  })

  it('leaves the current hostname lock for Chromium to handle', async () => {
    await staleLinks('runner-current-pod-123')
    await run()
    await expectLinksRetained()
  })

  it('preserves all locks when any Chromium process is already running', async () => {
    await staleLinks()
    env['BROWSER_STATUS'] = '0'
    await run()
    await expectLinksRetained()
  })

  it('does not remove locks if checking running processes fails', async () => {
    await staleLinks()
    env['BROWSER_STATUS'] = '2'
    await expect(run()).rejects.toMatchObject({ code: 2 })
    await expectLinksRetained()
  })

  it('preserves locks when the socket target still exists', async () => {
    await staleLinks()
    await mkdir(join(root, 'old-container-tmp'))
    // Even a non-socket endpoint is ambiguous and must not be removed.
    await writeFile(socketTarget, 'existing endpoint')
    await run()
    await expectLinksRetained()
    expect(await readFile(socketTarget, 'utf8')).toBe('existing endpoint')
  })

  it.each(['not-a-host-pid', 'previous-host-0'])('preserves an unrecognized lock owner: %s', async (owner) => {
    await staleLinks(owner)
    await run()
    await expectLinksRetained()
  })

  it.each(singletonNames)('never deletes an ordinary file named %s', async (name) => {
    await staleLinks()
    await rm(join(profile, name))
    await writeFile(join(profile, name), 'keep')
    await run()
    expect(await readFile(join(profile, name), 'utf8')).toBe('keep')
    for (const other of singletonNames.filter((candidate) => candidate !== name)) {
      expect((await lstat(join(profile, other))).isSymbolicLink()).toBe(true)
    }
  })

  it('preserves unexpected socket targets and handles an unused HOME without creating files', async () => {
    await staleLinks()
    await rm(join(profile, 'SingletonSocket'))
    await symlink('/other-host/SingletonSocket', join(profile, 'SingletonSocket'))
    await run()
    expect(await readlink(join(profile, 'SingletonSocket'))).toBe('/other-host/SingletonSocket')
    await expectLinksRetained()
    env['HOME'] = join(root, 'unused-home')
    await run()
    await expect(lstat(env['HOME'])).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
