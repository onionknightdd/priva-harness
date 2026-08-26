import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { FileTypeIcon } from "@/features/file-browser/components/file-type-icon"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import { fileNameFromPath } from "@/lib/file-path"
import { cn } from "@/lib/utils"

import { useFileExists } from "./use-file-exists"

export function FilePathLink({
  path,
  label,
  showIcon = false,
  recheckKey,
  variant = "text",
  className,
}: {
  path: string
  label: string
  showIcon?: boolean
  recheckKey?: string
  variant?: "text" | "code"
  className?: string
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const workspaceFiles = useOptionalWorkspaceFiles()
  const exists = useFileExists(path, recheckKey)
  const canOpen = exists && workspaceFiles !== null && path.trim() !== ""
  const openLabel = t("agentMessage.openFile", { name: label })

  if (!canOpen) {
    if (variant === "code") {
      return (
        <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[1em]", className)}>
          {label}
        </code>
      )
    }

    return <span className={className}>{label}</span>
  }

  return (
    <motion.button
      type="button"
      title={openLabel}
      aria-label={openLabel}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        workspaceFiles.openFileInWorkspace(path)
      }}
      whileHover={shouldReduceMotion ? undefined : { y: -0.5 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
      className={cn(
        "relative z-10 inline-flex max-w-full min-w-0 pointer-events-auto items-center gap-1 rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
        variant === "code"
          ? "rounded bg-muted px-1.5 py-0.5 font-mono text-[1em]"
          : "font-medium",
        className
      )}
    >
      {showIcon ? (
        <FileTypeIcon
          name={fileNameFromPath(path)}
          path={path}
          className="size-[1em]"
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </motion.button>
  )
}
