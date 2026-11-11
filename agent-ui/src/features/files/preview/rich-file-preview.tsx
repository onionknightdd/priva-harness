import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import { Tabs } from "@/components/motion/tabs"
import {
  canRenderFile,
  canShowAgentAssist,
  canShowFileSource,
  canUseAgentAssist,
  type FilePreviewMode,
  type PreviewFile,
} from "@/features/files/model/file.types"
import {
  PreviewSelectionBridgeProvider,
  type PreviewSelection,
} from "@/features/files/selection"
import { cn } from "@/lib/utils"

import { SourceSelectionActions } from "../selection/source-selection-actions"
import { FileAssistProvider } from "../element-assist/file-assist-provider"
import { downloadTextFile } from "./download-text-file"
import { FilePreviewToolbar } from "./file-preview-toolbar"
import { PreviewRendererBoundary } from "./preview-renderer-boundary"
import { PreviewRequestState } from "./preview-request-state"
import { HtmlRenderer } from "./renderers/html-renderer"
import { ImageRenderer } from "./renderers/image-renderer"
import { JsonRenderer } from "./renderers/json-renderer"
import { MarkdownRenderer } from "./renderers/markdown-renderer"
import { isCsvSource } from "./renderers/spreadsheet-source"
import { SourcePreview } from "./source-preview"
import { UnsupportedPreview } from "./unsupported-preview"
import type { ModelViewState } from "./model/model-renderer"

const ModelRenderer = React.lazy(() => import("./model/model-renderer").then((module) => ({ default: module.ModelRenderer })))

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

  if (preferredMode === "edit" && canUseAgentAssist(file)) {
    return "edit"
  }

  if (canShowFileSource(file)) {
    return "source"
  }

  return canRenderFile(file) ? "render" : null
}

function RenderedFile({ file, visible, modelViews }: { file: PreviewFile; visible: boolean; modelViews: Map<string, ModelViewState> }) {
  if (!file.renderKind) {
    return <UnsupportedPreview hasFile />
  }

  if (file.renderKind === "model" && file.renderSource) {
    return <ModelRenderer file={file} active={visible} viewStates={modelViews} />
  }

  if (file.renderKind === "markdown" && file.content !== undefined) {
    return <MarkdownRenderer content={file.content} />
  }

  if (file.renderKind === "json" && file.content !== undefined) {
    return <JsonRenderer content={file.content} />
  }

  if (file.renderKind === "html" && file.content !== undefined) {
    return <HtmlRenderer fileId={file.id} content={file.content} fileName={file.name} />
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
  visible,
  modelViews,
  file,
  fileTabsId,
  mode,
}: {
  active: boolean
  visible: boolean
  modelViews: Map<string, ModelViewState>
  file: PreviewFile
  fileTabsId: string
  mode: FilePreviewMode | null
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const showsSource = mode === "source" && file.content !== undefined
  // A DOCX is laid out on the main thread when its renderer mounts. Once shown,
  // its view stays mounted behind the other file tabs so that returning to it
  // does not parse and lay out the whole document again.
  const [documentShown, setDocumentShown] = React.useState(false)
  const keepsDocument = file.renderKind === "document" && !showsSource
  const nextDocumentShown = keepsDocument && (active || documentShown)
  if (nextDocumentShown !== documentShown) {
    setDocumentShown(nextDocumentShown)
  }
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
          "model",
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
    <div
      id={`${fileTabsId}-panel-${encodeURIComponent(file.id)}`}
      role="tabpanel"
      aria-labelledby={`${fileTabsId}-tab-${encodeURIComponent(file.id)}`}
      hidden={!active}
      tabIndex={active ? 0 : -1}
      className={cn(
        "min-h-0 flex-1 overscroll-contain outline-none",
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
          <PreviewRequestState error={file.error} reason={file.previewError} />
        ) : !active && !documentShown ? null : mode === "source" && file.content !== undefined ? (
          !canShowAgentAssist(file) && !isCsvSource(file.name, file.mediaType) ? (
            <SourceSelectionActions filePath={file.path} content={file.content}>
              <SourcePreview content={file.content} fileName={file.name} />
            </SourceSelectionActions>
          ) : (
            <SourcePreview content={file.content} fileName={file.name} />
          )
        ) : (
          <PreviewRendererBoundary
            key={`${file.id}:${file.renderSource ?? "inline"}`}
          >
            <React.Suspense fallback={<PreviewRequestState loading />}>
              <RenderedFile file={file} visible={visible} modelViews={modelViews} />
            </React.Suspense>
          </PreviewRendererBoundary>
        )}
      </div>
    </div>
  )
}

export function RichFilePreview({
  active = true,
  activeFileId,
  className,
  compact = false,
  expanded = false,
  files,
  mode,
  onActiveFileChange,
  onCloseAll,
  onFileClose,
  onDownload,
  onExpandedChange,
  onModeChange,
  onSelectionChange,
}: {
  active?: boolean
  activeFileId: string | null
  className?: string
  compact?: boolean
  expanded?: boolean
  files: PreviewFile[]
  mode?: FilePreviewMode
  onActiveFileChange: (fileId: string) => void
  onCloseAll: () => void
  onFileClose: (fileId: string) => void
  onDownload?: (file: PreviewFile) => void
  onExpandedChange?: (expanded: boolean) => void
  onModeChange?: (mode: FilePreviewMode) => void
  onSelectionChange?: (selection: PreviewSelection | null) => void
}) {
  const { t } = useTranslation()
  const fileTabsId = React.useId()
  const modelViews = React.useRef(new Map<string, ModelViewState>())
  React.useEffect(() => {
    const open = new Set(files.map((file) => file.id))
    for (const id of modelViews.current.keys()) if (!open.has(id)) modelViews.current.delete(id)
  }, [files])
  const [internalMode, setInternalMode] =
    React.useState<FilePreviewMode>("source")
  const preferredMode = mode ?? internalMode
  const activeFile =
    files.find((file) => file.id === activeFileId) ?? null
  const activeMode = getAvailableMode(activeFile, preferredMode)
  const sourceAvailable = canShowFileSource(activeFile)
  const renderAvailable = canRenderFile(activeFile)
  const agentAssistVisible = canShowAgentAssist(activeFile)
  const editAvailable = canUseAgentAssist(activeFile)

  const handleModeChange = (nextMode: FilePreviewMode) => {
    setInternalMode(nextMode)
    onModeChange?.(nextMode)
  }

  const handleDownload = (file: PreviewFile) => {
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
      <FileAssistProvider active={active} activeFile={activeFile} files={files} mode={activeMode}>
      <PreviewSelectionBridgeProvider
        activeFile={activeFile}
        onSelectionChange={onSelectionChange}
        scopeKey={`${activeFile?.id ?? "none"}:${activeMode ?? "none"}`}
      >
        <Tabs
          variant="underline"
          value={activeFileId ?? ""}
          onValueChange={(fileId) => {
            if (files.some((file) => file.id === fileId)) {
              onActiveFileChange(fileId)
            }
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <FilePreviewToolbar
            activeFile={activeFile}
            agentAssistVisible={agentAssistVisible}
            compact={compact}
            editAvailable={editAvailable}
            expanded={expanded}
            fileTabsId={fileTabsId}
            files={files}
            mode={activeMode}
            onCloseAll={onCloseAll}
            onFileClose={onFileClose}
            onDownload={handleDownload}
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
                visible={active && file.id === activeFileId}
                modelViews={modelViews.current}
                file={file}
                fileTabsId={fileTabsId}
                mode={getAvailableMode(file, preferredMode)}
              />
            ))
          ) : (
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <UnsupportedPreview hasFile={false} />
            </div>
          )}
        </Tabs>
      </PreviewSelectionBridgeProvider>
      </FileAssistProvider>
    </section>
  )
}
