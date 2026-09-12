import type {
  AuditPage,
  AuditPageInput,
  UsageOverview,
  UsageOverviewInput,
  UsageRangeInput,
  UsageRangeSummary,
} from '../resource/usage-overview.js'

export interface UsageReader {
  overview(input: UsageOverviewInput): Promise<UsageOverview>
  range(input: UsageRangeInput): Promise<UsageRangeSummary>
  auditPage(input: AuditPageInput): Promise<AuditPage>
}
