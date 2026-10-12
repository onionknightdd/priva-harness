import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket, type RawData } from 'ws'

import type { ComputerConfig } from '../../../../src/computer-config.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

const PATH = '/api/sandbox/computer/stream'
const GREETING = Buffer.from('RFB 003.008\n')

describe('computer desktop HTTP and WebSocket routes', () => {
  let root: string
  let server: FastifyInstance | undefined
  let vnc: Server
  let vncPort: number
  let origin: string
  let wsUrl: string
  let connections: Socket[]
  let clients: WebSocket[]
  let input: Buffer[]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'priva-computer-'))
    connections = []
    clients = []
    input = []
    vnc = createServer((socket) => {
      connections.push(socket)
      socket.on('error', () => { /* Socket teardown is asserted by the tests. */ })
      socket.on('data', (data: Buffer) => { input.push(data); socket.write(data) })
      socket.write(GREETING)
    })
    vnc.listen(0, '127.0.0.1')
    await once(vnc, 'listening')
    const address = vnc.address()
    if (!address || typeof address === 'string') throw new Error('Missing mock VNC address')
    vncPort = address.port
  })

  afterEach(async () => {
    for (const client of clients) client.terminate()
    await server?.close()
    for (const connection of connections) connection.destroy()
    await new Promise<void>((resolve) => vnc.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })

  async function start(computer: ComputerConfig | null = {
    host: '127.0.0.1', port: vncPort, allowedOrigins: [],
  }): Promise<void> {
    const services = createTestAgentServices(join(root, 'runtime'))
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: root }),
      modelProfileService: services.modelProfileService,
      agentProfileService: services.agentProfileService,
      ...(computer === null ? {} : { computer }),
    })
    origin = await server.listen({ host: '127.0.0.1', port: 0 })
    wsUrl = origin.replace('http:', 'ws:') + PATH
  }

  async function connect(headers: Record<string, string> = { origin }): Promise<{
    socket: WebSocket, received: Buffer[],
  }> {
    const socket = new WebSocket(wsUrl, { headers })
    const received: Buffer[] = []
    clients.push(socket)
    socket.on('message', (data: RawData, binary: boolean) => {
      expect(binary).toBe(true)
      received.push(asBuffer(data))
    })
    socket.on('error', () => { /* The open promise and close assertions observe failures. */ })
    await once(socket, 'open')
    return { socket, received }
  }

  async function rejected(headers: Record<string, string>, suffix = ''): Promise<number> {
    const socket = new WebSocket(wsUrl + suffix, { headers })
    clients.push(socket)
    socket.on('error', () => { /* Expected failed handshake. */ })
    return await new Promise<number>((resolve, reject) => {
      socket.once('open', () => reject(new Error('Unexpected accepted upgrade')))
      socket.once('unexpected-response', (_request, response) => {
        response.resume()
        socket.terminate()
        resolve(response.statusCode ?? 0)
      })
    })
  }

  it('reports configuration without opening a VNC connection', async () => {
    await start()
    const response = await server?.inject('/api/sandbox/computer')
    expect(response?.statusCode).toBe(200)
    expect(response?.json<unknown>()).toEqual({ available: true })
    expect(response?.headers['cache-control']).toBe('no-store')
    expect(connections).toHaveLength(0)
  })

  it('keeps an unconfigured desktop unavailable and refuses its upgrade', async () => {
    await start(null)
    expect((await server?.inject('/api/sandbox/computer'))?.json<unknown>()).toEqual({ available: false })
    expect(await rejected({ origin })).toBe(503)
    expect(connections).toHaveLength(0)
  })

  it('passes binary RFB bytes in both directions, including a large clipboard message', async () => {
    await start()
    const { socket, received } = await connect()
    await expect.poll(() => Buffer.concat(received)).toEqual(GREETING)
    const paste = Buffer.alloc(1024 * 1024 + 17, 0xab)
    socket.send(paste)
    await expect.poll(() => input.reduce((size, chunk) => size + chunk.length, 0)).toBe(paste.length)
    expect(Buffer.concat(input).equals(paste)).toBe(true)
    await expect.poll(() => received.reduce((size, chunk) => size + chunk.length, 0)).toBe(GREETING.length + paste.length)
    expect(Buffer.concat(received).equals(Buffer.concat([GREETING, paste]))).toBe(true)
    socket.close()
    await expect.poll(() => connections[0]?.destroyed).toBe(true)
  })

  it('rejects cross-site, missing and null origins and ignores spoofed forwarding headers', async () => {
    await start()
    for (const headers of [
      {}, { origin: 'null' }, { origin: 'https://evil.example' },
      { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
      { origin: origin + '/' },
    ]) expect(await rejected(headers)).toBe(403)
    expect(connections).toHaveLength(0)
  })

  it('accepts only explicitly configured proxy origins with their exact port', async () => {
    await start({ host: '127.0.0.1', port: vncPort, allowedOrigins: ['http://localhost:15173'] })
    const { received } = await connect({ origin: 'http://localhost:15173' })
    await expect.poll(() => Buffer.concat(received)).toEqual(GREETING)
    expect(await rejected({ origin: 'http://localhost:15174' })).toBe(403)
    expect(await rejected({ origin: 'http://localhost.evil.example:15173' })).toBe(403)
  })

  it('refuses target query parameters before connecting to the configured VNC server', async () => {
    await start()
    expect(await rejected({ origin }, '?host=example.com&port=22')).toBe(400)
    expect(connections).toHaveLength(0)
  })

  it('refuses text and oversized input and closes the upstream socket', async () => {
    await start()
    for (const [payload, code] of [
      ['not RFB', 1003], [Buffer.alloc(8 * 1024 * 1024 + 1), 1009],
    ] as const) {
      const { socket, received } = await connect()
      await expect.poll(() => Buffer.concat(received)).toEqual(GREETING)
      const closed = once(socket, 'close')
      socket.send(payload)
      expect((await closed)[0]).toBe(code)
    }
    expect(input).toHaveLength(0)
    await expect.poll(() => connections.every((connection) => connection.destroyed)).toBe(true)
  })

  it('closes the WebSocket when its configured desktop is unreachable', async () => {
    await new Promise<void>((resolve) => vnc.close(() => resolve()))
    await start()
    const { socket } = await connect()
    expect((await once(socket, 'close'))[0]).toBe(1011)
  })

  it('flushes the final upstream bytes before closing the browser stream', async () => {
    await start()
    const { socket, received } = await connect()
    await expect.poll(() => Buffer.concat(received)).toEqual(GREETING)
    const closed = once(socket, 'close')
    const tail = Buffer.alloc(512 * 1024, 0x42)
    connections[0]?.end(tail)
    await closed
    expect(Buffer.concat(received).equals(Buffer.concat([GREETING, tail]))).toBe(true)
  })

  it('shuts down active browser and VNC sockets with the HTTP server', async () => {
    await start()
    const { socket, received } = await connect()
    await expect.poll(() => Buffer.concat(received)).toEqual(GREETING)
    const closed = once(socket, 'close')
    await server?.close()
    await closed
    await expect.poll(() => connections[0]?.destroyed).toBe(true)
  })
})

function asBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.isBuffer(data) ? data : Buffer.from(data)
}
