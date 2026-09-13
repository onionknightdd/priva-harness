import { ArchiveIcon, PinIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"

import { useSessionList } from "./chat-session-context"

/** The session "⋯" menu body, shared by the sidebar row and the chat header
 * so both places offer the same actions in the same order. Render inside a
 * `DropdownMenuContent`. */
export function SessionMenuItems({ session }: { session: SessionInfo }) {
  const { t } = useTranslation()
  const { setPinned, archive, remove } = useSessionList()

  return (
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
