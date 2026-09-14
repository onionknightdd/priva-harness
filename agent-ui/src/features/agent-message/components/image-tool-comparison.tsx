import { Slider } from "@base-ui/react/slider"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { ResizableHandleGrip } from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { FilePathLink } from "@/features/files/file-path-link"
import { getDownloadUrl } from "@/lib/api/sandbox-files"
import { fileNameFromPath } from "@/lib/file-path"
import { cn } from "@/lib/utils"

type ImageToolComparisonProps = {
  before: string
  after: string
  recheckKey?: string
}

type ImageDimensions = { width: number; height: number }

export function ImageToolComparison(props: ImageToolComparisonProps) {
  return <Comparison key={`${props.before}\n${props.after}`} {...props} />
}

function Comparison({ before, after, recheckKey }: ImageToolComparisonProps) {
  const { t } = useTranslation()
  const [position, setPosition] = useState(50)
  const [keyboardChange, setKeyboardChange] = useState(false)
  const [loaded, setLoaded] = useState<{ before: ImageDimensions | null; after: ImageDimensions | null }>({ before: null, after: null })
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const ready = Boolean(loaded.before && loaded.after)
  // Fit both complete images at the preview height. Cap each candidate at its
  // intrinsic width, then use the larger one for the shared canvas.
  const fittedWidth = ({ width, height }: ImageDimensions) => `min(${width}px, calc((var(--image-comparison-height) - 2px) * ${width / height}))`
  const width = loaded.before && loaded.after
    ? `calc(max(${fittedWidth(loaded.before)}, ${fittedWidth(loaded.after)}) + 2px)`
    : undefined
  const src = (path: string) => `${getDownloadUrl(path)}${attempt ? `&retry=${attempt}` : ""}`
  const imageLabels = (
    <div className="relative h-5 min-w-0 overflow-hidden text-xs text-muted-foreground" data-slot="image-edit-file-labels">
      {/* Match the canvas's 1px inset. Each half-width label track follows the
          divider using transform, and stays inside its majority image area. */}
      <div className="absolute inset-x-px inset-y-0">
        {[
          { side: "before", label: t("agentMessage.imageTools.before"), path: before, visible: position > 50 },
          { side: "after", label: t("agentMessage.imageTools.edited"), path: after, visible: position < 50 },
        ].map(({ side, label, path, visible }) => (
          <div
            key={side}
            data-slot="image-comparison-file-label"
            data-side={side}
            aria-hidden={!visible}
            inert={!visible}
            className={cn(
              "absolute top-0 flex h-full w-1/2 min-w-0 items-baseline gap-1.5 transition-opacity duration-160 ease-out motion-reduce:duration-100",
              side === "before" ? "left-0 justify-end pr-1.5" : "left-1/2 pl-1.5"
            )}
            style={{
              transform: `translateX(${position * 2 - 100}%)`,
              opacity: visible ? 1 : 0,
              transitionDuration: keyboardChange ? "0ms" : undefined,
            }}
          >
            <span className="shrink-0">{label}</span>
            <FilePathLink path={path} label={fileNameFromPath(path)} tooltip={path} marquee recheckKey={recheckKey} />
          </div>
        ))}
      </div>
    </div>
  )

  if (failed) {
    return (
      <div className="min-w-0 space-y-1.5">
        {imageLabels}
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:h-64">
          <p role="alert" className="text-sm text-destructive">{t("agentMessage.imageTools.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => {
            setAttempt((value) => value + 1)
            setLoaded({ before: null, after: null })
            setFailed(false)
          }}>{t("agentMessage.imageTools.retryPreview")}</Button>
        </div>
      </div>
    )
  }

  return (
    <Slider.Root
      value={position}
      onValueChange={(value, details) => {
        setPosition(value)
        setKeyboardChange(details.reason === "keyboard")
      }}
      min={0}
      max={100}
      step={0.1}
      disabled={!ready}
      className="w-full max-w-full min-w-0 space-y-1.5 [--image-comparison-height:calc(var(--spacing)*48)] sm:[--image-comparison-height:calc(var(--spacing)*64)]"
      style={{ width }}
      aria-busy={!ready}
    >
      {imageLabels}
      <Slider.Control className="relative h-[var(--image-comparison-height)] w-full cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-lg border border-border bg-background data-disabled:cursor-default">
        <img
          src={src(after)}
          alt={t("agentMessage.imageTools.after")}
          draggable={false}
          className={cn("absolute inset-0 size-full object-contain", !ready && "invisible")}
          onLoad={({ currentTarget }) => setLoaded((value) => ({ ...value, after: { width: currentTarget.naturalWidth, height: currentTarget.naturalHeight } }))}
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
            onLoad={({ currentTarget }) => setLoaded((value) => ({ ...value, before: { width: currentTarget.naturalWidth, height: currentTarget.naturalHeight } }))}
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
