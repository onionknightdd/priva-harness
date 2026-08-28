import { ChevronDownIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { MessageResponse } from "@/components/ai-elements/message"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { cn } from "@/lib/utils"

import type { CompactMarker } from "../slash-command-envelope"
import { QuoteSelectable } from "./quote-selectable"

const PANEL_CLASS =
  "h-[var(--collapsible-panel-height)] overflow-hidden [overflow-anchor:none] transition-[height,opacity] duration-200 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0 motion-reduce:transition-none"

export function CompactSessionMarker({ compact }: { compact: CompactMarker }) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const summary = compact.summary?.trim() ?? ""
  const compacting = compact.phase === "compacting"
  const canExpand = !compacting && summary !== ""

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
    >
      {canExpand ? (
        <Collapsible className="group/compact">
          <Marker variant="separator">
            <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <MarkerContent>
                {t("agentMessage.conversationCompacted")}
              </MarkerContent>
              <ChevronDownIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 transition-transform duration-200 group-data-open/compact:rotate-180 motion-reduce:transition-none"
              />
              <span className="sr-only">
                {t("agentMessage.conversationCompactedExpand")}
              </span>
            </CollapsibleTrigger>
          </Marker>
          <CollapsibleContent className={PANEL_CLASS}>
            <div className="pt-3 text-sm text-muted-foreground">
              <QuoteSelectable>
                <MessageResponse
                  className="text-muted-foreground [&_p]:[line-height:calc(1.5em+2px)] [&_p+p]:mt-[2px] [&_*]:text-muted-foreground"
                  animated={false}
                >
                  {summary}
                </MessageResponse>
              </QuoteSelectable>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <Marker variant="separator" role={compacting ? "status" : undefined}>
          <MarkerContent
            className={cn(
              compacting && "shimmer motion-reduce:animate-none"
            )}
          >
            {t(
              compacting
                ? "agentMessage.conversationCompacting"
                : "agentMessage.conversationCompacted"
            )}
          </MarkerContent>
        </Marker>
      )}
    </motion.div>
  )
}
