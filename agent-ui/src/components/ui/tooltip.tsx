import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { useRender } from "@base-ui/react/use-render"
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react"

import { PopupsArmedContext } from "@/components/ui/popups-armed-context"
import { tooltipMotion } from "@/lib/popup-motion"
import { cn } from "@/lib/utils"

const TOOLTIP_DELAY = 1000
const TOOLTIP_RESET_TIMEOUT = 400

// Inside an unarmed PopupsArmedContext subtree the Base UI root and content
// stay unmounted and the trigger renders its element alone. Arming remounts
// the trigger, so the root remembers whether it held focus and restores it.
const HeldFocusContext = createContext<RefObject<boolean> | null>(null)

// One delay group spans the app: wait on first hover, skip the delay between
// hints, and reset after the pointer has left all hints for 400ms.
function TooltipProvider(props: Omit<TooltipPrimitive.Provider.Props, "delay" | "timeout">) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      {...props}
      delay={TOOLTIP_DELAY}
      timeout={TOOLTIP_RESET_TIMEOUT}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  const armed = useContext(PopupsArmedContext)
  const heldFocus = useRef(false)
  // Payload render functions need the root; only plain children can defer.
  const plainChildren = typeof props.children === "function" ? null : props.children
  return (
    <HeldFocusContext.Provider value={heldFocus}>
      {!armed && plainChildren !== null ? (
        plainChildren
      ) : (
        <TooltipPrimitive.Root data-slot="tooltip" {...props} />
      )}
    </HeldFocusContext.Provider>
  )
}

function TooltipTrigger(props: Omit<TooltipPrimitive.Trigger.Props, "delay">) {
  return <DeferrableTrigger data-slot="tooltip-trigger" {...props} />
}

function DeferrableTrigger(props: Omit<TooltipPrimitive.Trigger.Props, "delay">) {
  const armed = useContext(PopupsArmedContext)
  return armed ? <ArmedTrigger {...props} /> : <PlainTrigger {...props} />
}

function ArmedTrigger(props: Omit<TooltipPrimitive.Trigger.Props, "delay">) {
  const heldFocus = useContext(HeldFocusContext)
  const element = useRef<HTMLElement | null>(null)
  const setElement = useCallback((node: HTMLElement | null) => {
    element.current = node
  }, [])
  useLayoutEffect(() => {
    if (heldFocus?.current) {
      heldFocus.current = false
      element.current?.focus()
    }
  }, [heldFocus])
  return <TooltipPrimitive.Trigger ref={setElement} {...props} delay={TOOLTIP_DELAY} />
}

function PlainTrigger({
  render,
  className,
  disabled: _disabled,
  closeDelay: _closeDelay,
  closeOnClick: _closeOnClick,
  handle: _handle,
  payload: _payload,
  ...props
}: Omit<TooltipPrimitive.Trigger.Props, "delay">) {
  const heldFocus = useContext(HeldFocusContext)
  return useRender({
    render: render as useRender.RenderProp<TooltipPrimitive.Trigger.State> | undefined,
    state: { open: false } satisfies TooltipPrimitive.Trigger.State,
    defaultTagName: "button",
    props: {
      ...props,
      className,
      onFocus: () => {
        if (heldFocus) heldFocus.current = true
      },
      onBlur: () => {
        if (heldFocus) heldFocus.current = false
      },
    },
  })
}

function TooltipHint({ content, children }: { content?: ReactNode; children: ReactElement }) {
  // Preserve the child's data-slot when composing buttons, tabs, and menus.
  return (
    <Tooltip disabled={content == null || content === false || content === ""}>
      <DeferrableTrigger render={children} />
      <TooltipContent className="whitespace-pre-line wrap-anywhere">{content}</TooltipContent>
    </Tooltip>
  )
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  anchor,
  hideArrow = false,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "anchor" | "side" | "sideOffset"
  > & { hideArrow?: boolean }) {
  const armed = useContext(PopupsArmedContext)
  if (!armed) return null
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            tooltipMotion,
            className
          )}
          {...props}
        >
          {children}
          {!hideArrow && <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipHint }
