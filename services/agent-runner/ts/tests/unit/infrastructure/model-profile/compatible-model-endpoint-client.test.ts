import { describe, expect, it } from 'vitest'

import { createModelProfile } from '../../../../src/core/resource/model-profile.js'
import { CompatibleModelEndpointClient } from '../../../../src/infrastructure/model-profile/compatible-model-endpoint-client.js'

describe('CompatibleModelEndpointClient', () => {
  it('falls back from a configured path to the provider origin when listing models', async () => {
    const calls: FetchCall[] = []
    const fetch = createFetch(calls, (url) => url === 'https://api.example.com/models'
      ? jsonResponse(200, { data: [{ id: 'model-a' }, 'model-b'] })
      : new Response('not found', { status: 404 }))
    const client = new CompatibleModelEndpointClient({ fetch })

    await expect(client.listModels(profile())).resolves.toEqual([
      { id: 'model-a' },
      { id: 'model-b' },
    ])
    expect(calls.map(({ url }) => url)).toEqual([
      'https://api.example.com/anthropic/v1/models',
      'https://api.example.com/anthropic/models',
      'https://api.example.com/v1/models',
      'https://api.example.com/models',
    ])
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer secret')
    expect(new Headers(calls[0]?.init.headers).get('x-api-key')).toBe('secret')
  })

  it('sends a minimal image message and classifies success as supported', async () => {
    const calls: FetchCall[] = []
    const fetch = createFetch(calls, () => jsonResponse(200, { content: [] }))
    const client = new CompatibleModelEndpointClient({ fetch })

    await expect(client.probeModelCapability(
      profile(),
      'vision-a',
      'image_understanding',
    )).resolves.toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(
      'https://api.example.com/anthropic/v1/chat/completions',
    )
    expect(JSON.parse(requestBody(calls[0]?.init.body))).toMatchObject({
      model: 'vision-a',
      max_tokens: 1,
      messages: [{
        content: [
          { type: 'text', text: 'Reply with OK.' },
          { type: 'image_url', image_url: { detail: 'low' } },
        ],
      }],
    })
  })

  it('only treats deterministic image schema rejection as unsupported', async () => {
    const unsupported = new CompatibleModelEndpointClient({
      fetch: createFetch([], () => jsonResponse(422, {
        error: { message: 'image content is not supported' },
      })),
    })
    await expect(unsupported.probeModelCapability(
      profile(),
      'text-only',
      'image_understanding',
    )).resolves.toBe(false)

    const missingModel = new CompatibleModelEndpointClient({
      fetch: createFetch([], () => jsonResponse(422, {
        error: { message: 'model not found' },
      })),
    })
    await expect(missingModel.probeModelCapability(
      profile(),
      'missing',
      'image_understanding',
    )).rejects.toMatchObject({ kind: 'upstream-unavailable' })
  })

  it('falls back to Anthropic messages for image understanding', async () => {
    const calls: FetchCall[] = []
    const client = new CompatibleModelEndpointClient({
      fetch: createFetch(calls, (url) => url.endsWith('/messages')
        ? jsonResponse(200, { content: [] })
        : new Response('not found', { status: 404 })),
    })

    await expect(client.probeModelCapability(
      profile(),
      'claude-vision',
      'image_understanding',
    )).resolves.toBe(true)
    const anthropicCall = calls.at(-1)
    expect(anthropicCall?.url).toBe(
      'https://api.example.com/anthropic/v1/messages',
    )
    expect(JSON.parse(requestBody(anthropicCall?.init.body))).toMatchObject({
      model: 'claude-vision',
      messages: [{
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png' } },
          { type: 'text', text: 'Reply with OK.' },
        ],
      }],
    })
  })

  it('uses OpenAI-compatible generation and multipart edit requests', async () => {
    const calls: FetchCall[] = []
    const client = new CompatibleModelEndpointClient({
      fetch: createFetch(calls, () => jsonResponse(200, { data: [] })),
    })

    await expect(client.probeModelCapability(
      profile(),
      'image-a',
      'image_generation',
    )).resolves.toBe(true)
    expect(calls[0]?.url).toBe(
      'https://api.example.com/anthropic/v1/images/generations',
    )
    expect(JSON.parse(requestBody(calls[0]?.init.body))).toMatchObject({
      model: 'image-a',
      n: 1,
    })

    await expect(client.probeModelCapability(
      profile(),
      'edit-a',
      'image_edit',
    )).resolves.toBe(true)
    expect(calls[1]?.url).toBe(
      'https://api.example.com/anthropic/v1/images/edits',
    )
    const formData = calls[1]?.init.body
    expect(formData).toBeInstanceOf(FormData)
    if (!(formData instanceof FormData)) throw new TypeError('Expected FormData')
    expect(formData.get('model')).toBe('edit-a')
    expect(formData.get('prompt')).toBe('Keep this image unchanged.')
    expect(formData.get('image')).toBeInstanceOf(Blob)
  })

  it('maps authentication and timeout failures without exposing the token', async () => {
    const unauthorized = new CompatibleModelEndpointClient({
      fetch: createFetch([], () => new Response('unauthorized', { status: 401 })),
    })
    await expect(unauthorized.listModels(profile())).rejects.toMatchObject({
      kind: 'upstream-auth-failed',
    })

    const timeoutFetch: typeof globalThis.fetch = async (_input, init) => await new Promise(
      (_resolve, reject) => {
        const abort = (): void => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }
        init?.signal?.addEventListener('abort', abort, { once: true })
        if (init?.signal?.aborted === true) abort()
      },
    )
    const timeout = new CompatibleModelEndpointClient({ fetch: timeoutFetch, timeoutMs: 5 })
    try {
      await timeout.listModels(profile())
      throw new Error('Expected the model request to time out')
    } catch (error) {
      expect(error).toMatchObject({ kind: 'upstream-timeout' })
      expect(error).toBeInstanceOf(Error)
      if (error instanceof Error) expect(error.message).not.toContain('secret')
    }
  })
})

interface FetchCall {
  readonly url: string
  readonly init: RequestInit
}

function createFetch(
  calls: FetchCall[],
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const normalizedInit = init ?? {}
    const url = input instanceof Request ? input.url : String(input)
    calls.push({ url, init: normalizedInit })
    return await responder(url, normalizedInit)
  }
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestBody(body: RequestInit['body']): string {
  if (typeof body !== 'string') throw new TypeError('Expected a string request body')
  return body
}

function profile() {
  return createModelProfile({
    id: 'gateway',
    label: 'Gateway',
    baseUrl: 'https://api.example.com/anthropic',
    authToken: 'secret',
  })
}
