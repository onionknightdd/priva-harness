import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

// Exercise the actual built stdio entry point, including live /clear /cd context.
const root = await mkdtemp(join(tmpdir(), 'native-product-'))
const client = new Client({ name: 'native-product-probe', version: '1.0.0' })
try {
  const next = join(root, 'next-workspace')
  await mkdir(next)
  const config = join(root, 'product-tools.json')
  await writeFile(config, JSON.stringify({ cwd: root, sessionId: 'before', tools: ['visualize', 'canvas', 'image_gen', 'image_read', 'image_edit'] }), { mode: 0o600 })
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [resolve(process.argv[2] ?? 'dist/provider/claude/tools/native-product-server.js'), config], stderr: 'inherit' }))
  assert.equal((await client.listTools()).tools.length, 5)
  const visual = await client.callTool({ name: 'visualize', arguments: { jsx: '<button>native</button>' } })
  assert.equal(visual.isError, false)
  assert.ok(JSON.stringify(visual.content).includes('<button>native</button>'))
  await writeFile(join(root, 'claude-terminal-instance'), 'instance')
  await writeFile(join(root, 'claude-terminal-state.json'), JSON.stringify({ sessionId: 'after-clear', instanceId: 'instance', cwd: next, phase: 'idle', event: 'ready', updatedAt: Date.now() }))
  const canvas = await client.callTool({ name: 'canvas', arguments: { html: '<html>native artifact</html>', name: 'probe' } })
  assert.equal(canvas.isError, false)
  assert.equal(await readFile(join(next, '.canvas/probe.html'), 'utf8'), '<html>native artifact</html>')
  process.stdout.write('Native product MCP: compiled entry, JSX and rebound workspace passed\n')
} finally {
  await client.close()
  await rm(root, { recursive: true, force: true })
}
