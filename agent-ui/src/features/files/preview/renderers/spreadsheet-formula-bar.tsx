import * as React from "react"
import { ChevronDown } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { EASE_OUT } from "@/lib/ease"

export function SpreadsheetFormulaBar({ address, value }: { address: string; value: string }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const toggleLabel = t(expanded ? "filePreview.collapseFormulaBar" : "filePreview.expandFormulaBar")
  const transition = { duration: reduceMotion ? 0 : 0.18, ease: EASE_OUT }

  return (
    <div className="min-w-0 shrink-0 border-b border-border p-2">
      <Popover open={expanded} onOpenChange={setExpanded}>
        <InputGroup ref={anchorRef} aria-label={t("filePreview.spreadsheetFormulaBar")}>
          <InputGroupAddon className="h-9 min-w-16 max-w-[35%] shrink-0 justify-center border-r border-border px-2">
            <InputGroupText title={address} className="block truncate font-mono text-xs tabular-nums">{address}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            value={value}
            aria-label={t("filePreview.spreadsheetCellValue")}
            className="min-w-0"
            onClick={(event) => {
              const input = event.currentTarget
              if (/[\r\n]/.test(value) || input.scrollWidth > input.clientWidth) setExpanded(true)
            }}
          />
          <InputGroupAddon align="inline-end" className="h-9 shrink-0">
            <PopoverTrigger
              render={<InputGroupButton size="icon-xs" />}
              aria-label={toggleLabel}
              title={toggleLabel}
            >
              <motion.span initial={false} animate={{ rotate: expanded ? 180 : 0 }} transition={transition}>
                <ChevronDown className="size-4" />
              </motion.span>
            </PopoverTrigger>
          </InputGroupAddon>
        </InputGroup>
        <PopoverContent
          anchor={anchorRef}
          align="start"
          side="bottom"
          positionMethod="fixed"
          collisionAvoidance={{ side: "none", align: "none", fallbackAxisSide: "none" }}
          aria-label={t("filePreview.spreadsheetFormulaBar")}
          className="w-(--anchor-width) max-w-(--anchor-width) gap-0 overflow-hidden p-0"
        >
          <Textarea
            readOnly
            value={value}
            aria-label={t("filePreview.spreadsheetCellValue")}
            className="max-h-[min(10rem,var(--available-height))] min-h-0 resize-none overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-inset dark:bg-transparent"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
