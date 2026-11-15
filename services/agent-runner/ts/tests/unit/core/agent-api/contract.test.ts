import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AgentApiError, errorBody, validationError } from '../../../../src/core/agent-api/errors.js'
import { derivedId, hasPrefix, newId } from '../../../../src/core/agent-api/ids.js'
import { createSessionBodySchema, sendMessageBodySchema, userMessageSchema } from '../../../../src/core/agent-api/input.js'
import { describeTool } from '../../../../src/core/agent-api/tool-kind.js'

describe('Agent API IDs', () => {
  it('issues prefixed IDs that sort by creation time', () => {
    const first = newId('ses', 1_000)
    const second = newId('ses', 2_000)
    expect(first).toMatch(/^ses_[0-9A-Z]{26}$/u)
    expect(first < second).toBe(true)
    expect(hasPrefix(first, 'ses')).toBe(true)
    expect(hasPrefix(first, 'run')).toBe(false)
  })

  it('derives the same ID for the same native key', () => {
    expect(derivedId('itm', 'toolu_01')).toBe(derivedId('itm', 'toolu_01'))
    expect(derivedId('itm', 'toolu_01')).not.toBe(derivedId('itm', 'toolu_02'))
    expect(derivedId('itm', 'toolu_01')).not.toBe(derivedId('task', 'toolu_01').replace('task_', 'itm_'))
  })
})

describe('describeTool', () => {
  it.each([
    ['Bash', 'command', undefined],
    ['bash', 'command', undefined],
    ['MultiEdit', 'file_edit', undefined],
    ['Glob', 'search', undefined],
    ['AskUserQuestion', 'question', undefined],
    ['Workflow', 'workflow', undefined],
    ['mcp__linear__list_issues', 'mcp', 'linear'],
    ['mcp__agentWorkshop__image_gen', 'image', 'agentWorkshop'],
    ['visualize', 'visualize', undefined],
    ['SomethingNew', 'other', undefined],
  ] as const)('maps %s to %s', (name, kind, server) => {
    expect(describeTool(name)).toEqual({ name, kind, ...(server === undefined ? {} : { server }) })
  })
})

describe('UserMessage', () => {
  it('accepts text, inline images and inline files', () => {
    expect(userMessageSchema.safeParse({ parts: [
      { type: 'text', text: 'hi' },
      { type: 'image', image_url: 'data:image/png;base64,AAAA' },
      { type: 'file', file_data: 'data:application/pdf;base64,AAAA', filename: 'a.pdf' },
    ] }).success).toBe(true)
  })

  it.each([
    ['empty parts', { parts: [] }],
    ['blank text only', { parts: [{ type: 'text', text: '  ' }] }],
    ['remote image URL', { parts: [{ type: 'image', image_url: 'https://example.com/a.png' }] }],
    ['two image sources', { parts: [{ type: 'image', image_url: 'data:image/png;base64,AA', image_path: 'a.png' }] }],
    ['file_data without filename', { parts: [{ type: 'file', file_data: 'data:text/plain;base64,AA' }] }],
    ['filename with file_path', { parts: [{ type: 'file', file_path: 'a.txt', filename: 'b.txt' }] }],
    ['unknown part', { parts: [{ type: 'audio', url: 'x' }] }],
    ['unknown field', { parts: [{ type: 'text', text: 'x', extra: true }] }],
  ])('rejects %s', (_name, message) => {
    expect(userMessageSchema.safeParse(message).success).toBe(false)
  })

  it('only accepts send options together with a message on session creation', () => {
    for (const option of [{ response: 'wait' }, { allow_interrupt: true }, { delivery: 'steer' }, { stream_options: { deltas: false } }]) {
      expect(createSessionBodySchema.safeParse(option).success).toBe(false)
    }
    expect(createSessionBodySchema.safeParse({}).success).toBe(true)
    expect(createSessionBodySchema.safeParse({ run_mode: 'code' }).success).toBe(true)
  })

  it('only accepts stream options for a streamed response', () => {
    const message = { parts: [{ type: 'text', text: 'x' }] }
    const streamOptions = { deltas: false }
    expect(sendMessageBodySchema.safeParse({ message, stream_options: streamOptions }).success).toBe(true)
    expect(sendMessageBodySchema.safeParse({ message, response: 'stream', stream_options: streamOptions }).success).toBe(true)
    const waiting = sendMessageBodySchema.safeParse({ message, response: 'wait', stream_options: streamOptions })
    expect(waiting.error?.issues.map(({ path }) => path)).toEqual([['stream_options']])
    expect(sendMessageBodySchema.safeParse({ message, stream: true }).success).toBe(false)
  })
})

describe('Agent API errors', () => {
  it('points param at the failing field', () => {
    const result = sendMessageBodySchema.safeParse({ message: { parts: [{ type: 'text', text: 'x' }, { type: 'image' }] } })
    if (result.success) throw new Error('Expected a validation failure')
    const error = validationError(result.error)
    expect(error).toMatchObject({ code: 'validation_failed', type: 'invalid_request', status: 422, param: 'message.parts[1]' })
  })

  it('renders the shared error envelope', () => {
    const error = new AgentApiError('cursor_expired', 'gone', { details: { last_event_seq: 9 } })
    expect(errorBody(error, 'req_1')).toEqual({ error: {
      type: 'invalid_request', code: 'cursor_expired', message: 'gone', request_id: 'req_1', last_event_seq: 9,
    } })
    expect(validationError(new z.ZodError([])).message).toBe('Invalid request')
  })
})
