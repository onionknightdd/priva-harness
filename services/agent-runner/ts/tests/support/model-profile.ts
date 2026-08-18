import type { ModelEndpointClient } from '../../src/core/contract/model-profile.js'
import { ModelProfileService } from '../../src/harness/config/model-profile-service.js'
import { JsonModelProfileStore } from '../../src/infrastructure/model-profile/json-model-profile-store.js'

const emptyEndpointClient: ModelEndpointClient = {
  listModels() {
    return Promise.resolve([])
  },
  probeImageCapability() {
    return Promise.resolve(false)
  },
}

export function createTestModelProfileService(
  runtimeHome: string,
  endpointClient: ModelEndpointClient = emptyEndpointClient,
): ModelProfileService {
  return new ModelProfileService(
    new JsonModelProfileStore({ runtimeHome }),
    endpointClient,
  )
}
