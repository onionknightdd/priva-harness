import { createPublicKey, randomUUID, verify, type KeyObject } from 'node:crypto'
import { once } from 'node:events'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { createConnection, createServer, isIP, type Socket } from 'node:net'
import ssh2, { type Connection, type ServerChannel } from 'ssh2'

import { errorMessage, hasErrorCode } from '../../core/util/errors.js'
import { withExclusiveFileLock } from '../storage/private-file.js'
import {
  clientRequestSchema, controlPath, deviceIdSchema, deviceMessageSchema, EXIT_LINE, frame, helloSchema, readLines,
  WORKER_LINE, WORKER_LINE_BYTES, type DeviceInfo, type DeviceMethod,
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

/** Where a device's worker output goes: the local client that opened it. */
interface WorkerSink {
  line(line: string): void
  exit(reason: string): void
}

class Device {
  private pending?: Pending
  private worker?: WorkerSink
  private opening = false
  private online = true

  constructor(readonly info: DeviceInfo, private readonly channel: ServerChannel) {}

  request(method: DeviceMethod): Promise<unknown> {
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

  /** A desktop has one user at a time, so a device runs one worker. */
  async openWorker(sink: WorkerSink): Promise<void> {
    if (this.worker || this.opening) throw new Error('Device is in use by another session')
    this.opening = true
    try {
      await this.request('open')
      this.worker = sink
    } finally { this.opening = false }
  }

  writeWorker(sink: WorkerSink, line: string): void {
    if (this.worker === sink && this.online) this.channel.write(`${WORKER_LINE}${line}\n`)
  }

  closeWorker(sink: WorkerSink): void {
    if (this.worker !== sink) return
    delete this.worker
    if (this.online) this.channel.write(frame({ type: 'close' }))
  }

  receive(line: string): void {
    if (line.startsWith(WORKER_LINE)) {
      this.worker?.line(line.slice(WORKER_LINE.length))
      return
    }
    const message = deviceMessageSchema.parse(JSON.parse(line))
    if (message.type === 'worker-exit') {
      const worker = this.worker
      delete this.worker
      worker?.exit(message.reason)
      return
    }
    const pending = this.pending
    if (pending?.id !== message.id) throw new Error('Unexpected device response')
    clearTimeout(pending.timer)
    delete this.pending
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.error))
  }

  disconnect(message: string): void {
    this.online = false
    const worker = this.worker
    delete this.worker
    worker?.exit(message)
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
          readLines(channel, (line) => {
            if (device) return device.receive(line)
            const hello = helloSchema.parse(JSON.parse(line))
            if (devices.has(deviceId)) throw new Error('Device is already connected')
            device = new Device({ deviceId, platform: hello.platform, name: hello.name }, channel)
            devices.set(deviceId, device)
            clearTimeout(deadline)
            channel.write(frame({ type: 'ready', deviceId }))
          }, () => { detach(); connection.end() }, WORKER_LINE_BYTES)
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
    // Set once this connection carries a device's worker stream.
    let stream: { device: Device; sink: WorkerSink } | undefined
    readLines(socket, (line) => {
      if (stream) { stream.device.writeWorker(stream.sink, line); return }
      if (requested) throw new Error('One request per connection')
      requested = true
      const request = clientRequestSchema.parse(JSON.parse(line))
      const respond = (response: unknown) => { if (!socket.destroyed) socket.end(frame(response)) }
      if (request.method === 'list') {
        respond({ id: request.id, ok: true, value: [...devices.values()].map((device) => device.info) })
        return
      }
      const device = devices.get(request.deviceId)
      if (!device) { respond({ id: request.id, ok: false, error: 'Device is offline' }); return }
      if (request.method === 'status') {
        void device.request('status').then(
          (value) => respond({ id: request.id, ok: true, value }),
          (error: unknown) => respond({ id: request.id, ok: false, error: errorMessage(error) }),
        )
        return
      }
      const sink: WorkerSink = {
        line: (output) => { if (!socket.destroyed) socket.write(`${output}\n`) },
        exit: (reason) => { if (!socket.destroyed) socket.end(`${EXIT_LINE}${reason}\n`) },
      }
      socket.once('close', () => device.closeWorker(sink))
      void device.openWorker(sink).then(() => {
        if (socket.destroyed) { device.closeWorker(sink); return }
        // The worker stays open for as long as the session keeps this connection.
        socket.setTimeout(0)
        socket.write(frame({ id: request.id, ok: true, value: {} }))
        stream = { device, sink }
      }, (error: unknown) => respond({ id: request.id, ok: false, error: errorMessage(error) }))
    }, () => socket.destroy(), WORKER_LINE_BYTES)
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
