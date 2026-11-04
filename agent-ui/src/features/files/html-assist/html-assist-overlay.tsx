import * as React from "react"
import { MessageCircleCodeIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { SelectionActionsPopover } from "@/components/primitives/selection-actions-popover"
import { Button } from "@/components/ui/button"
import { TooltipHint } from "@/components/ui/tooltip"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

import type { HtmlElementBox } from "./html-assist.types"
import type { useHtmlAssist } from "./use-html-assist"

type State = ReturnType<typeof useHtmlAssist>

export function HtmlAssistOverlay({ state, iframeRef, menuRef }: {
  state: State
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [, refresh] = React.useReducer((value) => value + 1, 0)
  const { assist, enabled, draft, candidate, items, geometry, revealed } = state
  React.useEffect(() => {
    const frame = iframeRef.current
    if (!frame) return
    const update = () => refresh()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    document.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      document.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [iframeRef])

  const frame = iframeRef.current
  const frameRect = frame?.getBoundingClientRect()
  const hostRect = hostRef.current?.getBoundingClientRect() ?? frameRect
  const project = (nodeId: string, initial: HtmlElementBox) => {
    const box = Object.hasOwn(geometry, nodeId) ? geometry[nodeId] : initial
    if (!box || !frameRect || !frame || !hostRect) return null
    const scaleX = frameRect.width / (frame.clientWidth || frameRect.width)
    const scaleY = frameRect.height / (frame.clientHeight || frameRect.height)
    const left = frameRect.left + box.x * scaleX, top = frameRect.top + box.y * scaleY
    const width = box.width * scaleX, height = box.height * scaleY
    if (left + width <= frameRect.left || left >= frameRect.right || top + height <= frameRect.top || top >= frameRect.bottom) return null
    return {
      style: { left: left - hostRect.left, top: top - hostRect.top, width, height },
      anchor: { left, top, right: left + width, bottom: top + height, width, height },
    }
  }
  const selected = draft ? { nodeId: draft.locator.nodeId, label: draft.label, box: draft.boxes[0] } : candidate
  const selection = selected ? project(selected.nodeId, selected.box) : null
  const reveal = revealed ? project(revealed.nodeId, revealed.box) : null
  const anchor = enabled && selection ? selection.anchor : null
  const duration = reduceMotion ? 0 : 0.12

  return (
    <>
      <div ref={hostRef} className="pointer-events-none absolute inset-0 overflow-hidden" data-html-assist-overlay>
        <AnimatePresence>
          {enabled && items.map(({ annotation }, index) => {
            const position = project(annotation.locator.nodeId, annotation.boxes[0])
            if (!position) return null
            const duplicate = items.slice(0, index).filter((item) => item.annotation.locator.nodeId === annotation.locator.nodeId).length
            return (
              <motion.div key={annotation.selectionId} style={position.style}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration }}
                className="absolute rounded-xs border-2 border-primary/70 bg-primary/3 shadow-selection-actions ring-2 ring-background"
                data-html-assist-saved={annotation.index}>
                <div className="pointer-events-auto absolute -top-3 flex h-6 items-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground shadow-sm"
                  style={{ left: 4 + duplicate * 42 }}>
                  <span className="min-w-3 text-center tabular-nums">{annotation.index}</span>
                  <TooltipHint content={t("filePreview.officeAssist.remove", { index: annotation.index })}>
                    <Button variant="ghost" size="icon-xs" className="ml-0.5 size-5 rounded-full text-inherit hover:bg-primary-foreground/15 hover:text-inherit"
                      aria-label={t("filePreview.officeAssist.remove", { index: annotation.index })} onClick={() => assist?.remove(annotation.selectionId)}>
                      <XIcon aria-hidden="true" className="size-3" />
                    </Button>
                  </TooltipHint>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
        <AnimatePresence>
          {enabled && selection && selected && (
            <motion.div key={draft ? "draft" : "hover"} style={selection.style}
              layout={!draft && !reduceMotion} layoutDependency={selected.nodeId}
              initial={draft ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration, ease: EASE_OUT, layout: { duration, ease: EASE_OUT } }}
              className={cn("absolute rounded-xs border-2 border-primary shadow-selection-actions ring-2 ring-background", draft ? "bg-primary/6" : "bg-primary/3")}
              data-html-assist-candidate={selected.nodeId} data-html-assist-draft={draft ? "true" : undefined}>
              {draft ? (
                <Button variant="secondary" size="icon-xs" className="pointer-events-auto absolute -right-2.5 -top-2.5 size-6 rounded-full border border-border shadow-sm"
                  aria-label={t("filePreview.officeAssist.cancel")} onClick={state.cancel}>
                  <XIcon aria-hidden="true" className="size-3.5" />
                </Button>
              ) : (
                <span className="absolute -top-5 left-0 max-w-64 truncate rounded-sm bg-primary px-1 py-0.5 text-[10px] leading-3 text-primary-foreground">{selected.label}</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {revealed && reveal && !enabled && (
            <motion.div key="revealed" style={reveal.style} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration }}
              className="absolute rounded-xs border-2 border-primary bg-primary/5 shadow-selection-actions ring-2 ring-background" data-html-assist-revealed>
              <span className="absolute -top-3 left-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{revealed.index}</span>
              <Button variant="secondary" size="icon-xs" className="pointer-events-auto absolute -right-2 -top-2 size-6 rounded-full border border-border"
                aria-label={t("filePreview.officeAssist.cancel")} onClick={state.closeReveal}><XIcon aria-hidden="true" className="size-3" /></Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <SelectionActionsPopover anchorRect={anchor} menuRef={menuRef} instant={Boolean(reduceMotion)} kind="file" label={t("filePreview.selectionMenuLabel")}
        openInputActionId={draft ? "ask-agent" : undefined}
        actions={[{
          id: "ask-agent", label: t("filePreview.askAgent"), icon: <MessageCircleCodeIcon aria-hidden="true" />,
          input: {
            placeholder: t("filePreview.askAgentPlaceholder"), confirmLabel: t("filePreview.confirmAgentQuestion"),
            onOpen: state.capture, onConfirm: state.confirm,
          },
        }]} />
      {assist?.error && <p role="alert" className="absolute inset-x-3 bottom-3 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-selection-actions">{assist.error}</p>}
    </>
  )
}
