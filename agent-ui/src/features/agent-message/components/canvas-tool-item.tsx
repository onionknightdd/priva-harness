import { AppWindowIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import type { ToolResultStatus } from "@/components/agents/tool-result"
import { useChatSession } from "@/features/chat-session"
import { rememberFileExists } from "@/features/files/file-existence"
import { useOptionalWorkspaceFiles } from "@/features/workspace"
import { SPRING_PRESS } from "@/lib/ease"
import { fileNameFromPath, resolveAgainstCwd } from "@/lib/file-path"
import { cn } from "@/lib/utils"

import type { StreamBlock } from "../agent-message-data"
import {
  canvasPathFromTool,
  canvasTitleFromInput,
} from "../canvas-html"
import { isToolRunning, toolItemStatusLabel } from "../tool-activity"

export function CanvasToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { runCwd } = useChatSession()
  const workspaceFiles = useOptionalWorkspaceFiles()
  const tool = block.tool
  const running = isToolRunning(tool)
  const status = canvasStatus(tool?.ok, running)
  const input = tool?.input ?? block.input
  const path = resolveAgainstCwd(
    canvasPathFromTool(tool?.output, input),
    runCwd
  )
  const title = canvasTitleFromInput(input)
  const fileName = path === "" ? "" : fileNameFromPath(path)
  const canOpen =
    status === "success" &&
    path !== "" &&
    workspaceFiles !== null
  const openLabel = t("agentMessage.canvasOpenPreview")
  const displayName = title || fileName

  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1 px-0 py-0.5">
      <motion.button
        type="button"
        disabled={!canOpen}
        title={canOpen ? openLabel : undefined}
        aria-label={canOpen ? openLabel : undefined}
        onClick={() => {
          if (!canOpen || workspaceFiles === null) {
            return
          }
          rememberFileExists(path, true)
          workspaceFiles.openFileInWorkspace(path, { previewMode: "render" })
        }}
        whileTap={
          shouldReduceMotion || !canOpen ? undefined : { scale: 0.98 }
        }
        transition={shouldReduceMotion ? { duration: 0 } : SPRING_PRESS}
        className={cn(
          "flex w-fit max-w-full items-center gap-2 rounded-md bg-transparent px-0 py-0.5 text-left text-[15px] text-muted-foreground/70 outline-none",
          canOpen &&
            "cursor-pointer hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
          !canOpen && "cursor-default"
        )}
      >
        <AppWindowIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className={cn("min-w-0", running && "shimmer")}>
          {toolItemStatusLabel(block.name, running, t)}
        </span>
        {displayName ? (
          <span className="min-w-0 truncate font-normal text-muted-foreground">
            {displayName}
          </span>
        ) : null}
        {canOpen ? (
          <span className="shrink-0 text-muted-foreground/70">
            {openLabel}
          </span>
        ) : null}
      </motion.button>
      {status === "error" ? (
        <p className="max-w-full text-[15px] text-destructive">
          {tool?.output?.trim() || t("agentMessage.toolFailed")}
        </p>
      ) : null}
    </div>
  )
}

function canvasStatus(
  ok: boolean | undefined,
  running: boolean
): ToolResultStatus {
  if (running) {
    return "running"
  }
  if (ok === false) {
    return "error"
  }
  return "success"
}
