import { ImagesIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { ToolResult } from "@/components/agents/tool-result"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EASE_OUT } from "@/lib/ease"
import { fileNameFromPath } from "@/lib/file-path"

import { imageEditSourcePaths, imageOutputPath, imageToolInput, imageToolString, type ImageToolBlock } from "../image-tool-data"
import { isToolRunning, toolItemStatusLabel } from "../tool-activity"
import { ImageToolComparison } from "./image-tool-comparison"
import { ImageToolPreview } from "./image-tool-preview"
import { QuoteSelectable } from "./quote-selectable"

export function ImageEditToolItem({ block, cwd }: { block: ImageToolBlock; cwd: string }) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const pointerChange = useRef(false)
  const [mode, setMode] = useState("side-by-side")
  const [selectedSource, setSelectedSource] = useState(0)
  const input = imageToolInput(block)
  const prompt = imageToolString(input, "prompt")
  const sources = imageEditSourcePaths(input, cwd)
  const sourceIndex = Math.min(selectedSource, Math.max(0, sources.length - 1))
  const before = sources[sourceIndex] ?? ""
  const running = isToolRunning(block.tool)
  const after = imageOutputPath(block.tool?.output)
  const status = running ? "running" : block.tool?.ok === false || !after ? "error" : "success"
  const canCompare = Boolean(before && after && status === "success")
  const visibleMode = canCompare ? mode : "side-by-side"

  return (
    <ToolResult
      tool={toolItemStatusLabel(block.name, running, t)}
      title=""
      icon={<ImagesIcon className="size-[1em]" />}
      status={status}
      defaultOpen={running}
      collapseOnComplete={false}
      framed={false}
      maxHeight={640}
      contentClassName="min-w-0 space-y-3 py-1"
    >
      <QuoteSelectable>
        <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{prompt || t("agentMessage.imageTools.inputPending")}</p>
      </QuoteSelectable>
      <div
        className="space-y-2"
        onPointerDownCapture={() => { pointerChange.current = true }}
        onKeyDownCapture={() => { pointerChange.current = false }}
      >
        <ToggleGroup
          value={[visibleMode]}
          onValueChange={(value) => { if (value[0]) setMode(value[0]) }}
          aria-label={t("agentMessage.imageTools.comparisonMode")}
          variant="outline"
          size="sm"
          spacing={0}
        >
          <ToggleGroupItem value="side-by-side">Side-by-side</ToggleGroupItem>
          <ToggleGroupItem value="slide" disabled={!canCompare}>Slide</ToggleGroupItem>
        </ToggleGroup>
        {sources.length > 1 ? (
          <ToggleGroup
            value={[String(sourceIndex)]}
            onValueChange={(value) => { if (value[0]) setSelectedSource(Number(value[0])) }}
            aria-label={t("agentMessage.imageTools.sourceImages")}
            className="max-w-full flex-wrap"
            size="sm"
            spacing={1}
          >
            {sources.map((path, index) => <ToggleGroupItem key={`${index}:${path}`} value={String(index)}>{t("agentMessage.imageTools.sourceNumber", { number: index + 1 })}</ToggleGroupItem>)}
          </ToggleGroup>
        ) : null}
      </div>
      <motion.div
        key={visibleMode}
        initial={reduce || !pointerChange.current ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.16, ease: EASE_OUT }}
        className="min-w-0 space-y-1.5"
      >
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground" aria-hidden="true">
          <span>{t("agentMessage.imageTools.before")}</span>
          <span className={visibleMode === "slide" ? "text-right" : undefined}>{t("agentMessage.imageTools.after")}</span>
        </div>
        {visibleMode === "slide" ? <ImageToolComparison before={before} after={after} /> : (
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {before ? <ImageToolPreview path={before} alt={`${t("agentMessage.imageTools.before")} · ${fileNameFromPath(before)}`} className="h-48 sm:h-64" /> : (
              <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground sm:h-64">{t(running ? "agentMessage.imageTools.inputPending" : "agentMessage.imageTools.missingSource")}</div>
            )}
            {running ? <Skeleton className="h-48 w-full rounded-lg motion-reduce:animate-none sm:h-64" role="status"><span className="sr-only">{t("agentMessage.toolItem.imageEditRunning")}</span></Skeleton> : status === "error" ? (
              <div className="h-48 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 sm:h-64">
                <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive [overflow-wrap:anywhere]">{block.tool?.output || t("agentMessage.imageTools.missingOutput")}</p>
              </div>
            ) : <ImageToolPreview path={after} alt={t("agentMessage.imageTools.after")} className="h-48 sm:h-64" />}
          </div>
        )}
      </motion.div>
      <QuoteSelectable>
        <dl className="space-y-1 text-xs text-muted-foreground">
          {before ? <div className="flex items-baseline gap-2"><dt className="shrink-0">{t("agentMessage.imageTools.before")}</dt><dd className="min-w-0"><code className="break-all">{before}</code></dd></div> : null}
          {after && status === "success" ? <div className="flex items-baseline gap-2"><dt className="shrink-0">{t("agentMessage.imageTools.after")}</dt><dd className="min-w-0"><code className="break-all">{after}</code></dd></div> : null}
        </dl>
      </QuoteSelectable>
    </ToolResult>
  )
}
