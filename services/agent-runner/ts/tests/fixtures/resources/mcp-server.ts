import { createInterface } from 'node:readline'

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const request = JSON.parse(line) as { id?: number; method: string; params?: { protocolVersion?: string; cursor?: string; arguments?: Record<string, unknown> } }
  if (request.id === undefined) return
  let result: unknown
  switch (request.method) {
    case 'initialize': result = { protocolVersion: request.params?.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'fixture', version: '1' } }; break
    case 'tools/list': result = request.params?.cursor ? { tools: [{ name: 'second', inputSchema: { type: 'object' } }] } : { tools: [{ name: 'echo', description: 'Echo a value', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }], nextCursor: 'page2' }; break
    case 'resources/list': result = { resources: [{ name: 'fixture', uri: 'fixture://readme' }] }; break
    case 'prompts/list': result = { prompts: [{ name: 'explain', description: 'Explain the fixture' }] }; break
    case 'tools/call': result = { content: [{ type: 'text', text: JSON.stringify({ args: request.params?.arguments, cwd: process.cwd(), env: process.env['RESOURCE_TEST_VALUE'] }) }] }; break
    default: result = {}
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
})
