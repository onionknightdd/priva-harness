import claudeCodeIcon from "@lobehub/icons-static-svg/icons/claudecode-color.svg"
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg"

import { cn } from "@/lib/utils"

import type { HarnessId } from "./harness-options"

function PiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <path
        d="M5 7.5h14"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M9 7.5v11"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M15 7.5v8.2c0 1.7.9 2.8 2.4 2.8"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  )
}

const brandImages: Partial<Record<HarnessId, string>> = {
  claude: claudeCodeIcon,
  deepseek: deepseekIcon,
}

export function HarnessBrandLogo({
  className,
  harnessId,
}: {
  className?: string
  harnessId: HarnessId
}) {
  if (harnessId === "pi") {
    return <PiMark className={className} />
  }

  const src = brandImages[harnessId]

  if (!src) {
    return null
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={cn("size-6 object-contain", className)}
    />
  )
}
