import { ChevronDownIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { MessageResponse } from "@/components/ai-elements/message"
import {
  Collapsible,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

import type { CompactMarker } from "../slash-command-envelope"
import { MotionCollapsePanel } from "./motion-collapse-panel"
import { QuoteSelectable } from "./quote-selectable"

export function CompactSessionMarker({ compact }: { compact: CompactMarker }) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [open, setOpen] = useState(false)
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
        <Collapsible
          className="group/compact"
          open={open}
          onOpenChange={setOpen}
        >
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
          <MotionCollapsePanel open={open}>
            <div className="pt-3 text-sm text-muted-foreground">
              <QuoteSelectable>
                <MessageResponse
                  className="text-muted-foreground [&_p]:[line-height:1.5em] [&_p+p]:mt-[2px] [&_*]:text-muted-foreground"
                  animated={false}
                >
                  {summary}
                </MessageResponse>
              </QuoteSelectable>
            </div>
          </MotionCollapsePanel>
        </Collapsible>
      ) : (
        <Marker variant="separator" role={compacting ? "status" : undefined}>
          {compacting ? (
            <MarkerIcon>
              <Spinner
                className="size-3.5 motion-reduce:animate-none"
                aria-hidden="true"
              />
            </MarkerIcon>
          ) : null}
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
