import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import ssh2 from 'ssh2'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startComputerBroker } from '../../../../src/infrastructure/computer/broker.js'

const tsx = ['--import', createRequire(import.meta.url).resolve('tsx')]
const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/resources/${name}`, import.meta.url))
const server = fileURLToPath(new URL('../../../../src/infrastructure/computer/device-mcp.ts', import.meta.url))
const key = ssh2.utils.generateKeyPairSync('ed25519')
const host = ssh2.utils.generateKeyPairSync('ed25519')
const deviceId = 'fixture-mac'

describe('registered_computers MCP server', () => {
  let directory: string
  let broker: Awaited<ReturnType<typeof startComputerBroker>> | undefined
  let device: ChildProcess | undefined
  let mcp: Client | undefined

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'ph-dev-')) })
  afterEach(async () => {
    await mcp?.close()
    device?.kill('SIGTERM')
    await broker?.close()
    mcp = device = broker = undefined
    await rm(directory, { recursive: true, force: true })
  })

  async function connect(): Promise<Client> {
    const client = new Client({ name: 'device-mcp-test', version: '1.0.0' })
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [...tsx, server],
      env: { PATH: process.env['PATH'] ?? '', PRIVA_COMPUTER_DIR: directory }, stderr: 'pipe' }))
    mcp = client
    return client
  }

  async function call(name: string, args: Record<string, unknown> = {}) {
    if (!mcp) throw new Error('Connect first')
    const result = await mcp.callTool({ name, arguments: args })
    const content = result.content as { type: string; text?: string }[]
    return { isError: result.isError === true, text: content.map((part) => part.text ?? '').join(''),
      images: content.filter((part) => part.type === 'image').length }
  }

  /** A fixture tray: a real OpenSSH client that registers and runs a stand-in desktop worker. */
  async function startDevice(): Promise<ChildProcess> {
    broker = await startComputerBroker({ directory, port: 0, hostKey: Buffer.from(host.private), devices: { [deviceId]: key.public } })
    await writeFile(join(directory, 'identity'), key.private, { mode: 0o600 })
    await writeFile(join(directory, 'known_hosts'), `[127.0.0.1]:${broker.port} ${host.public}\n`, { mode: 0o600 })
    const child = spawn(process.execPath, [...tsx, fixture('fake-computer-device.ts'), fixture('desktop-worker-mcp-server.ts'),
      '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
      '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null', '-o', `UserKnownHostsFile=${join(directory, 'known_hosts')}`,
      '-p', String(broker.port), '-T', '-i', join(directory, 'identity'), '-s', 'device@127.0.0.1', 'priva-computer'],
    { stdio: 'ignore', env: { ...process.env, WORKER_LOG: join(directory, 'worker.log') } })
    device = child
    return child
  }

  it('operates a registered computer through its own worker, and reports when it goes away', async () => {
    const tray = await startDevice()
    await connect()
    await expect.poll(async () => (await call('list_devices')).text, { timeout: 15_000 })
      .toBe(JSON.stringify([{ deviceId, name: 'Fixture Mac', platform: 'darwin' }]))
    expect(JSON.parse((await call('device_status', { deviceId })).text)).toEqual({ platform: 'darwin', unlocked: true })

    // Text and image blocks come back as the worker produced them, and the worker keeps its state.
    const first = await call('js', { deviceId, code: 'let a = 1', title: 'Starting' })
    expect(first).toMatchObject({ isError: false, images: 1 })
    const started = JSON.parse(first.text) as { worker: number }
    expect(started).toMatchObject({ bindings: 1, code: 'let a = 1' })
    expect(JSON.parse((await call('js', { deviceId, code: 'a + 1' })).text)).toMatchObject({ worker: started.worker, bindings: 2 })

    // The host's turn end reaches the worker, which the model never calls itself.
    await call('turn_ended', { hook_event_name: 'Stop', session_id: 'session', turn_id: 'turn' })
    expect((await readFile(join(directory, 'worker.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as unknown))
      .toContainEqual({ pid: started.worker, tool: 'turn_ended', arguments: { hook_event_name: 'Stop', session_id: 'session', turn_id: 'turn' } })

    // The console locks: the session is told why, and that its bindings are gone.
    tray.kill('SIGUSR1')
    await expect.poll(async () => (await call('device_status', { deviceId })).text, { timeout: 10_000 }).toContain('"unlocked":false')
    const lost = await call('js', { deviceId, code: 'a + 2' })
    expect(lost.isError).toBe(true)
    expect(lost.text).toContain('The console locked.')
    expect(lost.text).toContain('bindings are gone')
    expect(await call('js', { deviceId, code: 'a' })).toMatchObject({ isError: true, text: `Cannot use ${deviceId}: Unlock the console first.` })

    // Unlocked again, the device starts a new worker with empty state.
    tray.kill('SIGUSR2')
    await expect.poll(async () => (await call('device_status', { deviceId })).text, { timeout: 10_000 }).toContain('"unlocked":true')
    const fresh = JSON.parse((await call('js', { deviceId, code: 'let b = 1' })).text) as { worker: number }
    expect(fresh.worker).not.toBe(started.worker)
    expect(fresh).toMatchObject({ bindings: 1 })
    expect(JSON.parse((await call('js_reset', { deviceId })).text)).toMatchObject({ worker: fresh.worker, bindings: 0 })

    // Calls for another device never fall back to this one.
    expect(await call('js', { deviceId: 'other-mac', code: '1' })).toMatchObject({ isError: true, text: 'Cannot use other-mac: Device is offline' })

    // The device drops off: whatever was running has an unknown outcome.
    tray.kill('SIGTERM')
    await once(tray, 'close')
    const gone = await call('js', { deviceId, code: 'b' })
    expect(gone.isError).toBe(true)
    expect(gone.text).toContain('outcome is unknown')
    expect((await call('list_devices')).text).toBe('[]')
  }, 60_000)

  it('says so when this Runner has no device service', async () => {
    await connect()
    expect(await call('list_devices')).toEqual({ isError: true, images: 0, text: 'This Runner has no device service, so no registered computer is available.' })
  })
})
