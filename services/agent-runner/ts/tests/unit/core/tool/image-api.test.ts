import { describe, expect, it, vi } from 'vitest'

import { CompatibleImageApi, normalizeSize } from '../../../../src/core/tool/image-api.js'

const profile = {
  baseUrl: 'https://api.example.com/v1',
  authToken: 'secret',
}

const pngB64 = Buffer.from('png-bytes').toString('base64')
const sourceImage = { bytes: Uint8Array.from([1]), mime: 'image/png', name: 'a.png' }
const imageCalls = [
  { name: 'generate', call: (api: CompatibleImageApi) => api.generate(profile, 'gen-a', { prompt: 'a lake' }) },
  { name: 'read', call: (api: CompatibleImageApi) => api.read(profile, 'vision-a', { prompt: 'describe', image: sourceImage }) },
  { name: 'edit', call: (api: CompatibleImageApi) => api.edit(profile, 'edit-a', { prompt: 'blue', images: [sourceImage] }) },
]

function jsonBody(init?: RequestInit): { stream?: boolean } {
  const raw = init?.body
  if (typeof raw !== 'string') return {}
  return JSON.parse(raw) as { stream?: boolean }
}

function imageResponse(): Promise<Response> {
  return Promise.resolve(Response.json({ data: [{ b64_json: pngB64 }] }))
}

describe('compatible image API', () => {
  it('normalizes OpenAI size form and rejects other separators', () => {
    expect(normalizeSize(undefined)).toBe('1024x1024')
    expect(normalizeSize(' 512x512 ')).toBe('512x512')
    expect(() => normalizeSize('1024*1024')).toThrow('size must look like 1024x1024')
  })

  it('generates a one-shot image without requesting a stream', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = jsonBody(init)
      expect(body.stream).toBeUndefined()
      expect((body as { partial_images?: number }).partial_images).toBeUndefined()
      return imageResponse()
    })
    const api = new CompatibleImageApi({ fetch: fetchImpl })
    const image = await api.generate(profile, 'gen-a', { prompt: 'a cat' })
    expect(Buffer.from(image.bytes).toString()).toBe('png-bytes')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('edits an image without requesting a stream or quality', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = init?.body
      if (!(body instanceof FormData)) {
        return Promise.resolve(new Response('expected form', { status: 400 }))
      }
      expect(body.get('stream')).toBeNull()
      expect(body.get('partial_images')).toBeNull()
      expect(body.get('quality')).toBeNull()
      return imageResponse()
    })
    const api = new CompatibleImageApi({ fetch: fetchImpl })
    const image = await api.edit(profile, 'edit-a', {
      prompt: 'make it blue',
      images: [{ bytes: Uint8Array.from([1]), mime: 'image/png', name: 'a.png' }],
    })
    expect(Buffer.from(image.bytes).toString()).toBe('png-bytes')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sends multiple edit images as image[]', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = init?.body
      if (!(body instanceof FormData)) {
        return Promise.resolve(new Response('expected form', { status: 400 }))
      }
      expect(body.getAll('image[]')).toHaveLength(2)
      return imageResponse()
    })
    const api = new CompatibleImageApi({ fetch: fetchImpl })
    await api.edit(profile, 'edit-a', {
      prompt: 'merge',
      images: [
        { bytes: Uint8Array.from([1]), mime: 'image/png', name: 'a.png' },
        { bytes: Uint8Array.from([2]), mime: 'image/png', name: 'b.png' },
      ],
    })
  })

  describe.each(imageCalls)('$name errors', ({ call }) => {
    const raw = '{\n  "error": { "code": "upstream_failure", "message": "Original service error <detail>" }\n}'

    it.each([
      { name: 'HTTP 404', status: 404, contentType: 'application/json', body: raw },
      { name: 'JSON error with HTTP 200', status: 200, contentType: 'application/json', body: raw },
      { name: 'SSE error with CRLF', status: 200, contentType: 'text/event-stream', body: `data: ${raw.replaceAll('\n', '\r\ndata: ')}\r\n\r\n` },
      { name: 'named SSE error', status: 200, contentType: 'text/event-stream', body: `event: error\ndata: ${raw.replaceAll('\n', '\ndata: ')}\n\n` },
    ])('preserves the original $name without an unrelated retry', async ({ status, contentType, body }) => {
      const fetchImpl = vi.fn(() => Promise.resolve(new Response(body, { status, headers: { 'content-type': contentType } })))
      await expect(call(new CompatibleImageApi({ fetch: fetchImpl }))).rejects.toMatchObject({ message: raw })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
  })

  it('retries without streaming only when the service explicitly does not support it', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(jsonBody(init).stream
      ? new Response('{"error":{"message":"stream is not supported"}}', { status: 400 })
      : Response.json({ choices: [{ message: { content: 'a mountain' } }] })))
    const api = new CompatibleImageApi({ fetch: fetchImpl })
    await expect(api.read(profile, 'vision-a', { prompt: 'describe', image: sourceImage })).resolves.toBe('a mountain')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps a mid-stream error after partial text and releases the response', async () => {
    const raw = '{"error":{"message":"image stream failed: rate limit"}}'
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"A mountain"}}]}\n\ndata: ${raw}\n\n`))
      },
      cancel,
    })
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    const onDelta = vi.fn()
    await expect(new CompatibleImageApi({ fetch: fetchImpl }).read(profile, 'vision-a', { prompt: 'describe', image: sourceImage, onDelta })).rejects.toMatchObject({ message: raw })
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('A mountain')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })

  it('accepts successful image and text SSE responses followed by DONE', async () => {
    const fetchImpl = vi.fn((url: string) => Promise.resolve(new Response(
      url.includes('images/')
        ? `data: {"data":[{"b64_json":"${pngB64}"}]}\r\n\r\ndata: [DONE]\r\n\r\n`
        : 'data: {"choices":[{"delta":{"content":"A mountain"}}]}\r\n\r\ndata: [DONE]\r\n\r\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )))
    const api = new CompatibleImageApi({ fetch: fetchImpl })
    expect(Buffer.from((await api.generate(profile, 'gen-a', { prompt: 'a mountain' })).bytes).toString()).toBe('png-bytes')
    await expect(api.read(profile, 'vision-a', { prompt: 'describe', image: sourceImage })).resolves.toBe('A mountain')
  })
})
