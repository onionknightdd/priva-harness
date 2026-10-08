import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ContextWindow } from "../model-context"

export function ComposerContextWindow({ value, pending, onChange }: {
  value: ContextWindow
  pending: boolean
  onChange: (value: ContextWindow) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [warning, setWarning] = useState(false)
  const label = value === 1_000_000 ? "1M" : "200K"
  return (
    <DropdownMenuSub open={open} onOpenChange={(next) => { setOpen(next); if (!next) setWarning(false) }}>
      <DropdownMenuSubTrigger
        className="min-w-0 gap-2 text-sm font-normal [&_svg:not([class*='size-'])]:size-3.5"
        label={t("agentMessage.contextWindowAria", { size: label })}
        aria-busy={pending}
        closeDelay={120}
        openOnHover
      >
        <span className="min-w-0 flex-1">{t("agentMessage.contextWindowLabel")}</span>
        {pending && <Spinner className="size-3.5 motion-reduce:animate-none" aria-label={t("agentMessage.configurationApplying")} />}
        <span className="shrink-0 text-muted-foreground">{label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        align="start" side="right" className="w-56 min-w-56 max-w-56 text-sm"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuRadioGroup value={String(value)} onValueChange={(next) => {
          if (next !== "200000" && next !== "1000000") return
          onChange(Number(next) as ContextWindow)
          setWarning(next === "1000000")
        }}>
          <DropdownMenuRadioItem value="200000" closeOnClick={false} className="text-sm font-normal">200K</DropdownMenuRadioItem>
          <Tooltip open={open && value === 1_000_000 && warning} onOpenChange={setWarning}>
            <TooltipTrigger
              closeOnClick={false}
              render={<DropdownMenuRadioItem value="1000000" closeOnClick={false} className="text-sm font-normal" />}
            >1M</TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-64 whitespace-normal">
              {t("agentMessage.contextWindowWarning")}
            </TooltipContent>
          </Tooltip>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
