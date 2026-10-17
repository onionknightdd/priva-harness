import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react"
import { useTranslation } from "react-i18next"

import { PreviewRail, type PreviewRailItem } from "@/components/motion/preview-rail"

import { AGENT_CHAT_HEADER_HEIGHT } from "../agent-chat-layout"
import {
  USER_MESSAGE_RAIL_BOTTOM_CLEARANCE,
  USER_MESSAGE_RAIL_ITEM_MAX,
  USER_MESSAGE_RAIL_ITEM_MIN,
  userMessageRailItemSize,
  userMessageRailVisible,
  type UserMessageRailEntry,
} from "../user-message-rail"

export function UserMessageRail({
  entries,
  onJump,
  scrollRootRef,
}: {
  entries: readonly UserMessageRailEntry[]
  onJump: (entry: UserMessageRailEntry) => void
  scrollRootRef: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const emptyLabel = t("agentMessage.userMessageRailEmpty")
  const [activeId, setActiveId] = useState("")
  const [itemSize, setItemSize] = useState(USER_MESSAGE_RAIL_ITEM_MAX)
  const show = userMessageRailVisible(entries.length)
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const resolvedActiveId = byId.has(activeId) ? activeId : (entries.at(-1)?.id ?? "")

  useLayoutEffect(() => {
    const row = scrollRootRef.current
    if (!row) return
    const measure = () => {
      const available = row.clientHeight - AGENT_CHAT_HEADER_HEIGHT - USER_MESSAGE_RAIL_BOTTOM_CLEARANCE
      const fitted = userMessageRailItemSize(available, entries.length)
      const next = Math.max(USER_MESSAGE_RAIL_ITEM_MIN, Math.floor(fitted / 2))
      setItemSize((current) => current === next ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [entries.length, scrollRootRef])

  const entryKey = useMemo(() => entries.map((entry) => entry.id).join("\0"), [entries])

  useEffect(() => {
    const row = scrollRootRef.current
    const viewport = row?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
    if (!viewport) return

    // Measure only after the gesture ends. Reading bubble positions during
    // scroll forces layout on every frame, and sticky bubbles make an
    // IntersectionObserver fire continuously.
    const update = () => {
      const headerLine = viewport.getBoundingClientRect().top + AGENT_CHAT_HEADER_HEIGHT
      let active = ""
      for (const node of viewport.querySelectorAll<HTMLElement>("[data-user-message-turn]")) {
        const id = node.dataset.userMessageTurn
        if (!id) continue
        if (node.getBoundingClientRect().top <= headerLine + 1) active = id
        else {
          if (!active) active = id
          break
        }
      }
      if (active) setActiveId((current) => current === active ? current : active)
    }

    update()
    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 120)
    }
    viewport.addEventListener("scroll", schedule, { passive: true })
    viewport.addEventListener("scrollend", update)
    return () => {
      window.clearTimeout(timer)
      viewport.removeEventListener("scroll", schedule)
      viewport.removeEventListener("scrollend", update)
    }
  }, [entryKey, scrollRootRef])

  const items = useMemo(() => entries.map((entry) => ({
    id: entry.id,
    label: entry.label || emptyLabel,
  })), [emptyLabel, entries])

  const renderPreview = useCallback((item: PreviewRailItem) => {
    const entry = byId.get(item.id)
    if (!entry) return null
    return <UserMessageRailPreview entry={entry} fallback={emptyLabel} />
  }, [byId, emptyLabel])

  if (!show) return null

  return (
    <div
      data-slot="user-message-rail"
      className="ml-4 hidden h-full w-12 shrink-0 @min-[640px]/agent-message:block"
      style={{
        "--user-message-rail-top": `${AGENT_CHAT_HEADER_HEIGHT}px`,
        "--user-message-rail-bottom": `${USER_MESSAGE_RAIL_BOTTOM_CLEARANCE}px`,
      } as CSSProperties}
    >
      <PreviewRail
        items={items}
        label={t("agentMessage.userMessageRail")}
        activeId={resolvedActiveId}
        onActiveChange={setActiveId}
        onItemSelect={(item) => {
          const entry = byId.get(item.id)
          if (entry) onJump(entry)
        }}
        highlightActive
        itemSize={itemSize}
        renderPreview={renderPreview}
        className="z-30 h-full min-h-0 w-12"
        railClassName="box-border min-h-0 max-h-full pt-(--user-message-rail-top) pb-(--user-message-rail-bottom)"
        previewContainerClassName="top-(--user-message-rail-top) bottom-(--user-message-rail-bottom) left-12 right-auto w-72"
        previewClassName="w-72 max-w-none"
      />
    </div>
  )
}

const REPLY_SUFFIX = "......"

function UserMessageRailPreview({
  entry,
  fallback,
}: {
  entry: UserMessageRailEntry
  fallback: string
}) {
  return (
    <div
      data-slot="preview-rail-card"
      className="w-72 rounded-[calc(var(--radius-2xl)-4px)] border border-border bg-card px-[calc((var(--radius-2xl)-4px)/2-1px+2px)] py-[calc((var(--radius-2xl)-4px)/2-1px+2px)] shadow-sm"
    >
      <p data-slot="preview-rail-title" className="truncate text-xs text-foreground">
        {entry.label || fallback}
      </p>
      {entry.reply ? <RailReply text={entry.reply} /> : null}
    </div>
  )
}

function RailReply({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(text)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node || node.clientWidth === 0) return
    const next = clampToBox(node, text, REPLY_SUFFIX)
    setShown((current) => current === next ? current : next)
  }, [text])

  return (
    <div
      ref={ref}
      data-slot="preview-rail-description"
      className="mt-[calc(0.25rem+1px)] max-h-[2lh] overflow-hidden text-xs leading-5 font-medium text-muted-foreground/60 [overflow-wrap:anywhere]"
    >
      {shown}
    </div>
  )
}

function clampToBox(node: HTMLElement, text: string, suffix: string): string {
  const fits = (value: string) => {
    node.textContent = value
    return node.scrollHeight <= node.clientHeight + 1
  }
  if (fits(text)) return text
  let low = 0
  let high = text.length
  let best = suffix
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = `${text.slice(0, mid).trimEnd()}${suffix}`
    if (fits(candidate)) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}
