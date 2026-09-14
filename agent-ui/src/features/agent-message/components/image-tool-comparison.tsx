import { Slider } from "@base-ui/react/slider"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { ResizableHandleGrip } from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { getDownloadUrl } from "@/lib/api/sandbox-files"
import { cn } from "@/lib/utils"

type ImageToolComparisonProps = {
  before: string
  after: string
}

export function ImageToolComparison(props: ImageToolComparisonProps) {
  return <Comparison key={`${props.before}\n${props.after}`} {...props} />
}

function Comparison({ before, after }: ImageToolComparisonProps) {
  const { t } = useTranslation()
  const [position, setPosition] = useState(50)
  const [loaded, setLoaded] = useState({ before: false, after: false })
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const ready = loaded.before && loaded.after
  const src = (path: string) => `${getDownloadUrl(path)}${attempt ? `&retry=${attempt}` : ""}`

  if (failed) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:h-64">
        <p role="alert" className="text-sm text-destructive">{t("agentMessage.imageTools.loadFailed")}</p>
        <Button variant="outline" size="sm" onClick={() => {
          setAttempt((value) => value + 1)
          setLoaded({ before: false, after: false })
          setFailed(false)
        }}>{t("agentMessage.imageTools.retryPreview")}</Button>
      </div>
    )
  }

  return (
    <Slider.Root
      value={position}
      onValueChange={setPosition}
      min={0}
      max={100}
      step={0.1}
      disabled={!ready}
      className="h-48 min-w-0 sm:h-64"
      aria-busy={!ready}
    >
      <Slider.Control className="relative size-full cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-lg border border-border bg-background data-disabled:cursor-default">
        <img
          src={src(after)}
          alt={t("agentMessage.imageTools.after")}
          draggable={false}
          className={cn("absolute inset-0 size-full object-contain", !ready && "invisible")}
          onLoad={() => setLoaded((value) => ({ ...value, after: true }))}
          onError={() => setFailed(true)}
        />
        {/* Both images keep the same canvas and contain fit. Only the reveal is
            clipped; resizing one image would misalign the comparison. */}
        <div className={cn("absolute inset-0 bg-background", !ready && "invisible")} style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} data-slot="image-comparison-before">
          <img
            src={src(before)}
            alt={t("agentMessage.imageTools.before")}
            draggable={false}
            className="size-full object-contain"
            onLoad={() => setLoaded((value) => ({ ...value, before: true }))}
            onError={() => setFailed(true)}
          />
        </div>
        {!ready ? <Skeleton className="absolute inset-0 size-full rounded-none motion-reduce:animate-none" role="status"><span className="sr-only">{t("agentMessage.imageTools.loading")}</span></Skeleton> : null}
        <Slider.Thumb
          aria-label={t("agentMessage.imageTools.comparePosition")}
          getAriaValueText={(_, value) => t("agentMessage.imageTools.compareValue", { value })}
          className={cn("group/handle flex h-full w-11 items-center justify-center outline-none", !ready && "invisible")}
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
          <ResizableHandleGrip className="group-has-[:focus-visible]/handle:ring-2 group-has-[:focus-visible]/handle:ring-inset group-has-[:focus-visible]/handle:ring-ring" />
        </Slider.Thumb>
      </Slider.Control>
    </Slider.Root>
  )
}
