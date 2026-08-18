import type { ModelEndpointClient } from '../../core/contract/model-profile.js'
import {
  type ModelCapability,
  type ModelInfo,
  type ModelProfile,
  ModelProfileError,
} from '../../core/resource/model-profile.js'

const DEFAULT_TIMEOUT_MS = 15_000
const ANTHROPIC_VERSION = '2023-06-01'
const PROBE_PROMPT = 'Reply with OK.'
const PROBE_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR42u3NQQEAAAQEMBS/6krw2wqsk9SnqWcCgUAgEAgEAoHgygKZ4wG9qjws0wAAAABJRU5ErkJggg=='

export interface CompatibleModelEndpointClientOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

export class CompatibleModelEndpointClient implements ModelEndpointClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor(options: CompatibleModelEndpointClientOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive safe integer')
    }
  }

  async listModels(
    profile: ModelProfile,
    signal?: AbortSignal,
  ): Promise<readonly ModelInfo[]> {
    return await this.withTimeout(signal, async (requestSignal) => {
      let lastResponse: Response | undefined
      for (const url of modelListCandidates(profile.baseUrl)) {
        const response = await this.performFetch(url, {
          method: 'GET',
          headers: authHeaders(profile),
          redirect: 'error',
          signal: requestSignal,
        })
        lastResponse = response
        if (response.status === 200) break
        if (![401, 404, 405].includes(response.status)) break
        await response.body?.cancel()
      }

      if (lastResponse === undefined) {
        throw new ModelProfileError(
          'upstream-unavailable',
          'No model discovery endpoint configured',
        )
      }
      if (lastResponse.status === 401 || lastResponse.status === 403) {
        throw new ModelProfileError(
          'upstream-auth-failed',
          'Invalid auth token — upstream rejected the request',
        )
      }
      if (lastResponse.status !== 200) {
        await lastResponse.body?.cancel()
        throw new ModelProfileError(
          'upstream-unavailable',
          `Upstream model API returned ${lastResponse.status}`,
        )
      }

      const payload = await parseJsonResponse(lastResponse)
      return parseModelList(payload)
    })
  }

  async probeModelCapability(
    profile: ModelProfile,
    modelId: string,
    capability: ModelCapability,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return await this.withTimeout(signal, async (requestSignal) => {
      switch (capability) {
        case 'image_understanding':
          return await this.probeImageUnderstanding(profile, modelId, requestSignal)
        case 'image_generation':
          return await this.probeImageGeneration(profile, modelId, requestSignal)
        case 'image_edit':
          return await this.probeImageEdit(profile, modelId, requestSignal)
      }
    })
  }

  private async probeImageUnderstanding(
    profile: ModelProfile,
    modelId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const openAiResult = await this.probeCandidates(
      endpointCandidates(profile.baseUrl, 'chat/completions'),
      'image_understanding',
      signal,
      () => ({
        headers: jsonAuthHeaders(profile),
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: PROBE_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${PROBE_IMAGE_BASE64}`,
                  detail: 'low',
                },
              },
            ],
          }],
        }),
      }),
    )
    if (openAiResult !== null) return openAiResult

    const anthropicResult = await this.probeCandidates(
      anthropicMessageCandidates(profile.baseUrl),
      'image_understanding',
      signal,
      () => ({
        headers: jsonAuthHeaders(profile),
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: PROBE_IMAGE_BASE64,
                },
              },
              { type: 'text', text: PROBE_PROMPT },
            ],
          }],
        }),
      }),
    )
    if (anthropicResult !== null) return anthropicResult
    throw modelUnavailable('image_understanding')
  }

  private async probeImageGeneration(
    profile: ModelProfile,
    modelId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const result = await this.probeCandidates(
      endpointCandidates(profile.baseUrl, 'images/generations'),
      'image_generation',
      signal,
      () => ({
        headers: jsonAuthHeaders(profile),
        body: JSON.stringify({
          model: modelId,
          prompt: 'A single black pixel on a white background.',
          n: 1,
        }),
      }),
    )
    if (result !== null) return result
    throw modelUnavailable('image_generation')
  }

  private async probeImageEdit(
    profile: ModelProfile,
    modelId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const image = Uint8Array.from(
      Buffer.from(PROBE_IMAGE_BASE64, 'base64'),
    )
    const result = await this.probeCandidates(
      endpointCandidates(profile.baseUrl, 'images/edits'),
      'image_edit',
      signal,
      () => {
        const body = new FormData()
        body.set('model', modelId)
        body.set('prompt', 'Keep this image unchanged.')
        body.set('n', '1')
        body.set('image', new Blob([image], { type: 'image/png' }), 'probe.png')
        return { headers: authHeaders(profile), body }
      },
    )
    if (result !== null) return result
    throw modelUnavailable('image_edit')
  }

  private async probeCandidates(
    candidates: readonly string[],
    capability: ModelCapability,
    signal: AbortSignal,
    request: () => Pick<RequestInit, 'body' | 'headers'>,
  ): Promise<boolean | null> {
    for (const url of candidates) {
      const response = await this.performFetch(url, {
        method: 'POST',
        ...request(),
        redirect: 'error',
        signal,
      })
      if (response.status === 404 || response.status === 405) {
        await response.body?.cancel()
        continue
      }
      return await evaluateCapabilityResponse(response, capability)
    }
    return null
  }

  private async performFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await this.fetch(url, init)
    } catch (error) {
      if (error instanceof ModelProfileError) throw error
      if (isAbortError(error)) throw error
      throw new ModelProfileError(
        'upstream-unavailable',
        'Cannot connect to model API',
        { cause: error },
      )
    }
  }

  private async withTimeout<T>(
    parentSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const timeoutReason = new Error('model endpoint request timeout')
    const timeout = setTimeout(() => {
      controller.abort(timeoutReason)
    }, this.timeoutMs)
    const abortFromParent = (): void => { controller.abort(parentSignal?.reason) }
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    if (parentSignal?.aborted === true) controller.abort()

    try {
      return await operation(controller.signal)
    } catch (error) {
      if (controller.signal.reason === timeoutReason) {
        throw new ModelProfileError(
          'upstream-timeout',
          'Model API request timed out',
          { cause: error },
        )
      }
      if (parentSignal?.aborted === true && isAbortError(error)) throw error
      throw error
    } finally {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}

function modelListCandidates(baseUrl: string): readonly string[] {
  const base = baseUrl.replace(/\/+$/u, '')
  const parsed = new URL(base)
  const path = parsed.pathname.replace(/\/+$/u, '')
  const candidates: string[] = []

  if (path.endsWith('/v1')) {
    addCandidate(candidates, `${base}/models`)
  } else {
    addCandidate(candidates, `${base}/v1/models`)
    addCandidate(candidates, `${base}/models`)
  }
  addCandidate(candidates, `${parsed.origin}/v1/models`)
  addCandidate(candidates, `${parsed.origin}/models`)
  return candidates
}

function anthropicMessageCandidates(baseUrl: string): readonly string[] {
  const base = baseUrl.replace(/\/+$/u, '')
  const parsed = new URL(base)
  const path = parsed.pathname.replace(/\/+$/u, '')
  return path.endsWith('/v1')
    ? [`${base}/messages`]
    : [`${base}/v1/messages`, `${base}/messages`]
}

function endpointCandidates(baseUrl: string, pathSuffix: string): readonly string[] {
  const base = baseUrl.replace(/\/+$/u, '')
  const parsed = new URL(base)
  const path = parsed.pathname.replace(/\/+$/u, '')
  const candidates: string[] = []

  if (path.endsWith('/v1')) {
    addCandidate(candidates, `${base}/${pathSuffix}`)
  } else {
    addCandidate(candidates, `${base}/v1/${pathSuffix}`)
    addCandidate(candidates, `${base}/${pathSuffix}`)
  }
  addCandidate(candidates, `${parsed.origin}/v1/${pathSuffix}`)
  addCandidate(candidates, `${parsed.origin}/${pathSuffix}`)
  return candidates
}

function addCandidate(candidates: string[], value: string): void {
  if (!candidates.includes(value)) candidates.push(value)
}

function authHeaders(profile: ModelProfile): Readonly<Record<string, string>> {
  return {
    Authorization: `Bearer ${profile.authToken}`,
    'x-api-key': profile.authToken,
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

function jsonAuthHeaders(profile: ModelProfile): Readonly<Record<string, string>> {
  return { ...authHeaders(profile), 'Content-Type': 'application/json' }
}

async function evaluateCapabilityResponse(
  response: Response,
  capability: ModelCapability,
): Promise<boolean> {
  if (response.status >= 200 && response.status < 300) {
    await response.body?.cancel()
    return true
  }
  const detail = await response.text()
  if (response.status === 401 || response.status === 403) {
    throw new ModelProfileError(
      'upstream-auth-failed',
      'Model capability probe authentication failed',
    )
  }
  if (
    [400, 415, 422].includes(response.status)
    && !looksLikeNonCapabilityError(detail)
  ) {
    return false
  }
  throw modelUnavailable(capability, response.status)
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown
  } catch (error) {
    throw new ModelProfileError(
      'upstream-invalid-response',
      'Invalid JSON response from upstream model API',
      { cause: error },
    )
  }
}

function parseModelList(payload: unknown): readonly ModelInfo[] {
  const values = isRecord(payload) ? payload['data'] : payload
  if (!Array.isArray(values)) return []
  const models: ModelInfo[] = []
  for (const value of values) {
    if (typeof value === 'string') {
      models.push({ id: value })
    } else if (isRecord(value) && typeof value['id'] === 'string') {
      models.push({ id: value['id'] })
    }
  }
  return models
}

function looksLikeNonCapabilityError(detail: string): boolean {
  const normalized = detail.toLowerCase()
  return [
    'model not found',
    'model does not exist',
    'unknown model',
    'invalid model',
    'no such model',
    'api key',
    'authentication',
    'unauthorized',
    'quota',
    'billing',
    'rate limit',
    'max_tokens',
    'max tokens',
  ].some((marker) => normalized.includes(marker))
}

function modelUnavailable(
  capability: ModelCapability,
  status?: number,
): ModelProfileError {
  return new ModelProfileError(
    'upstream-unavailable',
    `${capability} capability could not be determined${
      status === undefined ? '' : ` (upstream status ${status})`
    }`,
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
