import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { motion, useReducedMotion } from "motion/react"
import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { useTranslation } from "react-i18next"

import { FileTypeIcon } from "@/features/file-browser/components/file-type-icon"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import { fileNameFromPath } from "@/lib/file-path"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"

import { useFileExists } from "./use-file-exists"
import { TooltipHint } from "@/components/ui/tooltip"

const MotionFileButton = motion.create(ButtonPrimitive)

export function FilePathLink({
  path,
  label,
  tooltip,
  showIcon = false,
  recheckKey,
  variant = "text",
  marquee = false,
  wrap = false,
  className,
}: {
  path: string
  label: string
  tooltip?: string
  showIcon?: boolean
  recheckKey?: string
  variant?: "text" | "code"
  marquee?: boolean
  wrap?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const workspaceFiles = useOptionalWorkspaceFiles()
  const exists = useFileExists(path, recheckKey)
  const canOpen = exists === true && workspaceFiles !== null && path.trim() !== ""
  const openLabel = t("agentMessage.openFile", { name: label })

  const icon = showIcon ? (
    <FileTypeIcon
      name={fileNameFromPath(path)}
      path={path}
      className={cn("size-[0.875em]", wrap ? "me-0.5 inline-block align-text-bottom" : "block")}
    />
  ) : null
  const text = marquee && !wrap ? (
    <OverflowMarquee className="flex-1">{label}</OverflowMarquee>
  ) : (
    <span className={wrap ? "whitespace-normal wrap-anywhere" : "min-w-0 truncate"}>{label}</span>
  )
  const linkBox = cn(
    "relative z-10 text-left font-normal leading-normal",
    wrap ? "inline whitespace-normal wrap-anywhere" : "inline-flex max-w-full min-w-0 items-center gap-0.5 align-middle"
  )

  const content = canOpen ? (
    <MotionFileButton
      // Native buttons form an atomic inline box even with display:inline.
      // Base UI supplies button semantics and keyboard activation on a span.
      render={wrap ? <span /> : undefined}
      nativeButton={!wrap}
      type={wrap ? undefined : "button"}
      aria-label={openLabel}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        workspaceFiles.openFileInWorkspace(path)
      }}
      whileTap={wrap || shouldReduceMotion ? undefined : { scale: 0.98 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
      className={cn(
        linkBox,
        "pointer-events-auto outline-none",
        className,
        "cursor-pointer bg-transparent p-0 underline-offset-2",
        wrap && "transition-opacity duration-150 active:opacity-80 motion-reduce:transition-none",
        focusRing,
        variant === "code"
          ? "text-sky-600 underline decoration-sky-600/50 hover:decoration-sky-600 dark:text-sky-400 dark:decoration-sky-400/50 dark:hover:decoration-sky-400"
          : "hover:underline"
      )}
    >
      {icon}
      {text}
    </MotionFileButton>
  ) : exists === undefined ? (
    // Same box as the button, so a transcript full of references does not
    // reflow line by line as the existence checks resolve.
    <span className={cn(linkBox, className)}>
      {icon}
      {text}
    </span>
  ) : variant === "code" ? (
    <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[1em]", className)}>
      {label}
    </code>
  ) : (
    <span className={cn(marquee && "inline-block max-w-full min-w-0 truncate align-middle", className)}>{label}</span>
  )

  return (
    <TooltipHint content={tooltip ?? (canOpen ? openLabel : undefined)}>
      {/* Keep the native hover target mounted when the existence check replaces
          plain text with a button; Base UI attaches listeners to this element. */}
      <span className={wrap ? "inline" : "inline-flex max-w-full min-w-0 align-middle"}>
        {content}
      </span>
    </TooltipHint>
  )
}
