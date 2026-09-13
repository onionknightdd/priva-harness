import { FileIcon, RotateCwIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { SPRING_LAYOUT } from "@/lib/ease"

import {
  formatComposerAttachmentSize,
  isImageAttachment,
  type ComposerAttachment,
} from "../composer-attachments"
import { TooltipHint } from "@/components/ui/tooltip"

export function ComposerAttachmentChips({
  attachments,
  onRemove,
  onRetry,
}: {
  attachments: ComposerAttachment[]
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())

  if (attachments.length === 0) {
    return null
  }

  return (
    <AttachmentGroup className="px-3.5 pt-2">
      <AnimatePresence initial={false}>
        {attachments.map((attachment) => {
          const previewUrl = attachment.previewUrl
          const showImage =
            previewUrl !== null && isImageAttachment(attachment.file)

          return (
            <motion.div
              key={attachment.id}
              layout={!shouldReduceMotion}
              initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={
                shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }
              }
              transition={shouldReduceMotion ? { duration: 0 } : SPRING_LAYOUT}
              className="min-w-0"
            >
              <Attachment size="sm" state={attachment.status}>
                <AttachmentMedia variant={showImage ? "image" : "icon"}>
                  {showImage ? (
                    <img
                      src={previewUrl}
                      alt={attachment.file.name}
                    />
                  ) : (
                    <FileIcon />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle className="motion-reduce:animate-none!">
                    {attachment.file.name}
                  </AttachmentTitle>
                  <TooltipHint content={attachment.error}>
                    <AttachmentDescription role={attachment.status === "error" ? "alert" : undefined}>
                      {attachment.status === "uploading"
                        ? t("uploadQueue.percentage", { percentage: Math.round(attachment.progress) })
                        : attachment.status === "error"
                          ? attachment.error || t("agentMessage.attachmentUploadIncomplete")
                          : formatComposerAttachmentSize(attachment.file.size)}
                    </AttachmentDescription>
                  </TooltipHint>
                </AttachmentContent>
                <AttachmentActions>
                  {attachment.status === "error" ? (
                    <AttachmentAction
                      type="button"
                      aria-label={t("agentMessage.retryAttachment", { name: attachment.file.name })}
                      onClick={() => onRetry(attachment.id)}
                    >
                      <RotateCwIcon />
                    </AttachmentAction>
                  ) : null}
                  <AttachmentAction
                    type="button"
                    aria-label={t("agentMessage.removeAttachment", {
                      name: attachment.file.name,
                    })}
                    onClick={() => onRemove(attachment.id)}
                  >
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </AttachmentGroup>
  )
}
