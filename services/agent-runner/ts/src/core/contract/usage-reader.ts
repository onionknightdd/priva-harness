import type {
  AuditPage,
  AuditPageInput,
  UsageOverview,
  UsageOverviewInput,
} from '../resource/usage-overview.js'

export interface UsageReader {
  overview(input: UsageOverviewInput): Promise<UsageOverview>
  auditPage(input: AuditPageInput): Promise<AuditPage>
}
