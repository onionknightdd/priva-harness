import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import {
  Tabs,
  TabsContent,
} from "@/components/assistant-ui/tabs"
import {
  canEditHtmlFile,
  canRenderFile,
  canShowFileSource,
  type FilePreviewMode,
  type PreviewFile,
} from "@/features/files/model/file.types"
import {
  PreviewSelectionBridgeProvider,
  type PreviewSelection,
} from "@/features/files/selection"
import { cn } from "@/lib/utils"

import { downloadTextFile } from "./download-text-file"
import { FilePreviewToolbar } from "./file-preview-toolbar"
import { PreviewRendererBoundary } from "./preview-renderer-boundary"
import { PreviewRequestState } from "./preview-request-state"
import { HtmlRenderer } from "./renderers/html-renderer"
import { ImageRenderer } from "./renderers/image-renderer"
import { JsonRenderer } from "./renderers/json-renderer"
import { MarkdownRenderer } from "./renderers/markdown-renderer"
import { SourcePreview } from "./source-preview"
import { UnsupportedPreview } from "./unsupported-preview"

const DocumentRenderer = React.lazy(() =>
  import("./renderers/document-renderer").then((module) => ({
    default: module.DocumentRenderer,
  }))
)
const PdfRenderer = React.lazy(() =>
  import("./renderers/pdf-renderer").then((module) => ({
    default: module.PdfRenderer,
  }))
)
const PresentationRenderer = React.lazy(() =>
  import("./renderers/presentation-renderer").then((module) => ({
    default: module.PresentationRenderer,
  }))
)
const SpreadsheetRenderer = React.lazy(() =>
  import("./renderers/spreadsheet-renderer").then((module) => ({
    default: module.SpreadsheetRenderer,
  }))
)
const HtmlVisualEditor = React.lazy(() =>
  import("./renderers/html-visual-editor").then((module) => ({
    default: module.HtmlVisualEditor,
  }))
)

function withDraftContent(
  file: PreviewFile,
  drafts: Record<string, string>
) {
  const draft = drafts[file.id]
  return draft === undefined ? file : { ...file, content: draft }
}

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

  if (preferredMode === "edit" && canEditHtmlFile(file)) {
    return "edit"
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

  if (file.renderKind === "html" && file.content !== undefined) {
    return <HtmlRenderer content={file.content} fileName={file.name} />
  }

  if (file.renderKind === "image" && file.renderSource) {
    return <ImageRenderer source={file.renderSource} alt={file.name} />
  }

  if (file.renderKind === "spreadsheet" && file.renderSource) {
    return (
      <SpreadsheetRenderer
        fileId={file.id}
        fileName={file.name}
        mediaType={file.mediaType}
        source={file.renderSource}
      />
    )
  }

  if (file.renderKind === "document" && file.renderSource) {
    return <DocumentRenderer fileId={file.id} source={file.renderSource} />
  }

  if (file.renderKind === "presentation" && file.renderSource) {
    return (
      <PresentationRenderer fileId={file.id} source={file.renderSource} />
    )
  }

  if (file.renderKind === "pdf" && file.renderSource) {
    return <PdfRenderer fileId={file.id} source={file.renderSource} />
  }

  return <UnsupportedPreview hasFile />
}

function FilePreviewPanel({
  active,
  file,
  mode,
  onHtmlChange,
}: {
  active: boolean
  file: PreviewFile
  mode: FilePreviewMode | null
  onHtmlChange: (content: string) => void
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const usesInternalScroller =
    file.status !== "loading" &&
    file.status !== "error" &&
    (mode === "edit" ||
      (mode === "render" &&
        [
          "document",
          "html",
          "pdf",
          "presentation",
          "spreadsheet",
        ].includes(file.renderKind ?? "")))

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
      className={cn(
        "min-h-0 flex-1 overscroll-contain data-hidden:hidden",
        !active && "hidden",
        usesInternalScroller ? "overflow-hidden" : "overflow-auto"
      )}
    >
      <div
        ref={contentRef}
        className={cn(
          "relative min-h-full bg-card",
          usesInternalScroller && "h-full"
        )}
      >
        {file.status === "loading" ? (
          <PreviewRequestState loading />
        ) : file.status === "error" ? (
          <PreviewRequestState error={file.error} />
        ) : !active ? null : mode === "source" && file.content !== undefined ? (
          <SourcePreview content={file.content} fileName={file.name} />
        ) : mode === "edit" && file.content !== undefined ? (
          <PreviewRendererBoundary key={`${file.id}:html-edit`}>
            <React.Suspense fallback={<PreviewRequestState loading />}>
              <HtmlVisualEditor
                content={file.content}
                fileName={file.name}
                onChange={onHtmlChange}
              />
            </React.Suspense>
          </PreviewRendererBoundary>
        ) : mode === "edit" ? null : (
          <PreviewRendererBoundary
            key={`${file.id}:${file.renderSource ?? "inline"}`}
          >
            <React.Suspense fallback={<PreviewRequestState loading />}>
              <RenderedFile file={file} />
            </React.Suspense>
          </PreviewRendererBoundary>
        )}
      </div>
    </TabsContent>
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
  onSaveHtml,
  onSelectionChange,
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
  onSaveHtml?: (file: PreviewFile) => Promise<{ fileName: string }>
  onSelectionChange?: (selection: PreviewSelection | null) => void
}) {
  const { t } = useTranslation()
  const [internalMode, setInternalMode] =
    React.useState<FilePreviewMode>("source")
  const [drafts, setDrafts] = React.useState<Record<string, string>>(
    {}
  )
  const preferredMode = mode ?? internalMode
  const previewFiles = files.map((file) => withDraftContent(file, drafts))
  const activeFile =
    previewFiles.find((file) => file.id === activeFileId) ?? null
  const activeMode = getAvailableMode(activeFile, preferredMode)
  const sourceAvailable = canShowFileSource(activeFile)
  const renderAvailable = canRenderFile(activeFile)
  const editAvailable = canEditHtmlFile(activeFile)

  const handleModeChange = (nextMode: FilePreviewMode) => {
    setInternalMode(nextMode)
    onModeChange?.(nextMode)
  }

  const handleHtmlChange = React.useCallback(
    (fileId: string, content: string) => {
      setDrafts((currentDrafts) =>
        currentDrafts[fileId] === content
          ? currentDrafts
          : { ...currentDrafts, [fileId]: content }
      )
    },
    []
  )

  const handleFileClose = (fileId: string) => {
    setDrafts((currentDrafts) => {
      if (!(fileId in currentDrafts)) {
        return currentDrafts
      }

      const nextDrafts = { ...currentDrafts }
      delete nextDrafts[fileId]
      return nextDrafts
    })
    onFileClose(fileId)
  }

  const handleCloseAll = () => {
    setDrafts({})
    onCloseAll()
  }

  const handleDownload = (file: PreviewFile) => {
    const draft = drafts[file.id]

    if (draft !== undefined) {
      downloadTextFile(file.name, draft, file.mediaType || "text/html")
      return
    }

    if (onDownload) {
      onDownload(file)
      return
    }

    if (file.content !== undefined) {
      downloadTextFile(
        file.name,
        file.content,
        file.mediaType || "text/plain"
      )
    }
  }

  return (
    <section
      aria-label={t("filePreview.label")}
      className={cn(
        "rich-file-preview flex min-h-0 min-w-0 flex-1 flex-col bg-card text-card-foreground",
        className
      )}
    >
      <PreviewSelectionBridgeProvider
        activeFile={activeFile}
        onSelectionChange={onSelectionChange}
        scopeKey={`${activeFile?.id ?? "none"}:${activeMode ?? "none"}`}
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
            editAvailable={editAvailable}
            expanded={expanded}
            files={previewFiles}
            mode={activeMode}
            onCloseAll={handleCloseAll}
            onFileClose={handleFileClose}
            onDownload={handleDownload}
            onExpandedChange={onExpandedChange}
            onModeChange={handleModeChange}
            onSave={onSaveHtml}
            renderAvailable={renderAvailable}
            sourceAvailable={sourceAvailable}
          />

          {previewFiles.length > 0 ? (
            previewFiles.map((file) => (
              <FilePreviewPanel
                key={file.id}
                active={file.id === activeFileId}
                file={file}
                mode={getAvailableMode(file, preferredMode)}
                onHtmlChange={(content) => handleHtmlChange(file.id, content)}
              />
            ))
          ) : (
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <UnsupportedPreview hasFile={false} />
            </div>
          )}
        </Tabs>
      </PreviewSelectionBridgeProvider>
    </section>
  )
}
