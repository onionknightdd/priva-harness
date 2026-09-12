import { useId, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"

import { TooltipHint } from "@/components/ui/tooltip"
import { formatTokenCount } from "@/features/agent-message/context-usage"

import { modelRows, OTHER_MODELS_KEY, type UsageModel } from "./usage-api"
import { USAGE_HEATMAP_WIDTH } from "./usage-heatmap"
import { seriesColor } from "./usage-series-colors"

// Share bars grow from the left when the table appears; a scale transform
// keeps the animation off layout. The share is read from a CSS variable so the
// @starting-style rule can win over it (an inline transform would not yield).
const BAR_CLASS_NAME =
  "block h-1 origin-left rounded-full scale-x-(--share) motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out starting:scale-x-0"

export function UsageModelTable({ models }: { models: readonly UsageModel[] }) {
  const { t } = useTranslation()
  const titleId = useId()
  const rows = modelRows(models)
  const none = t("usage.overview.none")

  return (
    <section
      aria-labelledby={titleId}
      className="mx-auto flex w-full flex-col gap-3"
      style={{ maxWidth: USAGE_HEATMAP_WIDTH }}
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={titleId} className="text-sm font-semibold">
          {t("usage.modelTable.title")}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">{t("usage.modelTable.description")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t("usage.models.empty")}</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col />
            <col className="w-[30%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
          </colgroup>
          <thead>
            <tr className="h-[26px] text-left text-muted-foreground">
              <th scope="col" className="font-normal">{t("usage.modelTable.model")}</th>
              <th scope="col" className="font-normal">{t("usage.modelTable.share")}</th>
              <th scope="col" className="text-right font-normal">{t("usage.modelTable.tokens")}</th>
              <th scope="col" className="text-right font-normal">{t("usage.modelTable.cost")}</th>
              <th scope="col" className="text-right font-normal">{t("usage.modelTable.runs")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const color = seriesColor(index)
              const percent = Math.round(row.share * 100)
              return (
                <tr key={row.key} className="h-[26px] border-t border-border">
                  <td className="min-w-0 pr-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
                      <span className="truncate">{row.key === OTHER_MODELS_KEY ? t("usage.models.other") : row.key}</span>
                    </span>
                  </td>
                  <td className="pr-3">
                    <span className="flex items-center gap-2">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className={BAR_CLASS_NAME}
                          style={{ backgroundColor: color, "--share": Math.max(0, Math.min(1, row.share)) } as CSSProperties}
                        />
                      </span>
                      <span className="w-8 text-right tabular-nums">{percent}%</span>
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{formatTokenCount(row.processedTokens)}</td>
                  <td className="text-right tabular-nums">
                    {row.costUsd === null ? (
                      none
                    ) : row.runsWithoutCost > 0 ? (
                      <TooltipHint content={t("usage.overview.partialCost", { count: row.runsWithoutCost })}>
                        <span className="cursor-default underline decoration-dotted underline-offset-2">{`$${row.costUsd.toFixed(2)}+`}</span>
                      </TooltipHint>
                    ) : (
                      `$${row.costUsd.toFixed(2)}`
                    )}
                  </td>
                  <td className="text-right tabular-nums">{row.runs.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
