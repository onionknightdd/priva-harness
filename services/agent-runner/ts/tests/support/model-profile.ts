import type { ModelEndpointClient } from '../../src/core/contract/model-profile.js'
import { AgentProfileService } from '../../src/harness/config/agent-profile-service.js'
import { ModelProfileService } from '../../src/harness/config/model-profile-service.js'
import { JsonModelProfileStore } from '../../src/infrastructure/model-profile/json-model-profile-store.js'
import { JsonRuntimeSettingsStore } from '../../src/infrastructure/settings/json-runtime-settings-store.js'
import { createRuntimeConfig } from '../../src/runtime-config.js'

const emptyEndpointClient: ModelEndpointClient = {
  listModels() {
    return Promise.resolve([])
  },
  probeModelCapability() {
    return Promise.resolve(false)
  },
}

export function createTestRuntimeSettingsStore(
  runtimeHome: string,
): JsonRuntimeSettingsStore {
  return new JsonRuntimeSettingsStore({
    filePath: createRuntimeConfig(runtimeHome).settingsFilePath,
  })
}

export function createTestAgentServices(
  runtimeHome: string,
  endpointClient: ModelEndpointClient = emptyEndpointClient,
): {
  readonly settings: JsonRuntimeSettingsStore
  readonly modelProfileService: ModelProfileService
  readonly agentProfileService: AgentProfileService
} {
  const settings = createTestRuntimeSettingsStore(runtimeHome)
  return {
    settings,
    modelProfileService: new ModelProfileService(
      new JsonModelProfileStore({ settings, runtimeHome }),
      endpointClient,
    ),
    agentProfileService: new AgentProfileService(settings),
  }
}

export function createTestModelProfileService(
  runtimeHome: string,
  endpointClient: ModelEndpointClient = emptyEndpointClient,
): ModelProfileService {
  return createTestAgentServices(runtimeHome, endpointClient).modelProfileService
}
