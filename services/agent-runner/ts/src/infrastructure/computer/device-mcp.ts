import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { ComputerClient } from './client.js'

const client = new ComputerClient()
const server = new McpServer({ name: 'registered_computers', version: '1.0.0' })
const device = z.object({ deviceId: z.string().min(1).max(128) })
const textResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

server.registerTool('list_devices', {
  description: 'List devices currently connected to this Runner through the desktop tray.',
}, async () => textResult(await client.list()))
server.registerTool('device_status', {
  description: 'Read the selected device’s current desktop availability.', inputSchema: device,
}, async ({ deviceId }) => textResult(await client.request(deviceId, 'status')))
server.registerTool('calculator_check', {
  description: 'Ask the selected Mac tray to perform and read back 1 + 1 in Calculator.', inputSchema: device,
}, async ({ deviceId }) => {
  const value = await client.request(deviceId, 'calculator-check')
  const proof = z.object({ expression: z.literal('1+1'), result: z.literal('2') }).parse(value)
  return textResult({ deviceId, ...proof })
})
await server.connect(new StdioServerTransport())
