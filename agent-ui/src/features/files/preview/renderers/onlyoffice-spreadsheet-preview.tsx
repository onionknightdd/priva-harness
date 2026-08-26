import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  createLocalOnlyOfficePreviewSession,
  exampleCallbackUrl,
} from "@/lib/api/onlyoffice-example"
import {
  createOfficePreviewSession,
  type OfficePreviewSession,
} from "@/lib/api/sandbox-office"
import { EASE_OUT } from "@/lib/ease"

import { PreviewRequestState } from "../preview-request-state"
import {
  createOnlyOfficeEditor,
  loadOnlyOfficeApi,
} from "./onlyoffice-api"
import { SpreadsheetRenderer } from "./spreadsheet-renderer"

const EDITOR_READY_TIMEOUT_MS = 45_000

export function OnlyOfficeSpreadsheetPreview({
  fileId,
  fileName,
  filePath,
  mediaType,
  source,
}: {
  fileId: string
  fileName: string
  filePath: string
  mediaType: string
  source: string
}) {
  const { t, i18n } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const placeholderId = React.useId().replace(/:/g, "")
  const hostRef = React.useRef<HTMLDivElement>(null)
  const editorRef = React.useRef<{ destroyEditor: () => void } | null>(null)
  const [status, setStatus] = React.useState<"loading" | "ready" | "fallback">(
    "loading"
  )
  const [fallbackReason, setFallbackReason] = React.useState<string | null>(
    null
  )

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const placeholder = document.createElement("div")
    placeholder.id = `onlyoffice-${placeholderId}`
    placeholder.className = "h-full min-h-0 w-full"
    host.replaceChildren(placeholder)

    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setFallbackReason("timed out")
        setStatus((current) => (current === "loading" ? "fallback" : current))
      }
    }, EDITOR_READY_TIMEOUT_MS)

    const destroyEditor = () => {
      editorRef.current?.destroyEditor()
      editorRef.current = null
    }

    const fail = (reason: string) => {
      if (!cancelled) {
        setFallbackReason(reason)
        setStatus("fallback")
      }
    }

    void (async () => {
      try {
        const session = await resolveOfficePreviewSession({
          fileName,
          filePath,
          mediaType,
          source,
          signal: controller.signal,
        })
        const docsApi = await loadOnlyOfficeApi(session.documentServerUrl)
        if (cancelled) {
          return
        }

        editorRef.current = createOnlyOfficeEditor(docsApi, placeholder.id, {
          documentType: "cell",
          width: "100%",
          height: "100%",
          document: {
            ...session.document,
            permissions: {
              comment: false,
              download: true,
              edit: false,
              print: true,
              review: false,
            },
          },
          editorConfig: {
            mode: "view",
            lang: i18n.language.startsWith("zh") ? "zh-CN" : "en",
            callbackUrl: exampleCallbackUrl(session.document.title),
            user: {
              id: "preview",
              name: "Preview",
            },
            customization: {
              anonymous: { request: false },
              compactHeader: true,
              compactToolbar: true,
              hideRightMenu: true,
              hideRulers: true,
              toolbarNoTabs: true,
            },
          },
          events: {
            onAppReady: () => {
              if (!cancelled) {
                setStatus((current) =>
                  current === "fallback" ? current : "ready"
                )
              }
            },
            onDocumentReady: () => {
              if (!cancelled) {
                setStatus((current) =>
                  current === "fallback" ? current : "ready"
                )
              }
            },
            onError: (event) => {
              fail(describeEditorError(event))
            },
          },
        })
      } catch (error) {
        fail(describeUnknownError(error))
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timeout)
      destroyEditor()
      host.replaceChildren()
    }
  }, [fileName, filePath, i18n.language, mediaType, placeholderId, source])

  React.useEffect(() => {
    if (status !== "fallback") {
      return
    }

    editorRef.current?.destroyEditor()
    editorRef.current = null
  }, [status])

  if (status === "fallback") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <motion.p
          role="status"
          className="shrink-0 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: EASE_OUT }}
        >
          {fallbackReason
            ? t("filePreview.officeFallbackWithReason", {
                reason: fallbackReason,
              })
            : t("filePreview.officeFallback")}
        </motion.p>
        <div className="min-h-0 flex-1">
          <SpreadsheetRenderer
            fileId={fileId}
            fileName={fileName}
            mediaType={mediaType}
            source={source}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 w-full bg-background">
      {status === "loading" ? (
        <div className="absolute inset-0 z-10 bg-card">
          <PreviewRequestState loading />
        </div>
      ) : null}
      <div ref={hostRef} className="h-full min-h-0 w-full" />
    </div>
  )
}

async function resolveOfficePreviewSession(input: {
  fileName: string
  filePath: string
  mediaType: string
  source: string
  signal: AbortSignal
}): Promise<OfficePreviewSession> {
  const bytes = await downloadWorkbookBytes(input.source, input.signal)

  try {
    return await createLocalOnlyOfficePreviewSession({
      fileName: input.fileName,
      filePath: input.filePath,
      mediaType: input.mediaType,
      bytes,
      signal: input.signal,
    })
  } catch (error) {
    if (input.signal.aborted) {
      throw error
    }
  }

  return createOfficePreviewSession(input.filePath, input.signal)
}

async function downloadWorkbookBytes(source: string, signal: AbortSignal) {
  const response = await fetch(source, { cache: "no-store", signal })
  if (!response.ok) {
    throw new Error(response.statusText || `HTTP ${response.status}`)
  }

  return response.arrayBuffer()
}

function describeEditorError(event: {
  data?: { errorCode?: number; errorDescription?: string } | number
}) {
  const data = event.data
  if (typeof data === "number") {
    return `OnlyOffice error ${data}`
  }

  if (typeof data?.errorCode === "number") {
    const description = data.errorDescription?.trim()
    return description
      ? `OnlyOffice error ${data.errorCode}: ${description}`
      : `OnlyOffice error ${data.errorCode}`
  }

  return "OnlyOffice editor failed"
}

function describeUnknownError(error: unknown) {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message
  }

  return "OnlyOffice preview failed"
}
