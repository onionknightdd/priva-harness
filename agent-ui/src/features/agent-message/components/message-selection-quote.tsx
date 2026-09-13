import { MessageCircleCodeIcon, XIcon } from "lucide-react"

import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"
import { TooltipHint } from "@/components/ui/tooltip"

import { messageSelectionPreview, parseMessageSelections, type MessageSelection } from "../message-select-action"

export function MessageSelectionQuote({ selection, onRemove, removeLabel }: {
  selection: MessageSelection
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <TooltipHint content={<span className="whitespace-pre-wrap">{selection.selectedText}</span>}>
      <span data-message-selection-quote data-message-role={selection.messageRole} className="group/selection-quote inline cursor-pointer whitespace-pre-wrap break-words text-sky-600 dark:text-sky-400">
        {onRemove ? (
          <button
            type="button"
            aria-label={removeLabel}
            className={cn("relative mr-1 inline-block size-[1em] cursor-pointer rounded-xs align-[-0.125em]", focusRing)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => { event.stopPropagation(); onRemove() }}
          >
            <MessageCircleCodeIcon aria-hidden="true" className="absolute inset-0 size-full transition-opacity duration-120 group-hover/selection-quote:opacity-0 group-focus-within/selection-quote:opacity-0 motion-reduce:transition-none [@media(hover:none)]:opacity-0" />
            <XIcon aria-hidden="true" className="absolute inset-0 size-full opacity-0 transition-opacity duration-120 group-hover/selection-quote:opacity-100 group-focus-within/selection-quote:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100" />
          </button>
        ) : (
          <MessageCircleCodeIcon aria-hidden="true" className="mr-1 inline-block size-[1em] align-[-0.125em]" />
        )}
        <span>{`"${messageSelectionPreview(selection.selectedText)}"`}</span>
      </span>
    </TooltipHint>
  )
}

export function MessageSelectionContent({ content }: { content: string }) {
  return parseMessageSelections(content).map((part, index) => part.type === "text"
    ? part.text
    : <MessageSelectionQuote key={index} selection={part.selection} />)
}
