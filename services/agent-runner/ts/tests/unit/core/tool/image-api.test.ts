import { describe, expect, it, vi } from 'vitest'

import { CompatibleImageApi, normalizeSize } from '../../../../src/core/tool/image-api.js'

const profile = {
  baseUrl: 'https://api.example.com/v1',
  authToken: 'secret',
}

const pngB64 = Buffer.from('png-bytes').toString('base64')

describe('compatible image API', () => {
  it('normalizes OpenAI size form and rejects other separators', () => {
    expect(normalizeSize(undefined)).toBe('1024x1024')
    expect(normalizeSize(' 512x512 ')).toBe('512x512')
    expect(() => normalizeSize('1024*1024')).toThrow('size must look like 1024x1024')
  })

  it('falls back from a rejected stream to a one-shot generation', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean }
      if (body.stream === true) {
        return new Response('stream not supported', { status: 400 })
      }
      return Response.json({ data: [{ b64_json: pngB64 }] })
    })
    const api = new CompatibleImageApi({ fetch: fetchImpl as typeof fetch })
    const image = await api.generate(profile, 'gen-a', { prompt: 'a cat', stream: true })
    expect(Buffer.from(image.bytes).toString()).toBe('png-bytes')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries image edit without quality when the gateway rejects it', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body
      if (!(body instanceof FormData)) {
        return new Response('expected form', { status: 400 })
      }
      if (body.get('quality') === 'high') {
        return new Response('unknown field quality', { status: 400 })
      }
      return Response.json({ data: [{ b64_json: pngB64 }] })
    })
    const api = new CompatibleImageApi({ fetch: fetchImpl as typeof fetch })
    const image = await api.edit(profile, 'edit-a', {
      prompt: 'make it blue',
      images: [{ bytes: Uint8Array.from([1]), mime: 'image/png', name: 'a.png' }],
    })
    expect(Buffer.from(image.bytes).toString()).toBe('png-bytes')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('sends multiple edit images as image[]', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body
      if (!(body instanceof FormData)) {
        return new Response('expected form', { status: 400 })
      }
      expect(body.getAll('image[]')).toHaveLength(2)
      return Response.json({ data: [{ b64_json: pngB64 }] })
    })
    const api = new CompatibleImageApi({ fetch: fetchImpl as typeof fetch })
    await api.edit(profile, 'edit-a', {
      prompt: 'merge',
      images: [
        { bytes: Uint8Array.from([1]), mime: 'image/png', name: 'a.png' },
        { bytes: Uint8Array.from([2]), mime: 'image/png', name: 'b.png' },
      ],
    })
  })
})
