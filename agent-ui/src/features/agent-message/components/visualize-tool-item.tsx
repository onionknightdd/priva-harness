import { PresentationIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  ToolResult,
  type ToolResultStatus,
} from "@/components/agents/tool-result"
import { Skeleton } from "@/components/ui/skeleton"
import { SPRING_SWAP } from "@/lib/ease"

import type { StreamBlock } from "../agent-message-data"
import { isToolRunning, toolItemStatusLabel } from "../tool-activity"
import { visualizeJsxFromTool } from "../visualize-jsx"
import { VisualizeSandboxFrame } from "../visualize-sandbox/visualize-sandbox-frame"

export function VisualizeToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const tool = block.tool
  const running = isToolRunning(tool)
  const status = visualizeStatus(tool?.ok, running)
  const jsx = visualizeJsxFromTool(tool?.output, tool?.input ?? block.input)

  return (
    <ToolResult
      tool={toolItemStatusLabel(block.name, status === "running", t)}
      title=""
      kind="custom"
      status={status}
      icon={<PresentationIcon className="size-[1em]" />}
      defaultOpen
      collapseOnComplete={false}
      framed={false}
      maxHeight={560}
    >
      <VisualizePreviewBody
        jsx={jsx}
        running={running}
        failed={status === "error"}
        errorText={status === "error" ? (tool?.output ?? "") : ""}
        reduceMotion={shouldReduceMotion}
        frameTitle={t("agentMessage.visualizeFrameTitle")}
      />
    </ToolResult>
  )
}

function VisualizePreviewBody({
  jsx,
  running,
  failed,
  errorText,
  reduceMotion,
  frameTitle,
}: {
  jsx: string
  running: boolean
  failed: boolean
  errorText: string
  reduceMotion: boolean
  frameTitle: string
}) {
  if (failed && jsx === "") {
    return (
      <p className="text-[15px] text-destructive">{errorText}</p>
    )
  }
  if (jsx === "") {
    return <Skeleton className="h-32 w-full rounded-lg" />
  }
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
    >
      <VisualizeSandboxFrame
        jsx={jsx}
        streaming={running}
        title={frameTitle}
      />
    </motion.div>
  )
}

function visualizeStatus(
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
