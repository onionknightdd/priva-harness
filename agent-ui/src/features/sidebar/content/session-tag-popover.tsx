"use client"

import * as React from "react"
import { SearchIcon, TagIcon, XIcon } from "lucide-react"
import {
  AnimatePresence,
  motion,
  type Transition,
} from "motion/react"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"
import { cn } from "@/lib/utils"

import { rowHoverActionButtonClassName } from "./row-hover-action"
import { TagChip } from "./session-tag-chip"
import {
  fallbackTagColorIndex,
  MAX_SESSION_TAGS,
  type KnownSessionTag,
} from "./session-projects"

const searchTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

export function SessionTagPopover({
  session,
  knownTags,
  isMobile,
  reduceMotion,
  tagged,
  onSave,
}: {
  session: SessionInfo
  knownTags: KnownSessionTag[]
  isMobile: boolean
  reduceMotion: boolean
  tagged: boolean
  onSave: (sessionId: string, tags: string[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const [tags, setTags] = React.useState(session.tags)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isSearching, setIsSearching] = React.useState(false)
  const [tagQuery, setTagQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const searchTriggerRef = React.useRef<HTMLButtonElement>(null)
  const restoreSearchFocusRef = React.useRef(false)
  const searchIconLayoutId = React.useId()
  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : searchTransition

  React.useEffect(() => {
    if (!open) {
      setIsSearching(false)
      setTagQuery("")
      return
    }

    setTags(session.tags)
    setDraft("")
    setError(null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, session.tags])

  React.useEffect(() => {
    if (isSearching) {
      searchInputRef.current?.focus()
      return
    }

    if (restoreSearchFocusRef.current) {
      restoreSearchFocusRef.current = false
      searchTriggerRef.current?.focus()
    }
  }, [isSearching])

  const persist = async (next: string[]) => {
    setTags(next)
    setPending(true)
    setError(null)
    try {
      await onSave(session.sessionId, next)
    } catch (caught) {
      setTags(session.tags)
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t("sidebar.projects.tagSaveFailed")
      )
    } finally {
      setPending(false)
    }
  }

  const addTag = (value: string) => {
    const nextTag = value.trim()
    if (!nextTag || pending || tags.length >= MAX_SESSION_TAGS) {
      return
    }

    if (tags.some((tag) => tag.toLocaleLowerCase() === nextTag.toLocaleLowerCase())) {
      setDraft("")
      return
    }

    setDraft("")
    void persist([...tags, nextTag])
  }

  const removeTag = (tag: string) => {
    if (pending) {
      return
    }
    void persist(tags.filter((item) => item !== tag))
  }

  const closeSearch = (restoreFocus: boolean) => {
    restoreSearchFocusRef.current = restoreFocus
    setTagQuery("")
    setIsSearching(false)
  }

  const colorFor = (tag: string) =>
    session.tagColors[tag] ??
    knownTags.find((item) => item.name === tag)?.color ??
    fallbackTagColorIndex(tag)

  const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase()))
  const query = tagQuery.trim().toLocaleLowerCase()
  const candidates = knownTags.filter((item) => {
    if (selected.has(item.name.toLocaleLowerCase())) {
      return false
    }
    if (!query) {
      return true
    }
    return item.name.toLocaleLowerCase().includes(query)
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <motion.button
            type="button"
            className={cn(
              rowHoverActionButtonClassName,
              "border-0 shadow-none focus-visible:border-0 focus-visible:ring-0",
              tagged &&
                "bg-sidebar-accent text-sidebar-accent-foreground opacity-100"
            )}
            aria-label={t("sidebar.projects.tag")}
            aria-pressed={tagged}
            whileTap={reduceMotion ? undefined : { scale: 0.8 }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        }
      >
        <TagIcon
          className={cn("size-3.5", tagged && "fill-current")}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-52 gap-2 p-2.5 text-xs"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PopoverHeader className="gap-0.5">
          <PopoverTitle className="text-xs font-bold">
            {t("sidebar.projects.tagTitle")}
          </PopoverTitle>
          <PopoverDescription className="text-[11px]">
            {t("sidebar.projects.tagDescription")}
          </PopoverDescription>
        </PopoverHeader>
        <div
          className="relative flex w-full min-w-0 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 pr-6 shadow-xs focus-within:border-input focus-within:ring-0 dark:bg-input/30"
          onClick={() => inputRef.current?.focus()}
        >
          <AnimatePresence initial={false}>
            {tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                color={colorFor(tag)}
                removable
                disabled={pending}
                reduceMotion={reduceMotion}
                onRemove={() => removeTag(tag)}
              />
            ))}
          </AnimatePresence>
          {tags.length < MAX_SESSION_TAGS ? (
            <input
              ref={inputRef}
              value={draft}
              disabled={pending}
              placeholder={tags.length === 0 ? t("sidebar.projects.tagPlaceholder") : undefined}
              aria-label={t("sidebar.projects.tag")}
              className="h-5 min-w-12 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              onChange={(event) => setDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  addTag(draft)
                }
              }}
            />
          ) : null}
          {tags.length > 0 ? (
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-xs" }),
                "absolute top-0.5 right-0.5 size-5 text-muted-foreground"
              )}
              aria-label={t("sidebar.projects.clearAllTags")}
              disabled={pending}
              onClick={(event) => {
                event.stopPropagation()
                setDraft("")
                void persist([])
              }}
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </div>
        {knownTags.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              <AnimatePresence initial={false} mode="popLayout">
                {isSearching ? (
                  <motion.div
                    key="tag-search-input"
                    layout
                    className="relative h-6 w-full"
                    initial={
                      reduceMotion ? false : { opacity: 0, scaleX: 0.94 }
                    }
                    animate={{ opacity: 1, scaleX: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scaleX: 0.96 }}
                    transition={transition}
                    onBlurCapture={(event) => {
                      const nextTarget = event.relatedTarget
                      if (
                        tagQuery ||
                        (nextTarget instanceof Node &&
                          event.currentTarget.contains(nextTarget))
                      ) {
                        return
                      }
                      closeSearch(false)
                    }}
                  >
                    <motion.span
                      layoutId={searchIconLayoutId}
                      className="pointer-events-none absolute top-1/2 left-1.5 z-10 flex -translate-y-1/2 text-muted-foreground"
                      transition={transition}
                    >
                      <SearchIcon className="size-3" aria-hidden="true" />
                    </motion.span>
                    <input
                      ref={searchInputRef}
                      value={tagQuery}
                      aria-label={t("sidebar.projects.searchTags")}
                      placeholder={t("sidebar.projects.searchTagsPlaceholder")}
                      className="h-6 w-full rounded-md border-0 bg-sidebar-accent pr-6 pl-6 text-[11px] outline-none placeholder:text-muted-foreground"
                      onChange={(event) => setTagQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault()
                          closeSearch(true)
                        }
                      }}
                    />
                    <button
                      type="button"
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "icon-xs" }),
                        "absolute top-1/2 right-0.5 size-5 -translate-y-1/2 text-muted-foreground"
                      )}
                      aria-label={t("sidebar.projects.clearSearch")}
                      onClick={() => closeSearch(true)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.button
                    key="tag-search-trigger"
                    ref={searchTriggerRef}
                    type="button"
                    layout
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon-xs" }),
                      "size-5 text-muted-foreground"
                    )}
                    aria-label={t("sidebar.projects.searchTags")}
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                    transition={transition}
                    onClick={() => setIsSearching(true)}
                  >
                    <motion.span
                      layoutId={searchIconLayoutId}
                      className="flex"
                      transition={transition}
                    >
                      <SearchIcon className="size-3" aria-hidden="true" />
                    </motion.span>
                  </motion.button>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {candidates.map((item) => (
                  <TagChip
                    key={item.name}
                    tag={item.name}
                    color={item.color}
                    disabled={pending || tags.length >= MAX_SESSION_TAGS}
                    reduceMotion={reduceMotion}
                    onSelect={() => addTag(item.name)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
