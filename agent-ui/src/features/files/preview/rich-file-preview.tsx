import * as React from "react"
import gsap from "gsap"
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Tabs,
  TabsContent,
} from "@/components/assistant-ui/tabs"
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

function FilePreviewPanel({
  active,
  file,
  mode,
}: {
  active: boolean
  file: PreviewFile
  mode: FilePreviewMode | null
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const content = contentRef.current

    if (
      !active ||
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
  }, [active, file.id, mode])

  return (
    <TabsContent
      value={file.id}
      className="min-h-0 flex-1 overflow-auto overscroll-contain"
    >
      <div ref={contentRef} className="min-h-full">
        {file.status === "loading" ? (
          <PreviewRequestState loading />
        ) : file.status === "error" ? (
          <PreviewRequestState error={file.error} />
        ) : mode === "source" && file.content !== undefined ? (
          <SourcePreview content={file.content} fileName={file.name} />
        ) : (
          <RenderedFile file={file} />
        )}
      </div>
    </TabsContent>
  )
}

function PreviewRequestState({
  error,
  loading = false,
}: {
  error?: string
  loading?: boolean
}) {
  const { t } = useTranslation()
  const Icon = loading ? LoaderCircleIcon : TriangleAlertIcon

  return (
    <div
      role={loading ? "status" : "alert"}
      className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon
          aria-hidden="true"
          className={loading ? "size-5 animate-spin motion-reduce:animate-none" : "size-5"}
          strokeWidth={1.5}
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {t(
            loading
              ? "filePreview.loadingTitle"
              : "filePreview.loadFailedTitle"
          )}
        </p>
        {!loading && (
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {error || t("filePreview.loadFailedDescription")}
          </p>
        )}
      </div>
    </div>
  )
}

export function RichFilePreview({
  activeFileId,
  className,
  expanded = false,
  files,
  mode,
  onActiveFileChange,
  onCloseAll,
  onFileClose,
  onDownload,
  onExpandedChange,
  onModeChange,
}: {
  activeFileId: string | null
  className?: string
  expanded?: boolean
  files: PreviewFile[]
  mode?: FilePreviewMode
  onActiveFileChange: (fileId: string) => void
  onCloseAll: () => void
  onFileClose: (fileId: string) => void
  onDownload?: (file: PreviewFile) => void
  onExpandedChange?: (expanded: boolean) => void
  onModeChange?: (mode: FilePreviewMode) => void
}) {
  const { t } = useTranslation()
  const [internalMode, setInternalMode] =
    React.useState<FilePreviewMode>("source")
  const preferredMode = mode ?? internalMode
  const activeFile =
    files.find((file) => file.id === activeFileId) ?? null
  const activeMode = getAvailableMode(activeFile, preferredMode)
  const sourceAvailable = canShowFileSource(activeFile)
  const renderAvailable = canRenderFile(activeFile)

  const handleModeChange = (nextMode: FilePreviewMode) => {
    setInternalMode(nextMode)
    onModeChange?.(nextMode)
  }

  return (
    <section
      aria-label={t("filePreview.label")}
      className={cn(
        "rich-file-preview flex min-h-0 min-w-0 flex-1 flex-col bg-card text-card-foreground",
        className
      )}
    >
      <Tabs
        value={activeFileId ?? ""}
        onValueChange={(fileId) => {
          if (files.some((file) => file.id === fileId)) {
            onActiveFileChange(fileId)
          }
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <FilePreviewToolbar
          activeFile={activeFile}
          expanded={expanded}
          files={files}
          mode={activeMode}
          onCloseAll={onCloseAll}
          onFileClose={onFileClose}
          onDownload={onDownload}
          onExpandedChange={onExpandedChange}
          onModeChange={handleModeChange}
          renderAvailable={renderAvailable}
          sourceAvailable={sourceAvailable}
        />

        {files.length > 0 ? (
          files.map((file) => (
            <FilePreviewPanel
              key={file.id}
              active={file.id === activeFileId}
              file={file}
              mode={getAvailableMode(file, preferredMode)}
            />
          ))
        ) : (
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <UnsupportedPreview hasFile={false} />
          </div>
        )}
      </Tabs>
    </section>
  )
}
