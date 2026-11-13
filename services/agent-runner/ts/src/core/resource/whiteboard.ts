import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/).refine((value) => !['constructor', 'prototype', '__proto__'].includes(value), 'Reserved element id')
export const whiteboardSessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'A safe native session id is required')
const coordinate = z.number().min(-1_000_000).max(1_000_000)
const dimension = z.number().positive().max(100_000)
const text = z.string().max(100_000)
const color = z.enum(['plain', 'blue', 'green', 'amber', 'rose', 'violet', 'gray'])
const point = z.object({ x: coordinate, y: coordinate }).strict()
const positioned = { x: coordinate, y: coordinate, w: dimension, h: dimension,
  color: color.optional(), text: text.optional(), parentId: id.optional() }
export const whiteboardElementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shape'), ...positioned, kind: z.enum(['rect', 'rounded', 'pill', 'ellipse', 'diamond', 'hexagon', 'parallelogram', 'database', 'queue', 'document', 'cloud', 'person']) }).strict(),
  z.object({ type: z.literal('text'), ...positioned }).strict(),
  z.object({ type: z.literal('container'), ...positioned }).strict(),
  z.object({ type: z.literal('table'), ...positioned, columns: z.array(z.string().max(1000)).min(1).max(30), rows: z.array(z.array(z.string().max(10_000)).max(30)).max(500) }).strict(),
  z.object({ type: z.literal('html'), ...positioned, html: z.string().max(128_000), state: z.json().optional() }).strict(),
  z.object({ type: z.literal('image'), ...positioned, src: z.string().max(2_000_000).refine((value) => /^(https?:\/\/|data:image\/(png|jpeg|gif|webp|svg\+xml);)/i.test(value), 'Use an http(s) image URL or image data URL'), alt: z.string().max(1000).optional() }).strict(),
  z.object({ type: z.literal('stroke'), ...positioned, points: z.array(z.tuple([coordinate, coordinate])).min(2).max(20_000), width: z.number().positive().max(100).optional() }).strict(),
  z.object({ type: z.literal('arrow'), from: z.union([id, point]), to: z.union([id, point]), fromSide: z.enum(['top', 'right', 'bottom', 'left']).optional(), toSide: z.enum(['top', 'right', 'bottom', 'left']).optional(), label: z.string().max(1000).optional(), color: color.optional() }).strict(),
])
export type WhiteboardElement = z.infer<typeof whiteboardElementSchema>
export const whiteboardOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), id, element: whiteboardElementSchema }).strict(),
  z.object({ op: z.literal('update'), id, patch: z.record(z.string(), z.unknown()).refine((patch) => !Object.keys(patch).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key)), 'Reserved patch key') }).strict(),
  z.object({ op: z.literal('delete'), id }).strict(),
])
export type WhiteboardOperation = z.infer<typeof whiteboardOperationSchema>
export const whiteboardSchema = z.object({ v: z.literal(1), title: z.string().max(200), revision: z.number().int().nonnegative(), order: z.array(id).max(2000), elements: z.record(id, whiteboardElementSchema) }).strict()
export type Whiteboard = z.infer<typeof whiteboardSchema>
export const whiteboardClaimSchema = z.object({ id, label: z.string().max(200), x: coordinate, y: coordinate, w: dimension, h: dimension }).strict()
export type WhiteboardClaim = z.infer<typeof whiteboardClaimSchema>
export const whiteboardContextSchema = z.object({ selection: z.array(id).max(2000), viewport: z.object({ x: coordinate, y: coordinate, zoom: z.number().positive().max(100) }).strict().optional(), issues: z.array(z.string().max(1000)).max(100).optional() }).strict()
export type WhiteboardContext = z.infer<typeof whiteboardContextSchema>
export const whiteboardWriteSchema = z.object({ ops: z.array(whiteboardOperationSchema).max(500), title: z.string().max(200).optional(), claim: whiteboardClaimSchema.nullable().optional() }).strict()
export type WhiteboardWrite = z.infer<typeof whiteboardWriteSchema>

export class WhiteboardError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); this.name = 'WhiteboardError' }
}

export function validateWhiteboard(board: Whiteboard): void {
  const ids = Object.keys(board.elements)
  if (ids.length > 2000 || new Set(board.order).size !== ids.length || board.order.length !== ids.length || board.order.some((key) => !Object.hasOwn(board.elements, key))) throw new WhiteboardError(400, 'Board order must contain every element exactly once')
  for (const [key, element] of Object.entries(board.elements)) {
    if (element.type === 'arrow') {
      for (const end of [element.from, element.to]) if (typeof end === 'string' && (!Object.hasOwn(board.elements, end) || board.elements[end]?.type === 'arrow')) throw new WhiteboardError(400, `Arrow ${key} references missing node ${end}`)
    } else {
      if (element.type === 'table' && element.rows.some((row) => row.length !== element.columns.length)) throw new WhiteboardError(400, `Table ${key} rows must match its columns`)
      const seen = new Set([key])
      let parent = element.parentId
      while (parent !== undefined) {
        if (seen.has(parent)) throw new WhiteboardError(400, `Container cycle at ${key}`)
        seen.add(parent)
        const container = board.elements[parent]
        if (container?.type !== 'container') throw new WhiteboardError(400, `Parent ${parent} must be a container`)
        parent = container.parentId
      }
    }
  }
}
