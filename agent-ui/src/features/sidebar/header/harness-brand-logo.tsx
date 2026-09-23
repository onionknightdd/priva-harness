import claudeCodeIcon from "@lobehub/icons-static-svg/icons/claudecode-color.svg"
import piIcon from "@lobehub/icons-static-svg/icons/pi.svg"

import { cn } from "@/lib/utils"

import type { HarnessId } from "./harness-options"

const brandImages: Record<
  HarnessId,
  { src: string; monochrome?: boolean }
> = {
  pi: { src: piIcon, monochrome: true },
  claude: { src: claudeCodeIcon },
}

export function HarnessBrandLogo({
  className,
  harnessId,
}: {
  className?: string
  harnessId: HarnessId
}) {
  const icon = brandImages[harnessId]

  return (
    <img
      src={icon.src}
      alt=""
      aria-hidden="true"
      className={cn(
        harnessId === "pi" ? "size-5" : "size-6",
        "object-contain",
        icon.monochrome && "dark:invert",
        className
      )}
    />
  )
}
