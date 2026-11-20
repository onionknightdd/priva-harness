// Checks a registered computer through the Runner's device service, the way a session reaches it.
// Run where the device service runs, with PRIVA_COMPUTER_DIR set when it is not the default.
//
//   computer-device-smoke.ts status DEVICE_ID              availability and installed runtime
//   computer-device-smoke.ts app DEVICE_ID APPLICATION     also opens APPLICATION on that computer
//                                                          and reads its window. It sends no input.
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod'
import { resolvePluginMcpServers } from '../../src/core/plugin/plugin-mcp.js'
import { resolveBuiltinPlugins } from '../../src/core/plugin/builtin-plugins.js'

const [mode, deviceId, application, ...extra] = process.argv.slice(2)
if (!deviceId || extra.length > 0 || !((mode === 'status' && application === undefined) || (mode === 'app' && application !== undefined))) {
  throw new Error('Usage: computer-device-smoke.ts status DEVICE_ID | app DEVICE_ID APPLICATION')
}

// Only the device server is started; it does not need this machine's own desktop runtime.
const [plugin] = resolveBuiltinPlugins(['computer-use'])
const declaration = plugin?.mcpServers['registered_computers']
assert.ok(plugin && declaration, 'The computer-use plugin does not declare registered_computers')
const [launch] = resolvePluginMcpServers([{ ...plugin, mcpServers: { registered_computers: declaration } }])
assert.ok(launch)

const client = new Client({ name: 'computer-device-smoke', version: '1.0.0' })
async function call(name: string, args: Record<string, string> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args }, { timeout: 120_000 })
  const content = result.content as { type: string; text?: string }[]
  const text = content.map((part) => part.text ?? '').join('\n')
  if (result.isError) throw new Error(`${name}: ${text.slice(0, 1024)}`)
  return text
}
try {
  await client.connect(new StdioClientTransport({ command: launch.command, args: [...launch.args], stderr: 'inherit',
    env: { PATH: process.env['PATH'] ?? '', ...launch.env } }))
  const names = (await client.listTools()).tools.map((tool) => tool.name)
  for (const name of ['list_devices', 'device_status', 'js', 'js_reset']) assert.ok(names.includes(name), name)
  const devices = z.array(z.object({ deviceId: z.string(), platform: z.string() })).parse(JSON.parse(await call('list_devices')))
  assert.ok(devices.some((item) => item.deviceId === deviceId && item.platform === 'darwin'), 'The requested computer is not connected')
  const version = z.string().min(1)
  const status = z.object({
    platform: z.literal('darwin'), unlocked: z.boolean(),
    runtime: z.object({ target: version, node: version, cuaRepl: version, cua: version, sky: version }).optional(),
  }).parse(JSON.parse(await call('device_status', { deviceId })))
  console.log(JSON.stringify({ deviceId, status }))
  if (application !== undefined) {
    assert.ok(status.unlocked, 'Unlock the computer before opening an application on it')
    assert.ok(status.runtime, 'The computer has no desktop runtime installed')
    const opened = await call('js', { deviceId, title: `Opening ${application}`, code: `let app = await cua.getApp(${JSON.stringify(application)});` })
    const interfaceLines = opened.split('\n').filter((line) => /^\s*\d+\s+\S/u.test(line))
    assert.ok(interfaceLines.length > 0, 'The computer returned no application interface')
    // The binding lives in that computer's worker and survives into the next call.
    const again = await call('js', { deviceId, title: 'Reading it again', code: 'nodeRepl.write(String((await app.getAXState({disableDiffing:true})).length));' })
    assert.match(again.trim().split('\n').at(-1) ?? '', /^\d+$/u, 'The worker did not keep the application binding')
    console.log(JSON.stringify({ application, interfaceLines: interfaceLines.length, firstLine: interfaceLines[0]?.trim().slice(0, 120), bindingKept: true }))
  }
} finally {
  await client.close()
}
