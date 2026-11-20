import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { computerMcpServers, runtimeSurfaces } from '../../../src/core/plugin/computer-use.js'
import { resolveSessionPluginResources } from '../../../src/core/plugin/session-plugin-resources.js'

const [runtime, selection, ...extra] = process.argv.slice(2)
if (!runtime || extra.length) throw new Error('Usage: original-computer-surface-probe.ts RUNTIME [computer|browser|browser,computer|standalone-linux]')
const options = { timeout: 12_000 }
type Launch = ReturnType<typeof computerMcpServers>[string]

async function withWorker(launch: Launch, check: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: 'priva-original-surface-probe', version: '1.0.0' })
  const transport = new StdioClientTransport({ ...launch, stderr: 'ignore' })
  try {
    await client.connect(transport, options)
    await check(client)
  } finally {
    await client.close()
    await transport.close()
  }
}

async function call(client: Client, name: string, args: Record<string, string>): Promise<string[]> {
  const result = await client.callTool({ name, arguments: args }, options)
  const lines = result.content.filter((part) => part.type === 'text').flatMap((part) => part.text.split(/\r?\n/u))
  if (result.isError) throw new Error(lines.join('\n').slice(-1024))
  return lines
}

if (selection === 'standalone-linux') {
  assert.equal(process.platform, 'linux')
  const env = { ...process.env, PRIVA_CUA_RUNTIME: runtime, CUA_REPL_ENABLED_SURFACES: 'browser', PRIVA_CUA_ENABLED_SKILLS: 'computer-use' }
  assert.ok(process.env['PRIVA_CUA_SKILLS'], 'Set PRIVA_CUA_SKILLS to the verified Linux snapshot')
  assert.ok(resolveSessionPluginResources([], env).some(({ skillDir }) => skillDir.endsWith('/skills/computer-use')))
  const worker = computerMcpServers([], env)['node_repl']
  assert.ok(worker)
  await withWorker(worker, async (client) => {
    await call(client, 'js', { code: 'globalThis.sky = (await import("@oai/sky")).sky;' })
    const lines = await call(client, 'js', { code: 'nodeRepl.write("runner-window-count=" + (await sky.list_windows()).length);' })
    const count = lines.find((line) => line.startsWith('runner-window-count='))?.split('=')[1]
    assert.ok(count && /^[1-9]\d*$/u.test(count), 'The standalone Sky worker must see an Xfce window')
    console.log(JSON.stringify({ worker: 'node_repl', standalone: 'computer-use', linuxWindowCount: Number(count) }))
  })
}
const selections = selection === 'standalone-linux' ? [] : selection === undefined ? ['computer', 'browser', 'browser,computer'] : [selection]
for (const [i, selected] of selections.entries()) {
  const env = { PRIVA_CUA_RUNTIME: runtime, CUA_REPL_ENABLED_SURFACES: selected }
  const surfaces = runtimeSurfaces(env)
  const servers = computerMcpServers([], env)
  assert.ok(servers['node_repl'] && servers['cua_repl'])
  if (i === 0) {
    await withWorker(servers['node_repl'], async (client) => {
      await call(client, 'js', { code: 'let runnerProbeState = { n: 40 };' })
      const reused = await call(client, 'js', { code: 'nodeRepl.write("runner-result=" + (runnerProbeState.n + 2));' })
      assert.ok(reused.includes('runner-result=42'), 'Generic worker must preserve bindings between calls')
      await call(client, 'js_reset', {})
      const reset = await call(client, 'js', { code: 'nodeRepl.write("runner-type=" + typeof runnerProbeState);' })
      assert.ok(reset.includes('runner-type=undefined'), 'Reset must discard the previous binding')
      console.log(JSON.stringify({ worker: 'node_repl', persistentBinding: true, reset: true }))
    })
  }
  await withWorker(servers['cua_repl'], async (client) => {
    const lines = await call(client, 'js', {
      code: 'nodeRepl.write("runner-surface=" + JSON.stringify({getApp:typeof cua.getApp,getBrowser:typeof cua.getBrowser}));',
    })
    const observed = lines.find((line) => line.startsWith('runner-surface='))
    assert.ok(observed, 'The original NodeREPL did not return the surface type observation')
    const types: unknown = JSON.parse(observed.slice('runner-surface='.length))
    assert.deepEqual(types, {
      getApp: surfaces.includes('computer') ? 'function' : 'undefined',
      getBrowser: surfaces.includes('browser') ? 'function' : 'undefined',
    })
    console.log(JSON.stringify({ worker: 'cua_repl', surfaces, types }))
  })
}
