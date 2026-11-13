import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import websocket from '@fastify/websocket'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import Fastify from 'fastify'
import { WebSocket, type RawData } from 'ws'

import type { Whiteboard } from '../../../src/core/resource/whiteboard.js'
import { WHITEBOARD_ENDPOINT_ENV } from '../../../src/core/tool/whiteboard.js'
import { WhiteboardService } from '../../../src/harness/whiteboard/whiteboard-service.js'
import { whiteboardRoutes } from '../../../src/transport/http/route/whiteboards.js'

interface Frame { type: string; revision?: number; board?: Whiteboard }

function waitForFrame(socket: WebSocket, type: string): Promise<Frame> {
  return new Promise((resolveFrame, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.off('message', receive)
      socket.off('error', fail)
      socket.off('close', closed)
    }
    const fail = (error: Error): void => { cleanup(); reject(error) }
    const closed = (): void => fail(new Error(`Whiteboard socket closed before ${type}`))
    const receive = (data: RawData): void => {
      try {
        const message = (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('utf8')
        const frame = JSON.parse(message) as Frame
        if (frame.type === 'error') throw new Error(`Whiteboard returned ${message}`)
        if (frame.type === type) { cleanup(); resolveFrame(frame) }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    }
    const timer = setTimeout(() => fail(new Error(`Timed out waiting for whiteboard ${type}`)), 10_000)
    socket.on('message', receive)
    socket.on('error', fail)
    socket.on('close', closed)
  })
}

function toolData(result: Awaited<ReturnType<Client['callTool']>>): { path: string; board: Whiteboard } {
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.ok(Array.isArray(result.content))
  const content = result.content as { type: string; text?: string }[]
  const text = content.find((block) => block.type === 'text')?.text
  assert.ok(text, 'Native tool must return its board JSON')
  return JSON.parse(text) as { path: string; board: Whiteboard }
}

// Exercise the real stdio child process: its tool singleton must reach the
// same Runner-owned writer as the browser, including after a native /cd.
const root = await realpath(await mkdtemp(join(tmpdir(), 'whiteboard-native-')))
const server = Fastify()
server.register(websocket)
server.register(whiteboardRoutes, { service: new WhiteboardService() })
const client = new Client({ name: 'native-whiteboard-probe', version: '1.0.0' })
let socket: WebSocket | undefined
try {
  await server.listen({ port: 0, host: '127.0.0.1' })
  const address = server.server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = join(root, 'endpoint.json')
  await writeFile(endpoint, JSON.stringify({ url: `http://127.0.0.1:${address.port}` }), { mode: 0o600 })
  const config = join(root, 'product-tools.json')
  await writeFile(config, JSON.stringify({ cwd: root, sessionId: 'native-whiteboard-probe', tools: ['whiteboard_read', 'whiteboard_write'] }), { mode: 0o600 })
  const entry = resolve(process.argv[2] ?? 'src/provider/claude/tools/native-product-server.ts')
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env[WHITEBOARD_ENDPOINT_ENV] = endpoint
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [...(entry.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), entry, config], env, stderr: 'inherit' }))
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ['whiteboard_read', 'whiteboard_write'])
  const created = toolData(await client.callTool({ name: 'whiteboard_write', arguments: {
    path: 'probe.board.json',
    ops: JSON.stringify([{ op: 'set', id: 'database', element: { type: 'shape', kind: 'database', x: 1, y: 2, w: 120, h: 80, text: 'Initial' } }]),
  } }))
  socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/sandbox/whiteboards/stream?path=${encodeURIComponent(created.path)}`)
  assert.equal((await waitForFrame(socket, 'snapshot')).board?.revision, 1)
  const delta = waitForFrame(socket, 'change')
  const changed = toolData(await client.callTool({ name: 'whiteboard_write', arguments: {
    path: created.path, ops: JSON.stringify([{ op: 'update', id: 'database', patch: { text: 'Native update' } }]),
  } }))
  assert.equal(changed.board.revision, 2)
  assert.equal((await delta).revision, 2)
  const ack = waitForFrame(socket, 'ack')
  socket.send(JSON.stringify({ type: 'write', requestId: 'browser-edit', ops: [{ op: 'update', id: 'database', patch: { x: 42 } }] }))
  assert.equal((await ack).revision, 3)
  const read = toolData(await client.callTool({ name: 'whiteboard_read', arguments: { path: created.path } }))
  const element = read.board.elements['database']
  assert.ok(element?.type === 'shape')
  assert.equal(element.text, 'Native update')
  assert.equal(element.x, 42)
  assert.equal(read.board.revision, 3)
  assert.equal(created.path, join(root, '.whiteboard/native-whiteboard-probe/probe.board.json'))
  await writeFile(join(root, 'claude-terminal-instance'), 'whiteboard-probe')
  await writeFile(join(root, 'claude-terminal-state.json'), JSON.stringify({ sessionId: 'resumed-session', instanceId: 'whiteboard-probe', cwd: root, phase: 'idle', event: 'ready', updatedAt: Date.now() }))
  const resumed = toolData(await client.callTool({ name: 'whiteboard_write', arguments: { path: 'probe.board.json', ops: '[]' } }))
  assert.equal(resumed.path, join(root, '.whiteboard/resumed-session/probe.board.json'))
  assert.deepEqual(resumed.board.elements, {})
  const crossSession = await client.callTool({ name: 'whiteboard_read', arguments: { path: created.path } })
  assert.equal(crossSession.isError, true)
  await writeFile(join(root, 'claude-terminal-state.json'), JSON.stringify({ sessionId: 'native-whiteboard-probe', instanceId: 'whiteboard-probe', cwd: root, phase: 'idle', event: 'ready', updatedAt: Date.now() }))
  const restored = toolData(await client.callTool({ name: 'whiteboard_read', arguments: { path: 'probe.board.json' } }))
  assert.equal(restored.board.revision, 3)
  const nextWorkspace = join(root, 'next-workspace')
  await mkdir(nextWorkspace)
  await writeFile(join(root, 'claude-terminal-instance'), 'whiteboard-probe')
  await writeFile(join(root, 'claude-terminal-state.json'), JSON.stringify({ sessionId: 'after-cd', instanceId: 'whiteboard-probe', cwd: nextWorkspace, phase: 'idle', event: 'ready', updatedAt: Date.now() }))
  const rebound = toolData(await client.callTool({ name: 'whiteboard_write', arguments: { path: 'payment-flow.board.json', ops: '[]' } }))
  assert.equal(rebound.path, join(nextWorkspace, '.whiteboard/after-cd/payment-flow.board.json'))
  process.stdout.write('Native whiteboard MCP: child process, Runner HTTP, browser WebSocket, shared revisions, session isolation, resume and rebound workspace passed\n')
} finally {
  socket?.terminate()
  await client.close()
  await server.close()
  await rm(root, { recursive: true, force: true })
}
