"use client"

import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

const MIN_WIDTH = 160
const MIN_HEIGHT = 120
const KEY_STEP = 8

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

type BoxSize = {
  width: number
  height: number
}

type DragSession = {
  pointerId: number
  edge: ResizeEdge
  startX: number
  startY: number
  startWidth: number
  startHeight: number
}

const HANDLE_META: {
  edge: ResizeEdge
  className: string
  cursor: string
}[] = [
  {
    edge: "n",
    className: "left-3 right-14 -top-1 h-3 cursor-ns-resize",
    cursor: "ns-resize",
  },
  {
    edge: "s",
    className: "left-3 right-3 -bottom-1 h-3 cursor-ns-resize",
    cursor: "ns-resize",
  },
  {
    edge: "e",
    className: "top-8 bottom-3 -right-1 w-3 cursor-ew-resize",
    cursor: "ew-resize",
  },
  {
    edge: "w",
    className: "top-8 bottom-3 -left-1 w-3 cursor-ew-resize",
    cursor: "ew-resize",
  },
  {
    edge: "ne",
    className: "-top-1 -right-1 size-3 cursor-nesw-resize",
    cursor: "nesw-resize",
  },
  {
    edge: "nw",
    className: "-top-1 -left-1 size-3 cursor-nwse-resize",
    cursor: "nwse-resize",
  },
  {
    edge: "se",
    className: "-bottom-1 -right-1 size-3 cursor-nwse-resize",
    cursor: "nwse-resize",
  },
  {
    edge: "sw",
    className: "-bottom-1 -left-1 size-3 cursor-nesw-resize",
    cursor: "nesw-resize",
  },
]

function usesNorth(edge: ResizeEdge) {
  return edge === "n" || edge === "ne" || edge === "nw"
}

function usesSouth(edge: ResizeEdge) {
  return edge === "s" || edge === "se" || edge === "sw"
}

function usesEast(edge: ResizeEdge) {
  return edge === "e" || edge === "ne" || edge === "se"
}

function usesWest(edge: ResizeEdge) {
  return edge === "w" || edge === "nw" || edge === "sw"
}

function nextBox(
  session: DragSession,
  clientX: number,
  clientY: number
): BoxSize {
  const dx = clientX - session.startX
  const dy = clientY - session.startY
  let width = session.startWidth
  let height = session.startHeight

  // Left/top edges stay put. Dragging them still resizes, but the extra
  // space appears on the right/bottom. Pulling left or up enlarges.
  if (usesWest(session.edge) || usesEast(session.edge)) {
    const delta = usesWest(session.edge) ? -dx : dx
    width = Math.max(MIN_WIDTH, session.startWidth + delta)
  }

  if (usesNorth(session.edge) || usesSouth(session.edge)) {
    const delta = usesNorth(session.edge) ? -dy : dy
    height = Math.max(MIN_HEIGHT, session.startHeight + delta)
  }

  return { width, height }
}

function restoreBodyInteraction(previous: {
  cursor: string
  userSelect: string
} | null) {
  if (!previous) {
    return
  }

  document.body.style.cursor = previous.cursor
  document.body.style.userSelect = previous.userSelect
}

function ResizeHandle({
  edge,
  className,
  cursor,
  label,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
}: {
  edge: ResizeEdge
  className: string
  cursor: string
  label: string
  dragging: boolean
  onPointerDown: React.PointerEventHandler<HTMLDivElement>
  onPointerMove: React.PointerEventHandler<HTMLDivElement>
  onPointerUp: React.PointerEventHandler<HTMLDivElement>
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>
  onLostPointerCapture: React.PointerEventHandler<HTMLDivElement>
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>
}) {
  const reduceMotion = Boolean(useReducedMotion())
  const [hovered, setHovered] = React.useState(false)
  const active = hovered || dragging
  const horizontal = edge === "n" || edge === "s"
  const vertical = edge === "e" || edge === "w"

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={
        horizontal ? "horizontal" : vertical ? "vertical" : undefined
      }
      tabIndex={0}
      title={label}
      data-slot="mermaid-resize-handle"
      data-edge={edge}
      data-dragging={dragging ? "true" : undefined}
      className={cn(
        "absolute z-20 touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={onKeyDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <motion.span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute bg-ring",
          horizontal && "inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full",
          vertical && "inset-y-6 left-1/2 w-0.5 -translate-x-1/2 rounded-full",
          !horizontal && !vertical && "inset-[3px] rounded-[1px]"
        )}
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 0.16, ease: EASE_OUT }
        }
      />
    </div>
  )
}

export function MermaidEdgeResize({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<DragSession | null>(null)
  const bodyStyleRef = React.useRef<{
    cursor: string
    userSelect: string
  } | null>(null)
  const [box, setBox] = React.useState<BoxSize | null>(null)
  const [dragEdge, setDragEdge] = React.useState<ResizeEdge | null>(null)
  const label = t("common.resizeDiagram")

  const finishDrag = React.useCallback(() => {
    dragRef.current = null
    setDragEdge(null)
    restoreBodyInteraction(bodyStyleRef.current)
    bodyStyleRef.current = null
  }, [])

  const applyFromPointer = React.useCallback(
    (clientX: number, clientY: number) => {
      const session = dragRef.current

      if (!session) {
        return
      }

      setBox(nextBox(session, clientX, clientY))
    },
    []
  )

  const startDrag = React.useCallback(
    (edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      const node = rootRef.current

      if (!node) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const rect = node.getBoundingClientRect()
      const handle = HANDLE_META.find((item) => item.edge === edge)
      dragRef.current = {
        pointerId: event.pointerId,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: box?.width ?? rect.width,
        startHeight: box?.height ?? rect.height,
      }
      bodyStyleRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      }
      document.body.style.cursor = handle?.cursor ?? "nwse-resize"
      document.body.style.userSelect = "none"
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragEdge(edge)
    },
    [box]
  )

  const moveFromKeyboard = React.useCallback(
    (edge: ResizeEdge, dx: number, dy: number) => {
      const node = rootRef.current

      if (!node) {
        return
      }

      const rect = node.getBoundingClientRect()
      const session: DragSession = {
        pointerId: -1,
        edge,
        startX: 0,
        startY: 0,
        startWidth: box?.width ?? rect.width,
        startHeight: box?.height ?? rect.height,
      }

      setBox(nextBox(session, dx, dy))
    },
    [box]
  )

  React.useEffect(() => {
    return () => {
      restoreBodyInteraction(bodyStyleRef.current)
    }
  }, [])

  return (
    <div className={cn("my-4 w-full max-w-full", className)}>
      <div
        ref={rootRef}
        data-slot="mermaid-edge-resize"
        data-resized={box ? "true" : undefined}
        data-resizing={dragEdge ? "true" : undefined}
        className="relative w-full max-w-full"
        style={
          box
            ? {
                width: box.width,
                height: box.height,
              }
            : undefined
        }
      >
        {children}
        {HANDLE_META.map((handle) => (
          <ResizeHandle
            key={handle.edge}
            edge={handle.edge}
            className={handle.className}
            cursor={handle.cursor}
            label={label}
            dragging={dragEdge === handle.edge}
            onPointerDown={(event) => startDrag(handle.edge, event)}
            onPointerMove={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) {
                return
              }

              applyFromPointer(event.clientX, event.clientY)
            }}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) {
                return
              }

              applyFromPointer(event.clientX, event.clientY)
              finishDrag()
            }}
            onPointerCancel={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) {
                finishDrag()
              }
            }}
            onLostPointerCapture={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) {
                finishDrag()
              }
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP

              if (event.key === "ArrowLeft") {
                event.preventDefault()
                moveFromKeyboard(handle.edge, -step, 0)
                return
              }

              if (event.key === "ArrowRight") {
                event.preventDefault()
                moveFromKeyboard(handle.edge, step, 0)
                return
              }

              if (event.key === "ArrowUp") {
                event.preventDefault()
                moveFromKeyboard(handle.edge, 0, -step)
                return
              }

              if (event.key === "ArrowDown") {
                event.preventDefault()
                moveFromKeyboard(handle.edge, 0, step)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}
