import { useTranslation } from "react-i18next"

import { FilePathLink } from "@/features/files/file-path-link"
import { getDownloadUrl } from "@/lib/api/sandbox-files"

import type { MessageAttachment } from "../message-attachment"

export function UserMessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const { t } = useTranslation()
  return (
    <div role="list" aria-label={t("agentMessage.messageAttachments")} className="flex min-w-0 flex-wrap gap-x-3 gap-y-2 whitespace-normal">
      {attachments.map((attachment) => (
        <span role="listitem" key={attachment.path} className="min-w-0 max-w-full">
          {attachment.mimeType.startsWith("image/") ? (
            <img
              src={getDownloadUrl(attachment.path)}
              alt={attachment.name}
              className="max-h-24 max-w-full rounded-md border border-border object-contain"
            />
          ) : (
            <FilePathLink path={attachment.path} label={attachment.name} showIcon variant="code" />
          )}
        </span>
      ))}
    </div>
  )
}
