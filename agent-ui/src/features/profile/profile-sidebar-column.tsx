import {
  CalendarIcon,
  CodeXmlIcon,
  CrownIcon,
  MapPinIcon,
  MoonIcon,
  PackageIcon,
  PencilIcon,
  SunIcon,
  TimerIcon,
  ZapIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress, ProgressLabel } from "@/components/ui/progress"

import { mockProfilePlan } from "./mock-profile-data"

function QuickStat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof CodeXmlIcon
  value: number
  label: string
}) {
  return (
    <Card size="sm" className="gap-2 py-3">
      <CardContent className="gap-1.5 px-3">
        <Icon className="size-3.5 text-sky-500" aria-hidden="true" />
        <p className="text-base font-semibold tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}

export function ProfileSidebarColumn() {
  const { t } = useTranslation()
  const { resolvedTheme, setTheme } = useTheme()
  const name = t("sidebar.user.guestName")
  const email = t("sidebar.user.guestEmail")
  const initials = t("sidebar.user.guestInitials")
  const isDark = resolvedTheme === "dark"
  const themeLabel = isDark
    ? t("theme.switchToLight")
    : t("theme.switchToDark")

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex flex-col items-center text-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-0 right-0"
          aria-label={t("profile.edit")}
          title={t("profile.edit")}
        >
          <PencilIcon />
        </Button>
        <Avatar className="size-20 text-lg">
          <AvatarFallback className="bg-sky-500/15 text-sky-700 dark:text-sky-300">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="mt-3 flex items-center gap-2">
          <h3 className="text-base font-semibold">{name}</h3>
          <Badge className="rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300">
            {t("profile.planBadge")}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{email}</p>
        <p className="mt-3 max-w-[18rem] text-xs text-muted-foreground">
          {t("profile.bio")}
        </p>
        <div className="mt-3 flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPinIcon className="size-3.5" aria-hidden="true" />
            {t("profile.location")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon className="size-3.5" aria-hidden="true" />
            {t("profile.joined")}
          </span>
        </div>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <CrownIcon className="size-3.5 text-sky-500" aria-hidden="true" />
            {t("profile.planName")}
          </CardTitle>
          <CardAction>
            <Button type="button" variant="link" size="xs" className="text-sky-600 dark:text-sky-400">
              {t("profile.manage")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t("profile.planRenews")}</p>
          <Progress
            value={mockProfilePlan.usagePercent}
            className="mt-3 gap-1.5 [&_[data-slot=progress-indicator]]:bg-sky-500"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <ProgressLabel className="text-xs">
                {t("profile.usagePercent", {
                  percent: mockProfilePlan.usagePercent,
                })}
              </ProgressLabel>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("profile.usageTokens", {
                  used: mockProfilePlan.usageUsed,
                  limit: mockProfilePlan.usageLimit,
                })}
              </span>
            </div>
          </Progress>
          <Button
            type="button"
            className="mt-3 w-full bg-sky-500 text-white hover:bg-sky-500/90 dark:bg-sky-400 dark:text-sky-950 dark:hover:bg-sky-400/90"
          >
            <ZapIcon data-icon="inline-start" />
            {t("profile.upgrade")}
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" className="py-3">
        <CardContent className="flex-row items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">{t("profile.statusOnline")}</p>
              <p className="text-[11px] text-muted-foreground">
                {t("profile.statusActive")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={themeLabel}
            title={themeLabel}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <QuickStat
          icon={CodeXmlIcon}
          value={mockProfilePlan.projects}
          label={t("profile.stats.projects")}
        />
        <QuickStat
          icon={PackageIcon}
          value={mockProfilePlan.agents}
          label={t("profile.stats.agents")}
        />
        <QuickStat
          icon={TimerIcon}
          value={mockProfilePlan.sessions}
          label={t("profile.stats.sessions")}
        />
      </div>
    </div>
  )
}
