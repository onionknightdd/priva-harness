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
const hello = { type: 'hello', version: 1, platform: 'darwin', name: 'Fixture Mac' }
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
  async function next(): Promise<unknown> {
    const line = await lines.next()
    if (line.done) throw new Error('SSH subsystem ended without a frame')
    return JSON.parse(line.value) as unknown
  }
  return { child, closed, send, next }
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
    for (const method of ['status', 'calculator-check'] as const) {
      const answer = client.request('fixture-mac', method)
      const request = z.strictObject({ type: z.literal('request'), id: z.string(), method: z.literal(method) }).parse(await device.next())
      await expect(client.request('fixture-mac', method)).rejects.toThrow('busy')
      const value = method === 'status' ? { active: true } : { expression: '1+1', result: '2' }
      device.send({ type: 'result', id: request.id, ok: true, value })
      await expect(answer).resolves.toEqual(value)
    }
    const duplicate = openSsh()
    duplicate.send(hello)
    expect((await duplicate.closed)[0]).not.toBe(0)
    const outstanding = client.request('fixture-mac', 'calculator-check')
    const rejected = expect(outstanding).rejects.toThrow('disconnected')
    await device.next()
    device.child.kill()
    await rejected
    await expect(client.list()).resolves.toEqual([])
    await expect(client.request('fixture-mac', 'status')).rejects.toThrow('offline')
    const again = openSsh()
    again.send(hello)
    expect(await again.next()).toEqual({ type: 'ready', deviceId: 'fixture-mac' })
    const fresh = client.request('fixture-mac', 'status')
    const req = z.object({ method: z.literal('status'), id: z.string() }).parse(await again.next())
    again.send({ type: 'result', id: req.id, ok: false, error: 'user paused' })
    await expect(fresh).rejects.toThrow('user paused')
  })

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
