import * as React from "react"
import gsap from "gsap"
import { RefreshCwIcon, SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { fileBrowserItemCount } from "../file-browser-data"
import { FileBrowserTree } from "./file-browser-tree"

export function FileTreePane({
  onItemSelect,
  selectedItemId,
}: {
  onItemSelect: (itemId: string) => void
  selectedItemId: string
}) {
  const { t } = useTranslation()
  const refreshIconRef = React.useRef<SVGSVGElement>(null)
  const announcementTimerRef = React.useRef<number | null>(null)
  const [query, setQuery] = React.useState("")
  const [refreshVersion, setRefreshVersion] = React.useState(0)
  const [announcement, setAnnouncement] = React.useState("")

  React.useEffect(
    () => () => {
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current)
      }
    },
    []
  )

  const handleRefresh = () => {
    setRefreshVersion((version) => version + 1)
    setAnnouncement(t("fileBrowser.refreshed"))

    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current)
    }

    announcementTimerRef.current = window.setTimeout(
      () => setAnnouncement(""),
      1200
    )

    if (
      refreshIconRef.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      gsap.fromTo(
        refreshIconRef.current,
        { rotate: 0 },
        {
          rotate: 360,
          duration: 0.45,
          ease: "power2.out",
          clearProps: "transform",
        }
      )
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b p-1.5">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("fileBrowser.searchLabel")}
            placeholder={t("fileBrowser.searchPlaceholder")}
            className="h-8 border-0 bg-muted/40 pl-8 text-xs shadow-none focus-visible:ring-2"
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("fileBrowser.refresh")}
                onClick={handleRefresh}
              />
            }
          >
            <RefreshCwIcon ref={refreshIconRef} />
          </TooltipTrigger>
          <TooltipContent>{t("fileBrowser.refresh")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <FileBrowserTree
          key={refreshVersion}
          query={query}
          selectedItemId={selectedItemId}
          onItemSelect={onItemSelect}
        />
      </div>
      <div className="flex h-9 shrink-0 items-center border-t px-3 text-xs text-muted-foreground">
        {t("fileBrowser.itemCount", { count: fileBrowserItemCount })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
