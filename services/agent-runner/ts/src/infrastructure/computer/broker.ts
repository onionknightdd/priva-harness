import { createPublicKey, randomUUID, verify, type KeyObject } from 'node:crypto'
import { once } from 'node:events'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { createConnection, createServer, isIP, type Socket } from 'node:net'
import ssh2, { type Connection, type ServerChannel } from 'ssh2'

import { errorMessage, hasErrorCode } from '../../core/util/errors.js'
import { withExclusiveFileLock } from '../storage/private-file.js'
import {
  clientRequestSchema, controlPath, deviceIdSchema, deviceReplySchema, frame, helloSchema, readFrames,
  type ComputerMethod, type DeviceInfo,
} from './protocol.js'

interface BrokerOptions {
  directory: string
  port: number
  bindAddress?: string
  hostKey: Buffer
  devices: Readonly<Record<string, string>>
}

function enrolledKeys(devices: Readonly<Record<string, string>>): Map<string, { id: string; key: KeyObject }> {
  const keys = new Map<string, { id: string; key: KeyObject }>()
  for (const [id, publicKey] of Object.entries(devices)) {
    deviceIdSchema.parse(id)
    const key = ssh2.utils.parseKey(publicKey)
    if (key instanceof Error || Array.isArray(key) || key.type !== 'ssh-ed25519' || key.isPrivateKey()) {
      throw new Error(`Expected an Ed25519 public key for ${id}`)
    }
    const bytes = key.getPublicSSH().toString('base64')
    if (keys.has(bytes)) throw new Error('Each device must have a distinct SSH public key')
    keys.set(bytes, { id, key: createPublicKey(key.getPublicPEM()) })
  }
  return keys
}

interface Pending {
  id: string
  timer: NodeJS.Timeout
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

class Device {
  private pending?: Pending
  private online = true

  constructor(readonly info: DeviceInfo, private readonly channel: ServerChannel) {}

  call(method: ComputerMethod): Promise<unknown> {
    if (!this.online) return Promise.reject(new Error('Device is offline'))
    if (this.pending) return Promise.reject(new Error('Device is busy'))
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.disconnect('Device did not respond; action outcome is unknown')
        this.channel.close()
      }, 30_000)
      this.pending = { id, timer, resolve, reject }
      this.channel.write(frame({ type: 'request', id, method }))
    })
  }

  receive(value: unknown): void {
    const result = deviceReplySchema.parse(value)
    const pending = this.pending
    if (pending?.id !== result.id) throw new Error('Unexpected device response')
    clearTimeout(pending.timer)
    delete this.pending
    if (result.ok) pending.resolve(result.value)
    else pending.reject(new Error(result.error))
  }

  disconnect(message: string): void {
    this.online = false
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(new Error(message))
    delete this.pending
  }
}

// A terminated process can leave its Unix socket in an emptyDir between container restarts.
// Call under the startup lock so two recoveries never unlink each other's listener.
async function removeStaleSocket(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (!info.isSocket() || info.uid !== process.getuid?.()) throw new Error('Refusing to replace foreign computer socket path')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return
    throw error
  }
  const probe = createConnection(path)
  try {
    await once(probe, 'connect')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return
    if (!hasErrorCode(error, 'ECONNREFUSED')) throw error
    await unlink(path)
    return
  } finally { probe.destroy() }
  throw new Error('A computer broker is already listening in this directory')
}

export async function startComputerBroker(options: BrokerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const address = options.bindAddress ?? '127.0.0.1'
  if (!isIP(address)) throw new Error('Computer SSH bind address must be a numeric IP address')
  const path = await controlPath(options.directory, true)
  const keys = enrolledKeys(options.devices)
  const devices = new Map<string, Device>()
  const connections = new Set<Connection>()
  const localClients = new Set<Socket>()
  const ssh = new ssh2.Server({ hostKeys: [options.hostKey], keepaliveInterval: 15_000, keepaliveCountMax: 2 }, (connection) => {
    connections.add(connection)
    const deadline = setTimeout(() => connection.end(), 10_000)
    let principal: string | undefined
    let device: Device | undefined
    const detach = () => {
      clearTimeout(deadline)
      if (device && devices.get(device.info.deviceId) === device) {
        devices.delete(device.info.deviceId)
        device.disconnect('Device disconnected; outstanding action outcome is unknown')
      }
    }
    connection.on('error', () => connection.end())
    connection.once('close', () => { detach(); connections.delete(connection) })
    connection.on('authentication', (auth) => {
      if (auth.method !== 'publickey' || auth.username !== 'device' || auth.key.algo !== 'ssh-ed25519') return auth.reject(['publickey'])
      const enrollment = keys.get(auth.key.data.toString('base64'))
      if (!enrollment) return auth.reject(['publickey'])
      // OpenSSH can probe a key without a signature. Only a signed authentication assigns a principal.
      if (auth.signature) {
        if (!auth.blob || !verify(null, auth.blob, enrollment.key, auth.signature)) return auth.reject(['publickey'])
        principal = enrollment.id
      }
      auth.accept()
    })
    connection.once('ready', () => {
      // ssh2 rejects unhandled SSH requests, including shell, exec, forwarding, PTY, env and SFTP.
      connection.once('session', (openSession) => {
        const session = openSession()
        session.on('subsystem', (accept, reject, { name }) => {
          if (name !== 'priva-computer' || !principal || devices.has(principal)) return reject()
          const deviceId = principal
          const channel = accept()
          channel.once('end', () => { detach(); connection.end() })
          channel.once('close', () => { detach(); connection.end() })
          channel.on('error', () => { detach(); connection.end() })
          readFrames(channel, (message) => {
            if (device) return device.receive(message)
            const hello = helloSchema.parse(message)
            if (devices.has(deviceId)) throw new Error('Device is already connected')
            device = new Device({ deviceId, platform: hello.platform, name: hello.name }, channel)
            devices.set(deviceId, device)
            clearTimeout(deadline)
            channel.write(frame({ type: 'ready', deviceId }))
          }, () => { detach(); connection.end() })
        })
      })
    })
  })
  ssh.maxConnections = 64
  const local = createServer((socket) => {
    localClients.add(socket)
    socket.once('close', () => localClients.delete(socket))
    socket.once('error', () => socket.destroy())
    socket.setTimeout(32_000, () => socket.destroy())
    let requested = false
    readFrames(socket, (message) => {
      if (requested) throw new Error('One request per connection')
      requested = true
      const request = clientRequestSchema.parse(message)
      const respond = (response: unknown) => { if (!socket.destroyed) socket.end(frame(response)) }
      if (request.method === 'list') {
        respond({ id: request.id, ok: true, value: [...devices.values()].map((device) => device.info) })
        return
      }
      const device = devices.get(request.deviceId)
      if (!device) { respond({ id: request.id, ok: false, error: 'Device is offline' }); return }
      void device.call(request.method).then(
        (value) => respond({ id: request.id, ok: true, value }),
        (error: unknown) => respond({ id: request.id, ok: false, error: errorMessage(error) }),
      )
    }, () => socket.destroy())
  })
  local.maxConnections = 64
  async function close(): Promise<void> {
    for (const connection of connections) connection.end()
    for (const client of localClients) client.destroy()
    await Promise.all([ssh, local].map((server) =>
      new Promise<void>((resolve) => server.close(() => resolve()))))
  }
  try {
    await withExclusiveFileLock(path + '.lock', { waitMs: 1500, staleMs: 30_000 }, async () => {
      await removeStaleSocket(path)
      const listening = once(local, 'listening')
      local.listen(path)
      await listening
      await chmod(path, 0o600)
    })
    const listening = once(ssh, 'listening')
    ssh.listen(options.port, address)
    await listening
    const bound = ssh.address()
    if (!bound || typeof bound === 'string') throw new Error('Computer SSH listener did not bind to TCP')
    return { port: bound.port, close }
  } catch (error) {
    await close()
    throw error
  }
}
