import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod'

// Run inside the Runner Pod. The calculator mode performs input on the enrolled Mac.
const [mode, deviceId, entry = 'dist/infrastructure/computer/device-mcp.js', ...extra] = process.argv.slice(2)
if (!deviceId || extra.length || (mode !== 'status' && mode !== 'calculator')) {
  throw new Error('Usage: computer-device-smoke.ts status|calculator DEVICE_ID [COMPILED_MCP_ENTRY]')
}
const client = new Client({ name: 'computer-device-smoke', version: '1.0.0' })
async function call(name: string, args: Record<string, string> = {}): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error(`${name} produced no text result`)
  if (result.isError) throw new Error(`${name}: ${content.text}`)
  return JSON.parse(content.text)
}
try {
  const directory = process.env['PRIVA_COMPUTER_DIR']
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [resolve(entry)], env: directory ? { PRIVA_COMPUTER_DIR: directory } : {},
  }))
  const names = (await client.listTools()).tools.map((tool) => tool.name)
  for (const name of ['list_devices', 'device_status', 'calculator_check']) assert.ok(names.includes(name), name)
  const devices = z.array(z.object({ deviceId: z.string(), platform: z.string() })).parse(await call('list_devices'))
  assert.ok(devices.some((item) => item.deviceId === deviceId && item.platform === 'darwin'), 'Requested Mac is offline')
  const version = z.string().min(1)
  const status = z.object({
    platform: z.literal('darwin'), unlocked: z.boolean(),
    runtime: z.object({ target: version, node: version, cuaRepl: version, cua: version, sky: version }).optional(),
  }).parse(await call('device_status', { deviceId }))
  console.log(JSON.stringify({ deviceId, status }))
  if (mode === 'calculator') {
    assert.ok(status.runtime, 'The Mac tray must identify the installed local runtime to verify the original worker')
    const result = await call('calculator_check', { deviceId })
    assert.deepEqual(result, { deviceId, expression: '1+1', result: '2' })
    console.log(JSON.stringify(result))
  }
} finally {
  await client.close()
}
