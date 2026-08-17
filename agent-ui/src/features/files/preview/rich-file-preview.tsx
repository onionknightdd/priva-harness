import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import {
  canRenderFile,
  canShowFileSource,
  type FilePreviewMode,
  type PreviewFile,
} from "@/features/files/model/file.types"
import { cn } from "@/lib/utils"

import { FilePreviewToolbar } from "./file-preview-toolbar"
import { ImageRenderer } from "./renderers/image-renderer"
import { JsonRenderer } from "./renderers/json-renderer"
import { MarkdownRenderer } from "./renderers/markdown-renderer"
import { SourcePreview } from "./source-preview"
import { UnsupportedPreview } from "./unsupported-preview"

function getAvailableMode(
  file: PreviewFile | null,
  preferredMode: FilePreviewMode
): FilePreviewMode | null {
  if (preferredMode === "source" && canShowFileSource(file)) {
    return "source"
  }

  if (preferredMode === "render" && canRenderFile(file)) {
    return "render"
  }

  if (canShowFileSource(file)) {
    return "source"
  }

  return canRenderFile(file) ? "render" : null
}

function RenderedFile({ file }: { file: PreviewFile }) {
  if (!file.renderKind) {
    return <UnsupportedPreview hasFile />
  }

  if (file.renderKind === "markdown" && file.content !== undefined) {
    return <MarkdownRenderer content={file.content} />
  }

  if (file.renderKind === "json" && file.content !== undefined) {
    return <JsonRenderer content={file.content} />
  }

  if (file.renderKind === "image" && file.renderSource) {
    return <ImageRenderer source={file.renderSource} alt={file.name} />
  }

  return <UnsupportedPreview hasFile />
}

export function RichFilePreview({
  className,
  expanded = false,
  file,
  mode,
  onExpandedChange,
  onModeChange,
}: {
  className?: string
  expanded?: boolean
  file: PreviewFile | null
  mode?: FilePreviewMode
  onExpandedChange?: (expanded: boolean) => void
  onModeChange?: (mode: FilePreviewMode) => void
}) {
  const { t } = useTranslation()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [internalMode, setInternalMode] =
    React.useState<FilePreviewMode>("source")
  const preferredMode = mode ?? internalMode
  const activeMode = getAvailableMode(file, preferredMode)
  const sourceAvailable = canShowFileSource(file)
  const renderAvailable = canRenderFile(file)

  React.useLayoutEffect(() => {
    const content = contentRef.current

    if (
      !content ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        content,
        { opacity: 0, y: 5 },
        {
          opacity: 1,
          y: 0,
          duration: 0.22,
          ease: "power2.out",
          clearProps: "transform,opacity",
        }
      )
    }, content)

    return () => context.revert()
  }, [activeMode, file?.id])

  const handleModeChange = (nextMode: FilePreviewMode) => {
    setInternalMode(nextMode)
    onModeChange?.(nextMode)
  }

  return (
    <section
      aria-label={t("filePreview.label")}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col bg-card text-card-foreground",
        className
      )}
    >
      <FilePreviewToolbar
        expanded={expanded}
        fileName={file?.name}
        mode={activeMode}
        onExpandedChange={onExpandedChange}
        onModeChange={handleModeChange}
        renderAvailable={renderAvailable}
        sourceAvailable={sourceAvailable}
      />
      <div ref={contentRef} className="min-h-0 flex-1 overflow-auto">
        {!file ? (
          <UnsupportedPreview hasFile={false} />
        ) : activeMode === "source" && file.content !== undefined ? (
          <SourcePreview content={file.content} fileName={file.name} />
        ) : (
          <RenderedFile file={file} />
        )}
      </div>
    </section>
  )
}
