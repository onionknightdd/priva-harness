import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

import { UsageActivity } from "./usage-activity"
import { USAGE_HEATMAP_WIDTH } from "./usage-heatmap"
import { UsageOverviewCards } from "./usage-overview-cards"
import { useUsageOverview } from "./use-usage-overview"

// One calendar year of local days, matching the streak / heatmap window the
// server keeps facts for.
const HEATMAP_DAYS = 365

export function UsagePage() {
  const { t } = useTranslation()
  const overview = useUsageOverview(HEATMAP_DAYS)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pb-6 pt-3">
      <UsageOverviewCards />
      <section aria-label={t("usage.activity.label")} className="flex flex-col">
        {overview.loading ? (
          <div
            role="status"
            aria-label={t("usage.loading")}
            className="mx-auto flex w-full flex-col gap-3"
            style={{ maxWidth: USAGE_HEATMAP_WIDTH }}
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-5 w-32" />
            </div>
            <Skeleton className="h-[138px] w-full" />
          </div>
        ) : overview.error ? (
          <div role="alert" className="flex flex-col items-start gap-3 text-sm">
            <p className="break-words text-destructive">{overview.error}</p>
            <Button variant="outline" size="sm" onClick={overview.retry}>
              {t("usage.retry")}
            </Button>
          </div>
        ) : overview.data ? (
          <div className="motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out starting:opacity-0">
            <UsageActivity overview={overview.data} />
          </div>
        ) : null}
      </section>
    </div>
  )
}
