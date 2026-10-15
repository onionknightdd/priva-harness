"use client"

import { useLayoutEffect, useRef, useState, type PointerEventHandler, type ReactNode } from "react"
import { Check } from "lucide-react"
import { motion, useIsPresent } from "motion/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EASE_IN_OUT, EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

// Adapted from https://www.beautifului.dev/r/selection-actions.json.
// Compact the pill's padding while retaining 28px controls.
export default function SelectionActions({ actions, label, instant = false, onLayoutChange, onDragStart }: {
  actions: {
    id: string
    label: string
    icon: ReactNode
    onSelect?: () => void
    input?: { placeholder: string; confirmLabel: string; onOpen?: () => void; onConfirm?: (value: string) => void }
  }[]
  label: string
  instant?: boolean
  onLayoutChange?: () => void
  onDragStart?: PointerEventHandler<HTMLSpanElement>
}) {
  const present = useIsPresent()
  const wasPresentRef = useRef(present)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnActionRef = useRef<string | null>(null)
  const [inputActionId, setInputActionId] = useState<string | null>(null)
  const [keyboardInteraction, setKeyboardInteraction] = useState(false)
  const inputAction = actions.find((action) => action.id === inputActionId && action.input)
  const immediate = instant || keyboardInteraction

  useLayoutEffect(() => {
    // Update the anchor position before Motion measures the new capsule bounds.
    onLayoutChange?.()
  }, [inputActionId, onLayoutChange])

  useLayoutEffect(() => {
    if (inputActionId) {
      inputRef.current?.focus({ preventScroll: true })
    } else if (returnActionRef.current) {
      const button = Array.from(toolbarRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.dataset.selectionActionId === returnActionRef.current)
      button?.focus({ preventScroll: true })
      returnActionRef.current = null
    }
  }, [inputActionId])

  useLayoutEffect(() => {
    // Keep the current shape throughout exit, resetting only if exit is interrupted.
    if (present && !wasPresentRef.current) {
      setInputActionId(null)
      setKeyboardInteraction(true)
    }
    wasPresentRef.current = present
  }, [present])

  return (
    <motion.div
      ref={toolbarRef}
      layout
      transition={{ layout: { duration: immediate ? 0 : 0.18, ease: EASE_IN_OUT } }}
      style={{ borderRadius: 9999 }}
      role="toolbar"
      aria-label={label}
      aria-hidden={!present}
      inert={!present}
      className={cn("relative flex h-8 max-w-[calc(100vw-16px)] items-center rounded-full bg-popover p-0.5 font-sans text-popover-foreground shadow-selection-actions ring-1 ring-foreground/10", inputAction ? "w-72 focus-within:ring-ring/50" : "w-fit")}
      onMouseDown={(event) => {
        if (event.target !== inputRef.current) event.preventDefault()
      }}
      onKeyDown={(event) => {
        if (inputAction) {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault()
            event.stopPropagation()
            returnActionRef.current = inputAction.id
            setKeyboardInteraction(true)
            setInputActionId(null)
          }
          return
        }
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "ArrowRight" ? (index + 1) % buttons.length
          : event.key === "ArrowLeft" ? (index - 1 + buttons.length) % buttons.length
            : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null
        if (next !== null) {
          event.preventDefault()
          buttons[next]?.focus()
        }
      }}
    >
      {inputAction && onDragStart && ["inset-x-3 top-0 h-0.5", "inset-x-3 bottom-0 h-0.5", "inset-y-3 left-0 w-0.5", "inset-y-3 right-0 w-0.5"].map((edge) => (
        <span
          key={edge}
          aria-hidden="true"
          data-selection-action-drag-handle
          className={cn("absolute z-10 touch-none cursor-grab active:cursor-grabbing", edge)}
          onPointerDown={onDragStart}
        />
      ))}
      {inputAction?.input && (
        <motion.div
          key="input"
          layout="position"
          className="min-w-0 flex-1"
          initial={immediate ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: immediate ? 0 : 0.16, ease: EASE_OUT }}
        >
          <Input
            ref={inputRef}
            data-selection-action-input
            aria-label={inputAction.input.placeholder}
            placeholder={inputAction.input.placeholder}
            className="h-7 rounded-full border-0 bg-transparent py-0 text-xs leading-4 shadow-none focus-visible:ring-0 md:text-xs dark:bg-transparent"
          />
        </motion.div>
      )}
      {actions.filter((action) => !inputAction || action.id === inputAction.id).map((action) => {
        const editing = action.id === inputAction?.id
        return (
          <Button
            key={action.id}
            type="button"
            data-selection-action-id={action.id}
            render={<motion.button layout="position" transition={{ layout: { duration: immediate ? 0 : 0.18, ease: EASE_IN_OUT } }} />}
            variant={editing ? "default" : "ghost"}
            size={editing ? "icon-xs" : "xs"}
            aria-label={editing ? action.input?.confirmLabel : undefined}
            className={cn("h-7 cursor-pointer gap-1 rounded-full text-xs leading-4 font-normal [&_svg]:size-3.5", editing ? "size-7 bg-black p-0 text-white hover:bg-black/90" : "px-1.25", immediate && "transition-none active:scale-100")}
            onClick={(event) => {
              if (editing) {
                action.input?.onConfirm?.(inputRef.current?.value ?? "")
                return
              }
              if (action.input) {
                action.input.onOpen?.()
                setKeyboardInteraction(event.detail === 0)
                setInputActionId(action.id)
              } else {
                action.onSelect?.()
              }
            }}
          >
            <motion.span
              layout="position"
              data-selection-action-icon
              aria-hidden="true"
              className="grid size-3.5 shrink-0 place-items-center"
              transition={{ layout: { duration: immediate ? 0 : 0.18, ease: EASE_IN_OUT } }}
            >
              <motion.span
                className="col-start-1 row-start-1"
                initial={false}
                animate={{ opacity: editing ? 0 : 1 }}
                transition={{ duration: immediate ? 0 : 0.12, ease: EASE_OUT }}
              >
                {action.icon}
              </motion.span>
              {action.input && (
                <motion.span
                  className="col-start-1 row-start-1"
                  initial={false}
                  animate={{ opacity: editing ? 1 : 0 }}
                  transition={{ duration: immediate ? 0 : 0.12, ease: EASE_OUT }}
                >
                  <Check strokeWidth={3} />
                </motion.span>
              )}
            </motion.span>
            {!editing && action.label}
          </Button>
        )
      })}
    </motion.div>
  )
}
