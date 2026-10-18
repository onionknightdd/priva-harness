import { QiIconAi } from "qingicon-react"
import { useTranslation } from "react-i18next"

import { InputGroupButton } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

const ACTIVE_FILLS = [
  "[&_path:nth-child(1)]:fill-[rgb(0_191_162)] [&_path:nth-child(1)]:stroke-[rgb(0_191_162)]",
  "[&_path:nth-child(2)]:fill-[rgb(75_155_255)] [&_path:nth-child(2)]:stroke-[rgb(75_155_255)]",
  "[&_path:nth-child(3)]:fill-[rgb(255_202_58)] [&_path:nth-child(3)]:stroke-[rgb(255_202_58)]",
  "[&_path:nth-child(4)]:fill-[rgb(253_47_73)] [&_path:nth-child(4)]:stroke-[rgb(253_47_73)]",
] as const

export function VisualizeModeButton({
  active,
  onChange,
}: {
  active: boolean
  onChange: (active: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <InputGroupButton
      type="button"
      size="icon-xs"
      className="rounded-full"
      aria-pressed={active}
      aria-label={t(active ? "agentMessage.visualizeModeOn" : "agentMessage.visualizeModeOff")}
      onClick={() => onChange(!active)}
    >
      <QiIconAi
        size={20}
        className={cn("size-5", active ? ACTIVE_FILLS : "text-muted-foreground")}
      />
    </InputGroupButton>
  )
}
