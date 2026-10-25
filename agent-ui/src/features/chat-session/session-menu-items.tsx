import { ArchiveIcon, PinIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"

import { useSessionList } from "./chat-session-context"

/** Shared session actions. The sidebar has its own inline pin trigger;
 * the chat header keeps pinning in this menu. */
export function SessionMenuItems({
  session,
  showPin = true,
}: {
  session: SessionInfo
  showPin?: boolean
}) {
  const { t } = useTranslation()
  const { setPinned, archive, remove } = useSessionList()

  return (
    <>
      {showPin && (
        <>
          <DropdownMenuItem
            onClick={() => {
              void setPinned(session.sessionId, !session.pinned)
            }}
          >
            <PinIcon className={session.pinned ? "fill-current" : undefined} />
            <span>
              {session.pinned
                ? t("sidebar.projects.unpin")
                : t("sidebar.projects.pin")}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        onClick={() => {
          void archive(session.sessionId)
        }}
      >
        <ArchiveIcon />
        <span>{t("sidebar.projects.archive")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        variant="destructive"
        onClick={() => {
          void remove(session.sessionId)
        }}
      >
        <Trash2Icon />
        <span>{t("sidebar.projects.delete")}</span>
      </DropdownMenuItem>
    </>
  )
}
