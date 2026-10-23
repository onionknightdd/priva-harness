"use client"

import { useLayoutEffect, useRef, useState, type PointerEventHandler, type ReactNode } from "react"
import { Check } from "lucide-react"
import { motion, useIsPresent } from "motion/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EASE_IN_OUT, EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

// Adapted from https://www.beautifului.dev/r/selection-actions.json.
// Keep the action capsule visible while its question opens in a separate row.
export default function SelectionActions({ actions, label, instant = false, openInputActionId, onInputOpenChange, onLayoutChange, onDragStart }: {
  actions: {
    id: string
    label: string
    icon: ReactNode
    onSelect?: () => void
    input?: { placeholder: string; confirmLabel: string; onOpen?: () => void; onConfirm?: (value: string) => void }
  }[]
  label: string
  instant?: boolean
  openInputActionId?: string
  onInputOpenChange?: (open: boolean) => void
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
  const inputOpen = present && Boolean(inputAction)

  useLayoutEffect(() => {
    onInputOpenChange?.(inputOpen)
    return () => onInputOpenChange?.(false)
  }, [inputOpen, onInputOpenChange])

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

  useLayoutEffect(() => {
    // Consume an external open request once; Escape can still return to the action.
    if (present && openInputActionId) setInputActionId(openInputActionId)
  }, [openInputActionId, present])

  return (
    <motion.div
      ref={toolbarRef}
      layout="position"
      transition={{ layout: { duration: immediate ? 0 : 0.18, ease: EASE_IN_OUT } }}
      role="toolbar"
      aria-label={label}
      aria-hidden={!present}
      inert={!present}
      className="relative flex w-fit max-w-[calc(100vw-16px)] flex-col items-start gap-1.5 font-sans text-popover-foreground"
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
      <motion.div
        layout="position"
        data-selection-action-bar
        className="flex h-8 max-w-full shrink-0 items-center rounded-full bg-popover p-0.5 shadow-selection-actions ring-1 ring-foreground/10"
        transition={{ layout: { duration: immediate ? 0 : 0.18, ease: EASE_IN_OUT } }}
      >
        {actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            data-selection-action-id={action.id}
            variant="ghost"
            size="xs"
            className={cn("h-7 cursor-pointer gap-1 rounded-full px-1.25 text-xs leading-4 font-normal [&_svg]:size-3.5", immediate && "transition-none active:scale-100")}
            onClick={(event) => {
              if (action.id === inputAction?.id) {
                inputRef.current?.focus({ preventScroll: true })
              } else if (action.input) {
                action.input.onOpen?.()
                setKeyboardInteraction(event.detail === 0)
                setInputActionId(action.id)
              } else {
                action.onSelect?.()
              }
            }}
          >
            <span data-selection-action-icon aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center">
              {action.icon}
            </span>
            {action.label}
          </Button>
        ))}
      </motion.div>
      {inputAction?.input && (
        <motion.div
          key="input"
          data-selection-action-question-row
          className="flex w-72 max-w-full items-center gap-1.5"
          initial={immediate ? false : { opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: immediate ? 0 : 0.16, ease: EASE_OUT }}
        >
          <div className="relative min-w-0 flex-1">
            <Input
              ref={inputRef}
              data-selection-action-input
              aria-label={inputAction.input.placeholder}
              placeholder={inputAction.input.placeholder}
              className="h-8 rounded-md bg-popover py-0 text-xs leading-4 shadow-selection-actions focus-visible:ring-1 md:text-xs dark:bg-popover"
            />
            {onDragStart && ["inset-x-3 top-0 h-0.5", "inset-x-3 bottom-0 h-0.5", "inset-y-3 left-0 w-0.5", "inset-y-3 right-0 w-0.5"].map((edge) => (
              <span
                key={edge}
                aria-hidden="true"
                data-selection-action-drag-handle
                className={cn("absolute z-10 touch-none cursor-grab active:cursor-grabbing", edge)}
                onPointerDown={onDragStart}
              />
            ))}
          </div>
          <Button
            type="button"
            data-selection-action-confirm
            size="icon-sm"
            aria-label={inputAction.input.confirmLabel}
            className={cn("cursor-pointer rounded-md bg-black p-0 text-white shadow-selection-actions hover:bg-black/90 [&_svg]:size-3.5", immediate && "transition-none active:scale-100")}
            onClick={() => inputAction.input?.onConfirm?.(inputRef.current?.value ?? "")}
          >
            <Check aria-hidden="true" strokeWidth={3} />
          </Button>
        </motion.div>
      )}
    </motion.div>
  )
}
