// MCP server `registered_computers`: the desktop worker of a registered computer,
// reached through the Runner's device service.
//
//   session ── js(deviceId, code) ──> this server ── local worker stream ──> device service
//                                                                              │ SSH channel
//                                        the computer's own desktop worker <───┘
//
// Every call names its device, so input can never land on another desktop.
import { Client, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

import { errorMessage, hasErrorCode } from '../../core/util/errors.js'
import { ComputerClient } from './client.js'

interface Worker {
  readonly client: Client
  /** Why the device ended this worker, once it has. */
  closed?: string
}

const devices = new ComputerClient()
const server = new McpServer({ name: 'registered_computers', version: '2.0.0' })
const workers = new Map<string, Promise<Worker>>()
/** Why a device's previous worker ended, until the session has been told. */
const ended = new Map<string, string>()

const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], isError })
const device = z.object({ deviceId: z.string().min(1).max(64).describe('Device id from list_devices.') })

async function openWorker(deviceId: string): Promise<Worker> {
  const connection = await devices.open(deviceId)
  const worker: Worker = { client: new Client({ name: 'priva-registered-computer', version: '1.0.0' }) }
  const transport: Transport = {
    start: () => Promise.resolve(),
    send: (message) => { connection.send(JSON.stringify(message)); return Promise.resolve() },
    close: () => { connection.close(); return Promise.resolve() },
  }
  connection.onLine = (line) => {
    try { transport.onmessage?.(JSON.parse(line) as JSONRPCMessage) }
    catch (error) { transport.onerror?.(error instanceof Error ? error : new Error(String(error))) }
  }
  connection.onClose = (reason) => {
    worker.closed = reason
    workers.delete(deviceId)
    ended.set(deviceId, reason)
    transport.onclose?.()
  }
  await worker.client.connect(transport, { timeout: 30_000 })
  return worker
}

async function forward(deviceId: string, name: 'js' | 'js_reset', args: Record<string, unknown>, timeout: number) {
  const previous = ended.get(deviceId)
  if (previous !== undefined) {
    ended.delete(deviceId)
    return text(`${previous} The desktop worker on ${deviceId} ended, so its JavaScript bindings are gone. Start again with an entry call.`, true)
  }
  let worker: Worker
  try {
    let opening = workers.get(deviceId)
    if (!opening) {
      opening = openWorker(deviceId)
      workers.set(deviceId, opening)
    }
    worker = await opening
  } catch (error) {
    workers.delete(deviceId)
    ended.delete(deviceId)
    return text(`Cannot use ${deviceId}: ${errorMessage(error)}`, true)
  }
  try {
    const result = await worker.client.callTool({ name, arguments: args }, { timeout })
    return { content: result.content, isError: result.isError === true }
  } catch (error) {
    if (worker.closed === undefined) return text(errorMessage(error), true)
    ended.delete(deviceId)
    return text(`${worker.closed} The last action on ${deviceId} may or may not have happened; read the application's state before repeating it. `
      + 'The JavaScript bindings are gone.', true)
  }
}

server.registerTool('list_devices', {
  description: 'List the registered computers that are connected to this Runner right now.',
}, async () => {
  try { return text(JSON.stringify(await devices.list())) }
  catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return text('This Runner has no device service, so no registered computer is available.', true)
    return text(errorMessage(error), true)
  }
})

server.registerTool('device_status', {
  description: 'Read whether a registered computer can be operated now: its console must be unlocked and its desktop runtime installed.',
  inputSchema: device,
}, async ({ deviceId }) => {
  try { return text(JSON.stringify(await devices.status(deviceId))) }
  catch (error) { return text(errorMessage(error), true) }
})

server.registerTool('js', {
  description: 'Run JavaScript in the desktop worker of a registered computer. It is the `cua` API of `cua_repl.js`, on that computer\'s desktop. '
    + 'The first call for a device, and the first after `js_reset`, runs exactly one entry call such as `let app = await cua.getApp("Calculator");` or `await cua.getState();`. '
    + 'Its result includes the API documentation for that computer\'s platform. Bindings persist per device until its worker ends.',
  inputSchema: device.extend({
    code: z.string().min(1).describe('JavaScript to execute in that computer\'s desktop worker.'),
    title: z.string().max(80).optional().describe('Short user-facing description of what this code block is doing.'),
    timeout_ms: z.number().int().min(1).optional().describe('Optional execution timeout in milliseconds. Defaults to 30000.'),
  }),
}, ({ deviceId, ...args }) => forward(deviceId, 'js', args, (args.timeout_ms ?? 30_000) + 30_000))

server.registerTool('js_reset', {
  description: 'Reset the JavaScript session of a registered computer\'s desktop worker. Its bindings are discarded; applications stay open.',
  inputSchema: device,
}, ({ deviceId }) => forward(deviceId, 'js_reset', {}, 30_000))

// Called by the host when a turn or subagent stops, so each worker releases what it holds for the turn.
server.registerTool('turn_ended', {
  description: 'Host lifecycle event.',
  inputSchema: z.object({ hook_event_name: z.string().min(1), session_id: z.string().min(1), turn_id: z.string().min(1) }),
}, async (event) => {
  await Promise.all([...workers.values()].map(async (opening) => {
    try { await (await opening).client.callTool({ name: 'turn_ended', arguments: event }, { timeout: 10_000 }) }
    catch { /* A worker that is gone has nothing left to release. */ }
  }))
  return text('ok')
})

process.stdin.once('close', () => {
  void Promise.all([...workers.values()].map(async (opening) => {
    try { await (await opening).client.close() } catch { /* Already closed. */ }
  })).finally(() => process.exit(0))
})
await server.connect(new StdioServerTransport())
