import { PresentationIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  JSXPreview,
  JSXPreviewContent,
  JSXPreviewError,
} from "@/components/ai-elements/jsx-preview"
import {
  ToolResult,
  type ToolResultStatus,
} from "@/components/agents/tool-result"
import { Skeleton } from "@/components/ui/skeleton"
import { SPRING_SWAP } from "@/lib/ease"
import { writeClipboardText } from "@/lib/clipboard"

import type { StreamBlock } from "../agent-message-data"
import { isToolRunning, toolItemStatusLabel } from "../tool-activity"
import { visualizeJsxFromTool } from "../visualize-jsx"
import { visualizePreviewComponents } from "../visualize-preview-components"

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
    <div className="w-full min-w-0 px-0 py-0">
      <ToolResult
        tool={toolItemStatusLabel(block.name, status === "running", t)}
        title=""
        kind="custom"
        status={status}
        icon={<PresentationIcon className="size-[1em]" />}
        copyText={jsx || undefined}
        onCopy={
          jsx
            ? () => {
                void writeClipboardText(jsx)
              }
            : undefined
        }
        defaultOpen
        collapseOnComplete={false}
        maxHeight={560}
      >
        <VisualizePreviewBody
          jsx={jsx}
          running={running}
          failed={status === "error"}
          errorText={status === "error" ? (tool?.output ?? "") : ""}
          reduceMotion={shouldReduceMotion}
        />
      </ToolResult>
    </div>
  )
}

function VisualizePreviewBody({
  jsx,
  running,
  failed,
  errorText,
  reduceMotion,
}: {
  jsx: string
  running: boolean
  failed: boolean
  errorText: string
  reduceMotion: boolean
}) {
  if (failed && jsx === "") {
    return (
      <p className="text-sm text-destructive">{errorText}</p>
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
      <JSXPreview
        jsx={jsx}
        isStreaming={running}
        components={visualizePreviewComponents}
      >
        <JSXPreviewContent className="min-h-24 text-sm text-foreground" />
        <JSXPreviewError />
      </JSXPreview>
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
