import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { errorBodySchema } from '../../../../src/core/agent-api/errors.js'
import { agentApiEventSchema, DURABLE_EVENT_TYPES } from '../../../../src/core/agent-api/events.js'
import {
  createSessionBodySchema,
  interactionResponseBodySchema,
  patchSessionBodySchema,
  sendMessageBodySchema,
} from '../../../../src/core/agent-api/input.js'
import { sessionSnapshotSchema } from '../../../../src/core/agent-api/objects.js'
import {
  fileUploadedSchema,
  interactionAcceptedSchema,
  messageAcceptedSchema,
  messageResultSchema,
  publishedSessionCreatedSchema,
  runCancelAcceptedSchema,
  runResultSchema,
  runsPageSchema,
  sessionCreatedSchema,
  sessionUpdatedSchema,
  taskStopAcceptedSchema,
} from '../../../../src/core/agent-api/responses.js'

const EXAMPLES = fileURLToPath(new URL('../../../../../../../docs/api/agent-api-v1-examples.md', import.meta.url))
// The examples elide repeated timestamps as "…"; every other value is concrete.
const ELIDED_TIMESTAMP = '2026-10-22T00:00:00.000Z'

interface Payload {
  readonly line: number
  readonly label: string
  readonly value: unknown
  readonly schema: z.ZodType | undefined
}

describe('Agent API v1 examples', () => {
  const problems: string[] = []
  const payloads = collectPayloads(readFileSync(EXAMPLES, 'utf8'), problems)

  it('contains only complete JSON payloads', () => {
    expect(problems).toEqual([])
  })

  it('routes every payload to a schema', () => {
    expect(payloads.filter((payload) => payload.schema === undefined).map(({ line, label }) => `${String(line)} ${label}`)).toEqual([])
  })

  it.each(payloads.map((payload) => [`line ${String(payload.line)} ${payload.label}`, payload] as const))('%s matches the contract', (_name, payload) => {
    const result = payload.schema?.safeParse(payload.value)
    expect(result?.error?.issues ?? []).toEqual([])
  })

  it('shows every event type at least once', () => {
    const types = new Set(payloads.flatMap(({ value }) => isRecord(value) && typeof value['type'] === 'string' ? [value['type']] : []))
    expect([...DURABLE_EVENT_TYPES, 'item.delta', 'native'].filter((type) => !types.has(type))).toEqual([])
  })
})

function collectPayloads(markdown: string, problems: string[]): Payload[] {
  const payloads: Payload[] = []
  const fence = /```(json|http)\n([\s\S]*?)```/gu
  let request: { method: string; path: string } | undefined
  for (const match of markdown.matchAll(fence)) {
    const startLine = markdown.slice(0, match.index).split('\n').length + 1
    const [, kind, body = ''] = match
    if (kind === 'json') {
      const value = parseJson(body, startLine, problems)
      if (value === undefined) continue
      payloads.push({ line: startLine, label: labelOf(value), value, schema: jsonSchemaFor(value) })
      continue
    }
    for (const section of httpSections(body, startLine)) {
      if (section.start.kind === 'request') request = section.start
      if (section.body === undefined) continue
      const value = parseJson(section.body, section.line, problems)
      if (value === undefined) continue
      payloads.push({
        line: section.line,
        label: section.start.kind === 'request' ? `${section.start.method} ${section.start.path}` : `${String(section.start.status)} after ${request?.method ?? '?'} ${request?.path ?? '?'}`,
        value,
        schema: section.start.kind === 'request' ? requestSchemaFor(section.start) : responseSchemaFor(request, section.start.status, value),
      })
    }
  }
  return payloads
}

type HttpStart = { kind: 'request'; method: string; path: string } | { kind: 'response'; status: number }

function httpSections(block: string, startLine: number): { start: HttpStart; body: string | undefined; line: number }[] {
  const lines = block.split('\n')
  const sections: { start: HttpStart; lines: string[]; line: number; inBody: boolean }[] = []
  for (const [offset, line] of lines.entries()) {
    const request = /^(GET|POST|PATCH|DELETE) (\S+)/u.exec(line)
    const response = /^(\d{3}) /u.exec(line)
    if (request?.[1] !== undefined && request[2] !== undefined) {
      sections.push({ start: { kind: 'request', method: request[1], path: request[2] }, lines: [], line: startLine + offset, inBody: false })
    } else if (response?.[1] !== undefined) {
      sections.push({ start: { kind: 'response', status: Number(response[1]) }, lines: [], line: startLine + offset, inBody: false })
    } else {
      const current = sections.at(-1)
      if (current === undefined) continue
      if (!current.inBody && (line.trim() === '' || /^[A-Za-z-]+: /u.test(line) || line.startsWith('('))) continue
      current.inBody = true
      current.lines.push(line)
    }
  }
  return sections.map(({ start, lines: body, line }) => {
    const text = body.join('\n').trim()
    return { start, line, body: text.startsWith('{') ? text : undefined }
  })
}

function requestSchemaFor(request: { method: string; path: string }): z.ZodType | undefined {
  const { method, path } = request
  if (method === 'POST' && path.endsWith('/sessions')) return createSessionBodySchema
  if (method === 'POST' && path.endsWith('/messages')) return sendMessageBodySchema
  if (method === 'POST' && /\/interactions\/[^/]+$/u.test(path)) return interactionResponseBodySchema
  if (method === 'PATCH' && /\/sessions\/[^/]+$/u.test(path)) return patchSessionBodySchema
  return undefined
}

function responseSchemaFor(request: { method: string; path: string } | undefined, status: number, value: unknown): z.ZodType | undefined {
  if (isRecord(value) && 'error' in value) return errorBodySchema
  if (request === undefined) return undefined
  const { method, path } = request
  if (method === 'POST' && /\/published\/[^/]+\/sessions$/u.test(path) && status === 201) return publishedSessionCreatedSchema
  if (method === 'POST' && path.endsWith('/sessions') && status === 201) return sessionCreatedSchema
  if (method === 'POST' && path.endsWith('/files')) return fileUploadedSchema
  if (method === 'POST' && path.endsWith('/messages')) return status === 200 ? messageResultSchema : messageAcceptedSchema
  if (method === 'POST' && /\/interactions\/[^/]+$/u.test(path)) return interactionAcceptedSchema
  if (method === 'POST' && /\/runs\/[^/]+\/cancel$/u.test(path)) return runCancelAcceptedSchema
  if (method === 'POST' && /\/tasks\/[^/]+\/stop$/u.test(path)) return taskStopAcceptedSchema
  if (method === 'PATCH' && /\/sessions\/[^/]+$/u.test(path)) return sessionUpdatedSchema
  if (method === 'GET' && /\/sessions\/[^/?]+$/u.test(path)) return sessionSnapshotSchema
  if (method === 'GET' && /\/runs\/[^/?]+(\?|$)/u.test(path)) return runResultSchema
  if (method === 'GET' && /\/runs(\?|$)/u.test(path)) return runsPageSchema
  return undefined
}

function jsonSchemaFor(value: unknown): z.ZodType | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value['type'] === 'string') return agentApiEventSchema
  if ('message' in value) return sendMessageBodySchema
  return undefined
}

function parseJson(text: string, line: number, problems: string[]): unknown {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error) {
    problems.push(`line ${String(line)}: not valid JSON (${error instanceof Error ? error.message : String(error)})`)
    return undefined
  }
  const normalized = fillElidedTimestamps(value)
  if (JSON.stringify(normalized).includes('"…"')) {
    problems.push(`line ${String(line)}: elides a non-timestamp value`)
    return undefined
  }
  return normalized
}

function fillElidedTimestamps(value: unknown, key?: string): unknown {
  if (value === '…' && key?.endsWith('_at') === true) return ELIDED_TIMESTAMP
  if (Array.isArray(value)) return value.map((item) => fillElidedTimestamps(item))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, fillElidedTimestamps(item, name)]))
}

function labelOf(value: unknown): string {
  return isRecord(value) && typeof value['type'] === 'string' ? value['type'] : 'json'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
