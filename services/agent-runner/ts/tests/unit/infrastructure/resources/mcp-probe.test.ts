import { afterEach, describe, expect, it, vi } from 'vitest'

import { McpProbe } from '../../../../src/infrastructure/resources/mcp-probe.js'

interface RpcRequest { id?: number | string; method: string; params?: { protocolVersion?: string; arguments?: Record<string, unknown> } }
const definition = { url: 'https://mcp.example.test/mcp', headers: { 'X-Probe': 'fixture' }, bearerToken: 'fixture-token' }

function mockServer() {
  const requests: RpcRequest[] = []
  const network = vi.fn<typeof fetch>((_input, init) => {
    if (init?.method !== 'POST') return Promise.resolve(new Response('Unexpected network request', { status: 500 }))
    if (typeof init.body !== 'string') throw new Error('Expected a JSON request body')
    const request = JSON.parse(init.body) as RpcRequest
    requests.push(request)
    if (request.method === 'notifications/initialized') return Promise.resolve(new Response(null, { status: 202 }))
    let result: unknown
    switch (request.method) {
      case 'initialize': result = { protocolVersion: request.params?.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'fixture', version: '1.2.3' } }; break
      case 'tools/list': result = { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }; break
      case 'resources/list': result = { resources: [{ name: 'workspace', uri: 'fixture://workspace' }] }; break
      case 'prompts/list': result = { prompts: [{ name: 'review' }] }; break
      case 'tools/call': result = { content: [{ type: 'text', text: JSON.stringify(request.params?.arguments) }] }; break
      default: throw new Error(`Unexpected MCP method: ${request.method}`)
    }
    const message = { jsonrpc: '2.0', id: request.id, result }
    return Promise.resolve(request.method === 'tools/call'
      ? new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json(message))
  })
  vi.stubGlobal('fetch', network)
  return { network, requests }
}

afterEach(() => vi.unstubAllGlobals())

describe('MCP probe HTTP transport', () => {
  it('reads capabilities and server version over POST without sending GET, preserving headers', async () => {
    const { network, requests } = mockServer()

    const capabilities = await new McpProbe().capabilities(definition, process.cwd())

    expect(capabilities).toMatchObject({ tools: [{ name: 'echo' }], resources: [{ uri: 'fixture://workspace' }], prompts: [{ name: 'review' }], serverVersion: '1.2.3' })
    expect(requests.map((request) => request.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'resources/list', 'prompts/list'])
    expect(network).toHaveBeenCalledTimes(requests.length)
    for (const [input, init] of network.mock.calls) {
      expect(input instanceof Request ? input.url : input.toString()).toBe(definition.url)
      expect(init?.method).toBe('POST')
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Probe')).toBe('fixture')
      expect(headers.get('Authorization')).toBe('Bearer fixture-token')
    }
  })

  it('keeps POST SSE tool responses and typed arguments working without a GET stream', async () => {
    const { network, requests } = mockServer()
    const args = { count: 2, enabled: false, packages: ['one', 'two'] }

    const result = await new McpProbe().call(definition, process.cwd(), 'echo', args)

    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(args) }] })
    expect(requests.at(-1)).toMatchObject({ method: 'tools/call', params: { name: 'echo', arguments: args } })
    expect(network.mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true)
  })

  it('reports real POST failures instead of treating them as a disabled GET stream', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(new Response('Probe unavailable', { status: 503 }))))

    const request = new McpProbe().capabilities(definition, process.cwd())
    await expect(request).rejects.toMatchObject({ statusCode: 502 })
    await expect(request).rejects.toThrow('Probe unavailable')
  })

  it.each(['type', 'httpTransport'])('keeps the GET connection for explicit SSE via %s', async (key) => {
    const network = vi.fn<typeof fetch>(() => Promise.resolve(new Response('SSE unavailable', { status: 503 })))
    vi.stubGlobal('fetch', network)

    await expect(new McpProbe().capabilities({ ...definition, [key]: 'sse' }, process.cwd())).rejects.toMatchObject({ statusCode: 502 })

    expect(network).toHaveBeenCalled()
    expect(network.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })
})
