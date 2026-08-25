import {
  BookOpenTextIcon,
  BugIcon,
  CodeXmlIcon,
  FileSearchIcon,
  InfoIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  mockProfileKpis,
  mockRecentActivity,
  mockUseCases,
  PROFILE_RANGE_WEEKS,
  type ProfileRangeWeeks,
} from "./mock-profile-data"
import { ProfileTokenHeatmap } from "./profile-token-heatmap"
import { ProfileTopModelsChart } from "./profile-top-models-chart"

const useCaseIcons = {
  codeGeneration: CodeXmlIcon,
  codeReview: FileSearchIcon,
  debugging: BugIcon,
  docs: BookOpenTextIcon,
  other: SparklesIcon,
} as const

function KpiCard({
  label,
  value,
  detail,
  trend,
}: {
  label: string
  value: string
  detail?: string
  trend?: string
}) {
  return (
    <Card size="sm" className="gap-2 py-3">
      <CardContent className="gap-1 px-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums tracking-tight">
          {value}
        </p>
        {trend ? (
          <p className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <TrendingUpIcon className="size-3" aria-hidden="true" />
            {trend}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function ProfileUsageColumn({
  weeks,
  onWeeksChange,
}: {
  weeks: ProfileRangeWeeks
  onWeeksChange: (weeks: ProfileRangeWeeks) => void
}) {
  const { t } = useTranslation()
  const rangeItems = PROFILE_RANGE_WEEKS.map((value) => ({
    value: String(value),
    label: t("profile.range.weeks", { count: value }),
  }))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium">{t("profile.overviewTitle")}</h3>
          <InfoIcon
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <Select
          items={rangeItems}
          value={String(weeks)}
          onValueChange={(next) => {
            if (next === null) {
              return
            }

            onWeeksChange(Number(next) as ProfileRangeWeeks)
          }}
        >
          <SelectTrigger size="sm" aria-label={t("profile.range.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="end"
            alignItemWithTrigger={false}
            className="w-max min-w-(--anchor-width)"
          >
            <SelectGroup>
              {rangeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard
          label={t("profile.kpi.totalTokens")}
          value={mockProfileKpis.totalTokens}
          trend={mockProfileKpis.totalTokensTrend}
        />
        <KpiCard
          label={t("profile.kpi.dailyAverage")}
          value={mockProfileKpis.dailyAverage}
          trend={mockProfileKpis.dailyAverageTrend}
        />
        <KpiCard
          label={t("profile.kpi.peakDay")}
          value={mockProfileKpis.peakDayValue}
          detail={t("profile.kpi.peakDayDate")}
        />
        <KpiCard
          label={t("profile.kpi.totalRequests")}
          value={mockProfileKpis.totalRequests}
          trend={mockProfileKpis.totalRequestsTrend}
        />
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">{t("profile.heatmap.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileTokenHeatmap weeks={weeks} />
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">{t("profile.models.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileTopModelsChart />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">
              {t("profile.useCases.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-2">
              {mockUseCases.map((useCase) => {
                const Icon = useCaseIcons[useCase.id]
                return (
                  <Item key={useCase.id} size="xs" className="px-0 py-1.5">
                    <ItemMedia variant="icon">
                      <Icon className="text-sky-500" aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="text-xs font-medium">
                        {t(`profile.useCases.${useCase.id}`)}
                      </ItemTitle>
                    </ItemContent>
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">
                      {useCase.percent}%
                    </span>
                  </Item>
                )
              })}
            </ItemGroup>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">
              {t("profile.activity.title")}
            </CardTitle>
            <CardAction>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="text-sky-600 dark:text-sky-400"
              >
                {t("profile.activity.viewAll")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {mockRecentActivity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">
                      {item.minutesAgo != null
                        ? t("profile.activity.minutesAgo", {
                            count: item.minutesAgo,
                          })
                        : t("profile.activity.hoursAgo", {
                            count: item.hoursAgo ?? 0,
                          })}
                    </p>
                    <p className="truncate text-xs">
                      {t(`profile.activity.items.${item.id}`)}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className="rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300"
                  >
                    {item.tokens}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
