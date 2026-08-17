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

import { FileBrowserTree } from "./components/file-browser-tree"
import { fileBrowserItemCount } from "./file-browser-data"

export function FileBrowserPage() {
  const { t } = useTranslation()
  const pageRef = React.useRef<HTMLDivElement>(null)
  const refreshIconRef = React.useRef<SVGSVGElement>(null)
  const announcementTimerRef = React.useRef<number | null>(null)
  const [query, setQuery] = React.useState("")
  const [refreshVersion, setRefreshVersion] = React.useState(0)
  const [announcement, setAnnouncement] = React.useState("")

  React.useLayoutEffect(() => {
    const page = pageRef.current

    if (
      !page ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-file-browser-enter]",
        { y: 8, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.32,
          stagger: 0.05,
          ease: "power2.out",
          clearProps: "transform,opacity",
        }
      )
    }, page)

    return () => context.revert()
  }, [])

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
    <div
      ref={pageRef}
      className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0"
    >
      <div
        data-file-browser-enter
        className="flex shrink-0 items-center gap-2"
      >
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("fileBrowser.searchLabel")}
            placeholder={t("fileBrowser.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
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

      <section
        data-file-browser-enter
        aria-label={t("fileBrowser.contentLabel")}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground"
      >
        <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-3">
          <FileBrowserTree key={refreshVersion} query={query} />
        </div>
        <div className="flex h-9 shrink-0 items-center border-t px-3 text-xs text-muted-foreground">
          {t("fileBrowser.itemCount", { count: fileBrowserItemCount })}
        </div>
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
