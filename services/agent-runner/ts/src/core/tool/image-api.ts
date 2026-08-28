import type { ModelProfile } from '../resource/model-profile.js'
import { ModelProfileError } from '../resource/model-profile.js'

export type ImageBytes = {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly name: string
}

export type ImageDeltaHandler = (image: {
  readonly mime: string
  readonly b64: string
  readonly final: boolean
}) => void

export type ImageApiOptions = {
  readonly fetch?: typeof globalThis.fetch
}

const DEFAULT_SIZE = '1024x1024'

export class CompatibleImageApi {
  private readonly fetch: typeof globalThis.fetch

  constructor(options: ImageApiOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async generate(
    profile: Pick<ModelProfile, 'baseUrl' | 'authToken'>,
    model: string,
    input: {
      readonly prompt: string
      readonly size?: string
      readonly stream?: boolean
      readonly onImage?: ImageDeltaHandler
      readonly signal?: AbortSignal
    },
  ): Promise<ImageBytes> {
    const size = normalizeSize(input.size)
    const body = {
      model,
      prompt: input.prompt,
      n: 1,
      size,
      ...(input.stream === true ? { stream: true, partial_images: 3 } : {}),
    }
    if (input.stream === true) {
      try {
        return await this.requestJsonImage(
          profile,
          'images/generations',
          body,
          input.onImage,
          input.signal,
        )
      } catch (error) {
        if (!isRetryableStreamError(error)) throw error
      }
    }
    return await this.requestJsonImage(
      profile,
      'images/generations',
      { model, prompt: input.prompt, n: 1, size },
      input.onImage,
      input.signal,
    )
  }

  async edit(
    profile: Pick<ModelProfile, 'baseUrl' | 'authToken'>,
    model: string,
    input: {
      readonly prompt: string
      readonly images: readonly ImageBytes[]
      readonly size?: string
      readonly stream?: boolean
      readonly onImage?: ImageDeltaHandler
      readonly signal?: AbortSignal
    },
  ): Promise<ImageBytes> {
    const size = normalizeSize(input.size)
    const attempt = async (includeQuality: boolean, stream: boolean) => {
      const body = new FormData()
      body.set('model', model)
      body.set('prompt', input.prompt)
      body.set('n', '1')
      body.set('size', size)
      if (includeQuality) body.set('quality', 'high')
      if (stream) {
        body.set('stream', 'true')
        body.set('partial_images', '3')
      }
      for (const image of input.images) {
        body.append(
          input.images.length === 1 ? 'image' : 'image[]',
          new Blob([image.bytes], { type: image.mime }),
          image.name,
        )
      }
      return await this.requestFormImage(profile, body, input.onImage, input.signal)
    }

    if (input.stream === true) {
      try {
        return await attempt(true, true)
      } catch (error) {
        if (!isRetryableStreamError(error) && !isUnknownQualityError(error)) throw error
      }
    }
    try {
      return await attempt(true, false)
    } catch (error) {
      if (!isUnknownQualityError(error)) throw error
      return await attempt(false, false)
    }
  }

  async read(
    profile: Pick<ModelProfile, 'baseUrl' | 'authToken'>,
    model: string,
    input: {
      readonly prompt: string
      readonly image: ImageBytes
      readonly onDelta?: (text: string) => void
      readonly signal?: AbortSignal
    },
  ): Promise<string> {
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: input.prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${input.image.mime};base64,${Buffer.from(input.image.bytes).toString('base64')}`,
          },
        },
      ],
    }]
    try {
      const response = await this.postJson(
        profile,
        'chat/completions',
        { model, stream: true, max_tokens: 1024, messages },
        input.signal,
      )
      return await readChatCompletionResponse(response, input.onDelta)
    } catch (error) {
      if (!isRetryableStreamError(error)) throw error
    }
    const response = await this.postJson(
      profile,
      'chat/completions',
      { model, stream: false, max_tokens: 1024, messages },
      input.signal,
    )
    return await readChatCompletionResponse(response, input.onDelta)
  }

  private async requestJsonImage(
    profile: Pick<ModelProfile, 'baseUrl' | 'authToken'>,
    pathSuffix: string,
    body: Record<string, unknown>,
    onImage: ImageDeltaHandler | undefined,
    signal?: AbortSignal,
  ): Promise<ImageBytes> {
    const response = await this.postJson(profile, pathSuffix, body, signal)
    return await readImageResponse(response, onImage)
  }

  private async requestFormImage(
    profile: Pick<ModelProfile, 'baseUrl' | 'authToken'>,
    body: FormData,
    onImage: ImageDeltaHandler | undefined,
    signal?: AbortSignal,
  ): Promise<ImageBytes> {
    const response = await this.perform(
      firstEndpoint(profile.baseUrl, 'images/edits'),
      {
        method: 'POST',
        headers: authHeaders(profile),
        body,
        redirect: 'error',
        signal,
      },
    )
    return await readImageResponse(response, onImage)
  }

  private async postJson(
    profile: Pick<ModelProfile, 'baseUrl' | 'authToken'>,
    pathSuffix: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await this.perform(firstEndpoint(profile.baseUrl, pathSuffix), {
      method: 'POST',
      headers: {
        ...authHeaders(profile),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    })
  }

  private async perform(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(url, init)
    } catch (error) {
      if (error instanceof ModelProfileError) throw error
      throw new Error(
        error instanceof Error ? error.message : 'Cannot connect to image API',
        { cause: error },
      )
    }
  }
}

export function normalizeSize(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_SIZE
  if (!/^\d+x\d+$/.test(value)) {
    throw new Error('size must look like 1024x1024')
  }
  return value
}

function firstEndpoint(baseUrl: string, pathSuffix: string): string {
  const base = baseUrl.replace(/\/+$/u, '')
  return base.endsWith('/v1') ? `${base}/${pathSuffix}` : `${base}/v1/${pathSuffix}`
}

function authHeaders(profile: Pick<ModelProfile, 'authToken'>): Record<string, string> {
  return {
    Authorization: `Bearer ${profile.authToken}`,
    'x-api-key': profile.authToken,
  }
}

async function readImageResponse(
  response: Response,
  onImage: ImageDeltaHandler | undefined,
): Promise<ImageBytes> {
  if (!response.ok) {
    const detail = await response.text()
    const error = new Error(detail === '' ? `image request failed (${response.status})` : detail)
    ;(error as { status?: number }).status = response.status
    throw error
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream') && response.body !== null) {
    return await readImageSse(response.body, onImage)
  }
  const payload: unknown = JSON.parse(await response.text())
  const image = imageFromPayload(payload)
  onImage?.({ mime: image.mime, b64: Buffer.from(image.bytes).toString('base64'), final: true })
  return image
}

async function readImageSse(
  body: ReadableStream<Uint8Array>,
  onImage: ImageDeltaHandler | undefined,
): Promise<ImageBytes> {
  let latest: ImageBytes | undefined
  await forEachSseEvent(body, (event) => {
    const parsed: unknown = JSON.parse(event)
    const image = imageFromPayload(parsed)
    const final = eventType(parsed) === 'image_generation.completed'
      || eventType(parsed) === 'image_edit.completed'
    onImage?.({
      mime: image.mime,
      b64: Buffer.from(image.bytes).toString('base64'),
      final,
    })
    latest = image
  })
  if (latest === undefined) {
    throw new Error('image stream ended without an image')
  }
  return latest
}

async function readChatCompletionResponse(
  response: Response,
  onDelta: ((text: string) => void) | undefined,
): Promise<string> {
  if (!response.ok) {
    const detail = await response.text()
    const error = new Error(detail === '' ? `image_read failed (${response.status})` : detail)
    ;(error as { status?: number }).status = response.status
    throw error
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream') && response.body !== null) {
    return await readChatCompletionStream(response.body, onDelta)
  }
  const payload: unknown = JSON.parse(await response.text())
  const text = chatDeltaText(payload)
  if (text !== '') onDelta?.(text)
  return text
}

async function readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((text: string) => void) | undefined,
): Promise<string> {
  let text = ''
  await forEachSseEvent(body, (event) => {
    if (event === '[DONE]') return
    const parsed: unknown = JSON.parse(event)
    const delta = chatDeltaText(parsed)
    if (delta === '') return
    text += delta
    onDelta?.(delta)
  })
  return text
}

async function forEachSseEvent(
  body: ReadableStream<Uint8Array>,
  onEvent: (data: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const chunks = buffer.split('\n\n')
    buffer = done ? '' : (chunks.pop() ?? '')
    for (const chunk of chunks) {
      const data = chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
      if (data !== '') onEvent(data)
    }
    if (done) break
  }
}

function imageFromPayload(payload: unknown): ImageBytes {
  const record = asRecord(payload)
  const b64 =
    stringField(record, 'b64_json')
    ?? stringField(asRecord(firstData(record)), 'b64_json')
    ?? stringField(asRecord(record?.['image']), 'b64_json')
  if (b64 === undefined || b64 === '') {
    throw new Error('image response did not include b64_json')
  }
  return {
    bytes: Uint8Array.from(Buffer.from(b64, 'base64')),
    mime: 'image/png',
    name: 'image.png',
  }
}

function firstData(record: Record<string, unknown> | undefined): unknown {
  const data = record?.['data']
  return Array.isArray(data) ? data[0] : undefined
}

function eventType(payload: unknown): string {
  return stringField(asRecord(payload), 'type') ?? ''
}

function chatDeltaText(payload: unknown): string {
  const record = asRecord(payload)
  const choice = Array.isArray(record?.['choices']) ? asRecord(record.choices[0]) : undefined
  return stringField(asRecord(choice?.['delta']), 'content')
    ?? stringField(asRecord(choice?.['message']), 'content')
    ?? ''
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function isRetryableStreamError(error: unknown): boolean {
  const status = (error as { status?: number }).status
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return status === 400 || status === 404 || status === 415 || status === 422
    || message.includes('stream')
}

function isUnknownQualityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('quality')
}
