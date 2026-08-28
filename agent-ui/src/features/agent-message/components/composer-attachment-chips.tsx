import { FileIcon, XIcon } from "lucide-react"
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

export function ComposerAttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[]
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())

  if (attachments.length === 0) {
    return null
  }

  return (
    <AttachmentGroup className="px-3.5 pt-3">
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
              <Attachment size="sm" state="done">
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
                  <AttachmentTitle>{attachment.file.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {formatComposerAttachmentSize(attachment.file.size)}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
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
