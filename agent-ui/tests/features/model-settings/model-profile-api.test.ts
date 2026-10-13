import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createModelProfile, emptyModelCapabilityCatalog, probeSavedModelCapability } from '../../../src/features/model-settings/model-profile-api.ts'

test('serializes and reads classifier bindings without exposing a generated provider identifier', async () => {
  const originalFetch = globalThis.fetch
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    return Promise.resolve(Response.json({ ...body, id: 'profile', auth_token_set: true, model_count: null }))
  }
  try {
    const profile = await createModelProfile({
      label: 'Gateway', baseUrl: 'https://example.test/v1', authToken: 'key', defaultModel: 'chat',
      imageUnderstandingModel: null, imageGenerationModel: null, imageEditModel: null,
      classifierApi: 'typesafe-system-one', classifierModel: 'jev-latest', classifierProfileId: 'classifier-connection',
      modelCapabilities: emptyModelCapabilityCatalog(),
    })
    assert.equal(profile.classifierApi, 'typesafe-system-one')
    assert.equal(profile.classifierModel, 'jev-latest')
    assert.equal(profile.classifierProfileId, 'classifier-connection')
    assert.equal(bodies[0]?.classifier_api, 'typesafe-system-one')
    assert.equal(bodies[0]?.classifier_profile_id, 'classifier-connection')
    assert.deepEqual(profile.modelCapabilities.classification, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('passes unsaved classification protocol and connection selection to a probe', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: unknown
  globalThis.fetch = (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return Promise.resolve(Response.json({ model_id: 'classifier', capability: 'classification', supported: true }))
  }
  try {
    const result = await probeSavedModelCapability('profile', { classifierApi: 'openai-decisions', classifierProfileId: 'another' }, 'classifier', 'classification')
    assert.deepEqual(requestBody, { classifier_api: 'openai-decisions', classifier_profile_id: 'another', model_id: 'classifier', capability: 'classification' })
    assert.equal(result.supported, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
