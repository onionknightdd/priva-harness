import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { clearedKeypad, readCalculation } from './calculator-state.ts'

const resources = '/Applications/ChatGPT.app/Contents/Resources'
const runtime = join(resources, 'cua_node')
const timeout = 12_000
const controller = new AbortController()
const options = { timeout, signal: controller.signal }

async function unifiedDefinition() {
  const plugin = 'unified-computer-use'
  const metadata = JSON.parse(await readFile(join(resources, 'plugins/openai-bundled/plugins', plugin, '.codex-plugin/plugin.json'), 'utf8'))
  if (!/^[\d.]+$/u.test(metadata.version)) throw new Error('Unexpected unified Computer Use version')
  const file = join(homedir(), '.codex/plugins/cache/openai-bundled', plugin, metadata.version, '.mcp.json')
  const { cua_repl: definition } = JSON.parse(await readFile(file, 'utf8')).mcpServers
  if (definition?.enabled !== true || !definition.enabled_tools?.includes('js')) {
    throw new Error('Install and enable Computer Use in the ChatGPT desktop app')
  }
  if (definition.env?.NODE_REPL_JS_BANNER?.trim() !== 'await import("@oai/cua/tinyskyAlt");') {
    throw new Error('Unsupported Computer Use bootstrap')
  }
  return definition
}

async function withWorker(name, run) {
  const definition = name === 'cua_repl' ? await unifiedDefinition() : undefined
  const env = {
    NODE_REPL_NODE_PATH: join(runtime, 'bin/node'),
    NODE_REPL_NODE_MODULE_DIRS: join(runtime, 'lib/node_modules'),
    NODE_REPL_TRUSTED_CODE_PATHS: join(runtime, 'lib/node_modules'),
  }
  // Only the desktop installation's static declarations. Host-issued approvals and
  // connection credentials can be supplied only by the owning desktop host.
  if (definition) {
    for (const key of [
      'NODE_REPL_JS_BANNER', 'NODE_REPL_TOOL_OVERRIDES', 'NODE_REPL_JS_COMPLETION_SUMMARY',
      'NODE_REPL_TRUSTED_SERVICES', 'NODE_REPL_UNTRUSTED_ENV_ALLOWLIST',
      'BROWSER_USE_AVAILABLE_BACKENDS', 'BROWSER_USE_TINYSKY_ENABLED',
      'CUA_REPL_ENABLED_SURFACES', 'SKY_CUA_SERVICE_PATH',
    ]) {
      const value = definition.env[key]
      if (typeof value === 'string') env[key] = value
    }
  }
  const transport = new StdioClientTransport({
    command: join(runtime, 'bin/node_repl'), env, stderr: 'pipe',
  })
  const client = new Client({ name: 'priva-computer-compatibility', version: '1.0.0' })
  let startupError = ''
  const captureStartupError = (chunk) => { startupError = (startupError + chunk.toString()).slice(-512) }
  transport.stderr?.on('data', captureStartupError)
  try {
    controller.signal.throwIfAborted()
    try {
      await client.connect(transport, options)
    } catch (error) {
      if (!startupError.trim()) throw error
      throw new Error(`${error.message}\n${startupError.trim()}`, { cause: error })
    } finally {
      transport.stderr?.off('data', captureStartupError)
      transport.stderr?.resume()
    }
    const { tools, nextCursor } = await client.listTools({}, options)
    if (nextCursor) throw new Error('Unexpected paginated Computer Use tool catalog')
    if (!tools.some((tool) => tool.name === 'js')) throw new Error(`${name} does not provide the js tool`)
    return await run(client, {
      server: client.getServerVersion(), tools: tools.map((tool) => tool.name),
      ...(definition ? { enabledTools: definition.enabled_tools } : {}),
    })
  } finally {
    await client.close()
    await transport.close()
  }
}

async function invoke(client, args) {
  const response = await client.callTool({ name: 'js', arguments: args }, options)
  const text = response.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  if (response.isError) throw new Error(text.trim().slice(0, 1024) || 'Computer Use returned an error')
  return text
}

async function checkRuntime(client, name) {
  if (name === 'cua_repl') {
    const observed = await invoke(client, { code: 'nodeRepl.write(typeof cua.getApp);', title: 'Checking the Computer Use API' })
    if (!observed.split(/\r?\n/u).includes('function')) throw new Error('The preloaded cua.getApp function was unavailable')
    return { getAppType: 'function' }
  }
  await invoke(client, { code: 'const probeBinding = { label: "binding", sequence: 6 };' })
  const second = await invoke(client, { code: 'nodeRepl.write(probeBinding.label + "-" + (probeBinding.sequence + 1));' })
  if (!second.split(/\r?\n/u).includes('binding-7')) throw new Error('The second JS call did not read the first call’s binding')
  return { persistentBinding: true }
}

async function checkCalculator(client) {
  await invoke(client, { code: 'let calculator = await cua.getApp("com.apple.calculator");', title: 'Opening Calculator' })
  const cleared = await invoke(client, {
    code: 'await calculator.pressKey("alt+Escape"); await calculator.getAXState({disableDiffing:true});',
    title: 'Reading the cleared Calculator keypad',
  })
  const clicks = clearedKeypad(cleared).map((index) => `await calculator.click(${index});`).join('\n')
  const final = await invoke(client, {
    code: `${clicks}\nawait calculator.getAXState({disableDiffing:true});`, title: 'Calculating one plus one',
  })
  const verified = readCalculation(final)
  await invoke(client, { completion_summary: 'Verified Calculator displayed two' })
  return verified
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('The local ChatGPT desktop runtime probe requires macOS')
  const [mode, ...extra] = process.argv.slice(2)
  if (extra.length || !['inventory', 'runtime', 'calculator'].includes(mode)) throw new Error('Usage: probe.mjs inventory|runtime|calculator')
  if (mode === 'calculator') return await withWorker('cua_repl', checkCalculator)
  const results = {}
  for (const name of ['node_repl', 'cua_repl']) {
    try {
      results[name] = await withWorker(name, (client, inventory) => mode === 'runtime' ? checkRuntime(client, name) : inventory)
    } catch (error) {
      results[name] = { error: (error instanceof Error ? error.message : String(error)).slice(0, 1024) }
      process.exitCode = 1
    }
  }
  return results
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => controller.abort(new Error(`Cancelled by ${signal}`)))
}
try {
  console.log(JSON.stringify(await main()))
} catch (error) {
  console.error((error instanceof Error ? error.message : String(error)).slice(0, 1024))
  process.exitCode = 1
}
