"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { ExternalLinkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { writeClipboardText } from "@/lib/clipboard"

function StreamdownLinkSafetyModal({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps) {
  const { t } = useTranslation()
  const [copyState, setCopyState] = React.useState<
    "idle" | "copied" | "failed"
  >("idle")
  const resetTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!isOpen) {
      setCopyState("idle")
    }
  }, [isOpen])

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  if (!isOpen) {
    return null
  }

  return createPortal(
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLinkIcon className="size-4" aria-hidden="true" />
            {t("common.openExternalLink")}
          </DialogTitle>
          <DialogDescription>
            {t("common.externalLinkWarning")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-32 overflow-y-auto break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void writeClipboardText(url)
                .then(() => {
                  setCopyState("copied")
                })
                .catch(() => {
                  setCopyState("failed")
                })
                .finally(() => {
                  if (resetTimerRef.current !== null) {
                    window.clearTimeout(resetTimerRef.current)
                  }

                  resetTimerRef.current = window.setTimeout(() => {
                    setCopyState("idle")
                    resetTimerRef.current = null
                  }, 1600)
                })
            }}
          >
            {copyState === "copied"
              ? t("common.copied")
              : copyState === "failed"
                ? t("common.copyFailed")
                : t("common.copyLink")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {t("common.openLink")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
    document.body
  )
}

export const streamdownLinkSafety: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <StreamdownLinkSafetyModal {...props} />,
}
