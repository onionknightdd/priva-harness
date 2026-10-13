import type { AssistantImages, ImageModel, ImagesContext, ImagesOptions, ProviderImages } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import { resolveCapabilityModel } from '../../core/resource/model-profile.js'
import type { ImageToolProfile } from '../../core/tool/define-tool.js'
import { CompatibleImageApi, type ImageApiUsage } from '../../core/tool/image-api.js'
import { classifierImplementation, classifierModel } from '../../core/tool/classifier-api.js'

export const PI_IMAGE_PROVIDER_ID = 'priva-images'
const IMAGE_API = 'priva-openai-images'
const CLASSIFIER_PROVIDER_PREFIX = 'priva-classifier-'
const UNKNOWN_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** Replaces the current profile's auxiliary models, including on a warm session profile change. */
export async function registerPiProfileModels(runtime: ModelRuntime, spec: Pick<ProviderRunSpec, 'imageTools' | 'classifier'>): Promise<void> {
  for (const provider of runtime.getRegisteredProviderIds()) {
    if (provider === PI_IMAGE_PROVIDER_ID || provider.startsWith(CLASSIFIER_PROVIDER_PREFIX)) {
      await runtime.removeRuntimeApiKey(provider)
      runtime.unregisterProvider(provider)
    }
  }
  const profile = spec.imageTools
  if (profile !== undefined) {
    const generation = resolveCapabilityModel(profile, 'image_generation')
    const editing = resolveCapabilityModel(profile, 'image_edit')
    const ids = [...new Set([generation, editing].filter((id): id is string => id !== null))]
    if (ids.length > 0) {
      runtime.registerProvider(PI_IMAGE_PROVIDER_ID, {
        name: 'Profile image models',
        baseUrl: profile.baseUrl,
        models: ids.map((id) => ({
          type: 'image', api: IMAGE_API, id, name: id,
          input: id === editing ? ['text', 'image'] : ['text'], output: ['image'], cost: UNKNOWN_COST,
        })),
        images: { [IMAGE_API]: createPiImageProvider(profile) },
      })
      await runtime.setRuntimeApiKey(PI_IMAGE_PROVIDER_ID, profile.authToken)
    }
  }
  const classifier = spec.classifier
  if (classifier !== undefined) {
    const implementation = await classifierImplementation(classifier.api)
    const model = classifierModel(classifier)
    runtime.registerProvider(classifier.provider, {
      name: 'Profile classifier',
      baseUrl: classifier.baseUrl,
      models: [model],
      classifiers: {
        [classifier.api]: {
          async classify(requestModel, context, options) {
            return { ...await implementation.classify(requestModel, context, options), pricingKnown: false }
          },
        },
      },
    })
    await runtime.setRuntimeApiKey(classifier.provider, classifier.authToken)
  }
}

/** Adapts the existing Images API transport to Pi's native image-model contract. */
export function createPiImageProvider(profile: ImageToolProfile): ProviderImages {
  return {
    async generateImages(model: ImageModel<string>, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages & { pricingKnown: boolean }> {
      const base = { api: model.api, provider: model.provider, model: model.id, output: [], timestamp: Date.now() }
      try {
        options?.signal?.throwIfAborted()
        const prompt = context.input.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
        if (prompt.trim() === '') throw new Error('Image generation requires a non-empty text prompt')
        const inputs = context.input.filter((item) => item.type === 'image').map((item, index) => ({
          bytes: Uint8Array.from(Buffer.from(item.data, 'base64')), mime: item.mimeType, name: `input-${index}.${item.mimeType.split('/')[1] ?? 'png'}`,
        }))
        const capability = inputs.length === 0 ? 'image_generation' : 'image_edit'
        if (resolveCapabilityModel(profile, capability) !== model.id) {
          throw new Error(`Model ${model.id} is not configured for ${capability}`)
        }
        const api = new CompatibleImageApi({ ...(options?.fetch === undefined ? {} : { fetch: options.fetch }) })
        const connection = { baseUrl: model.baseUrl, authToken: options?.apiKey ?? profile.authToken }
        const request = { prompt, ...(options?.signal === undefined ? {} : { signal: options.signal }) }
        const result = inputs.length === 0
          ? await api.generate(connection, model.id, request)
          : await api.edit(connection, model.id, { ...request, images: inputs })
        return {
          ...base, stopReason: 'stop', pricingKnown: result.usage?.costUsd !== undefined,
          output: result.images.map((image) => ({ type: 'image', mimeType: image.mime, data: Buffer.from(image.bytes).toString('base64') })),
          ...(result.usage === undefined ? {} : { usage: nativeImageUsage(result.usage) }),
        }
      } catch (error) {
        return { ...base, stopReason: options?.signal?.aborted === true ? 'aborted' : 'error', pricingKnown: false, errorMessage: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

function nativeImageUsage(usage: ImageApiUsage) {
  return {
    input: usage.inputTokens, output: usage.outputTokens, totalTokens: usage.totalTokens,
    cacheRead: 0, cacheWrite: 0,
    cost: { ...UNKNOWN_COST, total: usage.costUsd ?? 0 },
  }
}
