import { ChevronDownIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { AgentDisclosure } from "@/components/agents/agent-disclosure"
import { MessageResponse } from "@/components/ai-elements/message"
import {
  Collapsible,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Spinner } from "@/components/ui/spinner"
import { TooltipHint } from "@/components/ui/tooltip"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"

import type { CompactMarker } from "../slash-command-envelope"
import { QuoteSelectable } from "./quote-selectable"

export function CompactSessionMarker({ compact }: { compact: CompactMarker }) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [open, setOpen] = useState(false)
  const summary = compact.summary?.trim() ?? ""
  const compacting = compact.phase === "compacting"
  const canExpand = compact.phase === "compacted" && summary !== ""
  const label = {
    queued: "agentMessage.conversationCompactQueued",
    compacting: "agentMessage.conversationCompacting",
    compacted: "agentMessage.conversationCompacted",
    failed: "agentMessage.conversationCompactFailed",
    cancelled: "agentMessage.conversationCompactCancelled",
  } as const

  return (
    <motion.div
      data-compact-phase={compact.phase}
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
    >
      {canExpand ? (
        <Collapsible
          className="group/compact"
          open={open}
          onOpenChange={setOpen}
        >
          <Marker variant="separator">
            <CollapsibleTrigger
              className={cn(
                "inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground",
                focusRing
              )}
            >
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
          <AgentDisclosure open={open} unmountOnClose>
            <div className="pt-3 text-ui text-muted-foreground">
              <QuoteSelectable>
                <MessageResponse
                  className="text-muted-foreground [&_p]:[line-height:1.5em] [&_p+p]:mt-[2px] [&_*]:text-muted-foreground"
                  animated={false}
                >
                  {summary}
                </MessageResponse>
              </QuoteSelectable>
            </div>
          </AgentDisclosure>
        </Collapsible>
      ) : (
        <Marker variant="separator" role="status">
          {compacting ? (
            <MarkerIcon>
              <Spinner
                className="size-3.5 motion-reduce:animate-none"
                aria-hidden="true"
              />
            </MarkerIcon>
          ) : null}
          <TooltipHint content={compact.message}>
            <MarkerContent
              tabIndex={compact.message ? 0 : undefined}
              className={cn(
                compacting && "shimmer motion-reduce:animate-none",
                compact.message && focusRing
              )}
            >
              {t(label[compact.phase])}
            </MarkerContent>
          </TooltipHint>
        </Marker>
      )}
    </motion.div>
  )
}
