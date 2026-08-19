import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg"
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg"

import { cn } from "@/lib/utils"

import type { HarnessId } from "./harness-options"

function BambuddyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-5", className)}
    >
      <path
        d="M8 3.5v5M8 10.5v5M8 17.5v3"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M6.15 8.5h3.7M6.15 15.5h3.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16 5.5v5M16 12.5v5M16 19.5v1"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M14.15 10.5h3.7M14.15 17.5h3.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16 5.5c2.35-1.7 3.85-.35 3.15 2.05"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

const brandImages: Partial<Record<HarnessId, string>> = {
  claude: claudeIcon,
  deepseek: deepseekIcon,
}

export function HarnessBrandLogo({
  className,
  harnessId,
}: {
  className?: string
  harnessId: HarnessId
}) {
  if (harnessId === "bambuddy") {
    return <BambuddyMark className={className} />
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
      className={cn("size-5 object-contain", className)}
    />
  )
}
