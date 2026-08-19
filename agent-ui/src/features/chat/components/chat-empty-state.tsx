import { MessageSquareIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export function ChatEmptyState() {
  const { t } = useTranslation()

  return (
    <Empty className="flex-none p-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquareIcon />
        </EmptyMedia>
        <EmptyTitle>{t("chat.emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("chat.emptyDescription")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
