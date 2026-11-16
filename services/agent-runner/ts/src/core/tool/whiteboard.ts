import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { networkInterfaces } from 'node:os'
import { defineTool, stringToolArg, type ToolContext } from './define-tool.js'
import { WHITEBOARD_READ_TOOL_NAME, WHITEBOARD_WRITE_TOOL_NAME } from '../event/tool-names.js'

export const WHITEBOARD_ENDPOINT_ENV = 'PRIVA_WHITEBOARD_ENDPOINT_FILE'
const properties = {
  path: { type: 'string' as const, description: 'Board file path within <cwd>/.whiteboard/<current-session-id>/. Short relative paths, including subdirectories, resolve inside that session directory. Also accepts its workspace-relative .whiteboard/<current-session-id>/... path or a returned absolute path. Other sessions, .canvas paths and escapes are rejected. Required for both read and write. On first creation choose a concise filename based on the content topic, such as login-flow.board.json; reuse that same path for subsequent edits. There is no default filename.' },
}
export const whiteboardReadTool = defineTool({
  name: WHITEBOARD_READ_TOOL_NAME,
  description: 'Read a whiteboard, its element records, current human selections, viewport, layout issues and Agent claims. Read before changing an existing board. Use whiteboard_write for every mutation so all viewers update live; never edit board JSON with file tools.',
  inputSchema: { type: 'object', properties, required: ['path'] },
  async execute(input, context) {
    return request('read', { path: stringToolArg(input, 'path'), cwd: context.cwd, sessionId: context.session.id }, context)
  },
})
export const whiteboardWriteTool = defineTool({
  name: WHITEBOARD_WRITE_TOOL_NAME,
  description: [
    'Create or incrementally edit a live whiteboard in the workspace preview. Return includes path to open in Workspace.',
    'Always supply path. For a new board, generate a concise content-specific filename such as login-flow.board.json or payment-architecture.board.json. For an existing board, reuse its path; do not create a new file for each edit.',
    'ops is a JSON array: {op:"set",id,element}, {op:"update",id,patch} (changed fields only), {op:"delete",id}. Batches are atomic. Use stable element ids; never replace the whole board.',
    'Elements: shape, text, container, table, html, image, stroke, arrow. All except arrows need x,y,w,h. Optional color: plain,blue,green,amber,rose,violet,gray; text:string; parentId:container id. Child coordinates are parent-relative.',
    'shape.kind: rect,rounded,pill,ellipse,diamond,hexagon,parallelogram,database,queue,document,cloud,person.',
    'arrow: from/to each an element id or {x,y}, optional fromSide/toSide top/right/bottom/left, label. table: columns:string[],rows:string[][], each row matching columns.',
    'stroke: points:[number,number][] relative to its position, width:number. image: src HTTPS URL or data:image URL, alt optional. html: html string and optional JSON state.',
    'Embedded html runs in an isolated iframe without network. Use window.whiteboard.state, window.whiteboard.setState(next), window.whiteboard.subscribe(listener) to persist and observe state. Do not include external scripts.',
    'New elements animate as the Agent draws them. Keep layouts legible, fit text within dimensions, connect arrows to nodes, group related elements with containers. Read viewer issues and selection before refining.',
    'Optional claim JSON {id,label,x,y,w,h} shows the area you are working on for up to 60 seconds; renew if needed and pass claim:"null" in the final batch to clear it. Empty ops may update a claim.',
  ].join(' '),
  inputSchema: { type: 'object', properties: { ...properties,
    title: { type: 'string', description: 'Optional board title.' },
    ops: { type: 'string', description: 'JSON array of set/update/delete element operations. Maximum 500 operations and 2000 elements.' },
    claim: { type: 'string', description: 'Optional JSON work-area rectangle, or the JSON string null to clear your claim.' },
  }, required: ['path', 'ops'] },
  async execute(input, context) {
    try {
      const title = stringToolArg(input, 'title'), claim = stringToolArg(input, 'claim')
      return await request('write', { path: stringToolArg(input, 'path'), cwd: context.cwd, sessionId: context.session.id,
        ops: JSON.parse(stringToolArg(input, 'ops')) as unknown, owner: `${context.session.provider}:${context.session.id}`,
        ...(title ? { title } : {}), ...(claim ? { claim: JSON.parse(claim) as unknown } : {}) }, context)
    } catch (error) { return { ok: false, text: error instanceof Error ? error.message : String(error) } }
  },
})

async function request(action: 'read' | 'write', body: unknown, context: ToolContext): Promise<{ ok: boolean; text: string }> {
  try {
    const file = process.env[WHITEBOARD_ENDPOINT_ENV]
    if (!file || !path.isAbsolute(file)) throw new Error('Whiteboard requires a running Agent Runner; its endpoint was not configured')
    // Read on every call so terminals surviving a Runner restart find its new port.
    const endpoint: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof endpoint !== 'object' || endpoint === null || !('url' in endpoint) || typeof endpoint.url !== 'string') throw new Error('Invalid Runner whiteboard endpoint')
    const url = new URL(endpoint.url)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const localAddresses = new Set(Object.values(networkInterfaces()).flatMap((interfaces) => interfaces?.map((entry) => entry.address) ?? []))
    if (url.protocol !== 'http:' || !(hostname === '::1' || hostname.startsWith('127.') || localAddresses.has(hostname))) throw new Error('Whiteboard endpoint must be on the local Runner')
    const response = await fetch(new URL(`/api/sandbox/whiteboards/${action}`, url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]) })
    const text = await response.text()
    return { ok: response.ok, text }
  } catch (error) { return { ok: false, text: error instanceof Error ? error.message : String(error) } }
}
