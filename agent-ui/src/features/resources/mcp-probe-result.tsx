import { CheckCircle2Icon } from "lucide-react"
import { motion, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"

import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { TooltipHint } from "@/components/ui/tooltip"
import type { McpCapabilities } from "./resource-api"

export function McpProbeResult({ capabilities }: { capabilities: McpCapabilities }) {
  const { t } = useTranslation()
  const reduceMotion = Boolean(useReducedMotionConfig())
  const summary = t("resources.mcpTestSucceeded") + (["tools", "prompts", "resources"] as const).map((kind) =>
    t("resources.discoveredCategory", { category: t(`resources.${kind}`), count: capabilities[kind].length })
  ).join(t("resources.inventorySeparator"))

  return <motion.div
    role="status"
    data-mcp-probe-result
    aria-live="polite"
    className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
    initial={reduceMotion ? false : { opacity: 0, transform: "translateY(-3px)" }}
    animate={{ opacity: 1, transform: "translateY(0px)" }}
    transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
  >
    <CheckCircle2Icon className="size-3.5 shrink-0" aria-hidden="true" />
    <TooltipHint content={summary}><span className="min-w-0 flex-1"><OverflowMarquee>{summary}</OverflowMarquee></span></TooltipHint>
  </motion.div>
}
