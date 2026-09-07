import { useTranslation } from "react-i18next"

import { FilePathLink } from "@/features/files/file-path-link"

import type { MessageAttachment } from "../message-attachment"

export function UserMessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const { t } = useTranslation()
  return (
    <div role="list" aria-label={t("agentMessage.messageAttachments")} className="flex min-w-0 flex-wrap gap-x-3 gap-y-2 whitespace-normal">
      {attachments.map((attachment) => (
        <span role="listitem" key={attachment.path} className="min-w-0 max-w-full">
          <FilePathLink path={attachment.path} label={attachment.name} showIcon variant="code" />
        </span>
      ))}
    </div>
  )
}
