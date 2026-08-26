import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  exampleEditorUrl,
  uploadWorkbookForExamplePreview,
} from "@/lib/api/onlyoffice-example"
import { EASE_OUT } from "@/lib/ease"

import { PreviewRequestState } from "../preview-request-state"
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
  const [status, setStatus] = React.useState<"loading" | "ready" | "fallback">(
    "loading"
  )
  const [editorUrl, setEditorUrl] = React.useState<string | null>(null)
  const [fallbackReason, setFallbackReason] = React.useState<string | null>(
    null
  )

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const fail = (reason: string) => {
      if (!cancelled) {
        setEditorUrl(null)
        setFallbackReason(reason)
        setStatus("fallback")
      }
    }

    void (async () => {
      try {
        const bytes = await downloadWorkbookBytes(source, controller.signal)
        const storedName = await uploadWorkbookForExamplePreview({
          fileName,
          mediaType,
          bytes,
          signal: controller.signal,
        })
        if (cancelled) {
          return
        }

        setEditorUrl(exampleEditorUrl(storedName, i18n.language))
      } catch (error) {
        fail(describeUnknownError(error))
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [fileName, filePath, i18n.language, mediaType, source])

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
      {editorUrl ? (
        <iframe
          title={fileName}
          src={editorUrl}
          className="h-full min-h-0 w-full border-0 bg-background"
          onLoad={(event) => {
            if (iframeLooksUnavailable(event.currentTarget)) {
              setEditorUrl(null)
              setFallbackReason("OnlyOffice editor was not found")
              setStatus("fallback")
              return
            }

            setStatus("ready")
          }}
        />
      ) : null}
    </div>
  )
}

async function downloadWorkbookBytes(source: string, signal: AbortSignal) {
  const response = await fetch(source, { cache: "no-store", signal })
  if (!response.ok) {
    throw new Error(response.statusText || `HTTP ${response.status}`)
  }

  return response.arrayBuffer()
}

function iframeLooksUnavailable(frame: HTMLIFrameElement) {
  try {
    const text = frame.contentDocument?.body?.innerText ?? ""
            return (
              text.includes("File not found") ||
              text.includes("Cannot GET")
            )
  } catch {
    return false
  }
}

function describeUnknownError(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "OnlyOffice upload timed out"
  }

  if (error instanceof Error && error.message.trim() !== "") {
    return error.message
  }

  return "OnlyOffice preview failed"
}
