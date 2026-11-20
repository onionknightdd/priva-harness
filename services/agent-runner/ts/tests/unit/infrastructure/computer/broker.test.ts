import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import ssh2 from 'ssh2'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { startComputerBroker } from '../../../../src/infrastructure/computer/broker.js'
import { ComputerClient } from '../../../../src/infrastructure/computer/client.js'
import { frame } from '../../../../src/infrastructure/computer/protocol.js'

const devices = { trusted: ssh2.utils.generateKeyPairSync('ed25519'), unknown: ssh2.utils.generateKeyPairSync('ed25519') }
const host = ssh2.utils.generateKeyPairSync('ed25519')
const hello = { type: 'hello', version: 2, platform: 'darwin', name: 'Fixture Mac' }
let directory: string
let broker: Awaited<ReturnType<typeof startComputerBroker>>
let client: ComputerClient
const children = new Set<ChildProcessWithoutNullStreams>()

function openSsh(command: string[] = ['-s', 'device@127.0.0.1', 'priva-computer'], identity = 'trusted') {
  // Ignore host SSH config, the agent and normal identities. Pin this test's ephemeral host key.
  const child = spawn('ssh', ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null', '-o', `UserKnownHostsFile=${join(directory, 'known_hosts')}`,
    '-p', String(broker.port), '-T', '-i', join(directory, identity), ...command], { stdio: ['pipe', 'pipe', 'pipe'] })
  children.add(child)
  child.stdin.on('error', () => { /* The refusal tests close the SSH stream before stdin drains. */ })
  const closed = once(child, 'close')
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  const send = (message: unknown) => child.stdin.write(frame(message))
  const sendLine = (line: string) => child.stdin.write(`${line}\n`)
  async function nextLine(): Promise<string> {
    const line = await lines.next()
    if (line.done) throw new Error('SSH subsystem ended without a frame')
    return line.value
  }
  const next = async (): Promise<unknown> => JSON.parse(await nextLine()) as unknown
  return { child, closed, send, sendLine, next, nextLine }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ph-cua-'))
  broker = await startComputerBroker({ directory, port: 0, hostKey: Buffer.from(host.private), devices: { 'fixture-mac': devices.trusted.public } })
  client = new ComputerClient(directory)
  await Promise.all(Object.entries(devices).map(([name, key]) => writeFile(join(directory, name), key.private, { mode: 0o600 })))
  await writeFile(join(directory, 'known_hosts'), `[127.0.0.1]:${broker.port} ${host.public}\n`, { mode: 0o600 })
})

afterEach(async () => {
  for (const child of children) child.kill()
  children.clear()
  await broker.close()
  await rm(directory, { recursive: true, force: true })
})

describe('Computer SSH subsystem', () => {
  it('uses the enrolled identity and exchanges scoped requests over a real OpenSSH client', async () => {
    const device = openSsh()
    device.send(hello)
    expect(await device.next()).toEqual({ type: 'ready', deviceId: 'fixture-mac' })
    expect(await client.list()).toEqual([{ deviceId: 'fixture-mac', name: 'Fixture Mac', platform: 'darwin' }])
    const answer = client.status('fixture-mac')
    const request = z.strictObject({ type: z.literal('request'), id: z.string(), method: z.literal('status') }).parse(await device.next())
    await expect(client.status('fixture-mac')).rejects.toThrow('busy')
    device.send({ type: 'result', id: request.id, ok: true, value: { unlocked: true } })
    await expect(answer).resolves.toEqual({ unlocked: true })
    const duplicate = openSsh()
    duplicate.send(hello)
    expect((await duplicate.closed)[0]).not.toBe(0)
    const outstanding = client.status('fixture-mac')
    const rejected = expect(outstanding).rejects.toThrow('disconnected')
    await device.next()
    device.child.kill()
    await rejected
    await expect(client.list()).resolves.toEqual([])
    await expect(client.status('fixture-mac')).rejects.toThrow('offline')
    const again = openSsh()
    again.send(hello)
    expect(await again.next()).toEqual({ type: 'ready', deviceId: 'fixture-mac' })
    const fresh = client.status('fixture-mac')
    const req = z.object({ method: z.literal('status'), id: z.string() }).parse(await again.next())
    again.send({ type: 'result', id: req.id, ok: false, error: 'user paused' })
    await expect(fresh).rejects.toThrow('user paused')
  })

  it('gives one session at a time the device worker stream and tells it why the worker ended', async () => {
    const device = openSsh()
    device.send(hello)
    await device.next()
    const opened = z.object({ type: z.literal('request'), method: z.literal('open'), id: z.string() })
    const accept = async () => device.send({ type: 'result', id: opened.parse(await device.next()).id, ok: true, value: {} })

    const opening = client.open('fixture-mac')
    await expect(client.open('fixture-mac')).rejects.toThrow('in use by another session')
    await accept()
    const worker = await opening
    const received: string[] = []
    worker.onLine = (line) => received.push(line)
    const ended = new Promise<string>((resolve) => { worker.onClose = resolve })

    const call = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'js' } })
    worker.send(call)
    expect(await device.nextLine()).toBe(`=${call}`)
    // A screenshot-sized worker message crosses both hops in one piece.
    const screenshot = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { data: 'x'.repeat(3 * 1024 * 1024) } })
    device.sendLine(`=${screenshot}`)
    await expect.poll(() => received.length, { timeout: 10_000 }).toBe(1)
    expect(received[0]).toBe(screenshot)
    await expect(client.open('fixture-mac')).rejects.toThrow('in use by another session')

    device.send({ type: 'worker-exit', reason: 'The Mac console locked.' })
    expect(await ended).toBe('The Mac console locked.')

    // The desktop is free again. Closing the session's side stops the worker on the device.
    const next = client.open('fixture-mac')
    await accept()
    ;(await next).close()
    expect(await device.next()).toEqual({ type: 'close' })

    // A device that drops takes its worker with it, and says the outcome is unknown.
    const last = client.open('fixture-mac')
    await accept()
    const dropped = new Promise<string>((resolve) => { void last.then((connection) => { connection.onClose = resolve }) })
    await last
    device.child.kill()
    expect(await dropped).toContain('outcome is unknown')
  }, 30_000)

  it('refuses a worker the device cannot start', async () => {
    const device = openSsh()
    device.send(hello)
    await device.next()
    const refused = client.open('fixture-mac')
    const request = z.object({ method: z.literal('open'), id: z.string() }).parse(await device.next())
    device.send({ type: 'result', id: request.id, ok: false, error: 'Unlock the Mac console first.' })
    await expect(refused).rejects.toThrow('Unlock the Mac console first.')
    await expect(client.open('offline-mac')).rejects.toThrow('offline')
  }, 30_000)

  it('rejects unregistered keys, remote commands and other subsystems', async () => {
    for (const ssh of [openSsh(undefined, 'unknown'), openSsh(['device@127.0.0.1', 'unavailable']),
      openSsh(['-s', 'device@127.0.0.1', 'sftp']), openSsh(['device@127.0.0.1']),
      openSsh(['-N', '-o', 'ExitOnForwardFailure=yes', '-R', '0:127.0.0.1:1', 'device@127.0.0.1'])]) {
      expect((await ssh.closed)[0]).not.toBe(0)
    }
    await expect(client.list()).resolves.toEqual([])
  })

  it('rejects forged identity or oversized registration', async () => {
    for (const input of [{ ...hello, deviceId: 'forged' }, { ...hello, name: 'a'.repeat(40_000) }]) {
      const ssh = openSsh()
      ssh.send(input)
      await ssh.closed
    }
    await expect(client.list()).resolves.toEqual([])
  })

  it('recovers its own Unix socket after an unclean stop', async () => {
    const dir = join(directory, 'stale')
    await mkdir(dir, { mode: 0o700 })
    const child = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(process.argv[1], () => process.stdout.write('ready\\n'))", join(dir, 'clients.sock')], { stdio: ['pipe', 'pipe', 'pipe'] })
    children.add(child)
    const done = once(child, 'close')
    await once(child.stdout, 'data')
    child.kill('SIGKILL')
    await done
    const recovered = await startComputerBroker({ directory: dir, port: 0, hostKey: Buffer.from(host.private), devices: {} })
    try { await expect(new ComputerClient(dir).list()).resolves.toEqual([]) } finally { await recovered.close() }
  })

  it('requires a private socket and refuses to replace a running broker', async () => {
    await expect(startComputerBroker({ directory, port: 0, hostKey: Buffer.from(host.private), devices: {} })).rejects.toThrow()
    await expect(client.list()).resolves.toEqual([])
    await chmod(join(directory, 'clients.sock'), 0o666)
    await expect(client.list()).rejects.toThrow('private socket')
  })
})
