import { ImageIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ToolResult } from "@/components/agents/tool-result"
import { MessageResponse } from "@/components/ai-elements/message"
import { AnalyzingImage } from "@/components/loading-ui/analyzing-image"
import { Skeleton } from "@/components/ui/skeleton"
import { resolveAgainstCwd } from "@/lib/file-path"

import { imageOutputPath, imageToolInput, imageToolString, type ImageToolBlock } from "../image-tool-data"
import { isToolRunning, toolItemStatusLabel } from "../tool-activity"
import { ImageToolPreview } from "./image-tool-preview"
import { QuoteSelectable } from "./quote-selectable"

export function ImageGenToolItem({ block }: { block: ImageToolBlock }) {
  const { t } = useTranslation()
  const input = imageToolInput(block)
  const prompt = imageToolString(input, "prompt")
  const size = imageToolString(input, "size") || "1024x1024"
  const running = isToolRunning(block.tool)
  const path = imageOutputPath(block.tool?.output)
  const status = running ? "running" : block.tool?.ok === false || !path ? "error" : "success"

  return (
    <ToolResult
      tool={toolItemStatusLabel(block.name, running, t)}
      title=""
      icon={<ImageIcon className="size-[1em]" />}
      status={status}
      defaultOpen
      collapseOnComplete={false}
      framed={false}
      maxHeight={560}
      contentClassName="min-w-0 space-y-3 py-1"
    >
      <QuoteSelectable>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">prompt</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{prompt || t("agentMessage.imageTools.inputPending")}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-xs text-muted-foreground">size</dt>
            <dd className="font-mono text-xs">{size}</dd>
          </div>
        </dl>
      </QuoteSelectable>
      {running ? (
        <Skeleton className="h-64 w-full rounded-lg motion-reduce:animate-none" role="status">
          <span className="sr-only">{t("agentMessage.toolItem.imageGenRunning")}</span>
        </Skeleton>
      ) : status === "error" ? (
        <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive [overflow-wrap:anywhere]">{block.tool?.output || t("agentMessage.imageTools.missingOutput")}</p>
      ) : path ? (
        <ImageToolPreview path={path} alt={prompt || t("agentMessage.generatedImage")} />
      ) : (
        <p role="alert" className="text-sm text-destructive">{t("agentMessage.imageTools.missingOutput")}</p>
      )}
    </ToolResult>
  )
}

export function ImageReadToolItem({ block, cwd }: { block: ImageToolBlock; cwd: string }) {
  const { t } = useTranslation()
  const input = imageToolInput(block)
  const prompt = imageToolString(input, "prompt")
  const imagePath = imageToolString(input, "image_path")
  const path = imagePath ? resolveAgainstCwd(imagePath, cwd) : ""
  const running = isToolRunning(block.tool)
  const status = running ? "running" : block.tool?.ok === false ? "error" : "success"
  const output = block.tool?.output ?? ""

  return (
    <ToolResult
      tool={toolItemStatusLabel(block.name, running, t)}
      title=""
      icon={<AnalyzingImage active={running} className="size-[1em]" />}
      status={status}
      defaultOpen={running}
      collapseOnComplete={false}
      framed={false}
      maxHeight={560}
      contentClassName="min-w-0 space-y-3 py-1"
    >
      <QuoteSelectable>
        <dl className="text-sm">
          <dt className="text-xs text-muted-foreground">prompt</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{prompt || t("agentMessage.imageTools.inputPending")}</dd>
        </dl>
      </QuoteSelectable>
      {path ? <ImageToolPreview path={path} alt={prompt || t("agentMessage.toolItem.imageReadDone")} /> : null}
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">{t("agentMessage.imageTools.modelOutput")}</p>
        <QuoteSelectable>
          {status === "error" ? (
            <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive [overflow-wrap:anywhere]">{output || t("agentMessage.toolFailed")}</p>
          ) : output ? (
            <MessageResponse mode={running ? "streaming" : "static"} isAnimating={running} className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
              {output}
            </MessageResponse>
          ) : running ? (
            <Skeleton className="h-5 w-2/3 motion-reduce:animate-none" role="status"><span className="sr-only">{t("agentMessage.toolRunning")}</span></Skeleton>
          ) : (
            <p className="text-sm text-muted-foreground">{t("agentMessage.imageTools.emptyOutput")}</p>
          )}
        </QuoteSelectable>
      </div>
    </ToolResult>
  )
}
