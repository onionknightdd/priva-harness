import { ActivityIcon, ChartColumnStackedIcon } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { TabsTriggerContent } from "@/components/assistant-ui/tabs-trigger-content"
import { cn } from "@/lib/utils"

import { HEATMAP_MODES, type HeatmapMode, type UsageOverview } from "./usage-api"
import { UsageHeatmap, USAGE_HEATMAP_WIDTH } from "./usage-heatmap"
import { UsageModelChart } from "./usage-model-chart"

const PANELS = ["tokens", "models"] as const
type Panel = (typeof PANELS)[number]

const PANEL_ICONS = { tokens: ActivityIcon, models: ChartColumnStackedIcon } as const

// Panels swap instantly and the incoming one fades in; a crossfade would
// stack both panels in the column for a frame and shift the layout.
const PANEL_ENTER_CLASS_NAME =
  "motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out starting:opacity-0"

function isPanel(value: unknown): value is Panel {
  return typeof value === "string" && (PANELS as readonly string[]).includes(value)
}

function isHeatmapMode(value: unknown): value is HeatmapMode {
  return typeof value === "string" && (HEATMAP_MODES as readonly string[]).includes(value)
}

// The block is exactly as wide as the year grid and centred in the page, so
// the panel tabs and the heatmap mode switch line up with the grid's edges
// instead of the viewport's: the weekday labels start at the SVG's left edge,
// while the grid ends 3px (its stroke padding) before the SVG's right edge.
// `-mr-2` cancels the last mode tab's padding so its text, not its hit area,
// meets the grid's right edge.
export function UsageActivity({ overview }: { overview: UsageOverview }) {
  const { t } = useTranslation()
  const reduceMotion = Boolean(useReducedMotion())
  const [panel, setPanel] = useState<Panel>("tokens")
  const [mode, setMode] = useState<HeatmapMode>("daily")

  return (
    <Tabs
      value={panel}
      onValueChange={(value) => {
        if (isPanel(value)) setPanel(value)
      }}
      className="mx-auto w-full gap-3"
      style={{ maxWidth: USAGE_HEATMAP_WIDTH }}
    >
      <div className="flex items-center justify-between gap-4 pr-[3px]">
        <TabsList variant="default" size="sm" aria-label={t("usage.activity.label")}>
          {PANELS.map((value) => (
            <TabsTrigger key={value} value={value} className="dark:data-active:text-white">
              <TabsTriggerContent
                active={panel === value}
                icon={PANEL_ICONS[value]}
                label={t(`usage.activity.${value}`)}
                reduceMotion={reduceMotion}
              />
            </TabsTrigger>
          ))}
        </TabsList>
        {/* The mode switch only applies to the heatmap: it leaves with the
            panel instantly and fades back in with it. */}
        {panel === "tokens" ? (
          <Tabs
            value={mode}
            onValueChange={(value) => {
              if (isHeatmapMode(value)) setMode(value)
            }}
            className={cn("gap-0", PANEL_ENTER_CLASS_NAME)}
          >
            <TabsList variant="text" size="sm" aria-label={t("usage.heatmap.modeLabel")} className="-mr-2 h-7">
              {HEATMAP_MODES.map((value) => (
                <TabsTrigger key={value} value={value} className="text-xs">
                  {t(`usage.heatmap.mode.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
      </div>
      {/* The fade lives on an inner wrapper: a transition on the panel itself
          would make Base UI keep the leaving panel mounted until it ends. */}
      <TabsContent value="tokens">
        <div className={PANEL_ENTER_CLASS_NAME}>
          <UsageHeatmap days={overview.heatmap} mode={mode} />
        </div>
      </TabsContent>
      <TabsContent value="models">
        <div className={PANEL_ENTER_CLASS_NAME}>
          <UsageModelChart window={overview.heatmap} dailyModels={overview.dailyModels} models={overview.models} />
        </div>
      </TabsContent>
    </Tabs>
  )
}
