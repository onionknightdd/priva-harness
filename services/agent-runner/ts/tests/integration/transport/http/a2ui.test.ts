import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { compileA2uiSource } from '../../../../src/core/a2ui/compiler.js'
import { a2uiRoutes } from '../../../../src/transport/http/route/a2ui.js'
import { salesDashboardSource } from '../../../fixtures/a2ui/sales-dashboard.source.js'

const servers: FastifyInstance[] = []
function createServer() {
  const server = Fastify()
  void server.register(a2uiRoutes)
  servers.push(server)
  return server
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())) })

describe('A2UI HTTP compiler', () => {
  it('compiles a real dashboard with the canonical protocol and isolated request state', async () => {
    const server = createServer()
    const response = await server.inject({ method: 'POST', url: '/api/sandbox/a2ui/compile', payload: { source: salesDashboardSource } })
    expect(response.statusCode).toBe(200)
    expect(response.json<unknown>()).toEqual(compileA2uiSource(salesDashboardSource))
    const next = await server.inject({ method: 'POST', url: '/api/sandbox/a2ui/compile', payload: { source: 'root = Text(text="Fresh")' } })
    expect(next.statusCode).toBe(200)
    expect(next.body).not.toContain('regional')
  })

  it.each([{}, { source: 12 }, { source: {} }, { source: 'root = Text("Hi")', tool: 'render' }, null])('rejects malformed request shapes %j', async (payload) => {
    const response = await createServer().inject({ method: 'POST', url: '/api/sandbox/a2ui/compile', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: string }>().error).toContain('source')
  })

  it.each([
    ['', /source is required/],
    ['root = Column(children=[missing])', /missing/],
    ['root = Table(columns=["A","B"],rows=[[1]])', /exactly 2 cells/],
    ['surface("custom")\nroot = Text("Hi")', /main surface/],
    [' '.repeat(64_001), /exceeds 64000/],
  ])('returns source errors as 422', async (source, expected) => {
    const response = await createServer().inject({ method: 'POST', url: '/api/sandbox/a2ui/compile', payload: { source } })
    expect(response.statusCode).toBe(422)
    expect(response.json<{ error: string }>().error).toMatch(expected)
  })

  it('uses the same error shape for invalid JSON and an oversized body', async () => {
    const server = createServer()
    const malformed = await server.inject({ method: 'POST', url: '/api/sandbox/a2ui/compile', headers: { 'content-type': 'application/json' }, payload: '{' })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json<{ error: unknown }>().error).toBeTypeOf('string')
    const oversized = await server.inject({ method: 'POST', url: '/api/sandbox/a2ui/compile', payload: { source: 'x'.repeat(512 * 1024) } })
    expect(oversized.statusCode).toBe(413)
    expect(oversized.json<{ error: unknown }>().error).toBeTypeOf('string')
  })
})
