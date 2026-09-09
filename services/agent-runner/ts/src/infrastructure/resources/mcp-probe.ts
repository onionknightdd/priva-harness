import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { Client, SSEClientTransport, StreamableHTTPClientTransport, type Transport } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'

import { ResourceError } from '../../core/resource/resource-catalog.js'
import type { McpCapabilities } from '../../core/contract/resource-service.js'
import { record, strings } from './resource-files.js'

function expand(value: string): string {
  if (value.startsWith('!')) throw new ResourceError(422, 'Command-based credentials must be tested in the provider session; use literal headers for this connection test')
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\$env:([A-Za-z_][A-Za-z0-9_]*)/gu, (_match, name: string | undefined, fallback: string | undefined, alternate: string | undefined) => {
    const key = name ?? alternate ?? ''
    const resolved = process.env[key] ?? fallback
    if (resolved === undefined) throw new ResourceError(422, `Environment variable ${key} is not set`)
    return resolved
  })
}

function environment(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, entry]) => {
    if (typeof entry !== 'string') throw new ResourceError(422, `${key} must have a string value`)
    return [key, expand(entry)]
  }))
}

export class McpProbe {
  async capabilities(definition: Record<string, unknown>, cwd: string): Promise<McpCapabilities> {
    return await this.connected(definition, cwd, async (client) => {
      const capabilities = client.getServerCapabilities()
      const tools = capabilities?.tools ? await this.pages((cursor) => client.listTools(cursor === undefined ? {} : { cursor }), 'tools') : []
      const resources = capabilities?.resources ? await this.pages((cursor) => client.listResources(cursor === undefined ? {} : { cursor }), 'resources') : []
      const prompts = capabilities?.prompts ? await this.pages((cursor) => client.listPrompts(cursor === undefined ? {} : { cursor }), 'prompts') : []
      return { tools, resources, prompts, testedAt: new Date().toISOString() }
    })
  }

  async call(definition: Record<string, unknown>, cwd: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    return await this.connected(definition, cwd, async (client) => await client.callTool({ name, arguments: args }, { timeout: 30_000 }))
  }

  private async pages(fetch: (cursor?: string) => Promise<unknown>, key: string): Promise<Record<string, unknown>[]> {
    const values: Record<string, unknown>[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const result = record(await fetch(cursor))
      const items = result[key]
      if (Array.isArray(items)) values.push(...items.map(record))
      if (values.length > 10_000) throw new ResourceError(502, 'MCP catalog is too large')
      if (typeof result['nextCursor'] !== 'string') return values
      cursor = result['nextCursor']
      if (cursors.has(cursor) || values.length > 10_000) throw new ResourceError(502, 'MCP server returned an invalid or oversized paginated catalog')
      cursors.add(cursor)
    }
    throw new ResourceError(502, 'MCP catalog has too many pages')
  }

  private async connected<T>(definition: Record<string, unknown>, cwd: string, run: (client: Client) => Promise<T>): Promise<T> {
    if (definition['disabled'] === true) throw new ResourceError(409, 'Enable this MCP server before testing it')
    if (definition['auth'] === 'oauth' || definition['oauth'] !== undefined || definition['bearerTokenStore'] === true || definition['requestHeadersCommand'] !== undefined || definition['headersHelper'] !== undefined) throw new ResourceError(422, 'This authentication configuration is managed by the provider session; this test supports stdio and HTTP/SSE with explicit credentials')
    const client = new Client({ name: 'priva-mcp-inspector', version: '1.0.0' })
    let transport: Transport
    if (typeof definition['command'] === 'string') {
      const dir = typeof definition['cwd'] === 'string' ? expand(definition['cwd']) : cwd
      transport = new StdioClientTransport({ command: expand(definition['command']), args: strings(definition['args']).map(expand), cwd: resolve(cwd, dir.startsWith('~/') ? `${homedir()}/${dir.slice(2)}` : dir),
        env: { ...(definition['inheritEnv'] === false ? getDefaultEnvironment() : Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))), ...environment(definition['env']) }, stderr: 'pipe', maxBufferSize: 5 * 1024 * 1024 })
      // Drain server stderr without sending credentials or arbitrary process output to the HTTP response.
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => undefined)
    } else if (typeof definition['url'] === 'string') {
      const url = new URL(expand(definition['url']))
      if (!['http:', 'https:'].includes(url.protocol)) throw new ResourceError(422, 'Connection tests support HTTP, SSE and stdio transports')
      const headers = environment(definition['headers'])
      const token = typeof definition['bearerToken'] === 'string' ? expand(definition['bearerToken']) : typeof definition['bearerTokenEnv'] === 'string' ? process.env[definition['bearerTokenEnv']] : undefined
      if (token !== undefined) headers['Authorization'] = `Bearer ${token}`
      const options = { requestInit: { headers } }
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Explicitly configured SSE-only servers still need the legacy transport.
      transport = definition['type'] === 'sse' || definition['httpTransport'] === 'sse' ? new SSEClientTransport(url, options) : new StreamableHTTPClientTransport(url, options)
    } else throw new ResourceError(422, 'Provide a complete stdio or HTTP/SSE definition to test this override')
    const signal = AbortSignal.timeout(30_000)
    const close = () => { void client.close() }
    signal.addEventListener('abort', close, { once: true })
    try {
      await client.connect(transport, { timeout: 15_000 })
      return await run(client)
    } catch (error) {
      if (error instanceof ResourceError) throw error
      throw new ResourceError(signal.aborted ? 504 : 502, signal.aborted ? 'MCP test timed out' : `MCP test failed: ${error instanceof Error ? error.message : 'Connection error'}`)
    } finally {
      signal.removeEventListener('abort', close)
      await client.close()
      await transport.close()
    }
  }
}
