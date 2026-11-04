import { XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { fileNameFromPath } from "@/lib/file-path"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"

import { fileAnnotationLabel, isSpatialFileAnnotation, isOfficeFileAnnotation, type FileAnnotation } from "../file-annotation"
import { AssistantFileReference } from "./assistant-file-reference"

export function FileAnnotationReference({ annotation, onRemove, removeLabel }: {
  annotation: FileAnnotation
  onRemove?: () => void
  removeLabel?: string
}) {
  const { t } = useTranslation()
  const element = isSpatialFileAnnotation(annotation) ? annotation : null
  const office = isOfficeFileAnnotation(annotation) ? annotation : null
  const label = office
    ? `${fileNameFromPath(office.filePath)} · ${t(`agentMessage.officeAnnotation.${office.kind === "document" ? "page" : "slide"}`, {
      page: office.boxes[0].surfaceIndex + 1, index: office.index,
    })}`
    : fileAnnotationLabel(annotation)
  const locator = element?.kind === "html"
    ? element.locator.selectors.join(" >>> ")
    : office ? [office.locator.part, office.locator.xpath].filter(Boolean).join("\n") : ""
  const tooltip = element ? [label, element.filePath, element.selectedText, locator].filter(Boolean).join("\n\n") : undefined
  return (
    <span data-file-annotation data-selection-id={element?.selectionId} className="group/file-annotation inline">
      <AssistantFileReference path={annotation.filePath} label={label} tooltip={tooltip}
        openOptions={element ? { previewMode: "render", annotation: element } : undefined} wrap />
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
