import type { HarnessConfig, HarnessConfigScope } from '../config/harness-config.js'

export interface HarnessConfigStore {
  read(scope: HarnessConfigScope): Promise<HarnessConfig>
  write(config: HarnessConfig): Promise<HarnessConfig>
}
