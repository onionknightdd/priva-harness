import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

import { emptyModelCapabilityCatalog } from '../../../../src/core/resource/model-profile.js'
import { createPiImageProvider, PI_IMAGE_PROVIDER_ID, registerPiProfileModels } from '../../../../src/provider/pi/pi-profile-models.js'

const dirs: string[] = []
const imageProfile = {
  baseUrl: 'https://images.test/v1', authToken: 'image-key',
  imageGenerationModel: 'generator', imageEditModel: 'editor', imageUnderstandingModel: null,
  modelCapabilities: emptyModelCapabilityCatalog(),
}
async function runtime() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-profile-models-'))
  dirs.push(dir)
  await writeFile(join(dir, 'auth.json'), '{}')
  return await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, modelsStorePath: join(dir, 'models-cache.json'), refreshOnCreate: false })
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('Pi native profile models', () => {
  it('registers typed models with separate credentials and removes them on a profile change', async () => {
    const models = await runtime()
    await registerPiProfileModels(models, { imageTools: { ...imageProfile, authToken: '$PROFILE_TOKEN_LITERAL' }, classifier: {
      provider: 'priva-classifier-test', api: 'typesafe-system-one', modelId: 'jev-test', baseUrl: 'https://classifiers.test/v1', authToken: 'classifier-key',
    } })
    expect(models.getModelsOfType('image', PI_IMAGE_PROVIDER_ID).map((model) => model.id)).toEqual(['generator', 'editor'])
    expect(models.getModelOfType('classifier', 'priva-classifier-test', 'jev-test')).toMatchObject({ api: 'typesafe-system-one', baseUrl: 'https://classifiers.test/v1' })
    expect(await models.getAvailableOfType('image', PI_IMAGE_PROVIDER_ID)).toHaveLength(2)
    expect(await models.getAuth(PI_IMAGE_PROVIDER_ID)).toMatchObject({ auth: { apiKey: '$PROFILE_TOKEN_LITERAL' } })
    expect(await models.getAuth('priva-classifier-test')).toMatchObject({ auth: { apiKey: 'classifier-key' } })
    await registerPiProfileModels(models, {})
    expect(models.getModelsOfType('image', PI_IMAGE_PROVIDER_ID)).toEqual([])
    expect(models.getModelsOfType('classifier', 'priva-classifier-test')).toEqual([])
  })

  it('returns multiple native image blocks and preserves known usage', async () => {
    const fetch = vi.fn((url: string | URL | Request) => { expect(url).toBeDefined(); return Promise.resolve(Response.json({ data: [{ b64_json: 'YQ==' }, { b64_json: 'Yg==' }], usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12, cost: 0.2 } })) })
    const models = await runtime()
    await registerPiProfileModels(models, { imageTools: imageProfile })
    const model = models.getModelOfType('image', PI_IMAGE_PROVIDER_ID, 'generator')
    assert.ok(model)
    const result = await createPiImageProvider(imageProfile).generateImages(model, { input: [{ type: 'text', text: 'a lake' }] }, { fetch, apiKey: 'scoped-key' })
    expect(result).toMatchObject({ stopReason: 'stop', pricingKnown: true, usage: { input: 4, output: 8, totalTokens: 12, cost: { total: 0.2 } } })
    expect(result.output).toHaveLength(2)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://images.test/v1/images/generations')
  })

  it('routes image inputs to editing and reports cancellation without calling the service', async () => {
    const models = await runtime()
    await registerPiProfileModels(models, { imageTools: imageProfile })
    const model = models.getModelOfType('image', PI_IMAGE_PROVIDER_ID, 'editor')
    assert.ok(model)
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData)
      return Promise.resolve(Response.json({ data: [{ b64_json: 'YQ==' }] }))
    })
    const images = createPiImageProvider(imageProfile)
    const context = { input: [{ type: 'text' as const, text: 'make blue' }, { type: 'image' as const, data: 'Yg==', mimeType: 'image/png' }] }
    expect(await images.generateImages(model, context, { fetch })).toMatchObject({ stopReason: 'stop', pricingKnown: false })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://images.test/v1/images/edits')
    const controller = new AbortController()
    controller.abort()
    expect(await images.generateImages(model, context, { fetch, signal: controller.signal })).toMatchObject({ stopReason: 'aborted' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the native classifier protocol and marks unavailable prices as unknown', async () => {
    const models = await runtime()
    await registerPiProfileModels(models, { classifier: { provider: 'priva-classifier-test', api: 'typesafe-system-one', modelId: 'jev-test', baseUrl: 'https://classifiers.test/v1', authToken: 'classifier-key' } })
    const fetch = vi.fn((url: string | URL | Request) => { expect(url).toBeDefined(); return Promise.resolve(Response.json({ answers: { ready: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } })) })
    const model = models.getModelOfType('classifier', 'priva-classifier-test', 'jev-test')
    assert.ok(model)
    const result = await models.classify(model, { state: { status: 'ready' }, questions: { ready: { type: 'bool', instructions: 'Ready?', criteria: { true: 'Ready', false: 'Not ready' } } } }, { fetch })
    expect(result).toMatchObject({ stopReason: 'stop', pricingKnown: false, answers: { ready: { type: 'bool', probability: 0.9 } } })
    expect(fetch.mock.calls[0]?.[0]).toEqual(new URL('https://classifiers.test/v1/systemone'))
  })
})
