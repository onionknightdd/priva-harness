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
      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
      className={cn(
        "relative z-10 inline-flex max-w-full min-w-0 pointer-events-auto items-center gap-0.5 align-middle text-left font-normal leading-none outline-none",
        className,
        "cursor-pointer bg-transparent p-0 underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring",
        variant === "code"
          ? "text-sky-600 underline decoration-sky-600/50 hover:decoration-sky-600 dark:text-sky-400 dark:decoration-sky-400/50 dark:hover:decoration-sky-400"
          : "hover:underline"
      )}
    >
      {showIcon ? (
        <FileTypeIcon
          name={fileNameFromPath(path)}
          path={path}
          className="block size-[0.875em]"
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </motion.button>
  )
}
