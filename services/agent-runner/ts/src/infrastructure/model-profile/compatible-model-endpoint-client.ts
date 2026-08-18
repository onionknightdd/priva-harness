import type { ModelEndpointClient } from '../../core/contract/model-profile.js'
import {
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

  async probeImageCapability(
    profile: ModelProfile,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const payload = {
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
    }

    return await this.withTimeout(signal, async (requestSignal) => {
      let lastResponse: Response | undefined
      for (const url of anthropicMessageCandidates(profile.baseUrl)) {
        const response = await this.performFetch(url, {
          method: 'POST',
          headers: {
            ...authHeaders(profile),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          redirect: 'error',
          signal: requestSignal,
        })
        lastResponse = response
        if (response.status !== 404 && response.status !== 405) break
        await response.body?.cancel()
      }

      if (lastResponse === undefined) {
        throw modelUnavailable()
      }
      if (lastResponse.status >= 200 && lastResponse.status < 300) {
        await lastResponse.body?.cancel()
        return true
      }
      if (lastResponse.status === 404 || lastResponse.status === 405) {
        throw modelUnavailable()
      }

      const detail = await lastResponse.text()
      if (
        [400, 415, 422].includes(lastResponse.status)
        && !looksLikeNonCapabilityError(detail)
      ) {
        return false
      }
      if (lastResponse.status === 401 || lastResponse.status === 403) {
        throw new ModelProfileError(
          'upstream-auth-failed',
          'Image capability probe authentication failed',
        )
      }
      throw modelUnavailable()
    })
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

function modelUnavailable(): ModelProfileError {
  return new ModelProfileError(
    'upstream-unavailable',
    'Image capability could not be determined',
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
