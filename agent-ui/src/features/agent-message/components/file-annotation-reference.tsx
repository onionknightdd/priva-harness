import { XIcon } from "lucide-react"

import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"

import { fileAnnotationLabel, type FileAnnotation } from "../file-annotation"
import { AssistantFileReference } from "./assistant-file-reference"

export function FileAnnotationReference({ annotation, onRemove, removeLabel }: {
  annotation: FileAnnotation
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span data-file-annotation className="group/file-annotation inline">
      <AssistantFileReference path={annotation.filePath} label={fileAnnotationLabel(annotation)} wrap />
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          className={cn("ml-0.5 inline-block size-[1em] cursor-pointer rounded-xs align-[-0.125em] text-muted-foreground opacity-0 transition-opacity duration-120 group-hover/file-annotation:opacity-100 group-focus-within/file-annotation:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100", focusRing)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => { event.stopPropagation(); onRemove() }}
        >
          <XIcon aria-hidden="true" className="size-full" />
        </button>
      ) : null}
    </span>
  )
}
