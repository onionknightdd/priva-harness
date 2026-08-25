"use client"

import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import { BrainIcon, ChevronDownIcon, DotIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"

interface ChainOfThoughtContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null
)

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext)
  if (!context) {
    throw new Error(
      "ChainOfThought components must be used within ChainOfThought"
    )
  }
  return context
}

export type ChainOfThoughtProps = {
  className?: string
  children?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
  }: ChainOfThoughtProps) => {
    const [uncontrolled, setUncontrolled] = useState(defaultOpen)
    const isControlled = open !== undefined
    const isOpen = isControlled ? open : uncontrolled
    const setIsOpen = useCallback(
      (next: boolean) => {
        if (!isControlled) {
          setUncontrolled(next)
        }
        onOpenChange?.(next)
      },
      [isControlled, onOpenChange]
    )

    const chainOfThoughtContext = useMemo(
      () => ({ isOpen, setIsOpen }),
      [isOpen, setIsOpen]
    )

    return (
      <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
        <Collapsible
          className={cn("not-prose flex max-w-prose flex-col gap-4", className)}
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtContext.Provider>
    )
  }
)

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
>

export const ChainOfThoughtHeader = memo(
  ({ className, children, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen } = useChainOfThought()

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          className
        )}
        {...props}
      >
        <BrainIcon className="size-4" />
        <span className="flex-1 text-left">{children ?? "Chain of Thought"}</span>
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform duration-200 motion-reduce:transition-none",
            isOpen ? "rotate-180" : "rotate-0"
          )}
        />
      </CollapsibleTrigger>
    )
  }
)

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon
  label: ReactNode
  description?: ReactNode
  status?: "complete" | "active" | "pending"
}

const stepStatusStyles = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-muted-foreground/50",
}

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon = DotIcon,
    label,
    description,
    status = "complete",
    children,
    ...props
  }: ChainOfThoughtStepProps) => (
    <div
      className={cn(
        "flex flex-col gap-2 text-sm",
        stepStatusStyles[status],
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div>{label}</div>
          {description ? (
            <div className="text-xs text-muted-foreground">{description}</div>
          ) : null}
        </div>
      </div>
      {children ? <div className="pl-6">{children}</div> : null}
    </div>
  )
)

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
  )
)

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
    <Badge
      className={cn("rounded-full px-2 py-0.5 font-normal", className)}
      variant="secondary"
      {...props}
    >
      {children}
    </Badge>
  )
)

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>

export const ChainOfThoughtContent = memo(
  ({ className, children, ...props }: ChainOfThoughtContentProps) => (
    <CollapsibleContent
      className={cn(
        "flex h-[var(--collapsible-panel-height)] flex-col gap-3 overflow-hidden transition-[height] duration-200 ease-out starting:h-0 data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none",
        className
      )}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
)

export type ChainOfThoughtImageProps = ComponentProps<"div"> & {
  caption?: string
}

export const ChainOfThoughtImage = memo(
  ({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      <div className="overflow-hidden rounded-lg border border-border/60">
        {children}
      </div>
      {caption ? (
        <p className="text-xs text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
)

ChainOfThought.displayName = "ChainOfThought"
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader"
ChainOfThoughtStep.displayName = "ChainOfThoughtStep"
ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults"
ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult"
ChainOfThoughtContent.displayName = "ChainOfThoughtContent"
ChainOfThoughtImage.displayName = "ChainOfThoughtImage"
