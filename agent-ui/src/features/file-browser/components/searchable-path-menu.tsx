import * as React from "react"
import gsap from "gsap"
import { FolderIcon, SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"

import type {
  FileBrowserBreadcrumbEntry,
  FileBrowserItem,
} from "../file-browser-data"

type PathMenuEntry = Pick<
  FileBrowserBreadcrumbEntry,
  "name" | "path" | "type"
>

function SearchablePathMenuItem({
  entry,
  onNavigate,
}: {
  entry: PathMenuEntry
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
}) {
  const [marqueeActive, setMarqueeActive] = React.useState(false)

  return (
    <DropdownMenuItem
      data-path-menu-result
      className="min-w-0"
      title={entry.path}
      onPointerEnter={() => setMarqueeActive(true)}
      onPointerLeave={() => setMarqueeActive(false)}
      onFocus={() => setMarqueeActive(true)}
      onBlur={() => setMarqueeActive(false)}
      onClick={() => onNavigate(entry.path, entry.type)}
    >
      <FolderIcon aria-hidden="true" />
      <OverflowMarquee
        active={marqueeActive}
        playback="once"
        className="min-w-0 flex-1"
      >
        {entry.name}
      </OverflowMarquee>
    </DropdownMenuItem>
  )
}

export function SearchablePathMenuContent({
  entries,
  open,
  onNavigate,
}: {
  entries: PathMenuEntry[]
  open: boolean
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
}) {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const resultsRef = React.useRef<HTMLDivElement>(null)
  const [query, setQuery] = React.useState("")
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = normalizedQuery
    ? entries.filter((entry) =>
        entry.name.toLocaleLowerCase().includes(normalizedQuery)
      )
    : entries

  React.useEffect(() => {
    if (!open) {
      setQuery("")
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [open])

  React.useLayoutEffect(() => {
    const results = resultsRef.current

    if (
      !results ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const items = results.querySelectorAll<HTMLElement>(
      "[data-path-menu-result]"
    )

    if (items.length === 0) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y: 3 },
        {
          opacity: 1,
          y: 0,
          duration: 0.16,
          stagger: 0.015,
          ease: "power1.out",
          clearProps: "opacity,transform",
        }
      )
    }, results)

    return () => context.revert()
  }, [normalizedQuery])

  return (
    <DropdownMenuContent
      align="start"
      className="flex h-72 min-h-72 w-64! min-w-64! max-w-64 flex-col overflow-hidden! p-0!"
    >
      <div className="shrink-0 border-b p-1.5">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            aria-label={t("fileBrowser.directorySearchLabel")}
            placeholder={t("fileBrowser.directorySearchPlaceholder")}
            className="h-8 border-0 bg-muted/60 pl-8 text-xs shadow-none focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                event.stopPropagation()
              }
            }}
          />
        </div>
      </div>

      <div
        ref={resultsRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 [scrollbar-gutter:stable]"
      >
        {filteredEntries.length > 0 ? (
          filteredEntries.map((entry) => (
            <SearchablePathMenuItem
              key={entry.path}
              entry={entry}
              onNavigate={onNavigate}
            />
          ))
        ) : (
          <div
            role="status"
            className="flex min-h-24 items-center justify-center px-4 text-center text-xs text-muted-foreground"
          >
            {t("fileBrowser.noDirectoryResults", {
              query: query.trim(),
            })}
          </div>
        )}
      </div>
    </DropdownMenuContent>
  )
}
