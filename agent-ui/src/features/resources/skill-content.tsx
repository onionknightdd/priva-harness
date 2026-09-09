import * as React from "react"
import { CheckIcon, CopyIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/animate-ui/components/radix/tabs"
import { ResourceIconButton } from "./resource-icon-button"
import { writeClipboardText } from "@/lib/clipboard"
import { PreviewRendererBoundary } from "@/features/files/preview/preview-renderer-boundary"
import { ImageRenderer } from "@/features/files/preview/renderers/image-renderer"
import { MarkdownRenderer } from "@/features/files/preview/renderers/markdown-renderer"
import { SourcePreview } from "@/features/files/preview/source-preview"
import { PreviewSelectionBridgeProvider } from "@/features/files/selection"
import { cn } from "@/lib/utils"
import { errorMessage, resourceRequest, resourceUrl, type ResourceQuery, type SkillDetail } from "./resource-api"
import { ResourceEmpty, ResourceErrorState, ResourceLoading } from "./resource-shared"
import { skillFileKind } from "./skill-file-kind"

const PdfRenderer = React.lazy(async () => ({ default: (await import("@/features/files/preview/renderers/pdf-renderer")).PdfRenderer }))

export const SkillContent = React.memo(function SkillContent({ detail, query, file }: {
  detail: SkillDetail; query: ResourceQuery; file: string
}) {
  const { t } = useTranslation()
  const kind = skillFileKind(file)
  const textAvailable = kind === "markdown" || kind === "text" || /\.svg$/iu.test(file)
  const [mode, setMode] = React.useState("preview")
  const activeMode = textAvailable ? mode : "preview"
  const needsText = textAvailable && (activeMode === "source" || kind !== "image")
  const [loaded, setLoaded] = React.useState<{ file: string; content?: string; error?: string } | null>(null)
  const content = file === "SKILL.md" ? detail.content : loaded?.file === file ? loaded.content : undefined
  const error = loaded?.file === file ? loaded.error : undefined
  React.useEffect(() => {
    if (!needsText || file === "SKILL.md" || content !== undefined) return
    const controller = new AbortController()
    void resourceRequest<{ content: string }>(`skills/${detail.id}/file`, query, { signal: controller.signal }, { path: file }).then(
      (value) => { if (!controller.signal.aborted) React.startTransition(() => setLoaded({ file, content: value.content })) },
      (reason: unknown) => { if (!controller.signal.aborted) setLoaded({ file, error: errorMessage(reason) }) },
    )
    return () => controller.abort()
  }, [file, detail.id, query, needsText, content])
  const source = resourceUrl(`skills/${detail.id}/asset`, query, { path: file })
  const fileId = `${detail.id}:${file}`
  const previewFile = React.useMemo(() => ({ id: fileId, name: file, path: `${detail.path}/${file}`, mediaType: kind === "pdf" ? "application/pdf" : "text/plain" }), [fileId, file, detail.path, kind])
  const textState = error ? <ResourceErrorState message={error} /> : content === undefined ? <ResourceLoading /> : null

  return <Tabs value={activeMode} onValueChange={setMode} className="min-h-0 flex-1 gap-0">
    <div className="flex min-w-0 items-center gap-3 border-b px-5 py-2 sm:px-7" data-skill-file-toolbar>
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={previewFile.path}>{previewFile.path}</p>
      <div className="flex shrink-0 items-center gap-2">
        <SkillCopyButton key={fileId} content={textAvailable ? content : undefined} />
        <TabsList className="h-7 rounded-md p-0.5" aria-label={t("resources.fileMode")}>
          <TabsTrigger className="px-2 py-0.5 text-xs" value="source" disabled={!textAvailable} title={!textAvailable ? t("resources.textOnly") : undefined}>{t("resources.sourceCode")}</TabsTrigger>
          <TabsTrigger className="px-2 py-0.5 text-xs" value="preview">{t("resources.preview")}</TabsTrigger>
        </TabsList>
      </div>
    </div>
    <TabsContent value="source" className="min-h-0 flex-1 overflow-auto">
      {textState ?? <SourcePreview content={content!} fileName={file} highlight={false} />}
    </TabsContent>
    <TabsContent value="preview" className={cn("min-h-0 flex-1", kind === "pdf" ? "overflow-hidden" : "overflow-auto")}>
      <PreviewRendererBoundary key={fileId}>
        <React.Suspense fallback={<ResourceLoading />}>
          {kind === "image" ? <ImageRenderer key={source} source={source} alt={file} />
            : kind === "pdf" ? <PreviewSelectionBridgeProvider activeFile={previewFile} scopeKey={fileId}><PdfRenderer fileId={fileId} source={source} /></PreviewSelectionBridgeProvider>
            : kind === "binary" ? <ResourceEmpty text={t("resources.previewUnavailable")} />
            : textState ?? (kind === "markdown" ? <MarkdownRenderer content={file === "SKILL.md" ? content!.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "") : content!} />
              : <SourcePreview content={content!} fileName={file} />)}
        </React.Suspense>
      </PreviewRendererBoundary>
    </TabsContent>
  </Tabs>
})

function SkillCopyButton({ content }: { content: string | undefined }) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = React.useState<"copied" | "copyFailed" | null>(null)
  React.useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 1600)
    return () => window.clearTimeout(timer)
  }, [feedback])
  const copy = async () => {
    if (content === undefined) return
    try { await writeClipboardText(content); setFeedback("copied") }
    catch { setFeedback("copyFailed") }
  }
  return <>
    <ResourceIconButton aria-label={t("filePreview.copy")} title={t(`filePreview.${feedback ?? "copy"}`)} disabled={content === undefined} onClick={() => void copy()}>
      {feedback === "copied" ? <CheckIcon /> : feedback === "copyFailed" ? <XIcon className="text-destructive" /> : <CopyIcon />}
    </ResourceIconButton>
    <span role="status" className="sr-only">{feedback ? t(`filePreview.${feedback}`) : ""}</span>
  </>
}
