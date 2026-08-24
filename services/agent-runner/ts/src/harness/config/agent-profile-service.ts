import { isQueueBehavior, type QueueBehavior } from '../../core/contract/agent-provider.js'
import type { RuntimeSettingsStore } from '../../core/contract/runtime-settings.js'
import {
  RuntimeSettingsError,
  type AgentProfile,
} from '../../core/resource/runtime-settings.js'

export class AgentProfileService {
  constructor(private readonly settings: RuntimeSettingsStore) {}

  async read(): Promise<AgentProfile> {
    return (await this.settings.read()).agentProfile
  }

  async updateQueueBehavior(queueBehavior: QueueBehavior): Promise<AgentProfile> {
    if (!isQueueBehavior(queueBehavior)) {
      throw new RuntimeSettingsError(
        'invalid-queue-behavior',
        'agentProfile.queueBehavior must be follow-up, steer, or interrupt',
      )
    }
    return this.settings.transact((settings) => {
      const agentProfile = { queueBehavior }
      return {
        settings: {
          ...settings,
          agentProfile,
        },
        result: agentProfile,
      }
    })
  }
}
