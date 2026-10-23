import * as React from "react"
import { MessageCircleCodeIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { SelectionActionsPopover } from "@/components/primitives/selection-actions-popover"
import { Button } from "@/components/ui/button"
import { TooltipHint } from "@/components/ui/tooltip"
import type { OfficeFileAnnotation } from "@/features/agent-message/file-annotation"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

import { PreviewCursor } from "../preview/preview-cursor"
import { useOfficeAssist } from "./office-assist-provider"
import type { OfficeAssistSurface, OfficeElementBox, OfficeElementTarget } from "./office-assist.types"

type ProjectedBox = { left: number; top: number; width: number; height: number; rotation: number }

function targetKey(target: OfficeElementTarget | null) {
  return target ? JSON.stringify([target.elementType, target.locator, target.boxes.map((box) => box.surfaceIndex)]) : ""
}

function project(box: OfficeElementBox, surface: OfficeAssistSurface): ProjectedBox | null {
  const canvas = surface.getCanvas(box.surfaceIndex)
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const units = surface.unitsPerCssPixel(box.surfaceIndex)
  if (rect.width <= 0 || rect.height <= 0 || !(units > 0)) return null
  return {
    left: rect.left + box.x / units,
    top: rect.top + box.y / units,
    width: box.width / units,
    height: box.height / units,
    rotation: box.rotation ?? 0,
  }
}

function axisBounds(box: ProjectedBox) {
  const angle = box.rotation * Math.PI / 180
  const width = Math.abs(box.width * Math.cos(angle)) + Math.abs(box.height * Math.sin(angle))
  const height = Math.abs(box.width * Math.sin(angle)) + Math.abs(box.height * Math.cos(angle))
  const left = box.left + (box.width - width) / 2
  const top = box.top + (box.height - height) / 2
  return { left, top, right: left + width, bottom: top + height, width, height }
}

function canvasIndex(canvas: HTMLCanvasElement) {
  const slide = canvas.parentElement?.dataset.slideIndex
  const page = canvas.parentElement?.querySelector<HTMLElement>('[data-ooxml-selection-surface="docx"][data-page-index]')?.dataset.pageIndex
  const value = slide ?? page
  return value === undefined ? null : Number(value)
}

export function OfficeAssistOverlay({ fileId, containerRef, surface }: {
  fileId: string
  containerRef: React.RefObject<HTMLDivElement | null>
  surface: OfficeAssistSurface | null
}) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const assist = useOfficeAssist()
  const workspace = useOptionalWorkspaceFiles()
  const menuRef = React.useRef<HTMLDivElement>(null)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const pointRef = React.useRef<{ x: number; y: number; parent: boolean } | null>(null)
  const candidateRef = React.useRef<OfficeElementTarget | null>(null)
  const [candidate, setCandidate] = React.useState<OfficeElementTarget | null>(null)
  const [animateCandidate, setAnimateCandidate] = React.useState(false)
  const [revealed, setRevealed] = React.useState<OfficeFileAnnotation | null>(null)
  const [projection, setProjection] = React.useState(0)
  const live = React.useRef({ assist, surface })
  live.current = { assist, surface }
  const active = assist?.activeFile?.id === fileId
  const enabled = Boolean(active && assist?.enabled)
  const draft = active ? assist?.draft ?? null : null
  const selected = draft ?? candidate
  const registerRevision = assist?.registerRevision
  const activePath = assist?.activeFile?.path
  const reportError = assist?.reportError

  React.useEffect(() => {
    if (surface) registerRevision?.(fileId, surface.fileRevision)
  }, [registerRevision, fileId, surface])

  React.useEffect(() => {
    candidateRef.current = null
    setCandidate(null)
    setAnimateCandidate(false)
  }, [assist?.clearEpoch, enabled])

  React.useEffect(() => {
    const pending = workspace?.pendingAnnotation
    if (!surface || !pending || !active || pending.filePath !== activePath) return
    if (pending.fileRevision !== surface.fileRevision) {
      reportError?.(t("filePreview.officeAssist.fileChanged"))
    } else {
      setRevealed(pending)
      surface.scrollTo(pending.boxes[0].surfaceIndex)
    }
    workspace?.clearPendingAnnotation(pending.selectionId)
  }, [active, activePath, reportError, surface, t, workspace])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container || !surface) return
    let frame = 0
    let generation = 0
    const refresh = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setAnimateCandidate(false)
        setProjection((value) => value + 1)
        if (pointRef.current && !live.current.assist?.draft) void hit(pointRef.current)
      })
    }
    const updateCandidate = (target: OfficeElementTarget | null) => {
      if (targetKey(candidateRef.current) === targetKey(target)) return
      candidateRef.current = target
      setCandidate(target)
    }
    const hit = async (point: { x: number; y: number; parent: boolean }, lock = false) => {
      const request = ++generation
      const current = live.current.assist
      if (!current?.enabled || current.activeFile?.id !== fileId || current.draft) return
      const canvas = Array.from(container.querySelectorAll("canvas")).find((element) => {
        const rect = element.getBoundingClientRect()
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
      })
      if (!canvas) { updateCandidate(null); return }
      const index = canvasIndex(canvas)
      if (index === null) { updateCandidate(null); return }
      const rect = canvas.getBoundingClientRect()
      const units = surface.unitsPerCssPixel(index)
      try {
        const target = await surface.picker.hitTest(index, { x: (point.x - rect.left) * units, y: (point.y - rect.top) * units }, { parent: point.parent })
        const latest = live.current.assist
        if (request !== generation || !latest?.enabled || latest.draft || latest.activeFile?.id !== fileId || latest.clearEpoch !== current.clearEpoch) return
        updateCandidate(target)
        if (lock && target) latest.lock(target)
      } catch (reason) {
        if (request !== generation) return
        updateCandidate(null)
        live.current.assist?.reportError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    let hitFrame = 0
    const scheduleHit = (point: { x: number; y: number; parent: boolean }) => {
      pointRef.current = point
      if (hitFrame) return
      hitFrame = requestAnimationFrame(() => {
        hitFrame = 0
        if (pointRef.current) void hit(pointRef.current)
      })
    }
    const inMenuCorridor = (x: number, y: number) => {
      const target = candidateRef.current
      const menu = menuRef.current?.getBoundingClientRect()
      if (!target || !menu) return false
      const targetBox = target.boxes.map((box) => project(box, surface)).find((box) => box !== null)
      if (!targetBox) return false
      const bounds = axisBounds(targetBox)
      const below = menu.top >= bounds.bottom - 2
      const above = menu.bottom <= bounds.top + 2
      return (below || above) && x >= Math.min(bounds.left, menu.left) - 8 && x <= Math.max(bounds.right, menu.right) + 8 &&
        y >= (below ? bounds.bottom - 2 : menu.bottom - 2) && y <= (below ? menu.top + 2 : bounds.top + 2)
    }
    const onMove = (event: PointerEvent) => {
      if (event.buttons || event.pointerType === "touch") return
      const current = live.current.assist
      if (!current?.enabled || current.activeFile?.id !== fileId || current.draft) return
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest("[data-office-assist-overlay]")) return
      if (inMenuCorridor(event.clientX, event.clientY)) return
      setAnimateCandidate(true)
      scheduleHit({ x: event.clientX, y: event.clientY, parent: event.altKey })
    }
    let cancelledOnDown = false
    let pressedTarget: OfficeElementTarget | null = null
    const overPage = (event: MouseEvent) => event.target instanceof Node && container.contains(event.target) &&
      Array.from(container.querySelectorAll("canvas")).some((canvas) => {
        const rect = canvas.getBoundingClientRect()
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      })
    const cancelHit = () => {
      ++generation
      cancelAnimationFrame(hitFrame)
      hitFrame = 0
    }
    const onDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return
      cancelledOnDown = false
      pressedTarget = null
      const current = live.current.assist
      if (!current?.enabled || current.activeFile?.id !== fileId) return
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest("[data-office-assist-overlay], [data-office-assist-controls]")) return
      if (current.draft) {
        cancelledOnDown = true
        cancelHit()
        current.cancelDraft()
        updateCandidate(null)
        return
      }
      if (!overPage(event)) return
      setAnimateCandidate(false)
      // Preserve the displayed hover target until click, including Alt parent selection.
      pressedTarget = candidateRef.current
      cancelHit()
      if (event.pointerType !== "touch") {
        event.preventDefault()
        event.stopPropagation()
        container.focus({ preventScroll: true })
      }
    }
    const onClick = (event: MouseEvent) => {
      const cancelled = cancelledOnDown
      cancelledOnDown = false
      const target = pressedTarget ?? candidateRef.current
      pressedTarget = null
      const current = live.current.assist
      if (event.button !== 0 || !current?.enabled || current.activeFile?.id !== fileId || !overPage(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (cancelled || current.draft) return
      cancelHit()
      const point = { x: event.clientX, y: event.clientY, parent: event.altKey }
      pointRef.current = point
      if (target) current.lock(target)
      else void hit(point, true)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.type === "keyup" && event.key !== "Alt") return
      const current = live.current.assist
      if (!current?.enabled || current.activeFile?.id !== fileId || event.isComposing || event.keyCode === 229) return
      setAnimateCandidate(false)
      if (event.key === "Alt" && pointRef.current && !current.draft) {
        scheduleHit({ ...pointRef.current, parent: event.altKey })
      } else if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest("[data-selection-action-input]"))) {
        ++generation
        current.cancelDraft()
        updateCandidate(null)
        container.focus({ preventScroll: true })
      } else if (event.key === "Tab" && !event.shiftKey && candidateRef.current &&
          event.target instanceof Node && container.contains(event.target)) {
        event.preventDefault()
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
      }
    }
    const onBlur = () => {
      ++generation
      updateCandidate(null)
      const current = live.current.assist
      if (current?.activeFile?.id === fileId) current.cancelDraft()
    }
    const observer = new ResizeObserver(refresh)
    observer.observe(container)
    const mutations = new MutationObserver(refresh)
    mutations.observe(container, { childList: true, subtree: true })
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("click", onClick, true)
    document.addEventListener("keydown", onKey)
    document.addEventListener("keyup", onKey)
    document.addEventListener("scroll", refresh, true)
    window.addEventListener("resize", refresh)
    window.addEventListener("blur", onBlur)
    refresh()
    return () => {
      ++generation
      cancelAnimationFrame(frame)
      cancelAnimationFrame(hitFrame)
      observer.disconnect()
      mutations.disconnect()
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("keyup", onKey)
      document.removeEventListener("scroll", refresh, true)
      window.removeEventListener("resize", refresh)
      window.removeEventListener("blur", onBlur)
    }
  }, [containerRef, fileId, surface])

  if (!assist || !surface || !active) return null
  const host = hostRef.current?.getBoundingClientRect() ?? containerRef.current?.getBoundingClientRect()
  const visible = (target: { boxes: OfficeElementBox[] }) => {
    const perSurface = new Map<number, number>()
    return target.boxes.flatMap((box, index) => {
      const ordinal = perSurface.get(box.surfaceIndex) ?? 0
      perSurface.set(box.surfaceIndex, ordinal + 1)
      const projected = project(box, surface)
      if (!projected || !host) return []
      const axis = axisBounds(projected)
      if (axis.right <= host.left || axis.left >= host.right || axis.bottom <= host.top || axis.top >= host.bottom) return []
      return [{ box: projected, index, surfaceKey: `${box.surfaceIndex}:${ordinal}` }]
    })
  }
  const targetBoxes = selected ? visible(selected) : []
  const pointer = pointRef.current
  const anchorBox = targetBoxes.find(({ box }) => {
    const bounds = axisBounds(box)
    return pointer && pointer.x >= bounds.left && pointer.x <= bounds.right && pointer.y >= bounds.top && pointer.y <= bounds.bottom
  }) ?? targetBoxes[0]
  const anchor = enabled && anchorBox ? axisBounds(anchorBox.box) : null
  const style = (box: ProjectedBox): React.CSSProperties => ({
    left: box.left - (host?.left ?? 0), top: box.top - (host?.top ?? 0), width: box.width, height: box.height,
    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
  })
  const closeDraft = () => { assist.cancelDraft(); candidateRef.current = null; setCandidate(null) }
  const saved = enabled ? assist.items : []
  const animateHover = animateCandidate && !draft && !reduceMotion

  return (
    <>
      <PreviewCursor targetRef={containerRef} enabled={enabled} />
      <div ref={hostRef} className="pointer-events-none absolute inset-0 overflow-hidden" data-office-assist-overlay data-projection={projection}>
        <AnimatePresence>
          {saved.flatMap(({ annotation }, itemIndex) => {
            const duplicate = saved.slice(0, itemIndex).filter((item) => JSON.stringify(item.annotation.locator) === JSON.stringify(annotation.locator)).length
            return visible(annotation).map(({ box, index }) => (
              <motion.div key={annotation.selectionId + ":" + index} style={style(box)}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.12 }}
                className="group absolute rounded-xs border-2 border-primary/70 bg-primary/3 shadow-selection-actions ring-2 ring-background"
                data-office-assist-saved={annotation.index}>
                <div className="pointer-events-auto absolute -top-3 flex h-6 items-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground shadow-sm"
                  style={{ left: 4 + duplicate * 42, transform: box.rotation ? `rotate(${-box.rotation}deg)` : undefined }}>
                  <span className="min-w-3 text-center tabular-nums">{annotation.index}</span>
                  <TooltipHint content={t("filePreview.officeAssist.remove", { index: annotation.index })}>
                    <Button variant="ghost" size="icon-xs" className="ml-0.5 size-5 rounded-full text-inherit hover:bg-primary-foreground/15 hover:text-inherit"
                      aria-label={t("filePreview.officeAssist.remove", { index: annotation.index })} onClick={() => assist.remove(annotation.selectionId)}>
                      <XIcon aria-hidden="true" className="size-3" />
                    </Button>
                  </TooltipHint>
                </div>
              </motion.div>
            ))
          })}
        </AnimatePresence>
        <AnimatePresence key={draft ? "draft" : "hover"}>
          {enabled && targetBoxes.map(({ box, surfaceKey }) => (
            <motion.div key={surfaceKey}
              layout={animateHover} layoutDependency={targetKey(selected)}
              style={{ ...style(box), transform: undefined }} className="absolute"
              initial={draft ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.12, ease: EASE_OUT,
                layout: { duration: animateHover ? 0.12 : 0, ease: EASE_OUT } }}>
              <motion.div initial={false} animate={{ transform: `rotate(${box.rotation}deg)` }}
                transition={{ duration: animateHover ? 0.12 : 0, ease: EASE_OUT }}
                className={cn("absolute inset-0 rounded-xs border-2 border-primary shadow-selection-actions ring-2 ring-background", draft ? "bg-primary/6" : "bg-primary/3")}
                data-office-assist-candidate={selected?.elementType} data-office-assist-draft={draft ? "true" : undefined}>
                {draft ? (
                  <Button variant="secondary" size="icon-xs" className="pointer-events-auto absolute -right-2.5 -top-2.5 size-6 rounded-full border border-border shadow-sm"
                    aria-label={t("filePreview.officeAssist.cancel")} onClick={closeDraft} style={{ transform: box.rotation ? `rotate(${-box.rotation}deg)` : undefined }}>
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </Button>
                ) : (
                  <span className="absolute -top-5 left-0 rounded-sm bg-primary px-1 py-0.5 text-[10px] leading-3 text-primary-foreground"
                    style={{ transform: box.rotation ? `rotate(${-box.rotation}deg)` : undefined }}>
                    {t("filePreview.officeAssist.element." + selected?.elementType)}
                  </span>
                )}
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {revealed && !enabled && visible(revealed).map(({ box, index }) => (
            <motion.div key={"revealed:" + index} style={style(box)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute rounded-xs border-2 border-primary bg-primary/5 shadow-selection-actions ring-2 ring-background" data-office-assist-revealed>
              <span className="absolute -top-3 left-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{revealed.index}</span>
              <Button variant="secondary" size="icon-xs" className="pointer-events-auto absolute -right-2 -top-2 size-6 rounded-full border border-border"
                aria-label={t("filePreview.officeAssist.cancel")} onClick={() => setRevealed(null)}><XIcon className="size-3" /></Button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <SelectionActionsPopover anchorRect={anchor} menuRef={menuRef} instant={Boolean(reduceMotion)} kind="file" label={t("filePreview.selectionMenuLabel")}
        openInputActionId={draft ? "ask-agent" : undefined}
        actions={[{
          id: "ask-agent", label: t("filePreview.askAgent"), icon: <MessageCircleCodeIcon aria-hidden="true" />,
          input: {
            placeholder: t("filePreview.askAgentPlaceholder"), confirmLabel: t("filePreview.confirmAgentQuestion"),
            onOpen: () => { const target = candidateRef.current; if (target) assist.lock(target) },
            onConfirm: (question) => assist.confirm(question),
          },
        }]} />
      {assist.error && <p role="alert" className="absolute inset-x-3 bottom-3 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-selection-actions">{assist.error}</p>}
    </>
  )
}
