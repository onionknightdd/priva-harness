import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { createOfficePreviewSession } from "@/lib/api/sandbox-office"
import { EASE_OUT } from "@/lib/ease"

import { PreviewRequestState } from "../preview-request-state"
import {
  createOnlyOfficeEditor,
  loadOnlyOfficeApi,
} from "./onlyoffice-api"
import { SpreadsheetRenderer } from "./spreadsheet-renderer"

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
        setStatus((current) => (current === "loading" ? "fallback" : current))
      }
    }, 12_000)

    const destroyEditor = () => {
      editorRef.current?.destroyEditor()
      editorRef.current = null
    }

    void (async () => {
      try {
        const session = await createOfficePreviewSession(
          filePath,
          controller.signal
        )
        const docsApi = await loadOnlyOfficeApi(session.documentServerUrl)
        if (cancelled) {
          return
        }

        editorRef.current = createOnlyOfficeEditor(docsApi, placeholder.id, {
          documentType: "cell",
          width: "100%",
          height: "100%",
          document: session.document,
          editorConfig: {
            mode: "view",
            lang: i18n.language.startsWith("zh") ? "zh" : "en",
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
            onError: () => {
              if (!cancelled) {
                setStatus("fallback")
              }
            },
          },
        })
      } catch {
        if (!cancelled) {
          setStatus("fallback")
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timeout)
      destroyEditor()
      host.replaceChildren()
    }
  }, [filePath, i18n.language, placeholderId])

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
          {t("filePreview.officeFallback")}
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
