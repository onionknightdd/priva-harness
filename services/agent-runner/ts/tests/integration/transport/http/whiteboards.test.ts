import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhiteboardService } from '../../../../src/harness/whiteboard/whiteboard-service.js'
import { whiteboardRoutes } from '../../../../src/transport/http/route/whiteboards.js'
import { WHITEBOARD_ENDPOINT_ENV, whiteboardReadTool, whiteboardWriteTool } from '../../../../src/core/tool/whiteboard.js'
import { describeTool } from '../../../../src/core/agent-api/tool-kind.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'board-http-'))
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const app = Fastify()
  await app.register(websocket)
  await app.register(whiteboardRoutes, { service: new WhiteboardService() })
  await app.listen({ host: '127.0.0.1', port: 0 })
  cleanups.push(() => app.close())
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  const url = `http://127.0.0.1:${address.port}`
  const endpoint = path.join(cwd, 'endpoint.json')
  await writeFile(endpoint, JSON.stringify({ url }))
  vi.stubEnv(WHITEBOARD_ENDPOINT_ENV, endpoint)
  return { cwd, app, url, endpoint, context: { cwd, session: { provider: 'claude' as const, id: 'agent' }, signal: new AbortController().signal } }
}
const shape = { type: 'shape', kind: 'database', x: 10, y: 20, w: 120, h: 60, text: 'Original' }

async function connect(url: string) {
  const socket = new WebSocket(url)
  const messages: Record<string, unknown>[] = []
  const waiting: { type: string; resolve: (frame: Record<string, unknown>) => void }[] = []
  socket.on('message', (data) => {
    const frame = JSON.parse((Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data).toString('utf8')) as Record<string, unknown>
    const index = waiting.findIndex((entry) => entry.type === frame['type'])
    const waiter = waiting[index]
    if (waiter) { waiting.splice(index, 1); waiter.resolve(frame) }
    else messages.push(frame)
  })
  cleanups.push(async () => { if (socket.readyState !== WebSocket.CLOSED) { const closed = once(socket, 'close'); socket.terminate(); await closed } })
  await once(socket, 'open')
  return { socket, next(type: string): Promise<Record<string, unknown>> {
    const index = messages.findIndex((frame) => frame['type'] === type)
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0] ?? {})
    return new Promise((resolve) => waiting.push({ type, resolve }))
  } }
}

describe('live whiteboard transport and tools', () => {
  it('lists the current session and discovers newly created Agent boards without a registry', async () => {
    const { app, cwd, context } = await fixture()
    const list = async (sessionId = context.session.id) => app.inject({ method: 'POST', url: '/api/sandbox/whiteboards/list', payload: { cwd, sessionId } })
    const empty = await list()
    expect(empty.statusCode).toBe(200)
    expect(empty.json()).toEqual({ files: [] })
    await expect(stat(path.join(cwd, '.whiteboard'))).rejects.toMatchObject({ code: 'ENOENT' })
    const written = await whiteboardWriteTool.execute({ path: 'design/new-flow.board.json', ops: '[]' }, context)
    expect(written.ok).toBe(true)
    const created = JSON.parse(written.text) as { path: string }
    expect((await list()).json()).toEqual({ files: [{ name: 'new-flow.board.json', path: created.path }] })
    expect((await list('another-session')).json()).toEqual({ files: [] })
  })

  it('strictly validates the session listing request', async () => {
    const { app, cwd } = await fixture()
    for (const payload of [
      {}, { cwd }, { sessionId: 'agent' }, { cwd, sessionId: '../other' }, { cwd, sessionId: '' },
      { cwd: ' ', sessionId: 'agent' }, { cwd, sessionId: 'agent', path: '/arbitrary' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/sandbox/whiteboards/list', payload })
      expect(response.statusCode).toBe(400)
    }
  })

  it('shares agent writes, browser edits, context and reconnect snapshots through one service', async () => {
    const { cwd, url, context } = await fixture()
    const created = await whiteboardWriteTool.execute({ path: 'data-flow.board.json', ops: JSON.stringify([{ op: 'set', id: 'a', element: shape }]), title: 'Flow' }, context)
    expect(created.ok).toBe(true)
    const result = JSON.parse(created.text) as { path: string }
    const viewer = await connect(`${url.replace('http', 'ws')}/api/sandbox/whiteboards/stream?${new URLSearchParams({ cwd, path: result.path }).toString()}`)
    expect(await viewer.next('snapshot')).toMatchObject({ board: { revision: 1, title: 'Flow' } })
    await whiteboardWriteTool.execute({ path: result.path, ops: JSON.stringify([{ op: 'update', id: 'a', patch: { text: 'Agent edit' } }]) }, context)
    expect(await viewer.next('change')).toMatchObject({ source: 'agent', revision: 2 })
    viewer.socket.send(JSON.stringify({ type: 'write', requestId: 'drag', ops: [{ op: 'update', id: 'a', patch: { x: 250 } }] }))
    expect(await viewer.next('ack')).toMatchObject({ requestId: 'drag', revision: 3 })
    expect(await viewer.next('change')).toMatchObject({ source: 'user', revision: 3 })
    await viewer.next('presence')
    viewer.socket.send(JSON.stringify({ type: 'context', selection: ['a'], viewport: { x: 0, y: 0, zoom: 1 } }))
    expect(await viewer.next('presence')).toMatchObject({ contexts: [{ selection: ['a'] }] })
    const read = await whiteboardReadTool.execute({ path: result.path }, context)
    expect(read.ok).toBe(true)
    expect(JSON.parse(read.text)).toMatchObject({ board: { revision: 3, elements: { a: { text: 'Agent edit', x: 250 } } }, contexts: [{ selection: ['a'] }] })
    const again = await connect(`${url.replace('http', 'ws')}/api/sandbox/whiteboards/stream?${new URLSearchParams({ path: result.path }).toString()}`)
    expect(await again.next('snapshot')).toMatchObject({ board: { revision: 3 } })
    expect(JSON.parse(await readFile(result.path, 'utf8'))).toMatchObject({ revision: 3 })
  })

  it('subscribes before the board or its directory exists, then streams the first Agent write', async () => {
    const { url, cwd, context, app } = await fixture()
    const file = path.join(cwd, '.whiteboard', context.session.id, 'live.board.json')
    const viewer = await connect(`${url.replace('http', 'ws')}/api/sandbox/whiteboards/stream?${new URLSearchParams({ path: file }).toString()}`)
    expect(await viewer.next('snapshot')).toMatchObject({ board: { revision: 0, elements: {}, order: [] } })
    await expect(readFile(file, 'utf8')).rejects.toThrow()
    const read = await app.inject({ method: 'POST', url: '/api/sandbox/whiteboards/read', payload: { path: file, cwd, sessionId: context.session.id } })
    expect(read.statusCode).toBe(404)
    const written = await whiteboardWriteTool.execute({ path: 'live.board.json', ops: JSON.stringify([{ op: 'set', id: 'a', element: shape }]) }, context)
    expect(written.ok).toBe(true)
    expect(await viewer.next('change')).toMatchObject({ source: 'agent', revision: 1, order: ['a'] })
  })

  it('isolates same-name boards by the current native session and accepts only that session paths', async () => {
    const { cwd, context } = await fixture()
    const workspace = await realpath(cwd)
    const first = await whiteboardWriteTool.execute({ path: 'data-flow.board.json', ops: JSON.stringify([{ op: 'set', id: 'a', element: shape }]) }, context)
    expect(first.ok).toBe(true)
    const firstBoard = JSON.parse(first.text) as { path: string }
    expect(firstBoard.path).toBe(path.join(workspace, '.whiteboard', 'agent', 'data-flow.board.json'))
    const secondContext = { ...context, session: { provider: 'claude' as const, id: 'another-session' } }
    const second = await whiteboardWriteTool.execute({ path: 'data-flow.board.json', ops: '[]' }, secondContext)
    expect(second.ok).toBe(true)
    const secondBoard = JSON.parse(second.text) as { path: string }
    expect(secondBoard.path).toBe(path.join(workspace, '.whiteboard', 'another-session', 'data-flow.board.json'))
    expect(JSON.parse(second.text)).toMatchObject({ board: { elements: {}, revision: 1 } })
    const explicit = await whiteboardWriteTool.execute({ path: 'design/architecture.board.json', ops: '[]' }, context)
    expect(explicit.ok).toBe(true)
    const explicitBoard = JSON.parse(explicit.text) as { path: string }
    expect(explicitBoard.path).toBe(path.join(workspace, '.whiteboard', 'agent', 'design', 'architecture.board.json'))
    for (const target of ['design/architecture.board.json', '.whiteboard/agent/design/architecture.board.json', explicitBoard.path, path.join(cwd, '.whiteboard', 'agent', 'design', 'architecture.board.json')]) {
      expect((await whiteboardReadTool.execute({ path: target }, context)).ok).toBe(true)
      expect((await whiteboardWriteTool.execute({ path: target, ops: '[]' }, context)).ok).toBe(true)
    }
    await mkdir(path.join(cwd, '.canvas'))
    const legacy = path.join(cwd, '.canvas', 'legacy.board.json')
    await writeFile(legacy, 'legacy board, do not migrate')
    for (const target of [secondBoard.path, '.whiteboard/another-session/data-flow.board.json', '../another-session/data-flow.board.json', '.canvas/legacy.board.json', legacy]) {
      expect((await whiteboardReadTool.execute({ path: target }, context)).ok).toBe(false)
      expect((await whiteboardWriteTool.execute({ path: target, ops: '[]' }, context)).ok).toBe(false)
    }
    expect(await readFile(legacy, 'utf8')).toBe('legacy board, do not migrate')
    expect(JSON.parse(await readFile(firstBoard.path, 'utf8'))).toMatchObject({ revision: 1, elements: { a: { text: 'Original' } } })
  })

  it('requires explicit cwd and a safe session id at the HTTP tool boundary', async () => {
    const { app, cwd } = await fixture()
    for (const payload of [
      { path: 'a.board.json', cwd },
      { path: 'a.board.json', sessionId: 'agent' },
      { path: 'a.board.json', cwd, sessionId: '../other' },
      { path: 'a.board.json', cwd, sessionId: '' },
    ]) {
      const read = await app.inject({ method: 'POST', url: '/api/sandbox/whiteboards/read', payload })
      expect(read.statusCode).toBe(400)
      const write = await app.inject({ method: 'POST', url: '/api/sandbox/whiteboards/write', payload: { ...payload, owner: 'agent', ops: [] } })
      expect(write.statusCode).toBe(400)
    }
  })

  it('reports invalid edits with request identity and preserves the file', async () => {
    const { url, context } = await fixture()
    const created = await whiteboardWriteTool.execute({ path: 'data-flow.board.json', ops: JSON.stringify([{ op: 'set', id: 'a', element: shape }]) }, context)
    const result = JSON.parse(created.text) as { path: string }
    const viewer = await connect(`${url.replace('http', 'ws')}/api/sandbox/whiteboards/stream?${new URLSearchParams({ path: result.path }).toString()}`)
    await viewer.next('snapshot')
    viewer.socket.send(JSON.stringify({ type: 'write', requestId: 'bad', ops: [{ op: 'update', id: 'a', patch: { w: -10 } }] }))
    expect(await viewer.next('error')).toMatchObject({ requestId: 'bad' })
    expect(JSON.parse(await readFile(result.path, 'utf8'))).toMatchObject({ revision: 1, elements: { a: { w: 120 } } })
  })

  it('requires an explicit themed filename and rejects unsupported path syntax', async () => {
    const { context } = await fixture()
    expect(whiteboardWriteTool.inputSchema.required).toEqual(['path', 'ops'])
    expect((await whiteboardWriteTool.execute({ ops: '[]' }, context)).ok).toBe(false)
    for (const target of ['', '  ', 'flow.BOARD.JSON', 'sub/../flow.board.json', ' ../agent/login-flow.board.json', 'sub\\flow.board.json', '<flow>.board.json', 'flow.board.json\n']) {
      expect((await whiteboardWriteTool.execute({ path: target, ops: '[]' }, context)).ok).toBe(false)
    }
    await expect(stat(path.join(context.cwd, '.whiteboard'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await whiteboardWriteTool.execute({ path: './login-flow.board.json', ops: '[]' }, context)).ok).toBe(true)
    await expect(stat(path.join(context.cwd, '.whiteboard', context.session.id, 'whiteboard.board.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('validates tool JSON and endpoint availability; classifies both provider tool names', async () => {
    const { context } = await fixture()
    expect((await whiteboardWriteTool.execute({ path: 'data-flow.board.json', ops: 'broken' }, context)).ok).toBe(false)
    vi.stubEnv(WHITEBOARD_ENDPOINT_ENV, '')
    const failure = await whiteboardReadTool.execute({ path: 'a.board.json' }, context)
    expect(failure.ok).toBe(false)
    expect(failure.text).toContain('running Agent Runner')
    expect(describeTool('mcp__agentWorkshop__whiteboard_write')).toMatchObject({ kind: 'visualize' })
    expect(describeTool('whiteboard_read')).toMatchObject({ kind: 'visualize' })
  })
})
